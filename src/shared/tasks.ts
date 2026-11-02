/**
 * Provider-neutral model tasks.
 *
 * The orchestrator and every product feature call these interfaces, never a
 * provider endpoint. The server implements them with Meta Model API and
 * open-weight endpoints; the browser preview implements them with hand-authored
 * samples. Swapping a model or provider changes one adapter, not the product.
 */
import type { Category } from './epistemics';
import type {
  AskOutput,
  CompareOutput,
  DecideOutput,
  GlanceOutput,
  IdentifyOutput,
  InsideDraft,
  ProfileCoreDraft,
  ProfileExtrasDraft,
  ResolveOutput,
  ScreenSourcesOutput,
  TranslateOutput,
} from './model-io';
import type { Box, Point, ProfileDigest, Region, Route, Source, Usage } from './schema';

export type PrivacyTier = 'private' | 'contributor';

export interface CallCtx {
  signal?: AbortSignal;
  language: string;
  /**
   * `private` uses model ids that Meta states are not used to improve its products.
   * `contributor` uses the cheaper ids that are. Default is always `private`.
   */
  privacyTier: PrivacyTier;
  route: Route;
  runId: string;
}

export interface Tracked<T> {
  value: T;
  usage: Usage | null;
  model: string;
  provider: string;
  ms: number;
  promptVersion: string;
}

export interface ImagePayload {
  mime: string;
  /** Base64 bytes with no `data:` prefix. */
  base64: string;
  width: number;
  height: number;
  label: string | null;
}

export interface QualityMetrics {
  sharpness: number | null;
  brightness: number | null;
  clipped: number | null;
}

export interface IdentifyInput {
  views: ImagePayload[];
  hint: string | null;
  prior: ProfileDigest | null;
  depth: 'quick' | 'deep';
  clientQuality: QualityMetrics | null;
}

export interface SegmentInput {
  view: ImagePayload;
  viewIndex: number;
  /** Short noun phrases. One request per phrase. */
  concepts?: string[];
  /** The full names to label each concept with, in the same order (defaults to the concepts). */
  labels?: string[];
  /** What the object is, for context when locating its parts. */
  object?: string | null;
  /** Correct names for parts of this kind of thing (from the body-plan reference). */
  vocabulary?: string[];
  /** Names this person taught for this kind of object (hints, and preferred words). */
  taught?: Array<{ from: string; to: string }>;
  /** 'quick': each part is named once; 'deep' (default): twice, independently, up close too. */
  depth?: 'quick' | 'deep';
  /** Click or tap prompts in image pixels. */
  points?: Array<Point & { label?: 'positive' | 'negative' }>;
  box?: Box;
}
export interface SegmentOutput {
  regions: Region[];
  diagnostics: string[];
}

export interface ComposeInput {
  /** Null when the person has chosen not to send the image again for writing. */
  views: ImagePayload[] | null;
  identify: IdentifyOutput;
  regions: Region[];
  sources: Source[];
  hint: string | null;
  prior: ProfileDigest | null;
}
export interface ComposeOutput {
  core: ProfileCoreDraft;
  extras: ProfileExtrasDraft;
}

export interface ResolveInput {
  candidates: Array<{ name: string; likelihood: number; evidenceFor: string[]; evidenceAgainst: string[]; missing: string[] }>;
  observations: string;
  textRead: string[];
  sources: Array<{ id: string; title: string; snippet: string }>;
}

export interface AskInput {
  digest: ProfileDigest;
  question: string;
  history: Array<{ role: 'user' | 'assistant'; text: string }>;
  regionId: string | null;
  /** The image (and, if a region is selected, its crop) when the question is visual. */
  view: ImagePayload | null;
  /** Sources retrieved for this question, in addition to the profile's own. */
  sources: Source[];
}

export interface CompareInput {
  a: ProfileDigest;
  b: ProfileDigest;
}

export interface IllustrateInput {
  digest: ProfileDigest;
  /** The person's photo: the drawing then keeps its exact pose and framing. */
  photo?: ImagePayload | null;
  /** From the inside view, when it exists: what kind of cross-section to draw and which parts to show. */
  inside?: { kind: string; brief: string; parts: string[] } | null;
  /** Always a cutaway. */
  style?: 'cutaway';
  /** Extra images to send after the photo (for example a draft to correct). */
  references?: ImagePayload[];
  /** An instruction placed before the prompt (for example what to fix in a draft). */
  instruction?: string | null;
  /** Use this prompt instead of the generated one (for edits of an earlier drawing). */
  prompt?: string | null;
  /** Output size "WxH" (aspect only); defaults to the photo's aspect. */
  size?: string;
}

