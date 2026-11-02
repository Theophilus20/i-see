/**
 * HTTP client for the Meta Model API and OpenAI-compatible open-weight endpoints.
 *
 * - Retries 429, 5xx, timeouts and network failures with exponential backoff and
 *   full jitter, honouring Retry-After. Never retries 400, 401, 403, 404 or 422:
 *   those will fail the same way again.
 * - A circuit breaker per host stops hammering a provider that is down and fails fast
 *   until a cool-down passes, then lets one probe request through.
 * - Errors carry the API's error envelope ({error:{message,type,param,code}}).
 * - Nothing here logs request bodies; the logger redacts keys and base64 regardless.
 */
import { log } from '../log';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly retryable: boolean,
    readonly provider: string,
    readonly type: string | null = null,
    readonly param: string | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class CancelledError extends Error {
  constructor() {
    super('Request cancelled');
    this.name = 'CancelledError';
  }
}

/** What actually went wrong underneath a bare "fetch failed", in plain words. */
const NET_CAUSES: Array<[RegExp, string]> = [
  [/ENOTFOUND|EAI_AGAIN|EAI_FAIL/, 'the address could not be looked up (DNS)'],
  [/UND_ERR_CONNECT_TIMEOUT|ETIMEDOUT|ESOCKETTIMEDOUT|UND_ERR_HEADERS_TIMEOUT/, 'the connection timed out'],
  [/ECONNREFUSED/, 'the connection was refused'],
  [/ECONNRESET|UND_ERR_SOCKET|EPIPE|ECONNABORTED|UND_ERR_CLOSED/, 'the connection was cut off'],
  [/ENETUNREACH|EHOSTUNREACH|ENETDOWN/, 'there is no route to the internet'],
  [/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|DEPTH_ZERO|ERR_TLS/, 'the secure connection was blocked (a certificate problem, usually antivirus or a proxy checking traffic)'],
];

export function networkCause(e: unknown): { code: string | null; plain: string | null } {
  const codes: string[] = [];
  const seen = new Set<unknown>();
  const walk = (x: unknown, depth: number) => {
    if (!x || typeof x !== 'object' || seen.has(x) || depth > 4) return;
    seen.add(x);
    const o = x as { code?: unknown; message?: unknown; cause?: unknown; errors?: unknown };
    if (typeof o.code === 'string') codes.push(o.code);
    if (typeof o.message === 'string') {
      const m = /\b(E[A-Z_]{3,}|UND_ERR_[A-Z_]+)\b/.exec(o.message);
      if (m) codes.push(m[1]!);
    }
    walk(o.cause, depth + 1);
    if (Array.isArray(o.errors)) for (const z of o.errors) walk(z, depth + 1);
  };
  walk(e, 0);
  for (const code of codes) {
    const hit = NET_CAUSES.find(([re]) => re.test(code));
    if (hit) return { code, plain: hit[1] };
  }
  return { code: codes[0] ?? null, plain: null };
}

let lastNetHint = 0;

const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529]);

// ---------------------------------------------------------------------------
// Circuit breaker
// ---------------------------------------------------------------------------

export interface BreakerOptions {
  /** Consecutive failed calls (after retries) before the circuit opens. */
  threshold: number;
  cooldownMs: number;
}

interface BreakerState {
  failures: number;
  openedAt: number | null;
  probing: boolean;
}

export class CircuitBreakers {
  private readonly states = new Map<string, BreakerState>();
  constructor(
    readonly options: BreakerOptions = { threshold: 5, cooldownMs: 30_000 },
    private readonly clock: () => number = Date.now,
  ) {}

  private state(key: string): BreakerState {
    let s = this.states.get(key);
    if (!s) {
      s = { failures: 0, openedAt: null, probing: false };
      this.states.set(key, s);
    }
    return s;
  }

  /** Throws if the circuit is open. In the half-open window, lets exactly one request through. */
  before(key: string, provider: string): void {
    const s = this.state(key);
    if (s.openedAt === null) return;
    const elapsed = this.clock() - s.openedAt;
    if (elapsed < this.options.cooldownMs || s.probing) {
      const wait = Math.max(1, Math.ceil((this.options.cooldownMs - elapsed) / 1000));
      throw new ApiError(`${provider} is not responding; paused for about ${wait}s before trying again.`, 503, 'circuit_open', true, provider);
    }
    s.probing = true;
  }

  success(key: string): void {
    const s = this.state(key);
    s.failures = 0;
    s.openedAt = null;
    s.probing = false;
  }

  failure(key: string): void {
    const s = this.state(key);
    s.failures++;
    s.probing = false;
    if (s.failures >= this.options.threshold) s.openedAt = this.clock();
  }

