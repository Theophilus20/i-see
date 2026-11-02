/**
 * The epistemic vocabulary of I SEE.
 *
 * Every statement the app makes carries a `basis`: how it is known. The UI, the
 * firewall, the exports and the evaluation harness all read from this one table,
 * so a change here changes the whole product consistently.
 *
 * Schema names follow the architecture spec (observation, sourced fact,
 * inference, hypothesis, unknown). The words people see are plainer.
 */

export const BASES = ['observed', 'sourced', 'inferred', 'hypothesis', 'unknown', 'user'] as const;
export type Basis = (typeof BASES)[number];

/** Bases a model may claim. `user` is reserved for notes the person adds. */
export const MODEL_BASES = ['observed', 'sourced', 'inferred', 'hypothesis', 'unknown'] as const;
export type ModelBasis = (typeof MODEL_BASES)[number];

export interface BasisInfo {
  /** Word shown in the interface. */
  label: string;
  /** One plain sentence: what this grade promises. */
  meaning: string;
  /** What would upgrade it. Shown in the key. */
  upgrade: string;
  /** Leader-line / outline dash pattern (SVG stroke-dasharray, in px). Empty = solid. */
  dash: string;
  /** Marker glyph drawn at the end of leader lines and in the key. */
  glyph: 'disc' | 'diamond' | 'half' | 'ring' | 'void' | 'pen';
  /** Order in the key and in tallies, from most to least directly evidenced. */
  rank: number;
}

export const BASIS_INFO: Record<Basis, BasisInfo> = {
  observed: {
    label: 'Seen',
    meaning: 'You can see this in the photo.',
    upgrade: 'Already first-hand evidence.',
    dash: '',
    glyph: 'disc',
    rank: 0,
  },
  sourced: {
    label: 'Cited',
    meaning: 'Taken from a source that was retrieved. Open the source to check it.',
    upgrade: 'Confirm against a primary source or the object itself.',
    dash: '',
    glyph: 'diamond',
    rank: 1,
  },
  inferred: {
    label: 'Reasoned',
    meaning: 'Worked out from what is seen and what is generally known. Not shown directly.',
    upgrade: 'A source or a closer photo would make it Cited or Seen.',
    dash: '7 5',
    glyph: 'half',
    rank: 2,
  },
  hypothesis: {
    label: 'Guess',
    meaning: 'Plausible, but nothing here confirms it.',
    upgrade: 'Needs the extra evidence listed under Open questions.',
    dash: '1.5 5',
    glyph: 'ring',
    rank: 3,
  },
  unknown: {
    label: 'Unknown',
    meaning: 'This cannot be told from the evidence available.',
    upgrade: 'Needs information that is not in the photo or the sources.',
    dash: '',
    glyph: 'void',
    rank: 4,
  },
  user: {
    label: 'Yours',
    meaning: 'Added by you. It has not been checked.',
    upgrade: 'Attach a source to check it.',
    dash: '',
    glyph: 'pen',
    rank: 5,
  },
};

export const basisLabel = (b: Basis): string => BASIS_INFO[b].label;

/** Verbal strength, used instead of a percentage because model confidence is not calibrated. */
export type Strength = 'strong' | 'moderate' | 'weak';

export const STRENGTH_LABEL: Record<Strength, string> = {
  strong: 'Strong',
  moderate: 'Moderate',
  weak: 'Weak',
};

/** Hard ceilings so a model cannot claim more certainty than its basis allows. */
export const BASIS_CONFIDENCE_CAP: Record<Basis, number | null> = {
  observed: 0.97,
  sourced: 0.97,
  inferred: 0.88,
  hypothesis: 0.6,
  unknown: null,
  user: null,
};

export function strengthFor(basis: Basis, confidence: number | null): Strength | null {
  if (basis === 'unknown' || basis === 'user' || confidence == null) return null;
  const cap = BASIS_CONFIDENCE_CAP[basis];
  const c = cap == null ? confidence : Math.min(confidence, cap);
  if (c >= 0.8) return 'strong';
  if (c >= 0.5) return 'moderate';
  return 'weak';
}

/** Where a finding sits in the profile. Titles are what people read. */
export const SECTION_KEYS = [
  'identity',
  'function',
  'operation',
  'parts',
  'materials',
  'size',
  'origin',
  'history',
  'uses',
  'strengths',
  'limits',
  'care',
  'safety',
  'failure',
  'environment',
  'related',
  'live',
] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

export const SECTION_TITLE: Record<SectionKey, string> = {
  identity: 'What it is',
  function: "What it's for",
  operation: 'How it works',
  parts: 'Parts',
  materials: 'Made of',
  size: 'Size',
  origin: "Where it's from",
  history: 'History',
  uses: 'How people use it',
  strengths: 'What it does well',
  limits: 'Where it falls short',
  care: 'Looking after it',
  safety: 'Safety',
  failure: 'What can go wrong',
  environment: 'Reuse and disposal',
  related: 'Related things',
  live: 'Right now',
};

export const CATEGORIES = [
  'consumer_product',
  'tool',
  'machine',
  'electronics',
  'furniture',
  'vehicle',
  'plant',
  'fungus',
  'animal',
  'mineral',
  'artifact',
  'component',
  'food',
  'medical',
  'chemical',
  'other',
] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABEL: Record<Category, string> = {
  consumer_product: 'Everyday product',
  tool: 'Tool',
  machine: 'Machine',
  electronics: 'Electronics',
  furniture: 'Furniture',
  vehicle: 'Vehicle',
  plant: 'Plant',
  fungus: 'Fungus',
  animal: 'Animal',
  mineral: 'Mineral',
  artifact: 'Artifact',
  component: 'Component or part',
  food: 'Food',
  medical: 'Medical item',
  chemical: 'Chemical',
  other: 'Other',
};

export const HAZARDS = [
  'electrical',
  'chemical',
  'mechanical',
  'thermal',
  'pressure',
  'biological',
  'toxic',
  'medical',
  'vehicle',
  'fire',
  'gas',
  'none',
] as const;
export type Hazard = (typeof HAZARDS)[number];

/**
 * Categories and hazards where a wrong answer can hurt someone. Findings here get
 * stricter treatment in the firewall: a Cited claim needs an authoritative source,
 * and some statements are replaced outright (see safety guards).
 */
export const HIGH_STAKES_CATEGORIES: readonly Category[] = [
  'plant',
  'fungus',
  'food',
  'medical',
  'chemical',
  'vehicle',
  'electronics',
];
export const HIGH_STAKES_HAZARDS: readonly Hazard[] = [
  'electrical',
  'chemical',
  'pressure',
  'toxic',
  'medical',
  'vehicle',
  'fire',
  'gas',
  'biological',
];

/** Source preference tiers from the architecture spec, lowest number = most authoritative. */
export const SOURCE_TIERS = {
  1: 'Manufacturer or maker',
  2: 'Government, regulator or standards body',
  3: 'Museum, academic or scientific collection',
  4: 'Specialist or trade reference',
  5: 'Community or general reference',
} as const;
export type SourceTier = keyof typeof SOURCE_TIERS;
