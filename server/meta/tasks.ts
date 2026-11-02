/**
 * ModelTasks on the Meta Model API.
 *
 *   identify, compose, ask, compare  Muse Spark (Chat Completions, json_schema, vision)
 *   resolve                          Muse Wonder (Responses API, high reasoning, text only)
 *   decide                           Muse Spark web search on what tells close candidates apart, then a check of the photo
 *   segment                          SAM 3.1 (Responses API stream, @meta-sam/parser)
 *   illustrate                       Muse Image (Responses API, store: false)
 *   transcribe                       Muse Voice Transcribe (POST /asr/transcribe)
 *   secondOpinion                    delegated to an open-weight model when one is configured
 */
import { createHash } from 'node:crypto';
import { DecideOutputSchema, ResolveOutputSchema, type IdentifyOutput, type ResolveOutput } from '../../src/shared/model-io';
import { DECIDE_SYSTEM, PROMPT_VERSION, RESOLVE_SYSTEM, decideSearchPrompt, decideUser, illustratePrompt, photoCutawayPrompt, resolveUser } from '../../src/shared/prompts';
import type { Source } from '../../src/shared/schema';
import type {
  CallCtx,
  DecideInput,
  DecideResult,
  PartsResearch,
  IdentifyInput,
  IllustrateInput,
  IllustrateOutput,
  ModelTasks,
  ResolveInput,
  SegmentInput,
  SegmentOutput,
  TranscribeInput,
  TranscribeOutput,
  Tracked,
} from '../../src/shared/tasks';
import { ChatTasks } from '../chat-tasks';
import { sparkModel, type Config } from '../config';
import { ApiError, HttpClient, type CircuitBreakers } from './http';
import { dataUrl, samSegment } from './sam';
import { scaleRegions, workingCopy, labelImage, nameOutline, type LabelDeps } from './label';
import { chatStructured, responsesStructured } from './structured';
import { parseGrounded, partsResearch } from '../retrieval/search';
import { log } from '../log';
import { usageFrom } from './usage';

export const META_PROVIDER = 'Meta Model API';

