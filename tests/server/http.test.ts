import { describe, expect, it } from 'vitest';
import { ApiError, CancelledError, CircuitBreakers, HttpClient, networkCause, parseRetryAfter, readSse } from '../../server/meta/http';
import { usageFrom } from '../../server/meta/usage';
import { redact } from '../../server/log';

function fakeFetch(responses: Array<() => Response | Promise<Response>>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses[Math.min(calls.length - 1, responses.length - 1)]!;
    return next();
  }) as unknown as typeof fetch;
  return { f, calls };
}
const ok = (data: unknown) => () => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
const err = (status: number, headers: Record<string, string> = {}, code = `e${status}`) => () =>
  new Response(JSON.stringify({ error: { message: `boom ${status}`, type: 'invalid_request_error', code, param: 'x' } }), { status, headers });

function client(responses: Array<() => Response | Promise<Response>>, extra: Partial<ConstructorParameters<typeof HttpClient>[0]> = {}) {
  const { f, calls } = fakeFetch(responses);
  const sleeps: number[] = [];
  const c = new HttpClient({
    baseUrl: 'https://api.example.test/v1',
    apiKey: 'LLM|1|secret',
    provider: 'Test',
    fetch: f,
    breakers: new CircuitBreakers({ threshold: 2, cooldownMs: 1000 }),
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    random: () => 0.5,
    ...extra,
  });
  return { c, calls, sleeps };
}

describe('HttpClient retries', () => {
  it('retries 503 and then succeeds', async () => {
    const { c, calls } = client([err(503), err(502), ok({ a: 1 })]);
    const r = await c.postJson('/chat/completions', { x: 1 });
    expect(r.data).toEqual({ a: 1 });
    expect(calls).toHaveLength(3);
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer LLM|1|secret');
  });

  it('never retries 400, 401, 404 and surfaces the error envelope', async () => {
    for (const status of [400, 401, 404, 422]) {
      const { c, calls } = client([err(status, {}, 'bad_param'), ok({})]);
      const e = await c.postJson('/x', {}).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).status).toBe(status);
      expect((e as ApiError).code).toBe('bad_param');
      expect((e as ApiError).param).toBe('x');
      expect((e as ApiError).retryable).toBe(false);
      expect(calls).toHaveLength(1);
    }
  });

  it('honours Retry-After on 429', async () => {
    const { c, sleeps } = client([err(429, { 'retry-after': '2' }), ok({})]);
    await c.postJson('/x', {});
    expect(sleeps).toEqual([2000]);
  });

  it('uses exponential backoff with jitter otherwise', async () => {
    const { c, sleeps } = client([err(500), err(500), err(500), ok({})], { breakers: new CircuitBreakers({ threshold: 10, cooldownMs: 1 }) });
    await c.postJson('/x', {});
    expect(sleeps).toEqual([250, 500, 1000]); // random 0.5 × 500·2^n
  });

  it('gives up after the retry budget with the last error', async () => {
    const { c, calls } = client([err(503)], { maxRetries: 2, breakers: new CircuitBreakers({ threshold: 10, cooldownMs: 1 }) });
    const e = (await c.postJson('/x', {}).catch((x: unknown) => x)) as ApiError;
    expect(e.status).toBe(503);
    expect(calls).toHaveLength(3);
  });

  it('turns network failures into retryable errors', async () => {
    const { c, calls } = client([() => Promise.reject(new TypeError('fetch failed')), ok({ y: 2 })]);
    expect((await c.postJson('/x', {})).data).toEqual({ y: 2 });
    expect(calls).toHaveLength(2);
  });

  it('says what went wrong underneath "fetch failed"', async () => {
    const timeout = new TypeError('fetch failed', { cause: Object.assign(new Error('Connect Timeout Error'), { code: 'UND_ERR_CONNECT_TIMEOUT' }) });
    expect(networkCause(timeout)).toEqual({ code: 'UND_ERR_CONNECT_TIMEOUT', plain: 'the connection timed out' });
    const dns = new TypeError('fetch failed', { cause: Object.assign(new Error('getaddrinfo ENOTFOUND api.meta.ai'), { code: 'ENOTFOUND' }) });
    expect(networkCause(dns).plain).toMatch(/DNS/);
    const both = new TypeError('fetch failed', { cause: new AggregateError([Object.assign(new Error('x'), { code: 'ECONNREFUSED' })]) });
    expect(networkCause(both).code).toBe('ECONNREFUSED');
    const { c } = client([() => Promise.reject(timeout)], { maxRetries: 1 });
    const e = (await c.postJson('/x', {}).then(() => null, (x: unknown) => x)) as ApiError;
    expect(e.code).toBe('network');
    expect(e.message).toBe('Could not reach Test: the connection timed out [UND_ERR_CONNECT_TIMEOUT]');
  });

  it('does not retry after the caller cancels', async () => {
    const ac = new AbortController();
    ac.abort();
    const { c, calls } = client([ok({})]);
    await expect(c.postJson('/x', {}, { signal: ac.signal })).rejects.toBeInstanceOf(CancelledError);
    expect(calls).toHaveLength(0);
  });

  it('rejects a 200 that is not JSON', async () => {
    const { c } = client([() => new Response('<html>', { status: 200 })]);
    await expect(c.postJson('/x', {})).rejects.toMatchObject({ code: 'bad_json' });
  });
});

