/**
 * Domain model for I SEE.
 *
 * These types are the contract between the model gateway, the epistemic firewall,
 * the browser UI, local storage and exports. Anything that crosses a boundary is
 * validated against one of these schemas.
 */
import { z } from 'zod';
import { BASES, CATEGORIES, HAZARDS, SECTION_KEYS } from './epistemics';

export const SCHEMA_VERSION = 1 as const;

const id = z.string().min(1).max(64);
const text = (max: number) => z.string().max(max);

/** Only http(s) links are ever rendered as links. Blocks javascript: and data: URLs. */
export const safeUrl = z
  .string()
  .max(2048)
  .refine((u) => u === '' || /^https?:\/\/[^\s]+$/i.test(u), 'Only http(s) URLs are allowed');

// ---------------------------------------------------------------------------
// Pixels
// ---------------------------------------------------------------------------

export const PointSchema = z.object({ x: z.number(), y: z.number() });
export type Point = z.infer<typeof PointSchema>;

/** Axis-aligned box in image pixels: left, top, width, height. */
export const BoxSchema = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });
export type Box = z.infer<typeof BoxSchema>;

export const ViewSchema = z.object({
  index: z.number().int().min(0),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  mime: z.string().max(40),
  label: text(80).nullable(),
  bytes: z.number().int().nonnegative().nullable(),
});
export type View = z.infer<typeof ViewSchema>;

export const RegionSourceSchema = z.enum(['sam', 'model-estimate', 'user', 'sample']);

/**
 * A place in an image that evidence can point to.
 * - `mask`  a segmentation mask (SAM 3.1), stored as an SVG path in image pixels
 * - `box`   a bounding box only
 * - `point` an approximate location the vision model estimated; shown as approximate
 */
export const RegionSchema = z.object({
  id,
  label: text(120),
  kind: z.enum(['mask', 'box', 'point']),
  source: RegionSourceSchema,
  view: z.number().int().min(0),
  box: BoxSchema,
  path: z.string().max(200_000).nullable(),
  anchor: PointSchema,
  area: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1).nullable(),
  /** The outline of the whole object, not one of its parts. */
  whole: z.boolean().optional(),
});
export type Region = z.infer<typeof RegionSchema>;

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

export const SOURCE_CATEGORIES = [
  'manufacturer',
  'government',
  'standards',
  'academic',
  'museum',
  'specialist',
  'community',
  'search',
  'unknown',
] as const;

export const SourceSchema = z.object({
  id,
  connector: text(40),
  kind: z.enum(['connector', 'search', 'user', 'sample']),
  url: safeUrl,
  title: text(300),
  publisher: text(160),
  tier: z.number().int().min(1).max(5),
  category: z.enum(SOURCE_CATEGORIES),
  publishedAt: text(40).nullable(),
  retrievedAt: text(40),
  /** The text that was actually retrieved. Quotes are verified against this, nothing else. */
  snippet: text(4000),
  contentHash: text(80),
  license: text(120).nullable(),
  note: text(300).nullable(),
});
export type Source = z.infer<typeof SourceSchema>;

// ---------------------------------------------------------------------------
// Findings (the claim ledger)
// ---------------------------------------------------------------------------

export const VERIFICATION_STATUS = [
  'unverified',
  'verified',
  'tool_cited',
  'pinned',
  'unpinned',
  'downgraded',
  'guarded',
  'not_applicable',
] as const;

export const VerificationSchema = z.object({
  status: z.enum(VERIFICATION_STATUS),
  notes: z.array(text(300)).max(8),
});
export type Verification = z.infer<typeof VerificationSchema>;

export const FindingSchema = z.object({
  id,
  section: z.enum(SECTION_KEYS),
  text: z.string().min(1).max(700),
  basis: z.enum(BASES),
  confidence: z.number().min(0).max(1).nullable(),
  regionIds: z.array(id).max(8),
  sourceIds: z.array(id).max(8),
  quote: text(500).nullable(),
  verification: VerificationSchema,
  recheckAfter: text(40).nullable(),
  flags: z.array(text(40)).max(8),
  origin: z.enum(['model', 'user', 'system']),
  disputed: z.boolean(),
  note: text(600).nullable(),
});
export type Finding = z.infer<typeof FindingSchema>;

// ---------------------------------------------------------------------------
// Structure of the profile
// ---------------------------------------------------------------------------

