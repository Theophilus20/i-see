/**
 * The I SEE gateway (Hono).
 *
 * Holds the API keys, chooses models per route, runs scans and streams their progress.
 * Stateless by design: photos and profiles pass through memory and are never written
 * to disk. Jobs (and the events of a scan) are kept for ten minutes so a browser can
 * reconnect, then deleted.
 */
import { createHash, randomUUID } from 'node:crypto';
import { getConnInfo } from '@hono/node-server/conninfo';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { streamSSE } from 'hono/streaming';
import type { z } from 'zod';
import {
  API_PREFIX,
  AskRequestSchema,
  CompareRequestSchema,
  IllustrateRequestSchema,
  InsideRequestSchema,
  GlanceRequestSchema,
  CutawayRequestSchema,
  TranslateRequestSchema,
  ScanRequestSchema,
  SegmentRequestSchema,
  VerifyRequestSchema,
  type ApiErrorBody,
  type HealthInfo,
  type ScanEvent,
} from '../src/shared/api';
import type { AskOutput } from '../src/shared/model-io';
import { assembleInside } from '../src/shared/inside';
import { HAZARDS, type Hazard } from '../src/shared/epistemics';
import { runScan } from '../src/shared/orchestrator';
import { makeCutaway } from './meta/cutaway';
import type { Route, Source } from '../src/shared/schema';
import type { CallCtx, ModelTasks, Retriever } from '../src/shared/tasks';
import { sanitizeText } from '../src/shared/text';
import { loadCapabilities } from './capabilities';
import { sparkModel, type Config } from './config';
import { JobStore } from './jobs';
import { log } from './log';
import { inspectWav, sanitizeImage, UploadError } from './media';
import { ApiError, CancelledError, HttpClient, type CircuitBreakers } from './meta/http';
import { MetaTasks } from './meta/tasks';
import { scalePath } from './meta/sam';
import { secondOpinion, workingCopy } from './meta/label';
import { OpenWeightTasks } from './openweight/tasks';
import { RateLimiter } from './ratelimit';
import { SourceRetriever } from './retrieval';
import { groundedSearch, insideResearch } from './retrieval/search';
import { modelCheck } from './meta/models';

export interface AppDeps {
  cfg: Config;
  /** Fetch used for model providers (tests point this at a mock). */
  fetch?: typeof fetch;
  /** Fetch used for retrieval connectors. */
  connectorFetch?: typeof fetch;
  breakers?: CircuitBreakers;
  sleep?: (ms: number) => Promise<void>;
}

interface RouteSet {
  primary: ModelTasks;
  secondary: ModelTasks | null;
  retriever: Retriever;
}

type Env = { Variables: { requestId: string } };

export { scalePath };

