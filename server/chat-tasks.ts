/**
 * Model tasks that run on any OpenAI-compatible Chat Completions endpoint:
 * the Meta Model API (Muse Spark) and open-weight hosts (Muse Spark Open, Muse Glimmer).
 * Provider-specific tasks (SAM, Wonder, Image, Voice) are added by subclasses.
 */
import {
  ScreenSourcesOutputSchema,
  type ScreenSourcesOutput,
  TranslateOutputSchema,
  type TranslateOutput,
  AskOutputSchema,
  CompareOutputSchema,
  GlanceOutputSchema,
  IdentifyOutputSchema,
  InsideDraftSchema,
  ProfileCoreDraftSchema,
  ProfileExtrasDraftSchema,
  ResolveOutputSchema,
  type AskOutput,
  type CompareOutput,
  type GlanceOutput,
  type IdentifyOutput,
  type InsideDraft,
  type ProfileExtrasDraft,
  type ResolveOutput,
} from '../src/shared/model-io';
import {
  SCREEN_SYSTEM,
  screenUser,
  TRANSLATE_SYSTEM,
  ASK_SYSTEM,
  COMPARE_SYSTEM,
  COMPOSE_CORE_SYSTEM,
  COMPOSE_EXTRAS_SYSTEM,
  GLANCE_SYSTEM,
  IDENTIFY_SYSTEM,
  INSIDE_SYSTEM,
  PROMPT_VERSION,
  RESOLVE_SYSTEM,
  askUser,
  compareUser,
  composeUser,
  identifyUser,
  insideUser,
  resolveUser,
} from '../src/shared/prompts';
import type {
  ScreenSourcesInput,
  TranslateInput,
  AskInput,
  CallCtx,
  CompareInput,
  ComposeInput,
  ComposeOutput,
  GlanceInput,
  IdentifyInput,
  InsideInput,
  IllustrateInput,
  IllustrateOutput,
  ModelTasks,
  ResolveInput,
  SegmentInput,
  SegmentOutput,
  TranscribeInput,
  TranscribeOutput,
  Tracked,
} from '../src/shared/tasks';
import { ApiError, type HttpClient } from './meta/http';
import { chatStructured, type ReasoningEffort } from './meta/structured';
import { addUsage } from './meta/usage';
import { log } from './log';

const EMPTY_EXTRAS: ProfileExtrasDraft = { timeline: [], safety: [], related: [], live: [], whatIf: [] };

export interface ChatTasksOptions {
  id: string;
  client: HttpClient;
  /** Display name of the provider, e.g. "Meta Model API" or "Baseten". */
  provider: string;
  /** Model id to use for a call (privacy tier aware for Meta). */
  modelFor: (ctx: CallCtx) => string;
  mode: 'json_schema' | 'prompt';
  instructionRole: 'developer' | 'system';
  vision: boolean;
  /** Whether the endpoint accepts `reasoning_effort`. */
  reasoning: boolean;
  timeoutMs?: number;
}

export class ChatTasks implements ModelTasks {
  readonly id: string;
  constructor(protected readonly o: ChatTasksOptions) {
    this.id = o.id;
  }

  protected unsupported(what: string): never {
    throw new ApiError(`${what} is not available on ${this.o.provider}.`, 501, 'unsupported', false, this.o.provider);
  }

  protected tracked<T>(value: T, model: string, usage: Tracked<T>['usage'], ms: number, provider = this.o.provider): Tracked<T> {
    return { value, usage, model, provider, ms, promptVersion: PROMPT_VERSION };
  }

  protected effort(e: ReasoningEffort): ReasoningEffort | null {
    return this.o.reasoning ? e : null;
  }

  protected images<T>(views: T[] | null | undefined): T[] {
    if (!views?.length) return [];
    if (!this.o.vision) this.unsupported('Image input');
    return views;
  }

