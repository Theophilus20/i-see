/**
 * Turns what the models returned into a Profile.
 *
 * Model output is drafts: loose, untrusted, possibly wrong in shape and in substance.
 * This module gives everything stable ids, enforces limits, links timeline, safety and
 * related entries to findings, runs the firewall over every claim, checks every
 * what-if calculation, and drops anything whose supporting finding did not survive.
 */
import { HIGH_STAKES_HAZARDS, type Category, type Hazard } from './epistemics';
import { runFirewall } from './firewall';
import { sanitizeWhatIf } from './calc';
import type {
  CandidateDraft,
  ClaimCore,
  DecideOutput,
  IdentifyOutput,
  ProfileCoreDraft,
  ProfileExtrasDraft,
  ResolveOutput,
} from './model-io';
import type {
  Candidate,
  Component,
  Conflict,
  Finding,
  LiveDatum,
  NextShot,
  Profile,
  QualityReport,
  Region,
  Related,
  SafetyNote,
  SecondOpinion,
  Source,
  TextRead,
  TimelineEvent,
  Trace,
  View,
  WhatIf,
} from './schema';
import { SCHEMA_VERSION } from './schema';
import { clamp01, normalizeForMatch, round2, sanitizeText } from './text';
import type { SectionKey } from './epistemics';

// ---------------------------------------------------------------------------
// Candidates: the hypothesis tournament
// ---------------------------------------------------------------------------

export const AMBIGUITY = { topBelow: 0.55, marginBelow: 0.15 } as const;

const UNIDENTIFIABLE = /cannot be identified|can't be identified|unidentifiable|not enough (?:detail|information)/i;

export function candidatesFrom(drafts: CandidateDraft[], fallbackCategory: Category): Candidate[] {
  const cleaned = drafts
    .filter((d) => d && typeof d.name === 'string' && d.name.trim())
    .slice(0, 6)
    .map((d, i) => ({
      id: `c${i + 1}`,
      name: sanitizeText(d.name, 160),
      category: d.category ?? fallbackCategory,
      likelihood: clamp01(Number(d.likelihood)),
      evidenceFor: (d.evidenceFor ?? []).slice(0, 6).map((s) => sanitizeText(s, 240)).filter(Boolean),
      evidenceAgainst: (d.evidenceAgainst ?? []).slice(0, 6).map((s) => sanitizeText(s, 240)).filter(Boolean),
      missing: (d.missing ?? []).slice(0, 6).map((s) => sanitizeText(s, 240)).filter(Boolean),
      eliminated: false,
      eliminatedBy: null,
    }));
  // Likelihoods are estimates; if they add up to more than 1, scale them down so they read as shares.
  const total = cleaned.reduce((a, c) => a + c.likelihood, 0);
  if (total > 1) for (const c of cleaned) c.likelihood = round2(c.likelihood / total);
  return cleaned.sort((a, b) => b.likelihood - a.likelihood).map((c, i) => ({ ...c, id: `c${i + 1}` }));
}

export function identityStatus(cands: Candidate[]): 'identified' | 'candidates' | 'unknown' {
  const live = cands.filter((c) => !c.eliminated);
  const top = live[0];
  if (!top || UNIDENTIFIABLE.test(top.name) || top.likelihood < 0.25) return 'unknown';
  return isAmbiguous(live) ? 'candidates' : 'identified';
}

/**
 * Applies a web-researched check of the features that tell close candidates apart. A clear
 * answer moves to the top with the decisive features as its evidence; "cannot tell", an
 * unknown name or low confidence changes nothing.
 */