export function createApp(deps: AppDeps) {
  const { cfg } = deps;
  const providerOpts = { fetch: deps.fetch, breakers: deps.breakers, sleep: deps.sleep };

  const openWeight = cfg.openWeight ? OpenWeightTasks.create(cfg.openWeight, 'spark-open', providerOpts) : null;
  const local = cfg.local ? OpenWeightTasks.create(cfg.local, 'glimmer', providerOpts) : null;
  const meta = cfg.meta.apiKey ? MetaTasks.create(cfg, { ...providerOpts, second: openWeight ?? local }) : null;
  const metaClient = meta?.client ?? null;

  const searchFor = (tier: CallCtx['privacyTier']) =>
    metaClient && cfg.searchGrounding ? (queries: string[], signal?: AbortSignal) => groundedSearch(metaClient, sparkModel(cfg, tier), queries, signal) : null;
  const retrieverFor = (route: Route, tier: CallCtx['privacyTier']) =>
    new SourceRetriever({
      fetch: deps.connectorFetch,
      connectors: cfg.connectors,
      // Web search goes through Meta, so it is used only on routes that already use Meta.
      search: route === 'hosted' || route === 'consensus' ? searchFor(tier) : null,
    });

  const routes = {
    hosted: !!meta,
    private: !!(openWeight ?? local),
    consensus: !!meta && !!(openWeight ?? local),
    'local-first': !!local && !!meta,
  } satisfies Record<Route, boolean>;

  function routeSet(route: Route, tier: CallCtx['privacyTier']): RouteSet | null {
    switch (route) {
      case 'hosted':
        return meta ? { primary: meta, secondary: null, retriever: retrieverFor(route, tier) } : null;
      case 'private': {
        const ow = openWeight ?? local;
        return ow ? { primary: ow, secondary: null, retriever: retrieverFor(route, tier) } : null;
      }
      case 'consensus': {
        const ow = openWeight ?? local;
        return meta && ow ? { primary: meta, secondary: ow, retriever: retrieverFor(route, tier) } : null;
      }
      case 'local-first':
        return local && meta ? { primary: local, secondary: meta, retriever: retrieverFor(route, tier) } : null;
    }
  }

  // The capability table follows the model names in use (the start-up check may switch them).
  let caps = { key: '', list: [] as ReturnType<typeof loadCapabilities> };
  const capabilitiesNow = () => {
    const key = JSON.stringify(cfg.meta.models);
    if (caps.key !== key) caps = { key, list: loadCapabilities(cfg) };
    return caps.list;
  };
  const jobs = new JobStore();
  const scanLimiter = new RateLimiter(Math.max(1, Math.round(cfg.ratePerMinute / 3)));
  const callLimiter = new RateLimiter(cfg.ratePerMinute);
  // The live camera asks every couple of seconds; it gets its own budget so it never starves the rest.
  const glanceLimiter = new RateLimiter(40);
  const anyRoute = Object.values(routes).some(Boolean);

  const health = (): HealthInfo => ({
    ok: true,
    version: cfg.version,
    mode: anyRoute ? 'live' : 'unconfigured',
    routes,
    features: { segment: !!meta, voice: !!meta, illustrate: !!meta, searchGrounding: !!meta && cfg.searchGrounding, resolve: anyRoute },
    limits: { maxImageBytes: cfg.maxImageBytes, maxViews: cfg.maxViews, maxAudioSeconds: cfg.maxAudioSeconds, ratePerMinute: cfg.ratePerMinute },
    privacyTier: cfg.privacyTier,
    capabilities: capabilitiesNow(),
    connectors: new SourceRetriever({ connectors: cfg.connectors, search: searchFor(cfg.privacyTier) }).connectorIds,
    serverStoresImages: false,
    ...(cfg.meta.apiKey ? { modelCheck: modelCheck(cfg) } : {}),
  });

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  const app = new Hono<Env>();

  const fail = (c: Context<Env>, status: number, code: string, message: string, retryable = false) =>
    c.json<ApiErrorBody>({ error: { code, message, retryable, requestId: c.get('requestId') } }, status as 400);

  const clientKey = (c: Context<Env>): string => {
    if (process.env.TRUST_PROXY === '1') {
      const fwd = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
      if (fwd) return fwd;
    }
    try {
      return getConnInfo(c).remote.address ?? 'unknown';
    } catch {
      return 'local';
    }
  };

  const limited = (c: Context<Env>, limiter: RateLimiter, cost = 1) => {
    const wait = limiter.take(clientKey(c), cost);
    if (!wait) return null;
    c.header('Retry-After', String(Math.ceil(wait / 1000)));
    return fail(c, 429, 'rate_limited', 'Too many requests. Please wait a moment and try again.', true);
  };

  async function parseBody<S extends z.ZodType>(c: Context<Env>, schema: S): Promise<{ ok: true; data: z.infer<S> } | { ok: false; res: Response }> {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return { ok: false, res: fail(c, 400, 'bad_json', 'The request body is not valid JSON.') };
    }
    const r = schema.safeParse(raw);
    if (!r.success) {
      const detail = r.error.issues
        .slice(0, 4)
        .map((i) => `${i.path.join('.') || 'body'}: ${i.message}`)
        .join('; ');
      return { ok: false, res: fail(c, 400, 'invalid_request', `The request is not valid (${detail}).`) };
    }
    return { ok: true, data: r.data as z.infer<S> };
  }

  const fromError = (c: Context<Env>, e: unknown) => {
    if (e instanceof UploadError) return fail(c, e.status, e.code, e.message);
    if (e instanceof CancelledError) return fail(c, 499, 'cancelled', 'The request was cancelled.', true);
    if (e instanceof ApiError) {
      log('warn', 'provider error', { requestId: c.get('requestId'), provider: e.provider, status: e.status, code: e.code, message: e.message });
      if (e.code === 'unsupported') return fail(c, 501, 'unsupported', e.message);
      if (e.status === 401 || e.status === 403) return fail(c, 502, 'provider_auth', `${e.provider} rejected the server's credentials. The server's API key needs attention.`);
      if (e.code === 'network') return fail(c, 502, 'service_unreachable', e.message, true);
      if (e.code === 'circuit_open') return fail(c, 503, 'provider_paused', e.message, true);
      if (e.code === 'timeout') return fail(c, 504, 'provider_timeout', `${e.provider} took too long to answer.`, true);
      if (e.status === 400) return fail(c, 502, 'provider_rejected', `${e.provider} could not process this request.`);
      return fail(c, 502, 'provider_error', `${e.provider} had a problem answering. Please try again.`, e.retryable);
    }
    log('error', 'unhandled', { requestId: c.get('requestId'), error: (e as Error)?.stack ?? String(e) });
    return fail(c, 500, 'internal', 'Something went wrong on the server.', true);
  };

  const unconfigured = (c: Context<Env>) =>
    fail(c, 503, 'unconfigured', 'No model provider is configured on this server. Add MODEL_API_KEY (Meta Model API) or an open-weight endpoint. Sample runs still work in the app.');

  const ctxFor = (signal: AbortSignal, route: Route, language: string, privacyTier: CallCtx['privacyTier']): CallCtx => ({ signal, route, language, privacyTier, runId: randomUUID() });

  // -------------------------------------------------------------------------
  // Middleware
  // -------------------------------------------------------------------------

  app.use('*', async (c, next) => {
    const id = randomUUID();
    c.set('requestId', id);
    c.header('X-Request-Id', id);
    const t0 = Date.now();
    await next();
    if (c.req.path.startsWith(API_PREFIX)) log('info', 'request', { id, method: c.req.method, path: c.req.path, status: c.res.status, ms: Date.now() - t0 });
  });
  app.use(
    '*',
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        mediaSrc: ["'self'", 'blob:'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", 'data:'],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
      },
      permissionsPolicy: { camera: ['self'], microphone: ['self'], geolocation: [] },
      referrerPolicy: 'no-referrer',
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(`${API_PREFIX}/*`, cors({ origin: (origin) => (cfg.allowedOrigins.includes(origin) ? origin : null), allowMethods: ['GET', 'POST'], maxAge: 600 }));

  const jsonLimit = (bytes: number) =>
    bodyLimit({ maxSize: bytes, onError: (c) => fail(c as Context<Env>, 413, 'too_large', 'The request is too large.') });
  const imageJsonBytes = Math.ceil(cfg.maxImageBytes * 1.4 * cfg.maxViews) + 256 * 1024;

  // -------------------------------------------------------------------------
  // Routes
  // -------------------------------------------------------------------------

  const api = new Hono<Env>();

  api.get('/health', (c) => c.json(health()));

  api.post('/scans', jsonLimit(imageJsonBytes), async (c) => {
    const lim = limited(c, scanLimiter);
    if (lim) return lim;
    if (!anyRoute) return unconfigured(c);
    const body = await parseBody(c, ScanRequestSchema);
    if (!body.ok) return body.res;
    const req = body.data;
    const set = routeSet(req.route, req.privacyTier);
    if (!set) return fail(c, 503, 'route_unavailable', `The "${req.route}" route is not configured on this server.`);
    if (jobs.active >= jobs.maxActive) return fail(c, 503, 'busy', 'The server is busy. Please try again in a minute.', true);
    try {
      req.views = await Promise.all(req.views.map((v) => sanitizeImage(v, cfg.maxImageBytes)));
    } catch (e) {
      return fromError(c, e);
    }
    const job = jobs.create(clientKey(c));
    const emit = (e: ScanEvent) => jobs.push(job, e);
    void runScan(req, {
      tasks: set.primary,
      secondary: set.secondary,
      retriever: set.retriever,
      emit,
      signal: job.controller.signal,
      requestEscalation: (r) => jobs.awaitEscalation(job, r.id),
      mode: 'live',
      log: (level, msg, data) => log(level, msg, { job: job.id, ...data }),
    }).catch((e: unknown) => {
      log('error', 'scan crashed', { job: job.id, error: (e as Error)?.stack ?? String(e) });
      if (job.finishedAt === null) emit({ type: 'error', code: 'internal', message: 'Something went wrong while building the profile.', retryable: true, stage: null });
    });
    return c.json({ jobId: job.id, eventsUrl: `${API_PREFIX}/jobs/${job.id}/events` }, 202);
  });

  api.get('/jobs/:id/events', (c) => {
    const job = jobs.get(c.req.param('id'));
    if (!job) return fail(c, 404, 'not_found', 'That scan has finished and been cleared, or never existed.');
    const lastId = Number(c.req.header('last-event-id') ?? -1);
    return streamSSE(c, async (stream) => {
      let closed = false;
      const queue: Array<{ e: ScanEvent; i: number }> = [];
      let wake: (() => void) | null = null;
      const listener = (e: ScanEvent, i: number) => {
        queue.push({ e, i });
        wake?.();
      };
      job.events.forEach((e, i) => {
        if (i > lastId) queue.push({ e, i });
      });
      job.listeners.add(listener);
      stream.onAbort(() => {
        closed = true;
        wake?.();
      });
      try {
        for (;;) {
          while (queue.length) {
            const { e, i } = queue.shift()!;
            await stream.writeSSE({ id: String(i), event: e.type, data: JSON.stringify(e) });
            if (e.type === 'done' || e.type === 'error') return;
          }
          if (closed || job.finishedAt !== null) return;
          await new Promise<void>((resolve) => {
            wake = resolve;
            const t = setTimeout(resolve, 15_000);
            t.unref();
          });
          wake = null;
          if (!queue.length && !closed) await stream.write(': keep-alive\n\n');
        }
      } finally {
        job.listeners.delete(listener);
      }
    });
  });

  api.post('/jobs/:id/cancel', (c) => {
    const job = jobs.get(c.req.param('id'));
    if (!job) return fail(c, 404, 'not_found', 'No such scan.');
    if (job.owner !== clientKey(c)) return fail(c, 403, 'forbidden', 'This scan belongs to another client.');
    job.controller.abort();
    return c.json({ ok: true });
  });

  api.post('/jobs/:id/escalation/:reqId', jsonLimit(4096), async (c) => {
    const job = jobs.get(c.req.param('id'));
    if (!job) return fail(c, 404, 'not_found', 'No such scan.');
    if (job.owner !== clientKey(c)) return fail(c, 403, 'forbidden', 'This scan belongs to another client.');
    let approve = false;
    try {
      approve = (await c.req.json<{ approve?: unknown }>()).approve === true;
    } catch {
      /* default: decline */
    }
    const ok = jobs.answerEscalation(job, c.req.param('reqId'), approve);
    return ok ? c.json({ ok: true, approve }) : fail(c, 404, 'not_found', 'That request is no longer waiting for an answer.');
  });

  api.post('/segment', jsonLimit(Math.ceil(cfg.maxImageBytes * 1.4) + 64 * 1024), async (c) => {
    const lim = limited(c, callLimiter);
    if (lim) return lim;
    if (!meta) return fail(c, 501, 'unsupported', 'Outlining needs SAM 3.1 on the Meta Model API, which is not configured.');
    const body = await parseBody(c, SegmentRequestSchema);
    if (!body.ok) return body.res;
    const b = body.data;
    try {
      // Re-encode (drops any metadata), then map coordinates between the browser's pixels and ours.
      const clean = await sanitizeImage(b.view, cfg.maxImageBytes);
      const sx = clean.width / b.view.width;
      const sy = clean.height / b.view.height;
      const r = await meta.segment(
        {
          view: clean,
          viewIndex: b.viewIndex,
          concepts: b.concept ? [sanitizeText(b.concept, 80)] : undefined,
          points: b.points.map((p) => ({ ...p, x: p.x * sx, y: p.y * sy })),
          box: b.box ? { x: b.box.x * sx, y: b.box.y * sy, w: b.box.w * sx, h: b.box.h * sy } : undefined,
          object: b.object ? sanitizeText(b.object, 160) : null,
        },
        ctxFor(c.req.raw.signal, 'hosted', b.language, 'private'),
      );
      if (sx !== 1 || sy !== 1) {
        r.value.regions = r.value.regions.map((g) => ({
          ...g,
          box: { x: g.box.x / sx, y: g.box.y / sy, w: g.box.w / sx, h: g.box.h / sy },
          anchor: { x: g.anchor.x / sx, y: g.anchor.y / sy },
          path: g.path ? scalePath(g.path, 1 / sx, 1 / sy) : null,
        }));
      }
      return c.json({ regions: r.value.regions, diagnostics: r.value.diagnostics, model: r.model });
    } catch (e) {
      return fromError(c, e);
    }
  });

  // A second look at a correction made in the Train game (see secondOpinion).
  api.post('/verify', jsonLimit(Math.ceil(cfg.maxImageBytes * 1.4) + 256 * 1024), async (c) => {
    const lim = limited(c, callLimiter);
    if (lim) return lim;
    if (!meta) return fail(c, 501, 'unsupported', 'A second look needs Muse Spark on the Meta Model API, which is not configured.');
    const body = await parseBody(c, VerifyRequestSchema);
    if (!body.ok) return body.res;
    const b = body.data;
    try {
      const clean = await sanitizeImage(b.view, cfg.maxImageBytes);
      // On a working copy, with the outline scaled to it.
      const work = await workingCopy(clean, 1536);
      const kx = b.view.width / work.img.width;
      const ky = b.view.height / work.img.height;
      const region = {
        path: b.region.path ? scalePath(b.region.path, 1 / kx, 1 / ky) : null,
        box: { x: b.region.box.x / kx, y: b.region.box.y / ky, w: b.region.box.w / kx, h: b.region.box.h / ky },
      };
      const ctx = ctxFor(c.req.raw.signal, 'hosted', b.language, b.privacyTier);
      const r = await secondOpinion(meta.labelDeps(ctx), work.img, region, b.object ? sanitizeText(b.object, 160) : null, [sanitizeText(b.options[0], 80), sanitizeText(b.options[1], 80)]);
      return c.json({ ...r, model: sparkModel(cfg, b.privacyTier) });
    } catch (e) {
      return fromError(c, e);
    }
  });

  api.post('/ask', jsonLimit(Math.ceil(cfg.maxImageBytes * 1.4) + 512 * 1024), async (c) => {
    const lim = limited(c, callLimiter);
    if (lim) return lim;
    if (!anyRoute) return unconfigured(c);
    const body = await parseBody(c, AskRequestSchema);
    if (!body.ok) return body.res;
    const b = body.data;
    const set = routeSet(b.route, b.privacyTier) ?? routeSet('hosted', b.privacyTier) ?? routeSet('private', b.privacyTier);
    if (!set) return unconfigured(c);
    try {
      const signal = c.req.raw.signal;
      const ctx = ctxFor(signal, b.route, b.language, b.privacyTier);
      const view = b.view ? await sanitizeImage(b.view, cfg.maxImageBytes) : null;
      // Extra sources for the question, with ids that cannot collide with the profile's.
      let extra: Source[] = [];
      try {
        const r = await set.retriever.retrieve([{ query: `${b.digest.displayName} ${b.question}`.slice(0, 120), intent: 'specs' }], { ...ctx, category: b.digest.category, textRead: [] });
        extra = r.sources.slice(0, 6).map((s, i) => ({ ...s, id: `q${i + 1}` }));
      } catch {
        /* answer from the profile alone */
      }
      const res = await set.primary.ask({ digest: b.digest, question: b.question, history: b.history, regionId: b.regionId, view, sources: extra }, ctx);
      const output = checkAnswer(res.value, new Set([...b.digest.sources.map((s) => s.id), ...extra.map((s) => s.id)]), new Set(b.digest.regions.map((r) => r.id)));
      return c.json({ output, sources: extra, model: res.model, provider: res.provider });
    } catch (e) {
      return fromError(c, e);
    }
  });

  api.post('/compare', jsonLimit(1024 * 1024), async (c) => {
    const lim = limited(c, callLimiter);
    if (lim) return lim;
    if (!anyRoute) return unconfigured(c);
    const body = await parseBody(c, CompareRequestSchema);
    if (!body.ok) return body.res;
    const b = body.data;
    const set = routeSet(b.route, b.privacyTier) ?? routeSet('hosted', b.privacyTier) ?? routeSet('private', b.privacyTier);
    if (!set) return unconfigured(c);
    try {
      const r = await set.primary.compare({ a: b.a, b: b.b }, ctxFor(c.req.raw.signal, b.route, b.language, b.privacyTier));
      const known = new Set([...b.a.sources, ...b.b.sources].map((s) => s.id));
      const output = {
        ...r.value,
        differences: r.value.differences.slice(0, 7).map((d) => {
          const sourceIds = d.sourceIds.filter((id) => known.has(id));
          return { ...d, sourceIds, basis: d.basis === 'sourced' && !sourceIds.length ? 'inferred' : d.basis, quote: null, regionIds: [] };
        }),
      };
      return c.json({ output, model: r.model, provider: r.provider });
    } catch (e) {
      return fromError(c, e);
    }
  });

  api.post('/inside', jsonLimit(3 * 1024 * 1024), async (c) => {
    const lim = limited(c, callLimiter);
    if (lim) return lim;
    if (!anyRoute) return unconfigured(c);
    const body = await parseBody(c, InsideRequestSchema);
    if (!body.ok) return body.res;
    const b = body.data;
    const set = routeSet(b.route, b.privacyTier) ?? routeSet('hosted', b.privacyTier) ?? routeSet('private', b.privacyTier);
    if (!set) return unconfigured(c);
    try {
      const ctx = ctxFor(c.req.raw.signal, b.route, b.language, b.privacyTier);
      // Look up the real inside first (anatomy and skeleton, or the internal parts), with citations,
      // so the hidden parts rest on references rather than on general knowledge.
      const added: Source[] = [];
      if (metaClient && cfg.searchGrounding && b.route !== 'local-first') {
        try {
          const found = await insideResearch(metaClient, sparkModel(cfg, b.privacyTier), b.digest.displayName, b.digest.category, c.req.raw.signal);
          const now = new Date().toISOString();
          const known = new Set(b.sources.map((x) => x.url));
          for (const r of found.sources) {
            if (known.has(r.url) || !r.snippet) continue;
            known.add(r.url);
            added.push({
              id: `s${b.sources.length + added.length + 1}`,
              connector: 'web-search',
              kind: 'search',
              url: r.url,
              title: r.title.slice(0, 300) || r.url,
              publisher: r.publisher.slice(0, 160),
              tier: r.tier ?? 4,
              category: r.category ?? 'search',
              publishedAt: null,
              retrievedAt: now,
              snippet: r.snippet.slice(0, 4000),
              contentHash: createHash('sha256').update(r.snippet).digest('hex'),
              license: null,
              note: 'Research on the inside. The snippet is the passage of the search answer that cites this page.',
            });
          }
        } catch (e) {
          log('warn', 'research on the inside failed; using the profile sources', { error: (e as Error).message });
        }
      }
      const sources = [...b.sources, ...added].slice(0, 60);
      const r = await set.primary.inside({ digest: b.digest, regions: b.regions.map((x) => ({ id: x.id, label: x.label })), sources }, ctx);
      const inside = assembleInside({
        draft: r.value,
        regions: b.regions,
        sources,
        category: b.digest.category,
        hazards: b.hazards.filter((h): h is Hazard => (HAZARDS as readonly string[]).includes(h)),
        now: new Date().toISOString(),
      });
      return c.json({ inside, sources: added.filter((x) => sources.includes(x)) });
    } catch (e) {
      return fromError(c, e);
    }
  });

  api.post('/glance', jsonLimit(2 * 1024 * 1024), async (c) => {
    const lim = limited(c, glanceLimiter);
    if (lim) return lim;
    if (!anyRoute) return unconfigured(c);
    const body = await parseBody(c, GlanceRequestSchema);
    if (!body.ok) return body.res;
    const set = routeSet('hosted', body.data.privacyTier) ?? routeSet('private', body.data.privacyTier);
    if (!set) return unconfigured(c);
    try {
      const view = await sanitizeImage(body.data.view, cfg.maxImageBytes);
      const r = await set.primary.glance({ view }, ctxFor(c.req.raw.signal, 'hosted', body.data.language, body.data.privacyTier));
      return c.json({ label: r.value.label ? sanitizeText(r.value.label, 60) : null, confidence: Math.max(0, Math.min(1, Number(r.value.confidence) || 0)), hint: r.value.hint ? sanitizeText(r.value.hint, 80) : null });
    } catch (e) {
      return fromError(c, e);
    }
  });

  api.post('/illustrate', jsonLimit(1024 * 1024), async (c) => {
    const lim = limited(c, callLimiter, 2);
    if (lim) return lim;
    if (!meta) return fail(c, 501, 'unsupported', 'Illustrations need Muse Image on the Meta Model API, which is not configured.');
    const body = await parseBody(c, IllustrateRequestSchema);
    if (!body.ok) return body.res;
    try {
      const r = await meta.illustrate({ digest: body.data.digest, inside: body.data.inside }, ctxFor(c.req.raw.signal, 'hosted', 'en', body.data.privacyTier));
      return c.json({ mime: r.value.mime, base64: r.value.base64, prompt: r.value.prompt, model: r.model });
    } catch (e) {
      return fromError(c, e);
    }
  });

  api.post('/cutaway', jsonLimit(Math.ceil(cfg.maxImageBytes * 1.4) + 256 * 1024), async (c) => {
    const lim = limited(c, callLimiter, 3);
    if (lim) return lim;
    if (!meta) return fail(c, 501, 'unsupported', 'Cutaways need Muse Image and SAM 3.1 on the Meta Model API.');
    const body = await parseBody(c, CutawayRequestSchema);
    if (!body.ok) return body.res;
    const b = body.data;
    try {
      const photo = b.view && b.consent ? await sanitizeImage(b.view, cfg.maxImageBytes) : null;
      const r = await makeCutaway(meta, cfg, { digest: b.digest, inside: b.inside, photo, style: 'cutaway' }, ctxFor(c.req.raw.signal, 'hosted', b.language, b.privacyTier), deps.connectorFetch ?? fetch);
      return c.json(r);
    } catch (e) {
      return fromError(c, e);
    }
  });

  /** Interface text in the person's language (Muse Spark). Cached by the browser. */
  api.post('/translate', jsonLimit(256 * 1024), async (c) => {
    const lim = limited(c, callLimiter);
    if (lim) return lim;
    if (!anyRoute) return unconfigured(c);
    const body = await parseBody(c, TranslateRequestSchema);
    if (!body.ok) return body.res;
    const set = routeSet('hosted', 'private') ?? routeSet('private', 'private');
    if (!set) return unconfigured(c);
    const texts = body.data.texts.map((t) => sanitizeText(t, 400));
    try {
      const r = await set.primary.translate({ texts, language: body.data.language }, ctxFor(c.req.raw.signal, 'hosted', body.data.language, 'private'));
      const out = r.value.translations.map((t) => sanitizeText(t, 600));
      if (out.length !== texts.length) return fail(c, 502, 'provider_error', 'The translation came back incomplete.', true);
      return c.json({ translations: out });
    } catch (e) {
      return fromError(c, e);
    }
  });

  api.post('/transcribe', bodyLimit({ maxSize: cfg.maxAudioBytes + 64 * 1024, onError: (c) => fail(c as Context<Env>, 413, 'too_large', 'The recording is too large (32 MB at most).') }), async (c) => {
    const lim = limited(c, callLimiter);
    if (lim) return lim;
    if (!meta) return fail(c, 501, 'unsupported', 'Voice needs Muse Voice Transcribe on the Meta Model API, which is not configured.');
    try {
      const form = await c.req.formData();
      const audio = form.get('audio');
      if (!(audio instanceof Blob)) return fail(c, 400, 'invalid_request', 'Attach the recording as "audio".');
      const wav = new Uint8Array(await audio.arrayBuffer());
      const info = inspectWav(wav, cfg.maxAudioSeconds);
      const parseList = (v: string | File | null): string[] => {
        if (typeof v !== 'string' || !v) return [];
        try {
          const j = JSON.parse(v) as unknown;
          return Array.isArray(j) ? j.map(String) : [];
        } catch {
          return v.split(',');
        }
      };
      const keywords = parseList(form.get('keywords'))
        .map((k) => sanitizeText(k, 60))
        .filter(Boolean)
        .slice(0, 50);
      const languageBias = parseList(form.get('languageBias'))
        .map((l) => l.trim())
        .filter((l) => /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(l))
        .slice(0, 5);
      const r = await meta.transcribe({ wav, keywords, languageBias }, ctxFor(c.req.raw.signal, 'hosted', 'en', 'private'));
      return c.json({ transcript: r.value.transcript, durationMs: r.value.durationMs ?? info.durationMs, model: r.model });
    } catch (e) {
      return fromError(c, e);
    }
  });

  api.notFound((c) => fail(c, 404, 'not_found', 'No such endpoint.'));
  app.route(API_PREFIX, api);

  if (cfg.staticDir) {
    const root = cfg.staticDir;
    app.use('/assets/*', async (c, next) => {
      await next();
      if (c.res.ok) c.header('Cache-Control', 'public, max-age=31536000, immutable');
    });
    app.use('*', serveStatic({ root }));
    app.get('*', serveStatic({ root, path: 'index.html' }));
  }

  app.onError((e, c) => fromError(c, e));

  return { app, jobs, health, routes };
}

/** Light firewall for answers: no references to sources or regions that do not exist. */
export function checkAnswer(out: AskOutput, sourceIds: Set<string>, regionIds: Set<string>): AskOutput {
  return {
    ...out,
    segments: out.segments.slice(0, 12).map((s) => {
      const src = s.sourceIds.filter((id) => sourceIds.has(id));
      const basis = s.basis === 'sourced' && !src.length ? 'inferred' : s.basis;
      return {
        ...s,
        text: sanitizeText(s.text, 700),
        sourceIds: src,
        regionIds: s.regionIds.filter((id) => regionIds.has(id)),
        basis,
        confidence: s.confidence == null || basis === 'unknown' ? null : Math.min(Math.max(0, s.confidence), basis === 'hypothesis' ? 0.6 : basis === 'inferred' ? 0.88 : 0.97),
        quote: basis === 'sourced' ? s.quote : null,
      };
    }),
    followUps: out.followUps.slice(0, 4).map((f) => sanitizeText(f, 200)),
  };
}

export { HttpClient };