  async identify(input: IdentifyInput, ctx: CallCtx): Promise<Tracked<IdentifyOutput>> {
    const model = this.o.modelFor(ctx);
    const r = await chatStructured({
      client: this.o.client,
      model,
      schema: IdentifyOutputSchema,
      name: 'identify',
      system: IDENTIFY_SYSTEM(ctx.language),
      user: identifyUser(input),
      images: this.images(input.views),
      mode: this.o.mode,
      instructionRole: this.o.instructionRole,
      reasoningEffort: this.effort(input.depth === 'deep' ? 'medium' : 'low'),
      signal: ctx.signal,
      timeoutMs: this.o.timeoutMs,
    });
    return this.tracked(r.value, model, r.usage, r.ms);
  }

  async secondOpinion(input: IdentifyInput, ctx: CallCtx): Promise<Tracked<IdentifyOutput>> {
    return this.identify(input, ctx);
  }

  async compose(input: ComposeInput, ctx: CallCtx): Promise<Tracked<ComposeOutput>> {
    const model = this.o.modelFor(ctx);
    const user = composeUser(input, input.identify.primary.category);
    const images = this.o.vision ? (input.views ?? []) : [];
    const common = {
      client: this.o.client,
      model,
      user,
      images,
      mode: this.o.mode,
      instructionRole: this.o.instructionRole,
      // Low effort: a long write-up at medium effort regularly ran past the time limit.
      reasoningEffort: this.effort('low'),
      signal: ctx.signal,
      timeoutMs: this.o.timeoutMs,
    } as const;
    const [core, extrasResult] = await Promise.all([
      chatStructured({ ...common, schema: ProfileCoreDraftSchema, name: 'profile_core', system: COMPOSE_CORE_SYSTEM(ctx.language) }),
      // The extras call does not need the pixels: it works from the description, sources and regions.
      // It is optional: if it fails, the profile still has its core findings.
      chatStructured({ ...common, images: [], schema: ProfileExtrasDraftSchema, name: 'profile_extras', system: COMPOSE_EXTRAS_SYSTEM(ctx.language) }).catch((e: unknown) => {
        if (ctx.signal?.aborted) throw e;
        log('warn', 'profile extras failed; continuing without them', { error: (e as Error).message });
        return null;
      }),
    ]);
    const extras = extrasResult?.value ?? EMPTY_EXTRAS;
    return this.tracked({ core: core.value, extras }, model, addUsage(core.usage, extrasResult?.usage ?? null), Math.max(core.ms, extrasResult?.ms ?? 0));
  }

  async resolve(input: ResolveInput, ctx: CallCtx): Promise<Tracked<ResolveOutput>> {
    const model = this.o.modelFor(ctx);
    const r = await chatStructured({
      client: this.o.client,
      model,
      schema: ResolveOutputSchema,
      name: 'resolve',
      system: RESOLVE_SYSTEM(ctx.language),
      user: resolveUser(input),
      mode: this.o.mode,
      instructionRole: this.o.instructionRole,
      reasoningEffort: this.effort('high'),
      signal: ctx.signal,
      timeoutMs: this.o.timeoutMs,
    });
    return this.tracked(r.value, model, r.usage, r.ms);
  }

  async ask(input: AskInput, ctx: CallCtx): Promise<Tracked<AskOutput>> {
    const model = this.o.modelFor(ctx);
    const r = await chatStructured({
      client: this.o.client,
      model,
      schema: AskOutputSchema,
      name: 'ask',
      system: ASK_SYSTEM(ctx.language),
      user: askUser(input),
      images: input.view && this.o.vision ? [input.view] : [],
      mode: this.o.mode,
      instructionRole: this.o.instructionRole,
      reasoningEffort: this.effort('low'),
      signal: ctx.signal,
      timeoutMs: this.o.timeoutMs,
    });
    return this.tracked(r.value, model, r.usage, r.ms);
  }


