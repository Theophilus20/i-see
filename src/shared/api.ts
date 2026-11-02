/**
 * Wire contract between the browser and the gateway.
 * The server validates every request with these schemas and the client validates
 * every response, so neither side trusts the other's shape.
 */
import { z } from 'zod';
import type { ModelCapability } from './tasks';
import {
  BoxSchema,
  PointSchema,
  ProfileDigestSchema,
  ProfileSchema,
  QualityReportSchema,
  RegionSchema,
  RouteSchema,
  SourceSchema,
  StageIdSchema,
  CandidateSchema,
  InsideSchema,
} from './schema';
import { AskOutputSchema, CompareOutputSchema } from './model-io';

export const API_PREFIX = '/api/v1';

export const ImageUploadSchema = z.object({
  mime: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  /** Base64 bytes, no data: prefix. Re-encoded in the browser, so EXIF (including GPS) is already gone. */
  base64: z.string().min(16),
  width: z.number().int().min(16).max(8192),
  height: z.number().int().min(16).max(8192),
  label: z.string().max(80).nullable(),
});
export type ImageUpload = z.infer<typeof ImageUploadSchema>;

export const ConsentSchema = z.object({
  /** The person agreed to send these images to the chosen route. */
  sendImages: z.literal(true),
  acknowledgedAt: z.string().max(40),
});

export const TaughtSchema = z.object({
  /** The kind of object ("car", "cow", "kettle"): see kindKey. */
  kind: z.string().max(40),
  from: z.string().max(80),
  to: z.string().min(1).max(80),
});
export type Taught = z.infer<typeof TaughtSchema>;

export const ScanRequestSchema = z.object({
  views: z.array(ImageUploadSchema).min(1).max(6),
  hint: z.string().max(300).nullable(),
  route: RouteSchema,
  depth: z.enum(['quick', 'deep']),
  language: z.string().min(2).max(35).default('en'),
  privacyTier: z.enum(['private', 'contributor']).default('private'),
  prior: ProfileDigestSchema.nullable().default(null),
  clientQuality: z
    .object({ sharpness: z.number().nullable(), brightness: z.number().nullable(), clipped: z.number().nullable() })
    .nullable()
    .default(null),
  consent: ConsentSchema,
  /**
   * Names this person has taught for kinds of objects (from the Train game, kept on their
   * device): a mix-up corrected before ("Tail light" was really the "Wing mirror"), or the word
   * they prefer for a part ("Hood" → "Bonnet"). Used as hints when naming the parts.
   */
  taught: z.array(TaughtSchema).max(60).default([]),
});
export type ScanRequest = z.infer<typeof ScanRequestSchema>;

export const EscalationRequestSchema = z.object({
  id: z.string(),
  reason: z.string().max(300),
  model: z.string().max(80),
  /** Exactly what would leave the device if approved. */
  preview: z.object({ text: z.string().max(2000), imageCount: z.number().int(), bytes: z.number().int() }),
});
export type EscalationRequest = z.infer<typeof EscalationRequestSchema>;

export const ScanEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('stage'),
    id: StageIdSchema,
    label: z.string(),
    status: z.enum(['start', 'done', 'skip', 'error']),
    model: z.string().nullable(),
    provider: z.string().nullable(),
    ms: z.number().nullable(),
    note: z.string().nullable(),
  }),
  z.object({ type: z.literal('quality'), report: QualityReportSchema }),
  z.object({
    type: z.literal('candidates'),
    candidates: z.array(CandidateSchema),
    status: z.enum(['identified', 'candidates', 'unknown']),
  }),
  z.object({ type: z.literal('regions'), regions: z.array(RegionSchema) }),
  z.object({ type: z.literal('sources'), sources: z.array(SourceSchema) }),
  z.object({ type: z.literal('escalation'), request: EscalationRequestSchema }),
  z.object({ type: z.literal('profile'), profile: ProfileSchema }),
  z.object({
    type: z.literal('error'),
    code: z.string(),
    message: z.string(),
    retryable: z.boolean(),
    stage: StageIdSchema.nullable(),
  }),
  z.object({ type: z.literal('done') }),
]);
export type ScanEvent = z.infer<typeof ScanEventSchema>;

/**
 * A second look at a correction someone made in the Train game: the outlined part, and two names
 * for it (what I SEE said, and what the person said, or "not a part"). The names are shown in a
 * random order, and the model is not told which is whose.
 */
export const VerifyRequestSchema = z.object({
  view: ImageUploadSchema,
  region: z.object({ path: z.string().max(200_000).nullable(), box: BoxSchema }),
  object: z.string().max(160).nullable().default(null),
  options: z.tuple([z.string().min(1).max(80), z.string().min(1).max(80)]),
  language: z.string().max(35).default('en'),
  privacyTier: z.enum(['private', 'contributor']).default('private'),
});
export type VerifyRequest = z.infer<typeof VerifyRequestSchema>;
export const VerifyResponseSchema = z.object({
  /** Which of the two options fits (0 or 1), or null for neither. */
  pick: z.number().int().min(0).max(1).nullable(),
  sure: z.boolean(),
  reason: z.string(),
  model: z.string(),
});
export type VerifyResponse = z.infer<typeof VerifyResponseSchema>;

export const SegmentRequestSchema = z.object({
  view: ImageUploadSchema,
  viewIndex: z.number().int().min(0).max(5).default(0),
  concept: z.string().min(1).max(80).nullable(),
  points: z
    .array(PointSchema.extend({ label: z.enum(['positive', 'negative']).optional() }))
    .max(8)
    .default([]),
  box: BoxSchema.nullable().default(null),
  /** What the object is, so a tapped outline can be named. */
  object: z.string().max(160).nullable().default(null),
  language: z.string().max(35).default('en'),
});
export type SegmentRequest = z.infer<typeof SegmentRequestSchema>;

