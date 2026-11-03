/**
 * Browser client for the I SEE gateway. Every response is validated with the shared
 * schemas: the client trusts the server's shape no more than the server trusts it.
 */
import { z } from 'zod';
import { VerifyResponseSchema, type VerifyRequest,
  API_PREFIX,
  AskResponseSchema,
  CompareResponseSchema,
  GlanceResponseSchema,
  CutawayJobSchema,
  TranslateResponseSchema,
  IllustrateResponseSchema,
  InsideResponseSchema,
  ScanEventSchema,
  TranscribeResponseSchema,
  type AskRequest,
  type HealthInfo,
  type ScanEvent,
  type ScanRequest,
  type SegmentRequest,
} from '@shared/api';
import { RegionSchema, type ProfileDigest, type Region, type Source } from '@shared/schema';
import { scrubProviderNames } from '@shared/text';

/**
 * What a person sees when something goes wrong. Server wording is written for
 * developers (keys, routes, providers); people get plain words and a next step.
 */
const FRIENDLY: Record<string, string> = {
  offline: 'I SEE is offline right now. Check your internet connection, then try again. The examples still work.',
  interrupted: 'The connection to I SEE was interrupted. Please try again.',
  rate_limited: 'Lots of requests at once. Give it a few seconds and try again.',
  busy: 'I SEE is busy with other scans. Please try again in a minute.',
  too_large: 'That photo or recording is too large. Try a smaller one.',
  bad_image: 'That file does not look like a photo I can read. Try a JPEG or PNG.',
  bad_image_type: 'That file type is not supported. Try a JPEG, PNG or WebP photo.',
  mime_mismatch: 'That photo could not be read. Try saving it again as a JPEG.',
  image_too_large: 'That photo is too large. Try a smaller one.',
  bad_audio: 'Your recording could not be used. Try recording again.',
  service_unreachable: 'I SEE could not reach its analysis service, so your photo was not looked at. The computer running I SEE needs a working internet connection (check Wi-Fi or data, VPN, firewall or antivirus), then try again.',
  identify_failed: 'The photo could not be analysed this time. Try again, or use a clearer, closer shot.',
  unsupported_media: 'That file type is not supported. Try a JPEG or PNG photo.',
  cancelled: 'Stopped.',
  provider_auth: 'I SEE cannot analyse photos right now. Please try again later.',
  provider_paused: 'Analysis is taking a short break after a few hiccups. Try again in a minute.',
  provider_timeout: 'That took longer than expected. Please try again.',
  provider_rejected: 'This photo could not be analysed. Try another angle or a clearer shot.',
  provider_error: 'Something went wrong while analysing. Please try again.',
  unconfigured: 'Live analysis is not switched on yet. You can still explore the examples.',
  route_unavailable: 'That analysis mode is not available right now. Pick Standard in Settings and try again.',
  unsupported: 'This feature is not available right now.',
  not_found: 'That scan has expired. Please start a new one.',
  forbidden: 'That scan was started on another device.',
  internal: 'Something went wrong on our side. Please try again.',
  bad_response: 'Something went wrong on our side. Please try again.',
  bad_json: 'Something went wrong sending that. Please try again.',
  invalid_request: 'Something in that request could not be used. Please try again.',
  consent_required: 'Allow photos to be sent for analysis in Settings first.',
  transcribe_failed: 'Your recording could not be turned into text. Try speaking again, or type the question.',
  connection_lost: 'The connection dropped while scanning. Please try again.',
};

export function friendlyMessage(code: string, fallback?: string): string {
  if (FRIENDLY[code]) return FRIENDLY[code];
  if (code.startsWith('http_5')) return FRIENDLY.internal!;
  if (code.startsWith('http_4')) return FRIENDLY.invalid_request!;
  return fallback ? scrubProviderNames(fallback) : FRIENDLY.internal!;
}

export class ApiError extends Error {
  readonly detail: string;
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(friendlyMessage(code, message));
    this.detail = message;
  }
}

/** The message to show for any thrown value. */
export function userMessage(e: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error && e.message) return scrubProviderNames(e.message);
  return fallback;
}