export interface DecideInput {
  candidates: Array<{ name: string; likelihood: number; evidenceFor: string[]; evidenceAgainst: string[] }>;
  observations: string;
  textRead: string[];
  view: ImagePayload;
}
/** A web-researched check of the features that tell close candidates apart, against the photo. */
export interface DecideResult {
  decision: DecideOutput;
  /** The pages the research cites (no ids yet). */
  sources: Array<Omit<Source, 'id'>>;
}

/** The named parts a kind of object has, looked up in reference sources. */
export interface PartsResearch {
  names: string[];
  sources: Array<Omit<Source, 'id'>>;
}

export interface ScreenSourcesInput {
  object: string;
  candidates: string[];
  textRead: string[];
  sources: Array<{ id: string; title: string; snippet: string }>;
}

export interface TranslateInput {
  texts: string[];
  /** BCP-47 code of the target language. */
  language: string;
}

export interface InsideInput {
  digest: ProfileDigest;
  regions: Array<{ id: string; label: string }>;
  sources: Source[];
}

export interface GlanceInput {
  /** A small frame from the live camera. */
  view: ImagePayload;
}
export interface IllustrateOutput {
  mime: string;
  base64: string;
  /** The prompt used, kept so the label can say exactly what was asked for. */
  prompt: string;
}

export interface TranscribeInput {
  /** Mono 16-bit PCM WAV at 16 or 24 kHz. */
  wav: Uint8Array;
  /** Biases recognition toward these names and terms. */
  keywords: string[];
  languageBias: string[];
}
export interface TranscribeOutput {
  transcript: string;
  durationMs: number | null;
  sessionId: string | null;
}

export interface ModelTasks {
  readonly id: string;
  identify(input: IdentifyInput, ctx: CallCtx): Promise<Tracked<IdentifyOutput>>;
  segment(input: SegmentInput, ctx: CallCtx): Promise<Tracked<SegmentOutput>>;
  compose(input: ComposeInput, ctx: CallCtx): Promise<Tracked<ComposeOutput>>;
  resolve(input: ResolveInput, ctx: CallCtx): Promise<Tracked<ResolveOutput>>;
  /** Optional: settle close candidates with web research on what tells them apart. */
  decide?(input: DecideInput, ctx: CallCtx): Promise<Tracked<DecideResult>>;
  /** Optional: the named parts this kind of object has, from the web, so outlines use real names. */
  researchParts?(input: { object: string; category: string }, ctx: CallCtx): Promise<Tracked<PartsResearch>>;
  ask(input: AskInput, ctx: CallCtx): Promise<Tracked<AskOutput>>;
  compare(input: CompareInput, ctx: CallCtx): Promise<Tracked<CompareOutput>>;
  illustrate(input: IllustrateInput, ctx: CallCtx): Promise<Tracked<IllustrateOutput>>;
  /** What each part does and how it works, for the inside view. */
  inside(input: InsideInput, ctx: CallCtx): Promise<Tracked<InsideDraft>>;
  /** A fast first look at a live camera frame: just what it is. */
  glance(input: GlanceInput, ctx: CallCtx): Promise<Tracked<GlanceOutput>>;
  /** The order the parts go together in, for the workshop. */
  /** Which retrieved sources are really about the object. */
  screenSources(input: ScreenSourcesInput, ctx: CallCtx): Promise<Tracked<ScreenSourcesOutput>>;
  /** Interface text in another language. */
  translate(input: TranslateInput, ctx: CallCtx): Promise<Tracked<TranslateOutput>>;
  transcribe(input: TranscribeInput, ctx: CallCtx): Promise<Tracked<TranscribeOutput>>;
  /** Identify again on a different route, for the second-opinion comparison. */
  secondOpinion(input: IdentifyInput, ctx: CallCtx): Promise<Tracked<IdentifyOutput>>;
}

export interface RetrieveQuery {
  query: string;
  intent: 'identify' | 'specs' | 'history' | 'safety' | 'repair' | 'material' | 'live';
}
export interface RetrieveResult {
  sources: Source[];
  /** Plain-language notes: which sources failed or were skipped. Never hidden from the person. */
  notes: string[];
}
export interface Retriever {
  retrieve(queries: RetrieveQuery[], ctx: CallCtx & { category: Category; textRead: string[] }): Promise<RetrieveResult>;
}

/** What one model is known to do. Built from documentation, then confirmed by probing. */
export interface ModelCapability {
  role: 'identify' | 'segment' | 'compose' | 'resolve' | 'illustrate' | 'transcribe' | 'second-opinion' | 'local-triage' | 'search';
  model: string;
  provider: string;
  hosting: 'meta-model-api' | 'open-weight';
  available: boolean;
  verified: 'documented' | 'probed' | 'unverified' | 'failed';
  inputs: string[];
  outputs: string[];
  dataUse: 'not-used-to-improve' | 'used-to-improve' | 'self-hosted' | 'unknown';
  notes: string | null;
}