export const ComponentSchema = z.object({
  id,
  name: text(100),
  role: text(300),
  regionId: id.nullable(),
  material: text(100).nullable(),
  parentId: id.nullable(),
  visible: z.boolean(),
  findingIds: z.array(id).max(12),
});
export type Component = z.infer<typeof ComponentSchema>;

export const TimelineEventSchema = z.object({
  id,
  /** maker = the brand or company; kind = this kind of object; item = this particular one. */
  strand: z.enum(['maker', 'kind', 'item']).default('kind'),
  label: text(160),
  detail: text(400).nullable(),
  from: z.number().int().min(-5000).max(3000),
  to: z.number().int().min(-5000).max(3000).nullable(),
  approx: z.boolean(),
  findingId: id,
});
export type TimelineEvent = z.infer<typeof TimelineEventSchema>;

export const SafetyNoteSchema = z.object({
  id,
  hazard: z.enum(HAZARDS),
  severity: z.enum(['info', 'caution', 'warning', 'danger']),
  text: text(500),
  advice: text(500).nullable(),
  professionalReview: z.boolean(),
  findingId: id,
});
export type SafetyNote = z.infer<typeof SafetyNoteSchema>;

export const LiveDatumSchema = z.object({
  id,
  label: text(120),
  value: text(200),
  scope: text(160),
  sourceId: id,
  retrievedAt: text(40),
  freshness: z.enum(['live', 'recent', 'stale']),
  kind: z.enum(['confirmed', 'estimate']),
  limitations: text(300),
  findingId: id.nullable(),
});
export type LiveDatum = z.infer<typeof LiveDatumSchema>;

export const RelatedSchema = z.object({
  id,
  name: text(140),
  relation: text(200),
  findingId: id.nullable(),
});
export type Related = z.infer<typeof RelatedSchema>;

export const TextReadSchema = z.object({
  text: text(200),
  view: z.number().int().min(0),
  regionId: id.nullable(),
  location: text(120).nullable(),
});
export type TextRead = z.infer<typeof TextReadSchema>;

export const ConflictSchema = z.object({
  id,
  findingIds: z.array(id).min(1).max(6),
  description: text(400),
});
export type Conflict = z.infer<typeof ConflictSchema>;

// ---------------------------------------------------------------------------
// Identity: the hypothesis tournament
// ---------------------------------------------------------------------------

export const CandidateSchema = z.object({
  id,
  name: text(160),
  category: z.enum(CATEGORIES),
  likelihood: z.number().min(0).max(1),
  evidenceFor: z.array(text(240)).max(6),
  evidenceAgainst: z.array(text(240)).max(6),
  missing: z.array(text(240)).max(6),
  eliminated: z.boolean(),
  eliminatedBy: text(240).nullable(),
});
export type Candidate = z.infer<typeof CandidateSchema>;

export const CAPTURE_KINDS = ['label', 'angle', 'detail', 'measurement', 'action', 'context'] as const;

export const NextShotSchema = z.object({
  instruction: text(300),
  why: text(400),
  separates: z.array(id).max(5),
  capture: z.enum(CAPTURE_KINDS),
  target: text(120).nullable(),
  expectedGain: z.number().min(0).max(1).nullable(),
});
export type NextShot = z.infer<typeof NextShotSchema>;

export const SecondOpinionSchema = z.object({
  model: text(80),
  provider: text(60),
  agreement: z.enum(['agrees', 'partly', 'differs']),
  topCandidate: text(160),
  notes: z.array(text(300)).max(6),
  disagreements: z
    .array(z.object({ topic: text(120), mine: text(240), theirs: text(240) }))
    .max(6),
  ranAt: text(40),
});
export type SecondOpinion = z.infer<typeof SecondOpinionSchema>;

export const QualityReportSchema = z.object({
  adequate: z.boolean(),
  issues: z
    .array(
      z.object({
        kind: z.enum(['blur', 'glare', 'dark', 'small', 'occluded', 'cluttered', 'other']),
        note: text(240),
      }),
    )
    .max(8),
  advice: z.array(text(240)).max(6),
  metrics: z
    .object({
      sharpness: z.number().nullable(),
      brightness: z.number().nullable(),
      clipped: z.number().nullable(),
    })
    .nullable(),
});
export type QualityReport = z.infer<typeof QualityReportSchema>;

// ---------------------------------------------------------------------------
// What-if lab
// ---------------------------------------------------------------------------

export const identifier = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,23}$/, 'Use letters, digits and underscores');