export const AskRequestSchema = z.object({
  digest: ProfileDigestSchema,
  question: z.string().min(1).max(600),
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(1500) }))
    .max(12)
    .default([]),
  regionId: z.string().nullable().default(null),
  /** Include the image only when the question is about what is visible. */
  view: ImageUploadSchema.nullable().default(null),
  route: RouteSchema.default('hosted'),
  language: z.string().max(35).default('en'),
  privacyTier: z.enum(['private', 'contributor']).default('private'),
  consent: ConsentSchema,
});
export type AskRequest = z.infer<typeof AskRequestSchema>;

export const AskResponseSchema = z.object({
  output: AskOutputSchema,
  sources: z.array(SourceSchema),
  model: z.string(),
  provider: z.string(),
});
export type AskResponse = z.infer<typeof AskResponseSchema>;

export const CompareRequestSchema = z.object({
  a: ProfileDigestSchema,
  b: ProfileDigestSchema,
  route: RouteSchema.default('hosted'),
  language: z.string().max(35).default('en'),
  privacyTier: z.enum(['private', 'contributor']).default('private'),
});
export const CompareResponseSchema = z.object({ output: CompareOutputSchema, model: z.string(), provider: z.string() });

export const IllustrateRequestSchema = z.object({
  digest: ProfileDigestSchema,
  privacyTier: z.enum(['private', 'contributor']).default('private'),
  inside: z
    .object({ kind: z.string().max(20), brief: z.string().max(600), parts: z.array(z.string().max(100)).max(16) })
    .nullable()
    .default(null),
});

export const InsideRequestSchema = z.object({
  digest: ProfileDigestSchema,
  regions: z.array(RegionSchema).max(60),
  sources: z.array(SourceSchema).max(60),
  hazards: z.array(z.string().max(20)).max(12).default([]),
  route: RouteSchema.default('hosted'),
  language: z.string().max(35).default('en'),
  privacyTier: z.enum(['private', 'contributor']).default('private'),
});
export const InsideResponseSchema = z.object({ inside: InsideSchema, sources: z.array(SourceSchema).default([]) });

export const GlanceRequestSchema = z.object({
  view: ImageUploadSchema,
  language: z.string().max(35).default('en'),
  privacyTier: z.enum(['private', 'contributor']).default('private'),
  consent: ConsentSchema,
});
export const CutawayRequestSchema = z.object({
  digest: ProfileDigestSchema,
  inside: z
    .object({ kind: z.string().max(20), brief: z.string().max(600), parts: z.array(z.string().max(100)).max(16) })
    .nullable()
    .default(null),
  /** The person's photo, so the drawing matches their object (needs consent). */
  view: ImageUploadSchema.nullable().default(null),
  consent: ConsentSchema.nullable().default(null),
  privacyTier: z.enum(['private', 'contributor']).default('private'),
  language: z.string().max(35).default('en'),
});
const ImageOutSchema = z.object({ mime: z.string(), base64: z.string(), width: z.number(), height: z.number() });
export const CutawayResponseSchema = z.object({
  /** The labelled drawing (or the clean one if labels could not be added). */
  image: ImageOutSchema,
  /** The same drawing without labels, sized like the photo. */
  clean: ImageOutSchema.nullable(),
  regions: z.array(RegionSchema),
  review: z.object({ matchesPhoto: z.number(), accuracy: z.number(), problems: z.array(z.string()), redrawn: z.boolean() }).nullable(),
  labels: z.object({ expected: z.array(z.string()), correct: z.array(z.string()), problems: z.array(z.string()), fixed: z.boolean() }).nullable(),
  diagnostics: z.array(z.string()),
});
export type CutawayResponse = z.infer<typeof CutawayResponseSchema>;

export const TranslateRequestSchema = z.object({
  texts: z.array(z.string().max(400)).min(1).max(80),
  language: z.string().min(2).max(35),
});
export const TranslateResponseSchema = z.object({ translations: z.array(z.string()) });

export const GlanceResponseSchema = z.object({ label: z.string().nullable(), confidence: z.number(), hint: z.string().nullable() });
export const IllustrateResponseSchema = z.object({
  mime: z.string(),
  base64: z.string(),
  prompt: z.string(),
  model: z.string(),
});

export const TranscribeResponseSchema = z.object({
  transcript: z.string(),
  durationMs: z.number().nullable(),
  model: z.string(),
});

export interface HealthInfo {
  ok: boolean;
  version: string;
  /** `live` once a Meta Model API key is configured; `unconfigured` otherwise. */
  mode: 'live' | 'unconfigured';
  routes: Record<'hosted' | 'private' | 'consensus' | 'local-first', boolean>;
  features: { segment: boolean; voice: boolean; illustrate: boolean; searchGrounding: boolean; resolve: boolean };
  limits: { maxImageBytes: number; maxViews: number; maxAudioSeconds: number; ratePerMinute: number };
  privacyTier: 'private' | 'contributor';
  capabilities: ModelCapability[];
  /** Which retrieval connectors are enabled. */
  connectors: string[];
  serverStoresImages: false;
  /** What the Meta Model API said, at start-up, about the models this key can use. */
  modelCheck?: ModelCheck;
}

export interface ModelCheck {
  state: 'not-run' | 'checking' | 'done' | 'failed';
  /** The model names in use now, by role. */
  using: Record<string, string>;
  /** The models the key can use, as the service listed them. */
  listed: string[];
  switched: Array<{ role: string; from: string; to: string }>;
  unlisted: Array<{ role: string; name: string }>;
  status: number | null;
  error: string | null;
  at: string | null;
}

export interface ApiErrorBody {
  error: { code: string; message: string; retryable: boolean; requestId: string };
}
