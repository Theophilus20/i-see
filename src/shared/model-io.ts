/**
 * What we ask the models to return.
 *
 * Differences from `schema.ts` on purpose:
 *  - Structure only. No min/max sizes: many structured-output decoders reject
 *    them, so limits are enforced afterwards by the assembler (truncate, clamp).
 *  - Every key is required; absence is `null`, never `undefined`.
 *  - No recursion (Meta's structured output rejects self-referencing schemas).
 *
 * `toStrictJsonSchema` turns any of these into the JSON Schema sent as
 * `response_format` / `text.format`.
 */
import { z } from 'zod';
import { CATEGORIES, HAZARDS, MODEL_BASES, SECTION_KEYS } from './epistemics';
import { CAPTURE_KINDS, WHATIF_KINDS } from './schema';

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

const claimShape = {
  basis: z
    .enum(MODEL_BASES)
    .describe(
      'How this is known. observed = visible in the supplied image. sourced = stated by a supplied source (cite it). inferred = reasoned from observed facts plus general knowledge. hypothesis = plausible but unconfirmed. unknown = cannot be determined.',
    ),
  confidence: z
    .number()
    .nullable()
    .describe('0 to 1. Null when basis is unknown. Never above 0.6 for a hypothesis.'),
  regionIds: z.array(z.string()).describe('Ids of image regions (r1, r2, ...) that show this. Empty array if none.'),
  sourceIds: z.array(z.string()).describe('Ids of supplied sources (s1, s2, ...) that state this. Empty array if none.'),
  quote: z
    .string()
    .nullable()
    .describe('Words copied exactly from a cited source that support the claim (at most 25 words). Null unless basis is sourced.'),
};

export const ClaimCoreSchema = z.object(claimShape);
export type ClaimCore = z.infer<typeof ClaimCoreSchema>;

export const FindingDraftSchema = z.object({
  ref: z.string().describe('A short local id such as f1, f2. Unique within this response.'),
  section: z.enum(SECTION_KEYS),
  text: z.string().describe('One plain statement, at most two sentences. No markdown.'),
  ...claimShape,
});
export type FindingDraft = z.infer<typeof FindingDraftSchema>;

export const CandidateDraftSchema = z.object({
  name: z.string().describe('Specific name, as specific as the evidence allows (maker and model only if the evidence supports it).'),
  category: z.enum(CATEGORIES),
  likelihood: z.number().describe('0 to 1. Candidates should roughly sum to at most 1. This is an estimate, not a calibrated probability.'),
  evidenceFor: z.array(z.string()).describe('Visible features that fit this candidate.'),
  evidenceAgainst: z.array(z.string()).describe('Visible features that do not fit, or are missing.'),
  missing: z.array(z.string()).describe('What would need to be seen or known to confirm it.'),
});
export type CandidateDraft = z.infer<typeof CandidateDraftSchema>;

export const RETRIEVAL_INTENTS = ['identify', 'specs', 'history', 'safety', 'repair', 'material', 'live'] as const;

// ---------------------------------------------------------------------------
// 1. Identify (Muse Spark, vision)
// ---------------------------------------------------------------------------

