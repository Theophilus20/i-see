/**
 * End-to-end through the gateway: real HTTP, real SSE, the real orchestrator and
 * firewall, with the Meta Model API replaced by a mock that mirrors documented shapes.
 */
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { serve, type ServerType } from '@hono/node-server';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp, scalePath } from '../../server/app';
import { loadConfig, type Config } from '../../server/config';
import { setLogSink } from '../../server/log';
import { CircuitBreakers, readSse } from '../../server/meta/http';
import { sizeFor } from '../../server/meta/tasks';
import { makeCutaway as makeCutawayFromApp } from '../../src/web/lib/api';
import { InsideResponseSchema, CutawayResponseSchema, CutawayJobSchema, VerifyResponseSchema, AskResponseSchema, ScanEventSchema, type ScanEvent } from '../../src/shared/api';
import { ProfileSchema, type Profile, digestOf } from '../../src/shared/schema';
import { setSecondOpinion, setMarksAnswer, setCheckAnswer, setCloseAnswer, MockMeta, setDecideAnswer, setMarkNamesBlank, setDrawingPartAnswer, TEST_KEY } from './mock-meta';

const fx = (name: string) => readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8');
const connectorFetch = (async (url: string) => {
  if (url.includes('wikipedia.org')) return new Response(fx('wikipedia.json'));
  if (url.includes('saferproducts.gov')) return new Response(fx('cpsc.json'));
  return new Response('{}', { status: 404 });
}) as unknown as typeof fetch;

const mock = new MockMeta();
let jpeg320: string;
const logLines: string[] = [];

beforeAll(async () => {
  await mock.start();
  setLogSink((l) => logLines.push(l), 'debug');
  const buf = await sharp({ create: { width: 320, height: 334, channels: 3, background: '#7a8590' } })
    .composite([{ input: await sharp({ create: { width: 120, height: 80, channels: 3, background: '#20262b' } }).png().toBuffer(), left: 150, top: 200 }])
    .withMetadata({ exif: { IFD0: { Copyright: 'secret-gps-marker' } } })
    .jpeg()
    .toBuffer();
  jpeg320 = buf.toString('base64');
});
afterAll(async () => {
  await mock.stop();
});
beforeEach(() => {
  mock.requests.length = 0;
});

function config(over: Partial<Config> = {}, env: Record<string, string> = {}): Config {
  const cfg = loadConfig({
    MODEL_API_KEY: TEST_KEY,
    META_API_BASE: `${mock.url}/v1`,
    OPEN_WEIGHT_BASE_URL: `${mock.url}/ow/v1`,
    OPEN_WEIGHT_API_KEY: 'ow-key',
    OPEN_WEIGHT_MODEL: 'meta-models/muse-spark-open',
    LOCAL_BASE_URL: `${mock.url}/local/v1`,
    LOCAL_MODEL: 'muse-glimmer',
    RATE_PER_MINUTE: '600',
    ...env,
  });
  return { ...cfg, ...over };
}

function makeApp(cfg = config()) {
  return createApp({ cfg, connectorFetch, breakers: new CircuitBreakers({ threshold: 50, cooldownMs: 10 }), sleep: async () => {}, traceUrl: null });
}

async function listen(app: ReturnType<typeof makeApp>['app']): Promise<{ base: string; server: ServerType }> {
  const server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' });
  await new Promise((r) => server.once('listening', r));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server };
}

const scanBody = (over: Record<string, unknown> = {}) => ({
  views: [{ mime: 'image/jpeg', base64: jpeg320, width: 320, height: 334, label: null }],
  hint: 'my grandmother’s coffee pot',
  route: 'hosted',
  depth: 'quick',
  language: 'en',
  privacyTier: 'private',
  prior: null,
  clientQuality: { sharpness: 150, brightness: 0.5, clipped: 0.01 },
  consent: { sendImages: true, acknowledgedAt: '2026-10-28T10:00:00Z' },
  ...over,
});