/**
 * A request that got no answer at all. If the device itself is offline, say so; otherwise the
 * connection dropped part-way (the phone paused the page, or the server restarted).
 */
function unanswered(): ApiError {
  if (typeof navigator !== 'undefined' && (navigator as { onLine?: boolean }).onLine === false) return new ApiError('offline', 'The I SEE server could not be reached.', 0, true);
  return new ApiError('interrupted', 'The request got no answer from the I SEE server.', 0, true);
}

async function call<T>(path: string, init: RequestInit, schema: z.ZodType<T>): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_PREFIX}${path}`, { ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } });
  } catch {
    throw unanswered();
  }
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    const e = (body as { error?: { code?: string; message?: string; retryable?: boolean } } | null)?.error;
    throw new ApiError(e?.code ?? `http_${res.status}`, e?.message ?? `The server answered ${res.status}.`, res.status, e?.retryable ?? res.status >= 500);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError('bad_response', 'The server sent something unexpected.', res.status, false);
  return parsed.data;
}

const HealthSchema = z.custom<HealthInfo>((v) => !!v && typeof v === 'object' && 'mode' in (v as object) && 'routes' in (v as object));

export async function getHealth(signal?: AbortSignal): Promise<HealthInfo> {
  return call('/health', { method: 'GET', signal }, HealthSchema);
}

export async function startScan(req: ScanRequest, signal?: AbortSignal): Promise<{ jobId: string }> {
  return call('/scans', { method: 'POST', body: JSON.stringify(req), signal }, z.object({ jobId: z.string() }));
}

/** Follows a scan's events over server-sent events. Returns a function that stops listening. */
export function followJob(jobId: string, onEvent: (e: ScanEvent) => void, onBroken: (message: string) => void): () => void {
  const es = new EventSource(`${API_PREFIX}/jobs/${encodeURIComponent(jobId)}/events`);
  let finished = false;
  const seen = new Set<string>();
  const handle = (m: MessageEvent) => {
    if (typeof m.data !== 'string') return;
    // The server names each event by its type and numbers it; a reconnect replays, so skip repeats.
    if (m.lastEventId) {
      if (seen.has(m.lastEventId)) return;
      seen.add(m.lastEventId);
    }
    try {
      const parsed = ScanEventSchema.safeParse(JSON.parse(m.data));
      if (!parsed.success) return;
      onEvent(parsed.data);
      if (parsed.data.type === 'done' || parsed.data.type === 'error') {
        finished = true;
        es.close();
      }
    } catch {
      /* ignore malformed frames */
    }
  };
  es.onmessage = handle;
  for (const type of ['stage', 'quality', 'candidates', 'regions', 'sources', 'escalation', 'profile', 'done']) es.addEventListener(type, handle as EventListener);
  // "error" is both a named server event and the EventSource's own failure signal.
  es.addEventListener('error', (e) => {
    if (e instanceof MessageEvent && typeof e.data === 'string') return handle(e);
    if (finished) return;
    if (es.readyState === EventSource.CLOSED) onBroken(FRIENDLY.connection_lost!);
  });
  return () => {
    finished = true;
    es.close();
  };
}

export async function cancelJob(jobId: string) {
  await call(`/jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST', body: '{}' }, z.unknown()).catch(() => undefined);
}

export async function answerEscalation(jobId: string, requestId: string, approve: boolean) {
  return call(`/jobs/${encodeURIComponent(jobId)}/escalation/${encodeURIComponent(requestId)}`, { method: 'POST', body: JSON.stringify({ approve }) }, z.unknown());
}

export async function segmentAt(req: SegmentRequest, signal?: AbortSignal) {
  return call('/segment', { method: 'POST', body: JSON.stringify(req), signal }, z.object({ regions: z.array(RegionSchema), model: z.string() }));
}

/** A second look at a correction from the Train game. */
export async function verifyLabel(req: VerifyRequest, signal?: AbortSignal) {
  return call('/verify', { method: 'POST', body: JSON.stringify(req), signal }, VerifyResponseSchema);
}