export const IdentifyOutputSchema = z.object({
  quality: z.object({
    adequate: z.boolean().describe('False if blur, glare, darkness, distance or occlusion prevents reliable identification.'),
    issues: z.array(
      z.object({
        kind: z.enum(['blur', 'glare', 'dark', 'small', 'occluded', 'cluttered', 'other']),
        note: z.string(),
      }),
    ),
    advice: z.array(z.string()).describe('Concrete capture advice, e.g. "Photograph the label on the underside".'),
  }),
  objectCount: z.number().describe('How many distinct objects are the likely subject.'),
  primary: z.object({
    description: z.string().describe('What is physically visible, with no identification claims.'),
    category: z.enum(CATEGORIES),
    subcategory: z.string().nullable(),
    hazards: z.array(z.enum(HAZARDS)),
  }),
  candidates: z.array(CandidateDraftSchema).describe('One to five candidate identities, most likely first. Include "Cannot be identified from this photo" as a candidate when that is the honest outcome.'),
  concepts: z
    .array(
      z.object({
        phrase: z
          .string()
          .describe('A short noun phrase naming ONE visible thing, e.g. "safety valve" or "hex nut". Not a sentence, not a command.'),
        role: z.enum(['whole', 'part', 'marking', 'material']),
        reason: z.string(),
      }),
    )
    .describe('Up to ten visible things worth outlining so claims can point at them. Include the whole object first.'),
  pointers: z
    .array(
      z.object({
        phrase: z.string().describe('Must equal one of the concept phrases.'),
        x: z.number().describe('Approximate horizontal centre of the thing, 0 (left edge) to 1 (right edge).'),
        y: z.number().describe('Approximate vertical centre of the thing, 0 (top edge) to 1 (bottom edge).'),
      }),
    )
    .describe('Rough locations for each concept, used only if outlining is unavailable.'),
  textRead: z
    .array(z.object({ text: z.string().describe('Characters exactly as printed or stamped.'), location: z.string().nullable() }))
    .describe('Every legible marking, label or inscription, transcribed verbatim. Empty if none.'),
  retrievalQueries: z
    .array(
      z.object({
        query: z.string().describe('A short search query a reference site would match.'),
        intent: z.enum(RETRIEVAL_INTENTS),
      }),
    )
    .describe('Up to six queries for looking the top candidates up: specs, history, safety notices, repair information.'),
});
export type IdentifyOutput = z.infer<typeof IdentifyOutputSchema>;

// ---------------------------------------------------------------------------
// 2. Compose the profile (Muse Spark). Two calls run in parallel.
// ---------------------------------------------------------------------------

export const ComponentDraftSchema = z.object({
  name: z.string(),
  role: z.string().describe('What this part does, in one sentence.'),
  regionId: z.string().nullable().describe('Region id if the part is visible in the photo, else null.'),
  material: z.string().nullable(),
  parent: z.string().nullable().describe('Name of the part this belongs to, if any.'),
  visibleInPhoto: z.boolean(),
  basis: z.enum(MODEL_BASES).describe('How the existence of this part is known.'),
});

export const ProfileCoreDraftSchema = z.object({
  displayName: z.string().describe('One plain name: the single best answer, as specific as the evidence supports. No alternatives, no second name, no parentheses and no hedging words; what is still uncertain goes in openQuestions.'),
  subcategory: z.string().nullable(),
  summary: z.string().describe('Two or three warm, plain sentences for a curious reader: what it is, what it is known for or used for, and one interesting or useful thing about it. Write like a good museum label. No talk about confidence, certainty, identification or evidence, and no warnings: those are shown elsewhere.'),
  identityStatus: z.enum(['identified', 'candidates', 'unknown']),
  topCandidate: z.string().nullable().describe('Name of the leading candidate, copied exactly from the candidates list; null if unknown.'),
  findings: z.array(FindingDraftSchema),
  components: z.array(ComponentDraftSchema),
  conflicts: z
    .array(z.object({ refs: z.array(z.string()), description: z.string() }))
    .describe('Pairs of findings that disagree, or that a source contradicts. Empty if none.'),
  openQuestions: z.array(z.string()).describe('What would settle the remaining doubt. Each should be something the person can do.'),
});
export type ProfileCoreDraft = z.infer<typeof ProfileCoreDraftSchema>;

export const WhatIfDraftSchema = z.object({
  title: z.string(),
  question: z.string(),
  kind: z.enum(WHATIF_KINDS),
  summary: z.string(),
  assumptions: z.array(
    z.object({
      key: z.string().describe('Identifier: letters, digits, underscore. Used in expressions.'),
      label: z.string(),
      value: z.number(),
      unit: z.string().describe('A unit the evaluator understands, e.g. "kg", "W", "degC", "mm", or "" for dimensionless.'),
      min: z.number(),
      max: z.number(),
      step: z.number(),
      origin: z.enum(['assumed', 'measured', 'sourced']),
      note: z.string().nullable(),
    }),
  ),
  steps: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      expr: z.string().describe('Arithmetic over assumption keys and earlier step keys, each a plain number in its declared unit, e.g. "m * c * dT / (P * eta)". Allowed functions: sqrt, abs, min, max, exp, log, log10, sin, cos, tan, pow, round.'),
      unit: z.string(),
    }),
  ),
  resultKey: z.string().nullable(),
  sweepKey: z.string().nullable(),
  caveats: z.array(z.string()),
  safety: z.string().nullable(),
  sourceIds: z.array(z.string()),
});