export const WhatIfAssumptionSchema = z.object({
  key: identifier,
  label: text(100),
  value: z.number().finite(),
  unit: text(24),
  min: z.number().finite(),
  max: z.number().finite(),
  step: z.number().finite().positive(),
  origin: z.enum(['assumed', 'measured', 'sourced']),
  note: text(240).nullable(),
});
export type WhatIfAssumption = z.infer<typeof WhatIfAssumptionSchema>;

export const WhatIfStepSchema = z.object({
  key: identifier,
  label: text(120),
  /** Arithmetic over assumption and earlier step keys (plain numbers in their declared units). Parsed and evaluated by calc.ts, which also checks the dimensions against `unit`. */
  expr: z.string().min(1).max(240),
  unit: text(24),
});
export type WhatIfStep = z.infer<typeof WhatIfStepSchema>;

export const WHATIF_KINDS = ['principle', 'calculation', 'simulation', 'hypothesis', 'unknown'] as const;
export const WHATIF_KIND_LABEL: Record<(typeof WHATIF_KINDS)[number], string> = {
  principle: 'Established principle',
  calculation: 'Calculation with stated assumptions',
  simulation: 'Simulation output',
  hypothesis: 'Qualitative hypothesis',
  unknown: 'Not enough data',
};

export const WhatIfSchema = z.object({
  id,
  title: text(140),
  question: text(240),
  kind: z.enum(WHATIF_KINDS),
  summary: text(700),
  assumptions: z.array(WhatIfAssumptionSchema).max(8),
  steps: z.array(WhatIfStepSchema).max(10),
  /** Key of the step shown as the headline number. Null when the answer is not numeric. */
  resultKey: identifier.nullable(),
  /** Assumption key to sweep for the sensitivity curve. */
  sweepKey: identifier.nullable(),
  caveats: z.array(text(300)).max(6),
  safety: text(300).nullable(),
  sourceIds: z.array(id).max(6),
});
export type WhatIf = z.infer<typeof WhatIfSchema>;

// ---------------------------------------------------------------------------
// Trace: how this profile was produced
// ---------------------------------------------------------------------------

export const ROUTES = ['hosted', 'private', 'consensus', 'local-first'] as const;
export const RouteSchema = z.enum(ROUTES);
export type Route = z.infer<typeof RouteSchema>;

export const UsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  reasoningTokens: z.number().int().nonnegative(),
  cachedTokens: z.number().int().nonnegative(),
  images: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative().nullable(),
});
export type Usage = z.infer<typeof UsageSchema>;

export const STAGE_IDS = ['intake', 'quality', 'identify', 'segment', 'retrieve', 'compose', 'reconcile', 'resolve'] as const;
export const StageIdSchema = z.enum(STAGE_IDS);
export type StageId = z.infer<typeof StageIdSchema>;

export const TraceStageSchema = z.object({
  id: StageIdSchema,
  label: text(80),
  model: text(80).nullable(),
  provider: text(60).nullable(),
  status: z.enum(['done', 'skipped', 'error']),
  ms: z.number().nonnegative().nullable(),
  note: text(300).nullable(),
  usage: UsageSchema.nullable(),
});
export type TraceStage = z.infer<typeof TraceStageSchema>;

export const FirewallReportSchema = z.object({
  checked: z.number().int().nonnegative(),
  downgraded: z.number().int().nonnegative(),
  dropped: z.number().int().nonnegative(),
  guarded: z.number().int().nonnegative(),
  citationsClaimed: z.number().int().nonnegative(),
  citationsVerified: z.number().int().nonnegative(),
  notes: z.array(text(300)).max(40),
});
export type FirewallReport = z.infer<typeof FirewallReportSchema>;

export const TraceSchema = z.object({
  runId: id,
  /** `sample` = hand-authored walkthrough, no model called. `recorded` = a real live run, saved and replayed. */
  mode: z.enum(['live', 'sample', 'recorded']),
  route: RouteSchema,
  startedAt: text(40),
  finishedAt: text(40),
  stages: z.array(TraceStageSchema).max(20),
  models: z
    .array(
      z.object({
        role: text(60),
        model: text(80),
        provider: text(60),
        promptVersion: text(40),
      }),
    )
    .max(20),
  firewall: FirewallReportSchema,
  costUsd: z.number().nonnegative().nullable(),
  language: text(35),
});
export type Trace = z.infer<typeof TraceSchema>;

// ---------------------------------------------------------------------------
// Inside view
// ---------------------------------------------------------------------------