describe('circuit breaker', () => {
  it('opens after repeated failures, fails fast, then lets one probe through after the cool-down', async () => {
    let now = 0;
    const breakers = new CircuitBreakers({ threshold: 2, cooldownMs: 1000 }, () => now);
    const { c, calls } = client([err(503)], { maxRetries: 0, breakers });
    await expect(c.postJson('/x', {})).rejects.toMatchObject({ status: 503 });
    await expect(c.postJson('/x', {})).rejects.toMatchObject({ status: 503 });
    expect(breakers.isOpen('api.example.test')).toBe(true);
    await expect(c.postJson('/x', {})).rejects.toMatchObject({ code: 'circuit_open' });
    expect(calls).toHaveLength(2); // fast fail: no request sent
    now = 1500;
    await expect(c.postJson('/x', {})).rejects.toMatchObject({ status: 503 }); // the probe
    expect(calls).toHaveLength(3);
  });

  it('a client error does not count against the provider', async () => {
    const breakers = new CircuitBreakers({ threshold: 1, cooldownMs: 1000 });
    const { c } = client([err(400)], { breakers });
    await expect(c.postJson('/x', {})).rejects.toMatchObject({ status: 400 });
    expect(breakers.isOpen('api.example.test')).toBe(false);
  });
});

describe('helpers', () => {
  it('parses Retry-After seconds and dates', () => {
    expect(parseRetryAfter('3')).toBe(3000);
    expect(parseRetryAfter(new Date(10_000).toUTCString(), 4000)).toBe(6000);
    expect(parseRetryAfter(null)).toBeNull();
  });

  it('reads server-sent events split across chunks', async () => {
    const enc = new TextEncoder();
    const body = new ReadableStream({
      start(ctrl) {
        ctrl.enqueue(enc.encode('event: a\ndata: {"type":"x",'));
        ctrl.enqueue(enc.encode('"n":1}\n\n: comment\n\ndata: [DONE]\n\ndata: {"type":"y"}'));
        ctrl.close();
      },
    });
    const out: unknown[] = [];
    for await (const e of readSse(new Response(body))) out.push(e);
    expect(out).toEqual([{ type: 'x', n: 1 }, { type: 'y' }]);
  });

  it('extracts usage from both API styles, with reasoning tokens and documented prices', () => {
    expect(usageFrom({ prompt_tokens: 10, completion_tokens: 5, completion_tokens_details: { reasoning_tokens: 3 } }, 'muse-spark-1.3')).toMatchObject({ inputTokens: 10, outputTokens: 5, reasoningTokens: 3, costUsd: null });
    expect(usageFrom({ input_tokens: 1_000_000, output_tokens: 1_000_000 }, 'muse-wonder-1.0')!.costUsd).toBe(24);
    expect(usageFrom(null, 'muse-image-1.0', 1)!.costUsd).toBe(0.01);
  });

  it('redacts keys, bearer tokens and base64 from log lines', () => {
    const line = redact({ auth: 'Bearer LLM|123|abc', key: 'LLM|1|zzz', img: `data:image/png;base64,${'A'.repeat(300)}`, blob: 'B'.repeat(400) });
    expect(line).not.toMatch(/abc|zzz|AAAA|BBBB/);
  });
});