export function applyDecision(cands: Candidate[], d: DecideOutput): { candidates: Candidate[]; winner: Candidate | null } {
  const confidence = clamp01(Number(d.confidence));
  const answer = normalizeForMatch(d.answer ?? '');
  const winner = cands.find((c) => normalizeForMatch(c.name) === answer) ?? null;
  if (!winner || confidence < 0.6 || /cannot tell/.test(answer)) return { candidates: cands, winner: null };
  const decisive = (d.features ?? [])
    .filter((f) => f.pointsTo && normalizeForMatch(f.pointsTo) === answer && !/not visible/i.test(f.inPhoto))
    .slice(0, 4)
    .map((f) => sanitizeText(`${f.feature}: ${f.inPhoto}`, 240));
  const top = Math.max(winner.likelihood, round2(Math.min(0.95, confidence)));
  const restBefore = cands.filter((c) => c !== winner).reduce((a, c) => a + c.likelihood, 0);
  const room = Math.max(0, 1 - top);
  const scale = restBefore > room && restBefore > 0 ? room / restBefore : 1;
  const out = cands.map((c) =>
    c === winner
      ? { ...c, likelihood: top, evidenceFor: [...decisive, ...c.evidenceFor.filter((e) => !decisive.includes(e))].slice(0, 6) }
      : { ...c, likelihood: round2(c.likelihood * scale) },
  );
  out.sort((a, b) => b.likelihood - a.likelihood);
  return { candidates: out.map((c, i) => ({ ...c, id: `c${i + 1}` })), winner: out.find((c) => c.name === winner.name) ?? null };
}

/** One plain name: hedges and alternatives in brackets come off ("Fancy rat (mouse not ruled out)" → "Fancy rat"). */
export function cleanDisplayName(name: string): string {
  const hedge = /\b(?:not ruled out|unconfirmed|uncertain|unclear|undetermined|unverified|possibly|probably|likely|maybe|perhaps|or|could be|to be confirmed|tbc|unknown|not certain|not sure)\b/i;
  let out = name.replace(/\s*[([]([^)\]]*)[)\]]/g, (m, inner: string) => (hedge.test(inner) ? '' : m));
  out = out.replace(/\s*[,;:–—]\s*(?:possibly|probably|likely|maybe|perhaps)\b.*$/i, '');
  out = out.replace(/\s+/g, ' ').trim();
  return out || name.trim();
}

/**
 * The summary reads like a museum label: sentences about confidence, how it was identified,
 * or warnings (shown in their own sections) are left out, as long as something remains.
 */
export function cleanSummary(text: string): string {
  const meta = /\b(?:confidence|confident|certainty|identity alone|does not prove|do(?:es)? not establish|cannot be (?:told|confirmed|determined|identified)|can't be told|do not eat|don't eat|not to be eaten|handle it as food|based on (?:the|this) photo|from (?:this|the|one) (?:photo|image|leaf) alone)\b/i;
  const sentences = text.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g) ?? [text];
  const kept = sentences.filter((x) => !meta.test(x));
  return (kept.length ? kept : sentences.slice(0, 1)).join('').trim();
}

/** True when the leader is weak or the runner-up is close: the trigger for Muse Wonder. */
export function isAmbiguous(cands: Candidate[]): boolean {
  const live = cands.filter((c) => !c.eliminated && !UNIDENTIFIABLE.test(c.name));
  if (live.length === 0) return true;
  const [a, b] = live;
  if (a!.likelihood < AMBIGUITY.topBelow) return true;
  return !!b && a!.likelihood - b.likelihood < AMBIGUITY.marginBelow;
}