  async screenSources(input: ScreenSourcesInput, ctx: CallCtx): Promise<Tracked<ScreenSourcesOutput>> {
    const model = this.o.modelFor(ctx);
    const r = await chatStructured({
      client: this.o.client,
      model,
      schema: ScreenSourcesOutputSchema,
      name: 'screen_sources',
      system: SCREEN_SYSTEM,
      user: screenUser(input),
      mode: this.o.mode,
      instructionRole: this.o.instructionRole,
      reasoningEffort: this.effort('low'),
      signal: ctx.signal,
      timeoutMs: this.o.timeoutMs,
    });
    return this.tracked(r.value, model, r.usage, r.ms);
  }

  async translate(input: TranslateInput, ctx: CallCtx): Promise<Tracked<TranslateOutput>> {
    const model = this.o.modelFor(ctx);
    const r = await chatStructured({
      client: this.o.client,
      model,
      schema: TranslateOutputSchema,
      name: 'translate',
      system: TRANSLATE_SYSTEM(input.language),
      user: JSON.stringify({ strings: input.texts }),
      mode: this.o.mode,
      instructionRole: this.o.instructionRole,
      reasoningEffort: this.effort('low'),
      signal: ctx.signal,
      timeoutMs: this.o.timeoutMs,
    });
    return this.tracked(r.value, model, r.usage, r.ms);
  }

  async inside(input: InsideInput, ctx: CallCtx): Promise<Tracked<InsideDraft>> {
    const model = this.o.modelFor(ctx);
    const r = await chatStructured({
      client: this.o.client,
      model,
      schema: InsideDraftSchema,
      name: 'inside',
      system: INSIDE_SYSTEM(ctx.language),
      user: insideUser(input),
      mode: this.o.mode,
      instructionRole: this.o.instructionRole,
      reasoningEffort: this.effort('low'),
      signal: ctx.signal,
      timeoutMs: this.o.timeoutMs,
    });
    return this.tracked(r.value, model, r.usage, r.ms);
  }

  async glance(input: GlanceInput, ctx: CallCtx): Promise<Tracked<GlanceOutput>> {
    const model = this.o.modelFor(ctx);
    const r = await chatStructured({
      client: this.o.client,
      model,
      schema: GlanceOutputSchema,
      name: 'glance',
      system: GLANCE_SYSTEM(ctx.language),
      user: 'What is the main object in this camera frame?',
      images: this.images([input.view]),
      mode: this.o.mode,
      instructionRole: this.o.instructionRole,
      reasoningEffort: this.effort('low'),
      signal: ctx.signal,
      timeoutMs: 20_000,
    });
    return this.tracked(r.value, model, r.usage, r.ms);
  }

  async compare(input: CompareInput, ctx: CallCtx): Promise<Tracked<CompareOutput>> {
    const model = this.o.modelFor(ctx);
    const r = await chatStructured({
      client: this.o.client,
      model,
      schema: CompareOutputSchema,
      name: 'compare',
      system: COMPARE_SYSTEM(ctx.language),
      user: compareUser(input.a, input.b),
      mode: this.o.mode,
      instructionRole: this.o.instructionRole,
      reasoningEffort: this.effort('low'),
      signal: ctx.signal,
      timeoutMs: this.o.timeoutMs,
    });
    return this.tracked(r.value, model, r.usage, r.ms);
  }

  async segment(_input: SegmentInput, _ctx: CallCtx): Promise<Tracked<SegmentOutput>> {
    return this.unsupported('Outlining (SAM 3.1)');
  }
  async illustrate(_input: IllustrateInput, _ctx: CallCtx): Promise<Tracked<IllustrateOutput>> {
    return this.unsupported('Illustration (Muse Image)');
  }
  async transcribe(_input: TranscribeInput, _ctx: CallCtx): Promise<Tracked<TranscribeOutput>> {
    return this.unsupported('Voice transcription (Muse Voice Transcribe)');
  }
}