export async function ask(req: AskRequest, signal?: AbortSignal) {
  return call('/ask', { method: 'POST', body: JSON.stringify(req), signal }, AskResponseSchema);
}

export async function compare(a: ProfileDigest, b: ProfileDigest, extra: { language: string; privacyTier: 'private' | 'contributor' }) {
  return call('/compare', { method: 'POST', body: JSON.stringify({ a, b, route: 'hosted', ...extra }) }, CompareResponseSchema);
}

export interface IllustrateInside {
  kind: string;
  brief: string;
  parts: string[];
}

export async function illustrate(digest: ProfileDigest, privacyTier: 'private' | 'contributor', inside: IllustrateInside | null = null, signal?: AbortSignal) {
  return call('/illustrate', { method: 'POST', body: JSON.stringify({ digest, privacyTier, inside }), signal }, IllustrateResponseSchema);
}

export async function explainInside(
  req: { digest: ProfileDigest; regions: Region[]; sources: Source[]; hazards: string[]; route: ScanRequest['route']; language: string; privacyTier: 'private' | 'contributor' },
  signal?: AbortSignal,
) {
  return call('/inside', { method: 'POST', body: JSON.stringify(req), signal }, InsideResponseSchema);
}

export async function glance(
  view: { mime: string; base64: string; width: number; height: number; label: null },
  extra: { privacyTier: 'private' | 'contributor'; consent: { sendImages: true; acknowledgedAt: string }; language?: string },
  signal?: AbortSignal,
) {
  return call('/glance', { method: 'POST', body: JSON.stringify({ view, ...extra }), signal }, GlanceResponseSchema);
}

export async function transcribe(wav: Blob, keywords: string[], language: string) {
  const form = new FormData();
  form.append('audio', wav, 'question.wav');
  form.append('keywords', JSON.stringify(keywords.slice(0, 50)));
  form.append('languageBias', JSON.stringify([language]));
  let res: Response;
  try {
    res = await fetch(`${API_PREFIX}/transcribe`, { method: 'POST', body: form });
  } catch {
    throw unanswered();
  }
  const body = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const e = (body as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(e?.code ?? 'transcribe_failed', e?.message ?? 'Transcription failed.', res.status, res.status >= 500);
  }
  const parsed = TranscribeResponseSchema.safeParse(body);
  if (!parsed.success) throw new ApiError('bad_response', 'The server sent something unexpected.', res.status, false);
  return parsed.data;
}

type Upload = { mime: string; base64: string; width: number; height: number; label: null };
type Consent = { sendImages: true; acknowledgedAt: string };

/**
 * Draws the cutaway. It can take several minutes, longer than the hosting keeps one request
 * open, so it runs in the background on the server and this asks every few seconds whether it
 * is ready. A short drop in the connection (a phone changing networks) is waited out.
 */
export async function makeCutaway(
  req: { digest: ProfileDigest; inside: { kind: string; brief: string; parts: string[] } | null; view: Upload | null; consent: Consent | null; privacyTier: 'private' | 'contributor'; language: string },
  signal?: AbortSignal,
) {
  const { jobId } = await call('/cutaway?background=1', { method: 'POST', body: JSON.stringify(req), signal }, z.object({ jobId: z.string() }));
  let misses = 0;
  for (;;) {
    await new Promise((r) => setTimeout(r, 4000));
    if (signal?.aborted) throw new ApiError('cancelled', 'Stopped.', 0, false);
    try {
      const r = await call(`/cutaway/jobs/${encodeURIComponent(jobId)}`, { method: 'GET', signal }, CutawayJobSchema);
      misses = 0;
      if (r.status === 'done') return r.result;
    } catch (e) {
      if (e instanceof ApiError && (e.code === 'offline' || e.code === 'interrupted') && ++misses < 15) continue;
      // Gone: the server restarted while drawing.
      if (e instanceof ApiError && e.code === 'not_found') throw new ApiError('interrupted', e.detail, e.status, true);
      throw e;
    }
  }
}

export async function translateTexts(texts: string[], language: string, signal?: AbortSignal) {
  return call('/translate', { method: 'POST', body: JSON.stringify({ texts, language }), signal }, TranslateResponseSchema);
}