export const ProfileExtrasDraftSchema = z.object({
  timeline: z.array(
    z.object({
      strand: z
        .enum(['maker', 'kind', 'item'])
        .optional()
        .describe('maker = the brand or company that makes it; kind = the history of this kind of object; item = this particular object (only if a source or marking dates it).'),
      label: z.string(),
      detail: z.string().nullable(),
      from: z.number().describe('Year (negative for BCE).'),
      to: z.number().nullable().describe('End year for a span, else null.'),
      approx: z.boolean(),
      ...claimShape,
    }),
  ),
  safety: z.array(
    z.object({
      hazard: z.enum(HAZARDS),
      severity: z.enum(['info', 'caution', 'warning', 'danger']),
      text: z.string(),
      advice: z.string().nullable(),
      professionalReview: z.boolean(),
      ...claimShape,
    }),
  ),
  related: z.array(z.object({ name: z.string(), relation: z.string(), ...claimShape })),
  live: z.array(
    z.object({
      label: z.string(),
      value: z.string(),
      scope: z.string(),
      sourceId: z.string().describe('Must be a supplied source. Never invent a current value.'),
      kind: z.enum(['confirmed', 'estimate']),
      limitations: z.string(),
    }),
  ),
  whatIf: z.array(WhatIfDraftSchema).describe('Up to three. Use kind "calculation" only when the steps really compute the answer.'),
});
export type ProfileExtrasDraft = z.infer<typeof ProfileExtrasDraftSchema>;

// ---------------------------------------------------------------------------
// 3. Resolve ambiguity (Muse Wonder). Text only: it never receives the image.
// ---------------------------------------------------------------------------

export const ResolveOutputSchema = z.object({
  ranking: z.array(
    z.object({
      candidateName: z.string().describe('Copied exactly from the supplied candidates.'),
      likelihood: z.number(),
      evidenceFor: z.array(z.string()),
      evidenceAgainst: z.array(z.string()),
    }),
  ),
  nextShot: z
    .object({
      instruction: z.string().describe('One thing the person can do now, imperative, e.g. "Photograph the stamped marks on the hex flats".'),
      why: z.string().describe('Which candidates it separates and why.'),
      separates: z.array(z.string()).describe('Candidate names this would tell apart.'),
      capture: z.enum(CAPTURE_KINDS),
      target: z.string().nullable(),
      expectedGain: z.number().describe('0 to 1: how much it would narrow the candidates.'),
    })
    .nullable()
    .describe('Null only if the candidates are already clearly separated.'),
  alternativeExplanations: z.array(z.string()),
  researchQuestions: z.array(z.string()),
});
export type ResolveOutput = z.infer<typeof ResolveOutputSchema>;

// ---------------------------------------------------------------------------
// 4. Ask
// ---------------------------------------------------------------------------

export const AskOutputSchema = z.object({
  segments: z.array(
    z.object({
      text: z.string().describe('One claim-sized piece of the answer.'),
      ...claimShape,
    }),
  ),
  followUps: z.array(z.string()),
  needsEvidence: z
    .object({ instruction: z.string() })
    .nullable()
    .describe('Set when a better answer needs a photo, a measurement or a source we do not have.'),
  refused: z
    .object({ reason: z.string() })
    .nullable()
    .describe('Set when answering would require advice that is unsafe to give from a photo.'),
});
export type AskOutput = z.infer<typeof AskOutputSchema>;

// ---------------------------------------------------------------------------
// 5. Compare
// ---------------------------------------------------------------------------