  isOpen(key: string): boolean {
    const s = this.states.get(key);
    return !!s && s.openedAt !== null && this.clock() - s.openedAt < this.options.cooldownMs;
  }
}

export const defaultBreakers = new CircuitBreakers();

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export interface HttpClientOptions {
  baseUrl: string;
  apiKey: string | null;
  provider: string;
  fetch?: typeof fetch;
  maxRetries?: number;
  timeoutMs?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  breakers?: CircuitBreakers;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
}

export interface CallOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Extra headers (never logged). */
  headers?: Record<string, string>;
  /** Override the retry budget for this call. */
  maxRetries?: number;
  /** False: a timeout is returned at once instead of retried (the caller retries more cheaply). */
  retryTimeouts?: boolean;
}

const defaultSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new CancelledError());
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new CancelledError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });

export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const secs = Number(value);
  if (Number.isFinite(secs) && secs >= 0) return secs * 1000;
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - now) : null;
}

async function errorFromResponse(res: Response, provider: string): Promise<ApiError> {
  let message = `${provider} returned HTTP ${res.status}`;
  let code = `http_${res.status}`;
  let type: string | null = null;
  let param: string | null = null;
  try {
    const text = await res.text();
    try {
      const body = JSON.parse(text) as { error?: { message?: unknown; type?: unknown; code?: unknown; param?: unknown } | string; message?: unknown };
      const e = body.error;
      if (e && typeof e === 'object') {
        if (typeof e.message === 'string') message = e.message;
        if (typeof e.code === 'string' || typeof e.code === 'number') code = String(e.code);
        if (typeof e.type === 'string') type = e.type;
        if (typeof e.param === 'string') param = e.param;
      } else if (typeof e === 'string') {
        message = e;
      } else if (typeof body.message === 'string') {
        message = body.message;
      }
    } catch {
      if (text) message = `${message}: ${text.slice(0, 200)}`;
    }
  } catch {
    /* body unreadable */
  }
  return new ApiError(message.slice(0, 500), res.status, code, RETRYABLE_STATUS.has(res.status), provider, type, param);
}

export class HttpClient {
  readonly provider: string;
  readonly baseUrl: string;
  private readonly apiKey: string | null;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly breakers: CircuitBreakers;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  private readonly random: () => number;
  private readonly breakerKey: string;

  constructor(o: HttpClientOptions) {
    this.provider = o.provider;
    this.baseUrl = o.baseUrl.replace(/\/+$/, '');
    this.apiKey = o.apiKey;
    this.fetchImpl = o.fetch ?? fetch;
    this.maxRetries = o.maxRetries ?? 3;
    this.timeoutMs = o.timeoutMs ?? 90_000;
    this.baseDelayMs = o.baseDelayMs ?? 500;
    this.maxDelayMs = o.maxDelayMs ?? 8_000;
    this.breakers = o.breakers ?? defaultBreakers;
    this.sleep = o.sleep ?? defaultSleep;
    this.random = o.random ?? Math.random;
    try {
      this.breakerKey = new URL(this.baseUrl).host;
    } catch {
      this.breakerKey = this.baseUrl;
    }
  }

  get configured(): boolean {
    return !!this.apiKey;
  }

  private headers(extra: Record<string, string> = {}, json = true): Record<string, string> {
    const h: Record<string, string> = { Accept: 'application/json', ...extra };
    if (json) h['Content-Type'] = 'application/json';
    if (this.apiKey) h.Authorization = `Bearer ${this.apiKey}`;
    return h;
  }

  private backoff(attempt: number, retryAfterMs: number | null): number {
    if (retryAfterMs != null) return Math.min(retryAfterMs, 30_000);
    const cap = Math.min(this.maxDelayMs, this.baseDelayMs * 2 ** attempt);
    return Math.round(this.random() * cap); // full jitter
  }