async function runScanOverHttp(base: string, body: unknown, onEvent?: (e: ScanEvent) => Promise<void> | void): Promise<ScanEvent[]> {
  const start = await fetch(`${base}/api/v1/scans`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  expect(start.status).toBe(202);
  const { jobId, eventsUrl } = (await start.json()) as { jobId: string; eventsUrl: string };
  expect(eventsUrl).toBe(`/api/v1/jobs/${jobId}/events`);
  const res = await fetch(`${base}${eventsUrl}`);
  expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
  const events: ScanEvent[] = [];
  for await (const raw of readSse(res)) {
    const e = ScanEventSchema.parse(raw);
    events.push(e);
    await onEvent?.(e);
    if (e.type === 'done' || e.type === 'error') break;
  }
  return events;
}

describe('health', () => {
  it('reports unconfigured when no provider is set, and refuses scans with a clear message', async () => {
    const { app, health } = createApp({ cfg: loadConfig({}) });
    expect(health().mode).toBe('unconfigured');
    expect(health().serverStoresImages).toBe(false);
    const res = await app.request('/api/v1/scans', { method: 'POST', body: JSON.stringify(scanBody()), headers: { 'content-type': 'application/json' } });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('unconfigured');
  });

  it('lists routes, features and documented capabilities, and never the key', async () => {
    const { app } = makeApp();
    const res = await app.request('/api/v1/health');
    const body = await res.text();
    expect(body).not.toContain(TEST_KEY);
    const h = JSON.parse(body);
    expect(h.mode).toBe('live');
    expect(h.routes).toEqual({ hosted: true, private: true, consensus: true, 'local-first': true });
    expect(h.capabilities.map((c: { model: string }) => c.model)).toEqual(expect.arrayContaining(['muse-spark-1.3', 'muse-wonder-1.0', 'sam-3.1', 'muse-image-1.0', 'muse-voice-transcribe-1.0', 'muse-glimmer']));
    expect(h.connectors).toContain('web-search');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  });

  it('asks the service again for the model list on ?recheck', async () => {
    const { app } = makeApp();
    const h = (await (await app.request('/api/v1/health?recheck')).json()) as { modelCheck: { state: string; listed: string[]; key: { ends: string } } };
    expect(h.modelCheck.state).toBe('done');
    expect(h.modelCheck.listed).toContain('muse-spark-1.3');
    expect(h.modelCheck.key.ends).toBe(TEST_KEY.slice(-4));
  });
});

describe('input validation', () => {
  it('requires consent to send images', async () => {
    const { app } = makeApp();
    const res = await app.request('/api/v1/scans', { method: 'POST', body: JSON.stringify(scanBody({ consent: { sendImages: false, acknowledgedAt: 'x' } })), headers: { 'content-type': 'application/json' } });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(/consent/);
  });

  it('rejects bytes that are not the image type they claim to be', async () => {
    const { app } = makeApp();
    const fake = Buffer.from('this is definitely not an image file at all').toString('base64');
    const res = await app.request('/api/v1/scans', { method: 'POST', body: JSON.stringify(scanBody({ views: [{ mime: 'image/png', base64: fake, width: 320, height: 334, label: null }] })), headers: { 'content-type': 'application/json' } });
    expect(res.status).toBe(415);
    const png = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#fff' } }).png().toBuffer();
    const res2 = await app.request('/api/v1/scans', { method: 'POST', body: JSON.stringify(scanBody({ views: [{ mime: 'image/jpeg', base64: png.toString('base64'), width: 20, height: 20, label: null }] })), headers: { 'content-type': 'application/json' } });
    expect(((await res2.json()) as { error: { code: string } }).error.code).toBe('mime_mismatch');
  });

  it('rejects malformed JSON and unknown routes', async () => {
    const { app } = makeApp();
    expect((await app.request('/api/v1/scans', { method: 'POST', body: '{nope', headers: { 'content-type': 'application/json' } })).status).toBe(400);
    expect((await app.request('/api/v1/nothing')).status).toBe(404);
  });

  it('rate-limits per client', async () => {
    const { app } = makeApp(config({ ratePerMinute: 3 }));
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      const r = await app.request('/api/v1/compare', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
      statuses.push(r.status);
    }
    expect(statuses.at(-1)).toBe(429);
  });
});

describe('a full scan on the hosted route', () => {
  let events: ScanEvent[];
  let profile: Profile;
  let requests: typeof mock.requests;

  beforeAll(async () => {
    const { app, jobs } = makeApp();
    const { base, server } = await listen(app);
    mock.requests.length = 0;
    events = await runScanOverHttp(base, scanBody());
    requests = [...mock.requests];
    profile = (events.find((e) => e.type === 'profile') as Extract<ScanEvent, { type: 'profile' }>).profile;
    jobs.close();
    server.close();
  });

  it('streams every stage and ends with a valid profile', () => {
    const stages = events.filter((e): e is Extract<ScanEvent, { type: 'stage' }> => e.type === 'stage' && e.status !== 'start').map((e) => e.id);
    expect(stages).toEqual(expect.arrayContaining(['intake', 'quality', 'identify', 'segment', 'retrieve', 'compose', 'reconcile']));
    expect(events.at(-1)!.type).toBe('done');
    expect(ProfileSchema.safeParse(profile).success).toBe(true);
    expect(profile.trace.mode).toBe('live');
  });

  it('sends the photo to Muse Spark with developer instructions and json_schema', () => {
    const chat = requests.filter((r) => r.path === '/v1/chat/completions');
    const identify = chat.find((r) => r.body.response_format?.json_schema?.name === 'identify')!;
    expect(identify.body.model).toBe('muse-spark-1.3');
    expect(identify.body.messages[0].role).toBe('developer');
    expect(identify.body.messages[1].content[1].type).toBe('image_url');
    expect(identify.body.reasoning_effort).toBe('low');
    expect(chat.every((r) => r.auth === `Bearer ${TEST_KEY}`)).toBe(true);
    // The photo was re-encoded on the server: metadata gone.
    const sent = Buffer.from(identify.body.messages[1].content[1].image_url.url.split(',')[1], 'base64');
    expect(sent.includes(Buffer.from('secret-gps-marker'))).toBe(false);
  });

  it('finds the regions of the object from the pixels with SAM 3.1, then has Muse Spark name them', () => {
    const ground = requests.find((r) => r.body?.response_format?.json_schema?.name === 'ground')!;
    const groundText = JSON.stringify(ground.body.messages).toLowerCase();
    for (const part of ['coffee pot', 'safety valve', 'handle']) expect(groundText).toContain(part);
    expect(groundText).not.toContain('segment the handle');
    // The real part names are looked up on the web first, but only to name what is seen: the
    // numbered list to find holds only what was noticed in this photo (a list of expected parts
    // makes vision models "find" parts that are not there).
    const parts = requests.find((r) => Array.isArray(r.body?.tools) && String(r.body.input).includes('one part per line'))!;
    expect(JSON.stringify(parts.body)).not.toContain('base64');
    const userText = String(ground.body.messages.at(-1).content.find((c: { type: string }) => c.type === 'text')?.text ?? ground.body.messages.at(-1).content);
    const listed = [...userText.matchAll(/^\d+\. (.+)$/gm)].map((m) => m[1]!.toLowerCase());
    expect(listed).not.toContain('lid');
    expect(listed).not.toContain('filter funnel');
    expect(userText).toMatch(/Standard names[^\n]*never box a part just because it is in this list[^\n]*Filter funnel/);
    expect(userText).toMatch(/Never include a part because this kind of object usually has it/);
    // Parts found by looking are outlined too.
    expect(profile.regions.map((r) => r.label)).toEqual(expect.arrayContaining(['Lid', 'Filter funnel']));
    expect(profile.trace.stages.find((x) => x.id === 'segment')!.note).toMatch(/Looked up the parts a Moka pot has/);
    expect(profile.sources.some((x) => x.url === 'https://www.bialetti.com/moka-parts')).toBe(true);
    // Each part is also outlined from its short name (SAM 3.1 concept prompts), so two
    // independent routes can confirm it.
    const byName = requests.filter((r) => r.body?.model === 'sam-3.1' && !/<\|(?:box|point);/.test(String(r.body.input[0].content[0].text)));
    expect(byName.map((r) => r.body.input[0].content[0].text)).toEqual(expect.arrayContaining(['safety valve', 'handle']));
    expect(byName.every((r) => /^[a-z][a-z -]*$/.test(r.body.input[0].content[0].text))).toBe(true);
    // Regions first, names second: SAM 3.1 traces the regions under a grid of points over the
    // object (and where parts were seen), eight points per request…
    const sam = requests.filter((r) => r.body?.model === 'sam-3.1');
    const pointReqs = sam.filter((r) => String(r.body.input[0].content[0].text).includes('<|point;') && !String(r.body.input[0].content[0].text).includes('<|box;'));
    expect(pointReqs.length).toBeGreaterThan(0);
    for (const r of pointReqs) expect((r.body.input[0].content[0].text.match(/<\|point;/g) ?? []).length).toBeLessThanOrEqual(8);
    // Small parts that sit together are looked at again in an enlarged close-up…
    const closeUp = requests.find((r) => r.body?.response_format?.json_schema?.name === 'ground' && JSON.stringify(r.body.messages).includes('a close-up of part of the'));
    expect(closeUp).toBeTruthy();
    // …and Muse Spark only names the numbered regions: it is never asked where a part is.
    const marks = requests.find((r) => r.body?.response_format?.json_schema?.name === 'part_marks')!;
    const marksText = JSON.stringify(marks.body.messages);
    expect(marksText).toMatch(/numbered regions outlined in colour/);
    expect(marksText).toMatch(/another object \(another plant or leaf, a pot, soil/);
    expect(requests.some((r) => r.body?.response_format?.json_schema?.name === 'label_check')).toBe(false);
    // The named parts, each traced from the photo, and the whole object marked as such.
    expect(profile.regions.map((r) => r.label)).toEqual(expect.arrayContaining(['Safety valve', 'Handle', 'Lid', 'Filter funnel']));
    expect(profile.regions.filter((r) => r.whole).length).toBe(1);
    expect(profile.regions.filter((r) => r.kind === 'mask').length).toBeGreaterThan(0);
    expect(profile.regions.every((r) => r.path && r.source === 'sam')).toBe(true);
  });

  it('settles a close call with web research on what tells them apart, checked against the photo', () => {
    const research = requests.find((r) => Array.isArray(r.body?.tools) && String(r.body.input).includes('apart by looking at a photograph'))!;
    expect(research.body.tools[0]).toEqual({ type: 'web_search', search_context_size: 'high' });
    expect(JSON.stringify(research.body)).not.toContain('base64');
    expect(research.body.input).toContain('"Moka pot" from "Stovetop percolator"');
    const decide = requests.find((r) => r.body.response_format?.json_schema?.name === 'decide')!;
    expect(JSON.stringify(decide.body)).toContain('image_url');
    expect(JSON.stringify(decide.body)).toContain('Reference research on telling them apart');
    expect(profile.candidates[0]!.name).toBe('Moka pot');
    expect(profile.candidates[0]!.likelihood).toBe(0.86);
    expect(profile.candidates[0]!.evidenceFor[0]).toMatch(/Octagonal two-part body/);
    expect(profile.identity.status).toBe('identified');
    expect(profile.displayName).not.toMatch(/[()]/);
    // The pages the research cites are kept as sources (the same page found twice counts once).
    expect(profile.sources.filter((x) => x.url === 'https://www.bialetti.com/moka-express').length).toBe(1);
    expect(profile.trace.stages.find((x) => x.id === 'retrieve')!.note).toMatch(/it is Moka pot/);
    // Settled, so Muse Wonder is not needed.
    expect(requests.some((r) => r.body?.model === 'muse-wonder-1.0')).toBe(false);
  });

  it('grounds with web search and connectors, and never sends the photo to search', () => {
    const search = requests.find((r) => Array.isArray(r.body?.tools))!;
    expect(search.body.tools[0].type).toBe('web_search');
    expect(JSON.stringify(search.body)).not.toContain('base64');
    expect(profile.sources.some((s) => s.kind === 'search' && s.url.includes('bialetti.com'))).toBe(true);
    expect(profile.sources.some((s) => s.publisher === 'Wikipedia')).toBe(true);
    expect(profile.sources[0]!.tier).toBe(2);
  });

  it('runs the firewall: verifies the real quote, downgrades the fake ones', () => {
    const f2 = profile.findings.find((f) => f.text.startsWith('The design was invented'))!;
    expect(f2.basis).toBe('sourced');
    expect(f2.verification.status).toBe('verified');
    const fake = profile.findings.find((f) => f.text.includes('Milan'))!;
    expect(fake.basis).not.toBe('sourced');
    const misquote = profile.findings.find((f) => f.text.includes('strong coffee'))!;
    expect(misquote.basis).not.toBe('sourced');
    expect(profile.findings.find((f) => f.text.includes('aluminium'))!.confidence).toBeLessThanOrEqual(0.6);
    expect(profile.trace.firewall.citationsVerified).toBeGreaterThanOrEqual(2);
    expect(profile.trace.firewall.downgraded).toBeGreaterThanOrEqual(2);
  });

  it('keeps the what-if as a checked calculation and relabels the "simulation"', () => {
    expect(profile.whatIf[0]!.kind).toBe('calculation');
    expect(profile.whatIf[0]!.caveats[0]).toMatch(/No simulation was run/);
  });

  it('records which model did what', () => {
    const models = profile.trace.models.map((m) => m.model);
    expect(models).toEqual(expect.arrayContaining(['muse-spark-1.3', 'sam-3.1']));
    expect(profile.trace.models.some((m) => m.role === 'decide')).toBe(true);
    expect(profile.trace.stages.find((s) => s.id === 'compose')!.usage!.reasoningTokens).toBeGreaterThan(0);
  });

  it('never logs the key or image data', () => {
    const all = logLines.join('\n');
    expect(all).not.toContain('test-secret-key');
    expect(all).not.toContain(jpeg320.slice(0, 60));
  });
});

describe('outlining every part', () => {
  it('asks again, on its own, for a part whose outline was missing from a cut-short answer (box method)', async () => {
    mock.samDropLast = 1;
    const { app, jobs } = makeApp(config({ labelMethod: 'boxes' }));
    const { base, server } = await listen(app);
    mock.requests.length = 0;
    const events = await runScanOverHttp(base, scanBody());
    const profile = (events.find((e) => e.type === 'profile') as Extract<ScanEvent, { type: 'profile' }>).profile;
    const sam = mock.requests.filter((r) => r.body?.model === 'sam-3.1').map((r) => (String(r.body.input[0].content[0].text).match(/<\|box;/g) ?? []).length);
    expect(sam[0]).toBeGreaterThan(1);
    expect(sam).toContain(1);
    expect(profile.regions.length).toBeGreaterThan(1);
    expect(profile.regions.every((r) => r.kind === 'mask')).toBe(true);
    jobs.close();
    server.close();
    mock.samDropLast = 0;
  });
});

describe('checking every outline without its name (box method)', () => {
  const scan = async () => {
    const { app, jobs } = makeApp(config({ labelMethod: 'boxes' }));
    const { base, server } = await listen(app);
    const events = await runScanOverHttp(base, scanBody());
    jobs.close();
    server.close();
    return (events.find((e) => e.type === 'profile') as Extract<ScanEvent, { type: 'profile' }>).profile;
  };

  it('renames an outline to what it really covers, and drops one that covers no part or fits badly', async () => {
    const before = await scan();
    const parts = before.regions.length - 1; // the first is the whole object
    expect(parts).toBeGreaterThanOrEqual(3);
    setCheckAnswer((count) => [
      { n: 1, covers: 'Steam vent', fits: true },
      { n: 2, covers: null, fits: false },
      { n: 3, covers: 'Handle', fits: false },
    ].filter((x) => x.n <= count));
    try {
      const after = await scan();
      const labels = after.regions.map((r) => r.label);
      expect(labels).toContain('Steam vent');
      expect(after.regions.length).toBe(before.regions.length - 2);
      // The whole object is never checked away.
      expect(after.regions[0]!.label).toBe(before.regions[0]!.label);
    } finally {
      setCheckAnswer(null);
    }
  });

  it('does not let a confused check remove most of the outlines', async () => {
    const before = await scan();
    setCheckAnswer((count) => Array.from({ length: count }, (_, i) => ({ n: i + 1, covers: null, fits: false })));
    try {
      const after = await scan();
      expect(after.regions.length).toBe(before.regions.length);
    } finally {
      setCheckAnswer(null);
    }
  });
});

describe('regions first, names second', () => {
  const scan = async (cfg = config(), over: Record<string, unknown> = {}) => {
    const { app, jobs } = makeApp(cfg);
    const { base, server } = await listen(app);
    mock.requests.length = 0;
    const events = await runScanOverHttp(base, scanBody(over));
    jobs.close();
    server.close();
    return (events.find((e) => e.type === 'profile') as Extract<ScanEvent, { type: 'profile' }>).profile;
  };

  it('leaves out regions that are not a part of this object, and joins pieces of one part', async () => {
    let seen = 0;
    setMarksAnswer((count) =>
      Array.from({ length: (seen = count) }, (_, i) => ({
        n: i + 1,
        // Two regions are "the plant pot" and "background" (not parts); the rest are pieces of a chamber.
        name: i === 0 ? 'Plant pot' : i === 1 ? null : i === 2 ? 'Background' : 'Chamber',
      })),
    );
    try {
      const p = await scan();
      const labels = p.regions.map((r) => r.label);
      expect(labels.join(' ')).not.toMatch(/Plant pot|Background/);
      // Pieces of the chamber that touch are one part; separate ones are told apart by where they are.
      const body = p.regions.filter((r) => /chamber/i.test(r.label));
      expect(seen).toBeGreaterThan(3);
      expect(body.length).toBeGreaterThan(0);
      expect(body.length).toBeLessThan(5);
      expect(p.regions.filter((r) => r.whole).length).toBe(1);
    } finally {
      setMarksAnswer(null);
    }
  });

  it('names every region twice, independently, and lets a third look settle disagreements', async () => {
    // All at once: the first region is a spout, the rest chambers. Up close (the stand-in cannot
    // tell the regions apart), every region looks like a chamber: the chambers are confirmed, and
    // the spout is a disagreement for a third look, which sides with "Spout".
    setMarksAnswer((count) => Array.from({ length: count }, (_, i) => ({ n: i + 1, name: i === 0 ? 'Spout' : 'Chamber' })));
    let looks = 0;
    setCloseAnswer(() => (looks++, { looks: 'Brushed metal.', name: 'Chamber', fits: 'well', sure: true }));
    setSecondOpinion((a, b) => ({ choice: a === 'Spout' ? 'A' : b === 'Spout' ? 'B' : 'neither', sure: true, reason: 'It has a pouring lip.' }));
    try {
      const p = await scan(config(), { depth: 'deep' });
      const labels = p.regions.map((r) => r.label).join(' | ');
      expect(looks).toBeGreaterThan(2);
      expect(labels).toMatch(/Spout/);
      expect(labels).toMatch(/Chamber/);
      const asked = mock.requests.filter((r) => r.body?.response_format?.json_schema?.name);
      const close = asked.filter((r) => r.body.response_format.json_schema.name === 'close_name');
      expect(close.length).toBe(looks);
      // Each close look thinks hard, sees one region (a close-up and the whole photo), and is told
      // nothing of the first look.
      expect(close.every((r) => r.body.reasoning_effort === 'high')).toBe(true);
      const imagesIn = (r: { body: { messages: Array<{ content: unknown }> } }) => (r.body.messages[1]!.content as Array<{ type: string }>).filter((c) => c.type === 'image_url').length;
      expect(close.every((r) => imagesIn(r) === 2)).toBe(true);
      expect(close.every((r) => !JSON.stringify(r.body.messages).includes('Spout'))).toBe(true);
      expect(asked.filter((r) => r.body.response_format.json_schema.name === 'second_opinion').length).toBe(1);
    } finally {
      setMarksAnswer(null);
      setCloseAnswer(null);
      setSecondOpinion(null);
    }
  });

  it('names each region once on a quick look', async () => {
    setCloseAnswer(() => ({ looks: 'Brushed metal.', name: 'Chamber', fits: 'well', sure: true }));
    try {
      const p = await scan(config(), { depth: 'quick' });
      expect(p.regions.length).toBeGreaterThan(1);
      expect(mock.requests.some((r) => r.body?.response_format?.json_schema?.name === 'close_name')).toBe(false);
    } finally {
      setCloseAnswer(null);
    }
  });

  it('drops regions the close look sees no part in', async () => {
    setCloseAnswer(() => ({ looks: 'The table top.', name: null, fits: 'well', sure: true }));
    try {
      const p = await scan(config(), { depth: 'deep' });
      // No region survives as a named part, so the parts are outlined from their boxes and checked.
      expect(mock.requests.some((r) => r.body?.response_format?.json_schema?.name === 'label_check')).toBe(true);
      expect(p.regions.length).toBeGreaterThan(0);
    } finally {
      setCloseAnswer(null);
    }
  });

  it('falls back to outlining the boxes when the regions cannot be named', async () => {
    mock.failNext('/v1/chat/completions', 400, 0);
    setMarksAnswer(() => {
      throw new Error('naming unavailable');
    });
    try {
      const p = await scan();
      expect(p.regions.length).toBeGreaterThan(1);
      expect(mock.requests.some((r) => r.body?.response_format?.json_schema?.name === 'label_check')).toBe(true);
    } finally {
      setMarksAnswer(null);
    }
  });
});

describe('a scan step that fails', () => {
  it('says plainly why, and writes the reason to the log', async () => {
    const { app, jobs } = makeApp();
    const { base, server } = await listen(app);
    const before = logLines.length;
    mock.failNext('/v1/chat/completions', 404, 1, undefined, { error: { message: 'The model muse-spark-1.3 does not exist.', code: 'model_not_found' } });
    const events = await runScanOverHttp(base, scanBody());
    jobs.close();
    server.close();
    const stage = events.find((e) => e.type === 'stage' && e.id === 'identify' && e.status === 'error') as Extract<ScanEvent, { type: 'stage' }> | undefined;
    expect(stage?.note).toMatch(/does not offer the model/);
    const logged = logLines.slice(before).join('\n');
    expect(logged).toMatch(/scan step failed/);
    expect(logged).toMatch(/model_not_found/);
    expect(logged).not.toMatch(/test-secret-key/);
  });
});

describe('what a person taught (the Train game)', () => {
  it('sends their corrections for this kind of object as hints, and uses their word for the same part', async () => {
    const { app, jobs } = makeApp();
    const { base, server } = await listen(app);
    mock.requests.length = 0;
    // The moka pot has no body plan: its kind is the last word of its name ("pot").
    const events = await runScanOverHttp(base, {
      ...scanBody(),
      taught: [
        { kind: 'pot', from: 'Handle', to: 'Grip' },
        { kind: 'pot', from: 'Lid', to: 'Steam vent' },
        { kind: 'car', from: 'Tail light', to: 'Wing mirror' },
      ],
    });
    jobs.close();
    server.close();
    const profile = (events.find((e) => e.type === 'profile') as Extract<ScanEvent, { type: 'profile' }>).profile;
    const marks = JSON.stringify(mock.requests.find((r) => r.body?.response_format?.json_schema?.name === 'part_marks')!.body.messages);
    expect(marks).toMatch(/corrected names on this kind of object before/);
    expect(marks).toMatch(/\\"Lid\\" was really \\"Steam vent\\"/);
    // Only for this kind of object: nothing about cars.
    expect(marks).not.toMatch(/Wing mirror/);
    // "Lid" to "Steam vent" is a mix-up (a hint only); the names it found stay as they are.
    expect(profile.regions.map((r) => r.label)).toContain('Lid');
  });
});

describe('a close call the photo cannot settle', () => {
  it('asks Muse Wonder to resolve it, with text only, and suggests the deciding photo', async () => {
    setDecideAnswer('cannot tell');
    try {
      const { app, jobs } = makeApp();
      const { base, server } = await listen(app);
      mock.requests.length = 0;
      const events = await runScanOverHttp(base, scanBody());
      const profile = (events.find((e) => e.type === 'profile') as Extract<ScanEvent, { type: 'profile' }>).profile;
      const wonder = mock.requests.find((r) => r.body?.model === 'muse-wonder-1.0')!;
      expect(wonder.body.reasoning).toEqual({ effort: 'high' });
      expect(wonder.body.text.format.type).toBe('json_schema');
      expect(JSON.stringify(wonder.body)).not.toContain('base64');
      expect(profile.candidates[0]!.name).toBe('Moka pot');
      expect(profile.candidates[0]!.likelihood).toBe(0.82);
      expect(profile.nextShot?.instruction).toMatch(/funnel/);
      expect(profile.trace.firewall.notes.join(' ')).toMatch(/Invented thing/);
      expect(profile.trace.stages.find((x) => x.id === 'retrieve')!.note).toMatch(/does not show enough to be sure/);
      jobs.close();
      server.close();
    } finally {
      setDecideAnswer('Moka pot');
    }
  });
});

describe('other routes', () => {
  it('uses the contributor model id only when asked', async () => {
    const { app, jobs } = makeApp();
    const { base, server } = await listen(app);
    await runScanOverHttp(base, scanBody({ privacyTier: 'contributor' }));
    const ids = new Set(mock.requests.filter((r) => r.path === '/v1/chat/completions').map((r) => r.body.model));
    expect([...ids]).toEqual(['muse-spark-1.3-contributor']);
    jobs.close();
    server.close();
  });

  it('runs the private route on the open-weight model only, with prompted JSON and pointer fallback', async () => {
    const { app, jobs } = makeApp();
    const { base, server } = await listen(app);
    const events = await runScanOverHttp(base, scanBody({ route: 'private' }));
    const profile = (events.find((e) => e.type === 'profile') as Extract<ScanEvent, { type: 'profile' }>).profile;
    expect(mock.count('/v1/')).toBe(0); // nothing went to the Meta Model API
    const ow = mock.requests.filter((r) => r.path === '/ow/v1/chat/completions');
    expect(ow.length).toBeGreaterThan(0);
    expect(ow[0]!.body.response_format).toBeUndefined();
    expect(ow[0]!.body.messages[0].role).toBe('system');
    expect(ow[0]!.auth).toBe('Bearer ow-key');
    expect(profile.regions.every((r) => r.kind === 'point' && r.source === 'model-estimate')).toBe(true);
    expect(profile.sources.some((s) => s.kind === 'search')).toBe(false);
    jobs.close();
    server.close();
  });

  it('gets an independent second opinion on the consensus route', async () => {
    const { app, jobs } = makeApp();
    const { base, server } = await listen(app);
    const events = await runScanOverHttp(base, scanBody({ route: 'consensus' }));
    const profile = (events.find((e) => e.type === 'profile') as Extract<ScanEvent, { type: 'profile' }>).profile;
    expect(profile.secondOpinion).not.toBeNull();
    expect(profile.secondOpinion!.model).toBe('meta-models/muse-spark-open');
    expect(profile.secondOpinion!.agreement).toBe('agrees');
    jobs.close();
    server.close();
  });

  it('asks before anything leaves the device on the local-first route', async () => {
    const { app, jobs } = makeApp();
    const { base, server } = await listen(app);
    let asked = false;
    const events = await runScanOverHttp(base, scanBody({ route: 'local-first' }), async (e) => {
      if (e.type !== 'escalation') return;
      asked = true;
      expect(mock.count('/v1/chat')).toBe(0);
      const job = [...(jobs as unknown as { jobs: Map<string, { id: string }> }).jobs.values()][0]!;
      const r = await fetch(`${base}/api/v1/jobs/${job.id}/escalation/${e.request.id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ approve: true }) });
      expect(r.status).toBe(200);
    });
    expect(asked).toBe(true);
    expect(mock.count('/local/v1/chat')).toBeGreaterThan(0);
    expect(mock.count('/v1/chat')).toBeGreaterThan(0);
    const profile = (events.find((e) => e.type === 'profile') as Extract<ScanEvent, { type: 'profile' }>).profile;
    expect(profile.trace.models.some((m) => m.model === 'muse-glimmer')).toBe(true);
    jobs.close();
    server.close();
  });

  it('declining the escalation keeps everything local', async () => {
    const { app, jobs } = makeApp();
    const { base, server } = await listen(app);
    await runScanOverHttp(base, scanBody({ route: 'local-first' }), async (e) => {
      if (e.type !== 'escalation') return;
      const job = [...(jobs as unknown as { jobs: Map<string, { id: string }> }).jobs.values()][0]!;
      await fetch(`${base}/api/v1/jobs/${job.id}/escalation/${e.request.id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ approve: false }) });
    });
    expect(mock.count('/v1/chat')).toBe(0);
    jobs.close();
    server.close();
  });

  it('replays buffered events to a late subscriber', async () => {
    const { app, jobs } = makeApp();
    const { base, server } = await listen(app);
    const start = await fetch(`${base}/api/v1/scans`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(scanBody()) });
    const { eventsUrl } = (await start.json()) as { eventsUrl: string };
    await new Promise((r) => setTimeout(r, 800));
    const seen: string[] = [];
    for await (const e of readSse(await fetch(`${base}${eventsUrl}`))) {
      seen.push(String(e.type));
      if (e.type === 'done' || e.type === 'error') break;
    }
    expect(seen[0]).toBe('stage');
    expect(seen).toContain('profile');
    jobs.close();
    server.close();
  });

  it('says the service could not be reached, not that the photo is bad, when the network fails', async () => {
    const { app, jobs } = makeApp(config({}, { META_API_BASE: 'http://127.0.0.1:1/v1' }));
    const { base, server } = await listen(app);
    const events = await runScanOverHttp(base, scanBody());
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'service_unreachable', stage: 'identify' });
    const look = events.filter((e) => e.type === 'stage' && (e as { id?: string }).id === 'identify').at(-1) as { status: string; note: string | null };
    expect(look).toMatchObject({ status: 'error' });
    expect(look.note).toMatch(/could not reach its analysis service/);
    jobs.close();
    server.close();
  });

  it('retries a provider 503 and does not retry a 400', async () => {
    const { app, jobs } = makeApp();
    const { base, server } = await listen(app);
    mock.failNext('/v1/chat/completions', 503, 1);
    const ok = await runScanOverHttp(base, scanBody());
    expect(ok.at(-1)!.type).toBe('done');
    mock.requests.length = 0;
    mock.failNext('/v1/chat/completions', 400, 1);
    const bad = await runScanOverHttp(base, scanBody());
    expect(bad.at(-1)).toMatchObject({ type: 'error', code: 'identify_failed' });
    expect(mock.count('/v1/chat/completions')).toBe(1);
    jobs.close();
    server.close();
  });

  it('repairs an answer that does not match the schema, once', async () => {
    const { app, jobs } = makeApp();
    const { base, server } = await listen(app);
    mock.breakSchemaOnce = 'identify';
    const events = await runScanOverHttp(base, scanBody());
    expect(events.at(-1)!.type).toBe('done');
    const identifyCalls = mock.requests.filter((r) => r.body?.response_format?.json_schema?.name === 'identify');
    expect(identifyCalls).toHaveLength(2);
    expect(identifyCalls[1]!.body.messages.at(-1).content).toMatch(/does not match the required schema/);
    jobs.close();
    server.close();
  });

  it('can be cancelled', async () => {
    const { app, jobs } = makeApp();
    const { base, server } = await listen(app);
    const start = await fetch(`${base}/api/v1/scans`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(scanBody()) });
    const { jobId } = (await start.json()) as { jobId: string };
    expect((await fetch(`${base}/api/v1/jobs/${jobId}/cancel`, { method: 'POST' })).status).toBe(200);
    const seen: ScanEvent[] = [];
    for await (const e of readSse(await fetch(`${base}/api/v1/jobs/${jobId}/events`))) {
      seen.push(e as ScanEvent);
      if (e.type === 'done' || e.type === 'error') break;
    }
    expect(seen.at(-1)).toMatchObject({ type: 'error', code: 'cancelled' });
    jobs.close();
    server.close();
  });
});