export const CompareOutputSchema = z.object({
  headline: z.string().describe('One sentence: the difference that matters most.'),
  differences: z.array(
    z.object({
      aspect: z.string(),
      a: z.string(),
      b: z.string(),
      matters: z.string().describe('Why a person choosing between them would care.'),
      ...claimShape,
    }),
  ),
  similarities: z.array(z.string()),
  advice: z.string().nullable(),
});
export type CompareOutput = z.infer<typeof CompareOutputSchema>;

// ---------------------------------------------------------------------------
// 6. Inside view: what each part does and how it works (Muse Spark)
// ---------------------------------------------------------------------------

export const INSIDE_KINDS = ['living', 'machine', 'natural', 'structure', 'other'] as const;

export const InsideDraftSchema = z.object({
  kind: z.enum(INSIDE_KINDS).describe('living = animal, plant, fungus or person; machine = anything made with working parts; natural = rock, mineral, shell, wood and other non-living natural material; structure = made things with no moving parts; other.'),
  intro: z.string().describe('Two plain sentences: what is inside this kind of thing and the one idea that explains how it works.'),
  groups: z
    .array(
      z.object({
        name: z.string().describe('A system or layer, e.g. "Circulatory system", "Brewing chamber", "Outer crust".'),
        role: z.string().describe('What this group does, in one sentence.'),
        parts: z.array(
          z.object({
            name: z.string(),
            what: z.string().describe('What it does, one short sentence.'),
            how: z.string().describe('How it does it, one or two plain sentences. No numbers you are not sure of.'),
            regionId: z.string().nullable().describe('Region id if this part is visible in the photo, else null.'),
            visibleInPhoto: z.boolean(),
            ...claimShape,
          }),
        ),
      }),
    )
    .describe('Two to six groups, each with two to six parts. Order from outside to inside, or along the flow.'),
  flows: z
    .array(
      z.object({
        title: z.string().describe('e.g. "How blood circulates", "From water to coffee", "How this rock formed".'),
        summary: z.string(),
        steps: z.array(z.object({ label: z.string().describe('Two to four words.'), detail: z.string().describe('One sentence.') })).describe('Three to eight steps in order.'),
        ...claimShape,
      }),
    )
    .describe('One to three flows that show how it works in real life, in order.'),
  illustrationBrief: z.string().describe('Two or three sentences for an illustrator drawing an accurate cutaway of this kind: the real internal parts by name (for an animal, the main bones and organs) and where each sits relative to the others, from the sources. No brand names.'),
});
export type InsideDraft = z.infer<typeof InsideDraftSchema>;

// ---------------------------------------------------------------------------
// 7. Glance: a fast look at a live camera frame
// ---------------------------------------------------------------------------

export const GlanceOutputSchema = z.object({
  label: z.string().nullable().describe('What the main object is, in two to five words. Null if nothing clear is in view.'),
  confidence: z.number().describe('0 to 1.'),
  hint: z.string().nullable().describe('One short capture tip if it would help, e.g. "Move closer" or "Show the label". Else null.'),
});
export type GlanceOutput = z.infer<typeof GlanceOutputSchema>;

// ---------------------------------------------------------------------------
// 7b. Grounding: where each part is (Muse Spark, normalised 0-1000 boxes)
// ---------------------------------------------------------------------------

const GroundBoxSchema = z.object({ x_min: z.number(), y_min: z.number(), x_max: z.number(), y_max: z.number() });

export const GroundOutputSchema = z.object({
  parts: z
    .array(
      z.object({
        name: z.string().describe('The part name, copied exactly from the list.'),
        visible: z.boolean().describe('False if this part cannot be seen in the image.'),
        boxes: z.array(GroundBoxSchema).describe('One tight box per visible instance, on the 0-1000 grid. Empty if not visible.'),
      }),
    )
    .describe('Every listed part, in the same order.'),
  extra: z
    .array(z.object({ name: z.string().describe('The correct short name of a clearly visible part that is not in the list.'), boxes: z.array(GroundBoxSchema) }))
    .describe('Every other part of the object that can clearly be seen in this photo, up to 14. Never the background, and never a part that cannot be seen from this angle.'),
});
export type GroundOutput = z.infer<typeof GroundOutputSchema>;