/** Applies Muse Wonder's re-ranking. Names must match supplied candidates; anything else is ignored. */
export function applyResolve(cands: Candidate[], out: ResolveOutput): { candidates: Candidate[]; nextShot: NextShot | null; notes: string[] } {
  const byName = new Map(cands.map((c) => [normalizeForMatch(c.name), c]));
  const notes: string[] = [];
  const updated = cands.map((c) => ({ ...c }));
  const touched = new Set<string>();
  for (const r of out.ranking ?? []) {
    const hit = byName.get(normalizeForMatch(r.candidateName ?? ''));
    if (!hit) {
      notes.push(`Ignored a re-ranking for "${sanitizeText(r.candidateName ?? '', 80)}", which was not a candidate.`);
      continue;
    }
    const c = updated.find((x) => x.id === hit.id)!;
    c.likelihood = clamp01(Number(r.likelihood));
    if (c.likelihood < 0.05) {
      c.eliminated = true;
      c.eliminatedBy = sanitizeText(r.evidenceAgainst?.[0] ?? 'Ruled out when the evidence was weighed again.', 240);
    }
    c.evidenceFor = [...new Set([...c.evidenceFor, ...(r.evidenceFor ?? []).map((s) => sanitizeText(s, 240))])].filter(Boolean).slice(0, 6);
    c.evidenceAgainst = [...new Set([...c.evidenceAgainst, ...(r.evidenceAgainst ?? []).map((s) => sanitizeText(s, 240))])].filter(Boolean).slice(0, 6);
    touched.add(c.id);
  }
  for (const c of updated) {
    if (touched.size && !touched.has(c.id) && c.likelihood < 0.05) {
      c.eliminated = true;
      c.eliminatedBy = 'Ruled out when the evidence was weighed again.';
    }
  }
  updated.sort((a, b) => Number(a.eliminated) - Number(b.eliminated) || b.likelihood - a.likelihood);
  const ns = out.nextShot;
  const nextShot: NextShot | null = ns
    ? {
        instruction: sanitizeText(ns.instruction, 300),
        why: sanitizeText(ns.why, 400),
        separates: (ns.separates ?? [])
          .map((n) => byName.get(normalizeForMatch(n))?.id)
          .filter((x): x is string => !!x)
          .slice(0, 5),
        capture: ns.capture,
        target: ns.target ? sanitizeText(ns.target, 120) : null,
        expectedGain: ns.expectedGain == null ? null : clamp01(ns.expectedGain),
      }
    : null;
  return { candidates: updated, nextShot: nextShot && nextShot.instruction ? nextShot : null, notes };
}

// ---------------------------------------------------------------------------
// Regions
// ---------------------------------------------------------------------------

/**
 * When outlining is unavailable, the vision model's rough pointers become approximate
 * point regions. They are drawn as dashed rings and labelled "approximate".
 */