export const InsidePartSchema = z.object({
  id,
  name: text(100),
  what: text(240),
  how: text(500),
  regionId: id.nullable(),
  visible: z.boolean(),
  findingId: id,
});
export const InsideFlowSchema = z.object({
  id,
  title: text(140),
  summary: text(400),
  steps: z.array(z.object({ label: text(60), detail: text(240) })).min(2).max(10),
  findingId: id,
});
export const InsideSchema = z.object({
  kind: z.enum(['living', 'machine', 'natural', 'structure', 'other']),
  intro: text(600),
  groups: z.array(z.object({ id, name: text(100), role: text(300), parts: z.array(InsidePartSchema).max(8) })).max(8),
  flows: z.array(InsideFlowSchema).max(3),
  /** The findings behind every part and flow, graded by the firewall like the rest of the profile. */
  findings: z.array(FindingSchema).max(80),
  brief: text(600),
  createdAt: text(40),
});
export type Inside = z.infer<typeof InsideSchema>;

// ---------------------------------------------------------------------------
// The profile
// ---------------------------------------------------------------------------

export const ProfileSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id,
  scanId: id,
  createdAt: text(40),
  updatedAt: text(40),
  views: z.array(ViewSchema).min(1).max(6),
  displayName: text(160),
  category: z.enum(CATEGORIES),
  subcategory: text(120).nullable(),
  summary: text(700),
  identity: z.object({
    status: z.enum(['identified', 'candidates', 'unknown']),
    topCandidateId: id.nullable(),
  }),
  candidates: z.array(CandidateSchema).max(8),
  nextShot: NextShotSchema.nullable(),
  secondOpinion: SecondOpinionSchema.nullable(),
  quality: QualityReportSchema,
  regions: z.array(RegionSchema).max(60),
  findings: z.array(FindingSchema).max(120),
  components: z.array(ComponentSchema).max(40),
  timeline: z.array(TimelineEventSchema).max(30),
  safety: z.array(SafetyNoteSchema).max(20),
  live: z.array(LiveDatumSchema).max(20),
  whatIf: z.array(WhatIfSchema).max(6),
  related: z.array(RelatedSchema).max(16),
  textRead: z.array(TextReadSchema).max(24),
  conflicts: z.array(ConflictSchema).max(10),
  openQuestions: z.array(text(300)).max(10),
  sources: z.array(SourceSchema).max(60),
  trace: TraceSchema,
  /** Filled in on request (the Parts tab), not during the scan. */
  inside: InsideSchema.nullable().default(null),
});
export type Profile = z.infer<typeof ProfileSchema>;

/**
 * A compact projection of a profile for follow-up calls (ask, compare, resolve).
 * No paths, no traces: small enough to send, and nothing the model does not need.
 */
export const ProfileDigestSchema = z.object({
  id,
  displayName: text(160),
  category: z.enum(CATEGORIES),
  /** The kind of thing ("compact SUV"), when the display name is a model or brand. */
  subcategory: text(120).nullable().optional(),
  summary: text(700),
  candidates: z.array(z.object({ id, name: text(160), likelihood: z.number() })).max(8),
  findings: z
    .array(z.object({ id, section: z.enum(SECTION_KEYS), text: text(700), basis: z.enum(BASES) }))
    .max(120),
  components: z.array(z.object({ name: text(100), role: text(300) })).max(40),
  regions: z.array(z.object({ id, label: text(120) })).max(60),
  sources: z
    .array(z.object({ id, title: text(300), url: safeUrl, snippet: text(600), tier: z.number().int().min(1).max(5) }))
    .max(60),
  openQuestions: z.array(text(300)).max(10),
});
export type ProfileDigest = z.infer<typeof ProfileDigestSchema>;

export function digestOf(p: Profile): ProfileDigest {
  return {
    id: p.id,
    displayName: p.displayName,
    category: p.category,
    subcategory: p.subcategory ?? null,
    summary: p.summary,
    candidates: p.candidates.filter((c) => !c.eliminated).map((c) => ({ id: c.id, name: c.name, likelihood: c.likelihood })),
    findings: p.findings.map((f) => ({ id: f.id, section: f.section, text: f.text, basis: f.basis })),
    components: p.components.map((c) => ({ name: c.name, role: c.role })),
    regions: p.regions.map((r) => ({ id: r.id, label: r.label })),
    sources: p.sources.map((s) => ({ id: s.id, title: s.title, url: s.url, snippet: s.snippet.slice(0, 600), tier: s.tier })),
    openQuestions: p.openQuestions,
  };
}