export const MarkNamesSchema = z.object({
  marks: z
    .array(
      z.object({
        n: z.number().describe('The number on the outline.'),
        name: z.string().nullable().describe('The one listed name that this outline shows, copied exactly; null if it shows none of them, several parts at once, or you cannot tell.'),
        sure: z.boolean().describe('True only if the drawing clearly shows that part inside this outline.'),
      }),
    )
    .describe('Every numbered outline, once.'),
});
export type MarkNames = z.infer<typeof MarkNamesSchema>;

export const LabelCheckOutputSchema = z.object({
  regions: z
    .array(
      z.object({
        n: z.number().describe('The number drawn next to the outline.'),
        covers: z.string().nullable().describe('The short name (one to four words) of the single part of the object inside this outline, judged only by what is inside it; null for background, another object, the whole object, several separate parts, or nothing nameable.'),
        fits: z.boolean().describe('True if the outline follows that part closely; false if it is much larger than the part or covers only a small piece of it.'),
      }),
    )
    .describe('One entry per numbered outline.'),
  missing: z
    .array(z.object({ name: z.string(), box: GroundBoxSchema }))
    .describe('Clearly visible parts of the object that have no outline yet, with a tight box on the 0-1000 grid. Up to five. Never the background.'),
});
export type LabelCheckOutput = z.infer<typeof LabelCheckOutputSchema>;



/** Naming regions that were found from the pixels (Set-of-Mark): one name or null per number. */
export const PartMarksSchema = z.object({
  regions: z
    .array(
      z.object({
        n: z.number().describe('The number on the region.'),
        name: z
          .string()
          .nullable()
          .describe('The short, generic name (one to three words) of the part of the object this region is, or null if it is background, the surface below, another object (another plant or leaf, a pot, soil, a hand, a person), the whole object, or not one part you can name.'),
      }),
    )
    .describe('Every numbered region, once.'),
  missing: z
    .array(z.object({ name: z.string(), box: GroundBoxSchema }))
    .describe('Up to six clearly visible parts of this object that no region covers, each with a tight box on the 0-1000 grid. Only parts you can really see.'),
});
export type PartMarks = z.infer<typeof PartMarksSchema>;

/** One outlined region, seen up close on its own: what part it is, and how well the outline fits it. */
export const CloseNameSchema = z.object({
  looks: z.string().describe('One short sentence: what the outlined pixels show (shape, material, colour), before naming it.'),
  name: z
    .string()
    .nullable()
    .describe('The short, generic name (one to three words) of the part of the object inside the outline, or null if the outline shows background, the ground, another object, the whole object, or several different parts at once.'),
  fits: z.enum(['well', 'partly', 'badly']).describe('well: the outline follows that part. partly: it covers only some of the part, or a little more. badly: it takes in a lot of other things.'),
  sure: z.boolean().describe('True only if the outlined pixels clearly show that part.'),
});
export type CloseName = z.infer<typeof CloseNameSchema>;

/** An independent second look at a corrected part: which of two names fits the outline. */
export const SecondOpinionSchema = z.object({
  choice: z.enum(['A', 'B', 'neither']).describe('The name that fits the outlined part: A or B, or neither if both are wrong (for example background, or another part).'),
  sure: z.boolean().describe('True only if what is inside the outline clearly shows it.'),
  reason: z.string().describe('One short plain sentence: what in the photo decides it.'),
});
export type SecondOpinion = z.infer<typeof SecondOpinionSchema>;