  /**
   * Sends a request with retries. Returns the successful Response (body unread).
   * `makeBody` is called per attempt because FormData and streams cannot be replayed.
   */
  async request(path: string, makeBody: () => { body: string | FormData; json: boolean }, opts: CallOptions = {}): Promise<{ res: Response; ms: number }> {
    const url = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    const retries = opts.maxRetries ?? this.maxRetries;
    const started = Date.now();
    let lastError: unknown = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      if (opts.signal?.aborted) throw new CancelledError();
      this.breakers.before(this.breakerKey, this.provider);
      const timeout = AbortSignal.timeout(opts.timeoutMs ?? this.timeoutMs);
      const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
      let retryAfter: number | null = null;
      try {
        const { body, json } = makeBody();
        const res = await this.fetchImpl(url, { method: 'POST', headers: this.headers(opts.headers, json), body, signal });
        if (res.ok) {
          this.breakers.success(this.breakerKey);
          return { res, ms: Date.now() - started };
        }
        const err = await errorFromResponse(res, this.provider);
        if (!err.retryable) {
          // A client error says nothing about the provider's health.
          this.breakers.success(this.breakerKey);
          throw err;
        }
        retryAfter = parseRetryAfter(res.headers.get('retry-after'));
        lastError = err;
      } catch (e) {
        if (e instanceof ApiError && !e.retryable) throw e;
        if (opts.signal?.aborted) throw new CancelledError();
        if (e instanceof ApiError) lastError = e;
        else if (timeout.aborted) {
          lastError = new ApiError(`${this.provider} did not answer in time.`, 504, 'timeout', true, this.provider);
          if (opts.retryTimeouts === false) throw lastError;
        }
        else {
          const why = networkCause(e);
          const detail = why.plain ? `${why.plain}${why.code ? ` [${why.code}]` : ''}` : `${(e as Error)?.message ?? e}${why.code ? ` [${why.code}]` : ''}`;
          lastError = new ApiError(`Could not reach ${this.provider}: ${detail}`, 0, 'network', true, this.provider);
        }
      }
      if (attempt < retries) {
        const wait = this.backoff(attempt, retryAfter);
        log('warn', 'retrying', { provider: this.provider, path, attempt: attempt + 1, waitMs: wait, error: (lastError as Error).message });
        await this.sleep(wait, opts.signal);
      }
    }
    this.breakers.failure(this.breakerKey);
    if (lastError instanceof ApiError && lastError.code === 'network' && Date.now() - lastNetHint > 60_000) {
      lastNetHint = Date.now();
      log('error', 'cannot reach the model service from this computer', {
        provider: this.provider,
        host: this.breakerKey,
        error: lastError.message,
        hint: 'Check this computer\'s internet connection, VPN, firewall or antivirus. Run "npm run check:connection" to see exactly where it fails.',
      });
    }
    throw lastError instanceof Error ? lastError : new ApiError('Request failed', 0, 'unknown', true, this.provider);
  }

  async postJson<T = unknown>(path: string, body: unknown, opts: CallOptions = {}): Promise<{ data: T; ms: number }> {
    const payload = JSON.stringify(body);
    const { res, ms } = await this.request(path, () => ({ body: payload, json: true }), opts);
    const text = await res.text();
    try {
      return { data: JSON.parse(text) as T, ms };
    } catch {
      throw new ApiError(`${this.provider} returned a response that is not JSON.`, res.status, 'bad_json', false, this.provider);
    }
  }

  /** For streaming endpoints: retries happen only before the stream starts. */
  async postStream(path: string, body: unknown, opts: CallOptions = {}): Promise<{ res: Response; ms: number }> {
    const payload = JSON.stringify(body);
    return this.request(path, () => ({ body: payload, json: true }), { ...opts, headers: { Accept: 'text/event-stream', ...opts.headers } });
  }

  async postForm<T = unknown>(path: string, makeForm: () => FormData, opts: CallOptions = {}): Promise<{ data: T; ms: number }> {
    const { res, ms } = await this.request(path, () => ({ body: makeForm(), json: false }), opts);
    const text = await res.text();
    try {
      return { data: JSON.parse(text) as T, ms };
    } catch {
      throw new ApiError(`${this.provider} returned a response that is not JSON.`, res.status, 'bad_json', false, this.provider);
    }
  }
}

// ---------------------------------------------------------------------------
// Server-sent events
// ---------------------------------------------------------------------------

/** Parses an SSE body into JSON events. Ignores comments and `[DONE]`. */
export async function* readSse(res: Response, signal?: AbortSignal): AsyncGenerator<Record<string, unknown>> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      if (signal?.aborted) throw new CancelledError();
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.search(/\r?\n\r?\n/)) >= 0) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx).replace(/^\r?\n\r?\n/, '');
        const data = block
          .split(/\r?\n/)
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).replace(/^ /, ''))
          .join('\n');
        if (!data || data === '[DONE]') continue;
        try {
          yield JSON.parse(data) as Record<string, unknown>;
        } catch {
          /* skip malformed event */
        }
      }
    }
    const tail = buf.trim();
    if (tail.startsWith('data:')) {
      const data = tail.slice(5).trim();
      if (data && data !== '[DONE]') {
        try {
          yield JSON.parse(data) as Record<string, unknown>;
        } catch {
          /* ignore */
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