export function sniffImageMime(b64: string): string {
  const head = Buffer.from(b64.slice(0, 24), 'base64');
  if (head[0] === 0x89 && head[1] === 0x50) return 'image/png';
  if (head[0] === 0xff && head[1] === 0xd8) return 'image/jpeg';
  if (head.toString('ascii', 0, 4) === 'RIFF' && head.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return 'image/png';
}

/**
 * Muse Image's full-quality (2K, about 2.5 megapixel) sizes. The one closest to the photo's
 * shape is asked for, so the drawing is as sharp as the model can make it and needs no
 * cropping to line up with the photo.
 */
export const IMAGE_PRESETS: Array<[number, number]> = [
  [1600, 1600],
  [1920, 1280],
  [1280, 1920],
  [1792, 1344],
  [1344, 1792],
  [2048, 1152],
  [1152, 2048],
  [2352, 1008],
];
export function sizeFor(photo: { width: number; height: number } | null): string {
  if (!photo) return '1600x1600';
  const r = Math.log(photo.width / Math.max(1, photo.height));
  const [w, h] = IMAGE_PRESETS.reduce((best, p) => (Math.abs(Math.log(p[0] / p[1]) - r) < Math.abs(Math.log(best[0] / best[1]) - r) ? p : best));
  return `${w}x${h}`;
}

export class MetaTasks extends ChatTasks implements ModelTasks {
  constructor(
    private readonly cfg: Config,
    readonly client: HttpClient,
    private readonly second: ModelTasks | null = null,
  ) {
    super({
      id: 'meta',
      client,
      provider: META_PROVIDER,
      modelFor: (ctx) => sparkModel(cfg, ctx.privacyTier),
      mode: 'json_schema',
      instructionRole: 'developer',
      vision: true,
      reasoning: true,
      timeoutMs: cfg.requestTimeoutMs,
    });
  }

  static create(cfg: Config, opts: { fetch?: typeof fetch; breakers?: CircuitBreakers; second?: ModelTasks | null; sleep?: (ms: number) => Promise<void> } = {}): MetaTasks {
    const client = new HttpClient({
      baseUrl: cfg.meta.baseUrl,
      apiKey: cfg.meta.apiKey,
      provider: META_PROVIDER,
      fetch: opts.fetch,
      breakers: opts.breakers,
      timeoutMs: cfg.requestTimeoutMs,
      sleep: opts.sleep,
    });
    return new MetaTasks(cfg, client, opts.second ?? null);
  }

  override async resolve(input: ResolveInput, ctx: CallCtx): Promise<Tracked<ResolveOutput>> {
    const model = this.cfg.meta.models.wonder;
    const r = await responsesStructured({
      client: this.client,
      model,
      schema: ResolveOutputSchema,
      name: 'resolve',
      system: RESOLVE_SYSTEM(ctx.language),
      user: resolveUser(input),
      reasoningEffort: 'high',
      signal: ctx.signal,
      timeoutMs: Math.max(this.cfg.requestTimeoutMs, 180_000),
    });
    return { value: r.value, usage: r.usage, model, provider: META_PROVIDER, ms: r.ms, promptVersion: PROMPT_VERSION };
  }

  /**
   * Close candidates (a fancy rat or a fancy mouse?): look up on the web what tells them apart,
   * then check each of those features in the photo and settle on one, citing the research.
   */
  async decide(input: DecideInput, ctx: CallCtx): Promise<Tracked<DecideResult>> {
    const model = sparkModel(this.cfg, ctx.privacyTier);
    const started = Date.now();
    const names = input.candidates.slice(0, 3).map((c) => c.name);
    let research = '';
    let sources: Array<Omit<Source, 'id'>> = [];
    try {
      const { data } = await this.client.postJson(
        '/responses',
        { model, input: decideSearchPrompt(names), tools: [{ type: 'web_search', search_context_size: 'high' }], store: false },
        { signal: ctx.signal, timeoutMs: 75_000, maxRetries: 0 },
      );
      const g = parseGrounded(data);
      research = g.text.slice(0, 6000);
      const now = new Date().toISOString();
      sources = g.sources.map((r) => ({
        connector: 'web-search',
        kind: 'search' as const,
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
        note: `Looked up to tell ${names.join(' from ')} apart. The snippet is the passage of the search answer that cites this page.`,
      }));
    } catch (e) {
      log('warn', 'research on telling the candidates apart failed', { error: (e as Error).message });
    }
    const r = await chatStructured({
      client: this.client,
      model,
      schema: DecideOutputSchema,
      name: 'decide',
      system: DECIDE_SYSTEM,
      user: decideUser({ candidates: input.candidates.slice(0, 3), observations: input.observations, textRead: input.textRead, research }),
      images: [input.view],
      mode: 'json_schema',
      instructionRole: 'developer',
      reasoningEffort: 'medium',
      signal: ctx.signal,
      timeoutMs: this.cfg.requestTimeoutMs,
    });
    return { value: { decision: r.value, sources }, usage: r.usage, model, provider: META_PROVIDER, ms: Date.now() - started, promptVersion: PROMPT_VERSION };
  }

  /** What parts this kind of object has, by their real names, from the web (with the pages cited). */
  async researchParts(input: { object: string; category: string }, ctx: CallCtx): Promise<Tracked<PartsResearch>> {
    const model = sparkModel(this.cfg, ctx.privacyTier);
    const started = Date.now();
    const r = await partsResearch(this.client, model, input.object, input.category, ctx.signal);
    const now = new Date().toISOString();
    const sources = r.sources.map((x) => ({
      connector: 'web-search',
      kind: 'search' as const,
      url: x.url,
      title: x.title.slice(0, 300) || x.url,
      publisher: x.publisher.slice(0, 160),
      tier: x.tier ?? 4,
      category: x.category ?? 'search',
      publishedAt: null,
      retrievedAt: now,
      snippet: x.snippet.slice(0, 4000),
      contentHash: createHash('sha256').update(x.snippet).digest('hex'),
      license: null,
      note: `Looked up for the parts a ${input.object} has. The snippet is the passage of the search answer that cites this page.`,
    }));
    return { value: { names: r.names, sources }, usage: r.usage, model, provider: META_PROVIDER, ms: Date.now() - started, promptVersion: PROMPT_VERSION };
  }

  /** For labelling: Muse Spark locates and checks, SAM 3.1 outlines. */
  labelDeps(ctx: CallCtx): LabelDeps {
    return { client: this.client, samModel: this.cfg.meta.models.sam, sparkModel: sparkModel(this.cfg, ctx.privacyTier), signal: ctx.signal, timeoutMs: this.cfg.requestTimeoutMs };
  }

  override async segment(input: SegmentInput, ctx: CallCtx): Promise<Tracked<SegmentOutput>> {
    const model = this.cfg.meta.models.sam;
    const started = Date.now();
    // Named parts: located by Muse Spark, outlined by SAM 3.1, then checked.
    if (!input.points?.length && !input.box && (input.labels?.length || input.concepts?.length)) {
      const names = input.labels?.length ? input.labels : (input.concepts ?? []);
      // Parts are found on a working copy (about 1500 px) and mapped back onto the full photo.
      const work = await workingCopy(input.view, 1536);
      const r = await labelImage(this.labelDeps(ctx), work.img, names, { object: input.object ?? null, viewIndex: input.viewIndex, source: 'sam', clipToObject: true, vocabulary: input.vocabulary ?? [], method: this.cfg.labelMethod ?? 'segments', taught: input.taught ?? [], twoLooks: input.depth !== 'quick' });
      return { value: { ...r, regions: scaleRegions(r.regions, work.kx, work.ky) }, usage: null, model, provider: META_PROVIDER, ms: Date.now() - started, promptVersion: PROMPT_VERSION };
    }
    const r = await samSegment(this.client, input, { model, signal: ctx.signal });
    // A tapped outline is named by what it shows.
    if ((input.points?.length || input.box) && r.regions[0]) {
      const name = await nameOutline(this.labelDeps(ctx), input.view, r.regions[0], input.object ?? null);
      if (name) r.regions = r.regions.map((x, i) => (i === 0 ? { ...x, label: name } : x));
    }
    return {
      value: { regions: r.regions, diagnostics: r.diagnostics },
      usage: null,
      model,
      provider: META_PROVIDER,
      ms: r.ms,
      promptVersion: PROMPT_VERSION,
    };
  }

  override async illustrate(input: IllustrateInput, ctx: CallCtx): Promise<Tracked<IllustrateOutput>> {
    const model = this.cfg.meta.models.image;
    const photo = input.photo ?? null;
    const prompt = input.prompt
      ? input.prompt
      : photo
        ? photoCutawayPrompt(input.digest, input.inside ?? null)
        : illustratePrompt(input.digest, input.inside ?? null);
    const extra = input.references ?? [];
    const body = (tier: number): Record<string, unknown> => ({
      model,
      input: photo
        ? [
            {
              role: 'user',
              content: [
                { type: 'input_text', text: input.instruction ? `${input.instruction}\n\n${prompt}` : prompt },
                { type: 'input_image', image_url: dataUrl(photo) },
                ...extra.map((r) => ({ type: 'input_image', image_url: dataUrl(r) })),
              ],
            },
          ]
        : prompt,
      // store: false — nothing about this request is kept on Meta's side for chaining.
      store: false,
      // Reasoning on, and reference image and web search allowed, so it can check real references.
      ...(tier > 0
        ? {
            tools: [
              {
                type: 'image_generation',
                size: input.size ?? sizeFor(photo),
                output_format: 'jpeg',
                // Highest quality: the most detail, and the least compression.
                ...(tier > 1 ? { quality: 'high', output_compression: 98 } : {}),
                reasoning_strength: 'high',
                enable_image_search: true,
                enable_web_search: true,
              },
            ],
          }
        : {}),
    });
    const call = (tier: number) =>
      // One retry at most: a drawing that times out twice is not worth a third long wait.
      this.client.postJson<{ output?: Array<{ type?: string; result?: unknown; status?: string }>; usage?: unknown }>('/responses', body(tier), {
        signal: ctx.signal,
        timeoutMs: Math.max(this.cfg.requestTimeoutMs, 150_000),
        maxRetries: 1,
      });
    // Settings from fullest to plainest: if one is not accepted, ask again with fewer.
    let res: Awaited<ReturnType<typeof call>> | null = null;
    for (let tier = 2; tier >= 0; tier--) {
      try {
        res = await call(tier);
        break;
      } catch (e) {
        if (!(tier > 0 && e instanceof ApiError && e.status === 400 && e.code !== 'content_policy_violation')) throw e;
        log('warn', 'image settings not accepted; asking with fewer', { tier, error: e.message });
      }
    }
    if (!res) throw new ApiError('Muse Image returned no image.', 200, 'no_image', true, META_PROVIDER);
    const { data, ms } = res;
    const item = (data.output ?? []).find((o) => o?.type === 'image_generation_call' && typeof o.result === 'string');
    if (!item) throw new ApiError('Muse Image returned no image.', 200, 'no_image', true, META_PROVIDER);
    const base64 = item.result as string;
    return { value: { mime: sniffImageMime(base64), base64, prompt }, usage: usageFrom(data.usage, model, 1), model, provider: META_PROVIDER, ms, promptVersion: PROMPT_VERSION };
  }

  override async transcribe(input: TranscribeInput, ctx: CallCtx): Promise<Tracked<TranscribeOutput>> {
    const model = this.cfg.meta.models.asr;
    const request: Record<string, unknown> = { mode: 'PUSH_TO_TALK', model, audioEncoding: 'WAV' };
    const keywords = input.keywords.map((k) => k.trim()).filter(Boolean).slice(0, 50);
    if (keywords.length) request.keywords = keywords;
    if (input.languageBias.length) request.languageBias = input.languageBias.slice(0, 5);
    const wav = input.wav;
    const { data, ms } = await this.client.postForm<{ sessionId?: unknown; transcript?: unknown; audioDurationMs?: unknown }>(
      '/asr/transcribe',
      () => {
        const form = new FormData();
        // The parameters travel as a JSON part, not as form fields.
        form.append('request', new Blob([JSON.stringify(request)], { type: 'application/json' }));
        form.append('audio', new Blob([wav as Uint8Array<ArrayBuffer>], { type: 'audio/wav' }), 'audio.wav');
        return form;
      },
      { signal: ctx.signal, timeoutMs: 120_000 },
    );
    return {
      value: {
        transcript: typeof data.transcript === 'string' ? data.transcript : '',
        durationMs: typeof data.audioDurationMs === 'number' ? data.audioDurationMs : null,
        sessionId: typeof data.sessionId === 'string' ? data.sessionId : null,
      },
      usage: null,
      model,
      provider: META_PROVIDER,
      ms,
      promptVersion: PROMPT_VERSION,
    };
  }

  override async secondOpinion(input: IdentifyInput, ctx: CallCtx): Promise<Tracked<IdentifyOutput>> {
    if (!this.second) return this.unsupported('A second opinion (no open-weight model is configured)');
    return this.second.identify(input, { ...ctx, route: 'private' });
  }
}