export const DecideOutputSchema = z.object({
  features: z
    .array(
      z.object({
        feature: z.string().describe('A visible feature that tells the candidates apart, from the reference research.'),
        inPhoto: z.string().describe('What this photo actually shows for that feature. Say "not visible" if it cannot be seen.'),
        pointsTo: z.string().nullable().describe('The candidate name this observation supports, copied exactly, or null if it does not decide anything.'),
      }),
    )
    .describe('Every distinguishing feature the research names, checked against the photo.'),
  answer: z.string().describe('Exactly one of the candidate names, copied exactly, or "cannot tell" if the visible features do not decide it.'),
  confidence: z.number().describe('0 to 1: how sure the answer is, given the features actually visible.'),
  reason: z.string().describe('One or two plain sentences: which visible features decided it.'),
});
export type DecideOutput = z.infer<typeof DecideOutputSchema>;

export const NameOutlineSchema = z.object({
  name: z.string().nullable().describe('One to four words naming the part of the object inside outline 1, or null if it is mostly background.'),
});

export const CutawayReviewSchema = z.object({
  matchesPhoto: z.number().describe('1 to 5: how closely the drawing keeps the pose, outline, proportions and framing of the photo.'),
  accuracy: z.number().describe('1 to 5: how correct the inside is for this kind of object (right parts, right places, right relative sizes).'),
  shown: z.array(z.string()).describe('Of the parts it should show, the ones that are clearly drawn and visible in the illustration, names copied exactly.'),
  problems: z.array(z.string()).describe('Concrete errors, each one short, e.g. "the heart is drawn in the head". Empty if none.'),
  fix: z.string().nullable().describe('One instruction to an illustrator that fixes every problem listed, or null if none are needed.'),
});
export type CutawayReview = z.infer<typeof CutawayReviewSchema>;

export const ScreenSourcesOutputSchema = z.object({
  sources: z
    .array(
      z.object({
        id: z.string().describe('The source id, copied exactly.'),
        relevant: z.boolean().describe('True only if the source is about this object, its maker or brand, its kind, or its material. Pages about unrelated topics that merely share a word are false.'),
      }),
    )
    .describe('Every supplied source, once.'),
});
export type ScreenSourcesOutput = z.infer<typeof ScreenSourcesOutputSchema>;


// ---------------------------------------------------------------------------
// 9. Translation of interface text
// ---------------------------------------------------------------------------

export const TranslateOutputSchema = z.object({
  translations: z.array(z.string()).describe('One translation per input string, in the same order and the same number of items.'),
});
export type TranslateOutput = z.infer<typeof TranslateOutputSchema>;

// ---------------------------------------------------------------------------
// JSON Schema for response_format / text.format
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

const STRIP_KEYS = new Set([
  '$schema',
  'format',
  'pattern',
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minItems',
  'maxItems',
  'uniqueItems',
  'default',
  'examples',
  'title',
]);

function strictify(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strictify);
  if (node && typeof node === 'object') {
    const src = node as Json;
    const out: Json = {};
    for (const [k, v] of Object.entries(src)) {
      if (STRIP_KEYS.has(k)) continue;
      if (k === 'properties' && v && typeof v === 'object' && !Array.isArray(v)) {
        // These keys are field names, not keywords: a field called "title" or "format" must stay.
        out[k] = Object.fromEntries(Object.entries(v as Json).map(([name, sub]) => [name, strictify(sub)]));
        continue;
      }
      out[k] = strictify(v);
    }
    if (out.type === 'object' && out.properties && typeof out.properties === 'object') {
      out.additionalProperties = false;
      out.required = Object.keys(out.properties as Json);
    }
    return out;
  }
  return node;
}

/** JSON Schema for a model-output schema: all keys required, no unsupported keywords, no recursion. */
export function toStrictJsonSchema(schema: z.ZodType): Json {
  const raw = z.toJSONSchema(schema, { target: 'draft-7', io: 'output' }) as Json;
  const strict = strictify(raw) as Json;
  if (JSON.stringify(strict).includes('"$ref"')) {
    throw new Error('Schema contains $ref (recursion or reuse). Meta structured output rejects recursive schemas; inline it.');
  }
  return strict;
}

/** Parse model text that should be JSON. Tolerates code fences and leading chatter; never evals. */
export function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    /* fall through */
  }
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      /* fall through */
    }
  }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return JSON.parse(trimmed.slice(start, end + 1));
  }
  throw new Error('No JSON object found in model output');
}