describe('follow-up endpoints', () => {
  let profile: Profile;
  beforeAll(async () => {
    const { app, jobs } = makeApp();
    const { base, server } = await listen(app);
    const events = await runScanOverHttp(base, scanBody());
    profile = (events.find((e) => e.type === 'profile') as Extract<ScanEvent, { type: 'profile' }>).profile;
    jobs.close();
    server.close();
  });

  it('ask: strips references to sources and regions that do not exist', async () => {
    const { app } = makeApp();
    const res = await app.request('/api/v1/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ digest: digestOf(profile), question: 'What is the little valve for?', consent: { sendImages: true, acknowledgedAt: 'x' } }),
    });
    expect(res.status).toBe(200);
    const body = AskResponseSchema.parse(await res.json());
    const [first, second] = body.output.segments;
    expect(first!.sourceIds).toEqual([]);
    expect(first!.basis).toBe('inferred');
    expect(first!.regionIds.every((id) => profile.regions.some((r) => r.id === id))).toBe(true);
    expect(second!.confidence).toBe(0.6);
  });

  it('compare', async () => {
    const { app } = makeApp();
    const d = digestOf(profile);
    const res = await app.request('/api/v1/compare', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ a: d, b: { ...d, id: 'other' } }) });
    const body = (await res.json()) as { output: { differences: Array<{ basis: string; sourceIds: string[] }> } };
    expect(body.output.differences[0]).toMatchObject({ basis: 'inferred', sourceIds: [] });
  });

  it('illustrate: Muse Image with store:false and no photo', async () => {
    const { app } = makeApp();
    const res = await app.request('/api/v1/illustrate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ digest: digestOf(profile) }) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { mime: string; prompt: string; model: string };
    expect(body).toMatchObject({ mime: 'image/png', model: 'muse-image-1.0' });
    expect(body.prompt).toMatch(/no text, letters, numbers, labels/i);
    const req = mock.requests.find((r) => r.body?.model === 'muse-image-1.0')!;
    expect(req.body.store).toBe(false);
    expect(typeof req.body.input).toBe('string');
  });

  it('inside: parts and flows go through the firewall', async () => {
    const { app } = makeApp();
    const res = await app.request('/api/v1/inside', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ digest: digestOf(profile), regions: profile.regions, sources: profile.sources.filter((x) => x.kind !== 'search') }),
    });
    expect(res.status).toBe(200);
    const { inside, sources } = InsideResponseSchema.parse(await res.json());
    expect(inside.kind).toBe('machine');
    // The inside is researched on the web first; the pages it cites come back as new sources.
    const research = mock.requests.filter((r) => Array.isArray(r.body?.tools) && String(r.body.input).startsWith('Describe what is inside')).at(-1)!;
    expect(research.body.tools[0]).toEqual({ type: 'web_search', search_context_size: 'high' });
    expect(sources.length).toBeGreaterThan(0);
    expect(sources[0]!.note).toMatch(/Research on the inside/);
    expect(Number(sources[0]!.id.slice(1))).toBeGreaterThan(profile.sources.filter((x) => x.kind !== 'search').length);
    const gasket = inside.groups[0]!.parts.find((p) => p.name === 'Gasket')!;
    // Unknown region removed; a citation to a source that was never retrieved is downgraded.
    expect(gasket.regionId).toBeNull();
    expect(gasket.visible).toBe(false);
    expect(inside.findings.find((f) => f.id === gasket.findingId)!.basis).not.toBe('sourced');
    expect(inside.flows[0]!.steps.length).toBe(2);
  });

  it('cutaway: drawn from the photo with no text, checked against it, and each part found in the drawing', async () => {
    const { app } = makeApp();
    const view = scanBody().views[0];
    mock.requests.length = 0;
    const res = await app.request('/api/v1/cutaway', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ digest: digestOf(profile), inside: { kind: 'machine', brief: 'A moka pot.', parts: ['Boiler', 'Gasket'] }, view, consent: { sendImages: true, acknowledgedAt: 'x' } }),
    });
    expect(res.status).toBe(200);
    const out = CutawayResponseSchema.parse(await res.json());
    expect(out.review).toMatchObject({ matchesPhoto: 4, accuracy: 4, redrawn: false });
    // The drawing is the photo's size, so it lines up with it.
    // The photo's shape, at full drawing quality (never shrunk to a small photo's size).
    expect(Math.abs(out.image.width / out.image.height - view!.width / view!.height)).toBeLessThan(0.01);
    expect(Math.max(out.image.width, out.image.height)).toBeGreaterThanOrEqual(1600);
    // One drawing only: the labels are not painted into the image (image models write text badly).
    const images = mock.requests.filter((r) => r.body?.model === 'muse-image-1.0');
    expect(images.length).toBe(1);
    expect(JSON.stringify(images[0]!.body.input)).toMatch(/Draw only what is inside it, in exactly the same pose/);
    expect(JSON.stringify(images[0]!.body.input)).toMatch(/take away the outer casing/);
    expect(JSON.stringify(images[0]!.body.input)).toMatch(/no text/i);
    expect(images[0]!.body.store).toBe(false);
    // Each part is located in the drawing, outlined and checked, and named exactly.
    // Candidates are outlined first (located by name, and outlined from text), then each numbered
    // outline is named by choosing from the list: the picture shows numbers only.
    const ground = mock.requests.find((r) => r.body?.response_format?.json_schema?.name === 'ground' && JSON.stringify(r.body.messages).includes('the inside of a'));
    expect(ground).toBeTruthy();
    // A drawing is located with medium thinking (high can run out of time and leave no labels).
    expect(ground!.body.reasoning_effort).toBe('medium');
    expect(mock.requests.some((r) => r.body?.model === 'sam-3.1' && String(r.body.input[0].content[0].text) === 'boiler')).toBe(true);
    const marks = mock.requests.find((r) => r.body?.response_format?.json_schema?.name === 'mark_names')!;
    expect(JSON.stringify(marks.body.messages)).toContain('Names to choose from');
    expect(out.regions.map((r) => r.label).sort()).toEqual(['Boiler', 'Gasket']);
    // The parts are found on a working copy of the large drawing (quicker uploads, no requests
    // running out of time), and mapped back onto the full drawing.
    const samImg = mock.requests.find((r) => r.body?.model === 'sam-3.1')!.body.input[0].content[1].image_url as string;
    const meta = await sharp(Buffer.from(samImg.split(',')[1]!, 'base64')).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(1280);
    const k = out.image.width / meta.width!;
    expect(k).toBeGreaterThan(1);
    // The stand-in's outlines are at least 48 px wide on the copy: on the full drawing, k times that.
    for (const r of out.regions) expect(r.box.w).toBeGreaterThanOrEqual(48 * k - 1);
    for (const r of out.regions) expect(r.box.x + r.box.w).toBeLessThanOrEqual(out.image.width + 1);
    expect(out.regions.every((r) => r.kind === 'mask' && r.path)).toBe(true);
    expect(out.labels).toMatchObject({ expected: ['Boiler', 'Gasket'], correct: ['Boiler', 'Gasket'], problems: [] });
  });

  it('cutaway: each label is checked again up close; a sure "none of these" removes it', async () => {
    const { app } = makeApp();
    const view = scanBody().views[0];
    const post = () =>
      app.request('/api/v1/cutaway', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ digest: digestOf(profile), inside: { kind: 'machine', brief: 'A moka pot.', parts: ['Boiler', 'Gasket'] }, view, consent: { sendImages: true, acknowledgedAt: 'x' } }),
      });
    try {
      // Sure that each outline is none of the parts: every label is removed.
      mock.requests.length = 0;
      setDrawingPartAnswer(() => ({ looks: 'Drawn metal.', name: null, sure: true }));
      const none = CutawayResponseSchema.parse(await (await post()).json());
      expect(none.regions).toEqual([]);
      const looks = mock.requests.filter((r) => r.body?.response_format?.json_schema?.name === 'drawing_part');
      expect(looks.length).toBe(2);
      // Each look sees one part on its own (a close-up and the whole drawing), and the list of names only.
      expect(looks.every((r) => (r.body.messages[1].content as Array<{ type: string }>).filter((c) => c.type === 'image_url').length === 2)).toBe(true);
      const asked = String((looks[0]!.body.messages[1].content as Array<{ type: string; text?: string }>).find((c) => c.type === 'text')?.text);
      expect(asked).toContain('"Boiler", "Gasket"');
      // Unsure: the first labels stand.
      setDrawingPartAnswer(() => ({ looks: 'Drawn metal.', name: null, sure: false }));
      const kept = CutawayResponseSchema.parse(await (await post()).json());
      expect(kept.regions.map((r) => r.label).sort()).toEqual(['Boiler', 'Gasket']);
    } finally {
      setDrawingPartAnswer(null);
    }
  });

  it('cutaway: when no numbered outline can be named, the parts found by their own names are still labelled', async () => {
    const { app } = makeApp();
    const view = scanBody().views[0];
    setMarkNamesBlank(true);
    try {
      const res = await app.request('/api/v1/cutaway', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ digest: digestOf(profile), inside: { kind: 'machine', brief: 'A moka pot.', parts: ['Boiler', 'Gasket'] }, view, consent: { sendImages: true, acknowledgedAt: 'x' } }),
      });
      const out = CutawayResponseSchema.parse(await res.json());
      expect(out.regions.map((r) => r.label).sort()).toEqual(['Boiler', 'Gasket']);
      expect(out.regions.every((r) => r.kind === 'mask' && r.path)).toBe(true);
    } finally {
      setMarkNamesBlank(false);
    }
  });

  it('cutaway of an animal: draws and labels its real skeleton and organs, never outside parts or its own name', async () => {
    const { app } = makeApp();
    const view = scanBody().views[0];
    mock.requests.length = 0;
    const digest = { ...digestOf(profile), displayName: 'Holstein cow', category: 'animal' as const };
    const res = await app.request('/api/v1/cutaway', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ digest, inside: { kind: 'living', brief: 'A cow.', parts: ['Udder', 'Teat', 'Torso', 'Rumen', 'Heart', 'Omasum'] }, view, consent: { sendImages: true, acknowledgedAt: 'x' } }),
    });
    expect(res.status).toBe(200);
    const out = CutawayResponseSchema.parse(await res.json());
    const drawing = JSON.stringify(mock.requests.find((r) => r.body?.model === 'muse-image-1.0')!.body.input);
    expect(drawing).toMatch(/Rumen/);
    expect(drawing).toMatch(/no upper front teeth/);
    expect(drawing).not.toMatch(/Udder|Teat|Torso/);
    expect(out.labels!.expected).toEqual(expect.arrayContaining(['Skull', 'Ribs', 'Heart', 'Rumen', 'Small intestine']));
    expect(out.labels!.expected.join(' ')).not.toMatch(/Udder|Teat|Torso|cow/i);
    expect(out.regions.length).toBeGreaterThan(5);
    expect(out.regions.every((r) => !/cow|torso|udder/i.test(r.label))).toBe(true);
  });

  it('cutaway of a car called by its model: labels its real inner parts, never the outside parts in the photo', async () => {
    const { app } = makeApp();
    const view = scanBody().views[0];
    mock.requests.length = 0;
    const digest = {
      ...digestOf(profile),
      displayName: 'BYD Atto 3',
      category: 'vehicle' as const,
      subcategory: 'compact SUV',
      summary: 'The BYD Atto 3 is a compact all-electric SUV.',
      components: ['Bumper', 'Door', 'Wing mirror', 'Headlight', 'Front emblem'].map((name) => ({ name, role: 'outside' })),
    };
    const res = await app.request('/api/v1/cutaway', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ digest, inside: { kind: 'machine', brief: 'An electric SUV.', parts: ['Bumper', 'Door', 'Battery pack', 'Inverter', 'Thermal management system'] }, view, consent: { sendImages: true, acknowledgedAt: 'x' } }),
    });
    expect(res.status).toBe(200);
    const out = CutawayResponseSchema.parse(await res.json());
    const drawing = mock.requests.find((r) => r.body?.model === 'muse-image-1.0')!.body;
    const text = JSON.stringify(drawing.input);
    expect(text).toMatch(/Battery pack/);
    expect(text).toMatch(/Electric motor/);
    expect(text).toMatch(/Thermal management system/);
    expect(text).not.toMatch(/Show clearly:[^.]*(Bumper|Door|Wing mirror|Fuel tank|Exhaust)/);
    expect(out.labels!.expected.join(' ')).not.toMatch(/Bumper|Door|Wing mirror|Headlight|emblem|Fuel tank/);
    expect(out.regions.every((r) => !/Bumper|Door|mirror|Headlight|emblem/i.test(r.label))).toBe(true);
    // Drawn in the photo's shape, using a size Meta documents, at its highest quality.
    expect(drawing.tools[0]).toMatchObject({ type: 'image_generation', quality: 'high' });
    expect(['1024x1024', '1536x1024', '1024x1536']).toContain(drawing.tools[0].size);
  });

  it('drawing: if the quality settings are refused, asks again without them and still uses the references', async () => {
    const { app } = makeApp();
    const view = scanBody().views[0];
    mock.requests.length = 0;
    mock.rejectImageQuality = true;
    try {
      const res = await app.request('/api/v1/cutaway', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ digest: digestOf(profile), inside: { kind: 'machine', brief: 'A moka pot.', parts: ['Boiler'] }, view, consent: { sendImages: true, acknowledgedAt: 'x' } }),
      });
      expect(res.status).toBe(200);
      const tries = mock.requests.filter((r) => r.body?.model === 'muse-image-1.0');
      expect(tries.length).toBe(2);
      expect(tries[1]!.body.tools[0].quality).toBeUndefined();
      expect(tries[1]!.body.tools[0].enable_image_search).toBe(true);
    } finally {
      mock.rejectImageQuality = false;
    }
  });

  it('cutaway in the background: answers at once, then hands over the drawing when asked', async () => {
    const { app } = makeApp();
    const view = scanBody().views[0];
    const start = await app.request('/api/v1/cutaway?background=1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ digest: digestOf(profile), inside: { kind: 'machine', brief: 'A moka pot.', parts: ['Boiler'] }, view, consent: { sendImages: true, acknowledgedAt: 'x' } }),
    });
    expect(start.status).toBe(202);
    const { jobId } = (await start.json()) as { jobId: string };
    let answer: ReturnType<typeof CutawayJobSchema.parse> = { status: 'running' };
    for (let i = 0; i < 200 && answer.status === 'running'; i++) {
      const poll = await app.request(`/api/v1/cutaway/jobs/${jobId}`);
      expect(poll.status).toBe(200);
      answer = CutawayJobSchema.parse(await poll.json());
      if (answer.status === 'running') await new Promise((r) => setTimeout(r, 25));
    }
    expect(answer.status).toBe('done');
    if (answer.status === 'done') expect(answer.result.image.base64.length).toBeGreaterThan(100);
    // An unknown or expired drawing.
    const gone = await app.request('/api/v1/cutaway/jobs/not-a-drawing');
    expect(gone.status).toBe(404);
    expect(((await gone.json()) as { error: { code: string } }).error.code).toBe('not_found');
  });

  it('cutaway in the background: a failed drawing hands back the same error a direct request would', async () => {
    const { app } = makeApp();
    const view = scanBody().views[0];
    mock.imageStatus = 403;
    try {
      const start = await app.request('/api/v1/cutaway?background=1', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ digest: digestOf(profile), inside: null, view: null, consent: null }),
      });
      expect(start.status).toBe(202);
      const { jobId } = (await start.json()) as { jobId: string };
      let poll = await app.request(`/api/v1/cutaway/jobs/${jobId}`);
      for (let i = 0; i < 200 && poll.status === 200; i++) {
        await new Promise((r) => setTimeout(r, 25));
        poll = await app.request(`/api/v1/cutaway/jobs/${jobId}`);
      }
      expect(poll.status).toBe(502);
      expect(((await poll.json()) as { error: { code: string } }).error.code).toBe('provider_auth');
    } finally {
      mock.imageStatus = null;
    }
  });

  it('cutaway from the app: starts it in the background and waits for it over short requests', async () => {
    const { app } = makeApp();
    const { base, server } = await listen(app);
    const realFetch = globalThis.fetch;
    const paths: string[] = [];
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      paths.push(`${init?.method ?? 'GET'} ${url}`);
      return realFetch(`${base}${url}`, init);
    }) as typeof fetch;
    try {
      const view = scanBody().views[0]!;
      const out = await makeCutawayFromApp({ digest: digestOf(profile), inside: { kind: 'machine', brief: 'A moka pot.', parts: ['Boiler'] }, view: { ...view, label: null }, consent: { sendImages: true, acknowledgedAt: 'x' }, privacyTier: 'private', language: 'en' });
      expect(out.image.base64.length).toBeGreaterThan(100);
      expect(paths[0]).toBe('POST /api/v1/cutaway?background=1');
      expect(paths.slice(1).every((p) => p.startsWith('GET /api/v1/cutaway/jobs/'))).toBe(true);
    } finally {
      globalThis.fetch = realFetch;
      server.close();
    }
  });

  it('drawing: if the size is refused, asks again without only the size', async () => {
    const { app } = makeApp();
    const view = scanBody().views[0];
    mock.requests.length = 0;
    mock.imageSizes = ['none of ours'];
    try {
      const res = await app.request('/api/v1/cutaway', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ digest: digestOf(profile), inside: { kind: 'machine', brief: 'A moka pot.', parts: ['Boiler'] }, view, consent: { sendImages: true, acknowledgedAt: 'x' } }),
      });
      expect(res.status).toBe(200);
      const tries = mock.requests.filter((r) => r.body?.model === 'muse-image-1.0');
      expect(tries[0]!.body.tools[0].size).toBeDefined();
      // The second try leaves out the size but keeps the quality, reasoning and search settings.
      expect(tries[1]!.body.tools[0].size).toBeUndefined();
      expect(tries[1]!.body.tools[0]).toMatchObject({ quality: 'high', reasoning_strength: 'high', enable_image_search: true });
    } finally {
      mock.imageSizes = null;
    }
  });

  it('drawing: asks for the documented size closest to the photo', () => {
    expect(sizeFor({ width: 3000, height: 4000 })).toBe('1024x1536');
    expect(sizeFor({ width: 4000, height: 3000 })).toBe('1536x1024');
    expect(sizeFor({ width: 1000, height: 1100 })).toBe('1024x1024');
    expect(sizeFor(null)).toBe('1024x1024');
  });

  it('cutaway: draws from public-domain reference pictures, without showing them', async () => {
    const png = await sharp({ create: { width: 1600, height: 1000, channels: 3, background: '#eeeeee' } }).png().toBuffer();
    const commons = (async (url: string) =>
      url.includes('commons.wikimedia.org/w/api.php')
        ? new Response(
            JSON.stringify({
              query: {
                pages: [
                  {
                    title: 'File:Cow skeleton photo.jpg',
                    index: 1,
                    imageinfo: [{ thumburl: 'https://upload.wikimedia.org/credit.jpg', descriptionurl: 'https://commons.wikimedia.org/wiki/File:Cow_skeleton_photo.jpg', mime: 'image/jpeg', width: 1600, height: 1000, extmetadata: { ImageDescription: { value: 'Skeleton of a cow in a museum' }, LicenseShortName: { value: 'CC BY-SA 4.0' }, Artist: { value: 'A. Photographer' } } }],
                  },
                  {
                    title: 'File:Cow skeleton.png',
                    index: 2,
                    imageinfo: [{ thumburl: 'https://upload.wikimedia.org/x.png', descriptionurl: 'https://commons.wikimedia.org/wiki/File:Cow_skeleton.png', mime: 'image/png', width: 1600, height: 1000, extmetadata: { ImageDescription: { value: 'Skeleton of a cow, 1889 plate' }, LicenseShortName: { value: 'Public domain' }, AttributionRequired: { value: 'false' } } }],
                  },
                ],
              },
            }),
          )
        : url.includes('upload.wikimedia.org')
          ? new Response(png)
          : connectorFetch(url)) as unknown as typeof fetch;
    const fetched: string[] = [];
    const watch = (async (url: string, init?: RequestInit) => {
      fetched.push(String(url));
      return commons(url, init);
    }) as unknown as typeof fetch;
    const app = createApp({ cfg: config(), connectorFetch: watch, breakers: new CircuitBreakers({ threshold: 50, cooldownMs: 10 }), sleep: async () => {} }).app;
    mock.requests.length = 0;
    const digest = { ...digestOf(profile), displayName: 'Holstein cow', category: 'animal' as const };
    const res = await app.request('/api/v1/cutaway', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ digest, inside: { kind: 'living', brief: 'A cow.', parts: ['Heart'] }, view: scanBody().views[0], consent: { sendImages: true, acknowledgedAt: 'x' } }),
    });
    const out = CutawayResponseSchema.parse(await res.json());
    const drawing = mock.requests.find((r) => r.body?.model === 'muse-image-1.0')!.body;
    // The photo, then the real reference picture.
    expect(drawing.input[0].content.filter((c: { type: string }) => c.type === 'input_image').length).toBe(2);
    expect(JSON.stringify(drawing.input)).toMatch(/real reference picture/);
    // Only the public-domain picture is used; the one that asks for credit is never downloaded.
    expect(fetched).toContain('https://upload.wikimedia.org/x.png');
    expect(fetched).not.toContain('https://upload.wikimedia.org/credit.jpg');
    // Nothing about the references is sent to the page.
    expect(JSON.stringify(out)).not.toMatch(/Cow skeleton|wikimedia/i);
    // Every problem found is corrected, with the placement rules.
    expect(JSON.stringify(drawing.input)).toMatch(/brain inside the skull/);
  });

  it('verify: a second look picks the name that fits, without knowing whose it is, in either order', async () => {
    const { app } = makeApp();
    const view = scanBody().views[0];
    // The stand-in "sees" a spout: it picks whichever option says Spout, wherever it is shown.
    setSecondOpinion((a, b) => ({ choice: a === 'Spout' ? 'A' : b === 'Spout' ? 'B' : 'neither', sure: true, reason: 'It pours.' }));
    try {
      const picks: Array<number | null> = [];
      for (let k = 0; k < 6; k++) {
        mock.requests.length = 0;
        const res = await app.request('/api/v1/verify', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ view, region: { path: 'M10 10L60 10L60 40Z', box: { x: 10, y: 10, w: 50, h: 30 } }, object: 'Moka pot', options: ['Lid', 'Spout'] }),
        });
        expect(res.status).toBe(200);
        const out = VerifyResponseSchema.parse(await res.json());
        picks.push(out.pick);
        expect(out.reason).toBe('It pours.');
        const text = JSON.stringify(mock.requests.find((r) => r.body?.response_format?.json_schema?.name === 'second_opinion')!.body.messages);
        // Not told which name came from I SEE and which from the person.
        expect(text).not.toMatch(/I SEE (?:said|called)|the person said|user said|correct(?:ed)? (?:it|name)/i);
        expect(text).toMatch(/Which name fits the outlined region/);
      }
      expect(picks.every((p) => p === 1)).toBe(true);
      setSecondOpinion(() => ({ choice: 'neither', sure: false, reason: 'It is the background.' }));
      const res = await app.request('/api/v1/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ view, region: { path: null, box: { x: 10, y: 10, w: 50, h: 30 } }, object: 'Moka pot', options: ['Lid', 'Spout'] }),
      });
      expect(VerifyResponseSchema.parse(await res.json()).pick).toBeNull();
    } finally {
      setSecondOpinion(null);
    }
  });

  it('translate: interface text comes back one for one', async () => {
    const { app } = makeApp();
    const res = await app.request('/api/v1/translate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ texts: ['Examine a photo', 'Settings'], language: 'fr' }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ translations: ['«Examine a photo»', '«Settings»'] });
  });

  it('glance: names what is in a camera frame', async () => {
    const { app } = makeApp();
    const view = scanBody().views[0];
    const res = await app.request('/api/v1/glance', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ view, consent: { sendImages: true, acknowledgedAt: 'x' } }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ label: 'Moka pot', hint: null });
  });

  it('segment: click-to-outline with a point', async () => {
    const { app } = makeApp();
    const res = await app.request('/api/v1/segment', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ view: { mime: 'image/jpeg', base64: jpeg320, width: 320, height: 334, label: null }, concept: null, points: [{ x: 230, y: 240 }] }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { regions: Array<{ source: string; path: string }> };
    expect(body.regions[0]!.source).toBe('user');
    expect(mock.requests.find((r) => r.body?.model === 'sam-3.1')!.body.input[0].content[0].text).toMatch(/^<0f>1<\|point;x=230;y=240;w=320;h=334\|>$/);
  });

  it('transcribe: validates the WAV and sends request + audio parts', async () => {
    const { app } = makeApp();
    const wav = (rate: number, channels = 1) => {
      const samples = rate / 10;
      const b = Buffer.alloc(44 + samples * 2 * channels);
      b.write('RIFF', 0);
      b.writeUInt32LE(36 + samples * 2 * channels, 4);
      b.write('WAVE', 8);
      b.write('fmt ', 12);
      b.writeUInt32LE(16, 16);
      b.writeUInt16LE(1, 20);
      b.writeUInt16LE(channels, 22);
      b.writeUInt32LE(rate, 24);
      b.writeUInt32LE(rate * 2 * channels, 28);
      b.writeUInt16LE(2 * channels, 32);
      b.writeUInt16LE(16, 34);
      b.write('data', 36);
      b.writeUInt32LE(samples * 2 * channels, 40);
      return b;
    };
    const send = (buf: Buffer) => {
      const form = new FormData();
      form.append('audio', new Blob([new Uint8Array(buf)], { type: 'audio/wav' }), 'a.wav');
      form.append('keywords', JSON.stringify(['safety valve', 'funnel']));
      form.append('languageBias', 'en,<script>');
      return app.request('/api/v1/transcribe', { method: 'POST', body: form });
    };
    const ok = await send(wav(24000));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ transcript: 'what is the little valve for', model: 'muse-voice-transcribe-1.0' });
    const raw = mock.requests.find((r) => r.path === '/v1/asr/transcribe')!.raw.toString('latin1');
    expect(raw).toContain('"keywords":["safety valve","funnel"]');
    expect(raw).toContain('"languageBias":["en"]');
    expect(raw).toContain('"audioEncoding":"WAV"');
    expect((await send(wav(44100))).status).toBe(415);
    expect((await send(wav(16000, 2))).status).toBe(415);
    expect((await send(Buffer.from('not a wav file at all, sorry, not even close'))).status).toBe(415);
  });

  it('maps provider auth failures without leaking details', async () => {
    const { app } = makeApp(config({}, { MODEL_API_KEY: 'LLM|9|wrong' }));
    const res = await app.request('/api/v1/illustrate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ digest: digestOf(profile) }) });
    expect(res.status).toBe(502);
    const body = await res.text();
    expect(JSON.parse(body).error.code).toBe('provider_auth');
    expect(body).not.toContain('wrong');
  });
});

describe('helpers', () => {
  it('scales paths', () => {
    expect(scalePath('M10 20L30 40H50V60Z', 0.5, 2)).toBe('M5 40L15 80H25V120Z');
  });
});