export function regionsFromPointers(identify: IdentifyOutput, view: Pick<View, 'width' | 'height'>, viewIndex = 0): Region[] {
  const concepts = new Set(identify.concepts.map((c) => normalizeForMatch(c.phrase)));
  const out: Region[] = [];
  for (const p of identify.pointers ?? []) {
    if (!concepts.has(normalizeForMatch(p.phrase))) continue;
    const x = clamp01(p.x) * view.width;
    const y = clamp01(p.y) * view.height;
    const r = Math.min(view.width, view.height) * 0.06;
    out.push({
      id: `r${out.length + 1}`,
      label: sanitizeText(p.phrase, 120),
      kind: 'point',
      source: 'model-estimate',
      view: viewIndex,
      box: { x: x - r, y: y - r, w: 2 * r, h: 2 * r },
      path: null,
      anchor: { x, y },
      area: 0,
      confidence: null,
    });
    if (out.length >= 10) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// The profile
// ---------------------------------------------------------------------------

export interface AssembleInput {
  profileId: string;
  scanId: string;
  now: string;
  views: View[];
  identify: IdentifyOutput;
  candidates: Candidate[];
  nextShot: NextShot | null;
  secondOpinion: SecondOpinion | null;
  quality: QualityReport;
  regions: Region[];
  sources: Source[];
  core: ProfileCoreDraft | null;
  extras: ProfileExtrasDraft | null;
  resolveNotes: string[];
  extraOpenQuestions: string[];
  trace: Omit<Trace, 'firewall' | 'finishedAt'>;
}

interface Pending {
  finding: Finding;
  attach?: (f: Finding) => void;
}

function claimToFinding(id: string, section: SectionKey, text: string, c: Partial<ClaimCore>, flags: string[] = []): Finding {
  return {
    id,
    section,
    text: String(text ?? ''),
    basis: c.basis ?? 'hypothesis',
    confidence: c.confidence == null ? null : clamp01(Number(c.confidence)),
    regionIds: Array.isArray(c.regionIds) ? c.regionIds.map(String) : [],
    sourceIds: Array.isArray(c.sourceIds) ? c.sourceIds.map(String) : [],
    quote: c.quote ?? null,
    verification: { status: 'unverified', notes: [] },
    recheckAfter: null,
    flags,
    origin: 'model',
    disputed: false,
    note: null,
  };
}

const yearOk = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= -5000 && n <= 3000;

export function assembleProfile(input: AssembleInput): Profile {
  const { identify, core, extras } = input;
  const category = identify.primary.category;
  const hazards = (identify.primary.hazards ?? []).filter((h) => h !== 'none') as Hazard[];
  const pending: Pending[] = [];
  const refToId = new Map<string, string>();
  let n = 0;
  const nextId = () => `f${++n}`;

  // Core findings
  for (const d of (core?.findings ?? []).slice(0, 80)) {
    const id = nextId();
    if (d.ref) refToId.set(String(d.ref), id);
    pending.push({ finding: claimToFinding(id, d.section, d.text, d) });
  }

  // Timeline
  const timeline: TimelineEvent[] = [];
  for (const t of (extras?.timeline ?? []).slice(0, 30)) {
    if (!yearOk(t.from)) continue;
    const id = nextId();
    const label = sanitizeText(t.label, 160);
    pending.push({
      finding: claimToFinding(id, 'history', t.detail ? `${label}: ${t.detail}` : label, t),
      attach: (f) =>
        timeline.push({
          id: `t${timeline.length + 1}`,
          strand: t.strand ?? 'kind',
          label,
          detail: t.detail ? sanitizeText(t.detail, 400) : null,
          from: t.from,
          to: yearOk(t.to) && t.to >= t.from ? t.to : null,
          // A date nobody cited is approximate, whatever the model said.
          approx: t.approx || f.basis !== 'sourced',
          findingId: f.id,
        }),
    });
  }

  // Safety
  const safety: SafetyNote[] = [];
  for (const s of (extras?.safety ?? []).slice(0, 20)) {
    const id = nextId();
    const highStakes = HIGH_STAKES_HAZARDS.includes(s.hazard) || s.professionalReview;
    pending.push({
      finding: claimToFinding(id, 'safety', s.text, s, highStakes ? ['high_stakes'] : []),
      attach: (f) =>
        safety.push({
          id: `h${safety.length + 1}`,
          hazard: s.hazard,
          severity: s.severity,
          text: f.text,
          advice: f.verification.status === 'guarded' ? null : s.advice ? sanitizeText(s.advice, 500) : null,
          professionalReview: s.professionalReview || f.verification.status === 'guarded' || ['gas', 'electrical', 'pressure', 'chemical', 'medical', 'vehicle'].includes(s.hazard),
          findingId: f.id,
        }),
    });
  }

  // Related
  const related: Related[] = [];
  for (const r of (extras?.related ?? []).slice(0, 12)) {
    const id = nextId();
    const name = sanitizeText(r.name, 140);
    pending.push({
      finding: claimToFinding(id, 'related', `${name}: ${r.relation}`, r),
      attach: (f) => related.push({ id: `x${related.length + 1}`, name, relation: sanitizeText(r.relation, 200), findingId: f.id }),
    });
  }

  // Live values: the value itself must appear in the text that was retrieved.
  const live: LiveDatum[] = [];
  const sourceById = new Map(input.sources.map((s) => [s.id, s]));
  for (const l of (extras?.live ?? []).slice(0, 12)) {
    const source = sourceById.get(l.sourceId);
    if (!source) continue;
    const hay = normalizeForMatch(source.snippet);
    const needle = normalizeForMatch(l.value);
    const at = needle ? hay.indexOf(needle) : -1;
    if (at < 0) continue;
    const quote = hay.slice(Math.max(0, at - 24), at + needle.length + 24).trim();
    const id = nextId();
    pending.push({
      finding: claimToFinding(id, 'live', `${l.label}: ${l.value}`, { basis: 'sourced', confidence: l.kind === 'confirmed' ? 0.85 : 0.6, sourceIds: [source.id], regionIds: [], quote }, ['time-sensitive']),
      attach: (f) =>
        live.push({
          id: `v${live.length + 1}`,
          label: sanitizeText(l.label, 120),
          value: sanitizeText(l.value, 200),
          scope: sanitizeText(l.scope, 160),
          sourceId: source.id,
          retrievedAt: source.retrievedAt,
          freshness: 'live',
          kind: l.kind,
          limitations: sanitizeText(l.limitations, 300),
          findingId: f.id,
        }),
    });
  }

  // Firewall over everything at once, so duplicates across sections are caught too.
  const { findings, report } = runFirewall({
    findings: pending.map((p) => p.finding),
    regions: input.regions,
    sources: input.sources,
    category,
    hazards,
    now: input.now,
  });
  const survived = new Map(findings.map((f) => [f.id, f]));
  for (const p of pending) {
    const f = survived.get(p.finding.id);
    if (f && p.attach) p.attach(f);
  }

  // Components
  const regionIds = new Set(input.regions.map((r) => r.id));
  const components: Component[] = [];
  const compDrafts = (core?.components ?? []).slice(0, 40);
  const compIdByName = new Map<string, string>();
  compDrafts.forEach((c, i) => compIdByName.set(normalizeForMatch(c.name), `p${i + 1}`));
  compDrafts.forEach((c, i) => {
    const name = sanitizeText(c.name, 100);
    if (!name) return;
    const regionId = c.regionId && regionIds.has(c.regionId) ? c.regionId : null;
    components.push({
      id: `p${i + 1}`,
      name,
      role: sanitizeText(c.role, 300),
      regionId,
      material: c.material ? sanitizeText(c.material, 100) : null,
      parentId: c.parent ? (compIdByName.get(normalizeForMatch(c.parent)) ?? null) : null,
      // "Visible" needs an outline to point at; otherwise the part is known by inference.
      visible: !!c.visibleInPhoto && !!regionId,
      findingIds: findings
        .filter((f) => f.section === 'parts' && normalizeForMatch(f.text).includes(normalizeForMatch(c.name)))
        .map((f) => f.id)
        .slice(0, 12),
    });
  });
  for (const c of components) if (c.parentId === c.id) c.parentId = null;

  // Conflicts reference findings by the model's refs.
  const conflicts: Conflict[] = [];
  for (const c of (core?.conflicts ?? []).slice(0, 10)) {
    const ids = (c.refs ?? []).map((r) => refToId.get(String(r))).filter((x): x is string => !!x && survived.has(x));
    if (!ids.length) continue;
    conflicts.push({ id: `k${conflicts.length + 1}`, findingIds: [...new Set(ids)].slice(0, 6), description: sanitizeText(c.description, 400) });
  }
  for (const c of conflicts) for (const id of c.findingIds) survived.get(id)!.disputed = true;

  // What-if: only calculations that check out keep their numbers.
  const whatIf: WhatIf[] = [];
  for (const w of (extras?.whatIf ?? []).slice(0, 3)) {
    const draft: WhatIf = {
      id: `w${whatIf.length + 1}`,
      title: sanitizeText(w.title, 140),
      question: sanitizeText(w.question, 240),
      kind: w.kind,
      summary: sanitizeText(w.summary, 700),
      assumptions: (w.assumptions ?? []).slice(0, 8).map((a) => ({
        key: String(a.key),
        label: sanitizeText(a.label, 100),
        value: Number(a.value),
        unit: String(a.unit ?? '').slice(0, 24),
        min: Number(a.min),
        max: Number(a.max),
        step: Number(a.step) > 0 ? Number(a.step) : Math.abs(Number(a.max) - Number(a.min)) / 50 || 1,
        origin: a.origin,
        note: a.note ? sanitizeText(a.note, 240) : null,
      })),
      steps: (w.steps ?? []).slice(0, 10).map((s) => ({ key: String(s.key), label: sanitizeText(s.label, 120), expr: String(s.expr).slice(0, 240), unit: String(s.unit ?? '').slice(0, 24) })),
      resultKey: w.resultKey,
      sweepKey: w.sweepKey,
      caveats: (w.caveats ?? []).slice(0, 6).map((c) => sanitizeText(c, 300)).filter(Boolean),
      safety: w.safety ? sanitizeText(w.safety, 300) : null,
      sourceIds: (w.sourceIds ?? []).filter((id) => sourceById.has(id)).slice(0, 6),
    };
    const keyOk = /^[A-Za-z_][A-Za-z0-9_]{0,23}$/;
    const keysValid = draft.assumptions.every((a) => keyOk.test(a.key) && [a.value, a.min, a.max].every(Number.isFinite)) && draft.steps.every((s) => keyOk.test(s.key));
    if (!draft.title) continue;
    whatIf.push(
      keysValid
        ? sanitizeWhatIf(draft)
        : sanitizeWhatIf({ ...draft, steps: [{ key: 'x', label: 'x', expr: '(', unit: '' }], resultKey: 'x', assumptions: [], sweepKey: null }),
    );
  }

  const textRead: TextRead[] = (identify.textRead ?? []).slice(0, 24).map((t) => ({
    text: sanitizeText(t.text, 200),
    view: 0,
    regionId: null,
    location: t.location ? sanitizeText(t.location, 120) : null,
  })).filter((t) => t.text);

  const top = input.candidates.find((c) => !c.eliminated) ?? null;
  const status = identityStatus(input.candidates);
  const topId = core?.topCandidate
    ? (input.candidates.find((c) => normalizeForMatch(c.name) === normalizeForMatch(core.topCandidate!))?.id ?? top?.id ?? null)
    : (top?.id ?? null);

  const fallbackName =
    status === 'unknown' ? 'Unidentified object' : top ? top.name : 'Unidentified object';

  const openQuestions = [...new Set([...(core?.openQuestions ?? []).map((q) => sanitizeText(q, 300)), ...input.extraOpenQuestions.map((q) => sanitizeText(q, 300))])]
    .filter(Boolean)
    .slice(0, 10);

  const finishedAt = input.now;
  const firewallNotes = [...report.notes, ...input.resolveNotes].slice(0, 40);

  return {
    schemaVersion: SCHEMA_VERSION,
    id: input.profileId,
    scanId: input.scanId,
    createdAt: input.trace.startedAt,
    updatedAt: finishedAt,
    views: input.views,
    displayName: cleanDisplayName(sanitizeText(core?.displayName ?? '', 160) || fallbackName),
    category,
    subcategory: core?.subcategory ? sanitizeText(core.subcategory, 120) : identify.primary.subcategory ? sanitizeText(identify.primary.subcategory, 120) : null,
    summary: cleanSummary(sanitizeText(core?.summary ?? '', 700)) || sanitizeText(identify.primary.description, 700),
    identity: { status, topCandidateId: status === 'unknown' ? null : topId },
    candidates: input.candidates.slice(0, 8),
    nextShot: input.nextShot,
    secondOpinion: input.secondOpinion,
    quality: input.quality,
    regions: input.regions.slice(0, 60),
    findings: findings.slice(0, 120),
    components,
    timeline: timeline.sort((a, b) => a.from - b.from),
    safety,
    live,
    whatIf,
    related,
    textRead,
    conflicts,
    openQuestions,
    sources: input.sources.slice(0, 60),
    trace: { ...input.trace, finishedAt, firewall: { ...report, notes: firewallNotes } },
    inside: null,
  };
}
