/**
 * The epistemic firewall.
 *
 * A model can write fluent, confident claims that nothing supports. This module
 * is the part of I SEE that does not take its word for it. Every finding passes
 * through here before a person sees it, and the checks are code, not prompts:
 *
 *  1. Unknown region and source ids are removed (no phantom citations).
 *  2. A "Cited" claim must quote its source. The quote is matched against the text
 *     that was actually retrieved. No match means the claim is downgraded to
 *     "Reasoned" or "Guess", and the reason is recorded.
 *  3. On safety-critical findings, a Cited claim needs an authoritative source
 *     (tier 1 to 3). Community sources cannot carry it alone.
 *  4. Confidence is capped by basis: a guess can never read as strong.
 *  5. Assurances that something is safe to eat, take, use or touch are replaced
 *     with an honest "cannot be told from a photo" statement.
 *  6. Time-sensitive findings get a recheck date.
 *
 * Nothing here calls a model. It is deterministic and fully tested.
 */
import {
  BASIS_CONFIDENCE_CAP,
  BASIS_INFO,
  HIGH_STAKES_CATEGORIES,
  HIGH_STAKES_HAZARDS,
  type Basis,
  type Category,
  type Hazard,
} from './epistemics';
import type { Finding, FirewallReport, Region, Source } from './schema';
import { clamp01, quoteSupported, round2, sanitizeText } from './text';

export interface FirewallInput {
  findings: Finding[];
  regions: Region[];
  sources: Source[];
  category: Category;
  hazards: Hazard[];
  /** ISO timestamp, injected so tests are deterministic. */
  now: string;
}

export interface FirewallResult {
  findings: Finding[];
  report: FirewallReport;
}

// ---------------------------------------------------------------------------
// Safety guards
// ---------------------------------------------------------------------------

/** Words that make an assurance sentence a warning instead ("do not eat", "not safe to use"). */
const NEGATING = /\b(not|never|isn'?t|aren'?t|don'?t|do not|doesn'?t|cannot|can'?t|unsafe|inedible|avoid|unconfirmed|unverified|no way|without)\b/i;

/** Assurances that something may be eaten, drunk, handled or taken. Guarded unless the sentence negates them. */
const CONSUMPTION_ASSURANCE: RegExp[] = [
  /\b(safe|fine|ok|okay|harmless|non-?toxic|edible)\b[^.]{0,40}\b(to )?(eat|eaten|eating|consume|consumed|consumption|ingest|ingestion|drink|drinking|taste|tasting|touch|touching|handle|handling|take|taking)\b/i,
  /\bsafe (for|around) (people|humans|children|kids|babies|pets|dogs|cats|livestock|consumption|eating)\b/i,
  /\bcan be (eaten|consumed|ingested|drunk)\b/i,
  /\bedible\b/i,
];

/** Assurances made by denying a hazard. These are guarded even though they contain "not". */
const HAZARD_DENIAL: RegExp[] = [
  /\bnot\s+(?:at all\s+)?(?:poisonous|toxic|harmful|dangerous|venomous|hazardous)\b/i,
  /\bnon-?(?:toxic|poisonous|venomous)\b/i,
  /\bharmless\b/i,
  /\b(?:poses?|presents?|carries)\s+no\s+(?:risk|danger|threat|hazard)\b/i,
  /\bno known (?:toxicity|danger|hazards?)\b/i,
];

const DOSE_PATTERN =
  /\b\d+(?:\.\d+)?\s?(?:mg|mcg|µg|ml|iu|tablets?|pills?|capsules?|drops?)\b[^.]{0,60}\b(?:daily|per day|twice|every|dose|dosage|a day)\b/i;

const OPERATION_ASSURANCE: RegExp[] = [
  /\b(safe|fine|ok|okay)\b[^.]{0,30}\b(to )?(use|operate|run|plug in|connect|install|fire|light|pressuri[sz]e)\b/i,
  /\b(no|zero) (risk|danger|hazard)\b/i,
  /\bwon'?t (leak|explode|burst|overheat|catch fire)\b/i,
];

export type GuardKind = 'consume' | 'dose' | 'operate';

function guardText(kind: GuardKind, category: Category): string {
  if (kind === 'dose') return 'A dose cannot be given from a photo. Follow the label on the product, or ask a pharmacist or doctor.';
  if (kind === 'operate') {
    return 'Whether this is safe to use, repair or install cannot be told from a photo. Have it checked by a qualified person before relying on it.';
  }
  switch (category) {
    case 'plant':
    case 'fungus':
      return 'Whether this is safe to eat, touch or have around pets cannot be told from a photo. Do not rely on this app for it; ask a local expert who can examine it in person, such as an extension service, a botanical garden or a mycological society.';
    case 'animal':
      return 'Whether this animal is harmless cannot be told from a photo. Keep your distance and ask a local expert or wildlife service.';
    case 'food':
      return 'Whether this food is safe to eat cannot be told from a photo. Go by the product label, its dates and storage, and ask a food-safety authority if in doubt.';
    case 'medical':
      return 'Whether a medicine or device is safe to take or use cannot be told from a photo. Ask a pharmacist or doctor, and follow the label.';
    default:
      return 'Whether this is safe to handle or swallow cannot be told from a photo. Check the safety data sheet or label, or call a poison information centre.';
  }
}

/** Does any sentence containing a match for `res` also carry a negating word? */
function matchesWithoutNegation(text: string, res: RegExp[]): boolean {
  const sentences = text.split(/(?<=[.!?;])\s+/);
  return sentences.some((s) => res.some((re) => re.test(s)) && !NEGATING.test(s));
}

export function guardKind(text: string, category: Category, hazards: Hazard[]): GuardKind | null {
  const consumptionCategory = ['plant', 'fungus', 'food', 'medical', 'chemical', 'animal'].includes(category);
  if (consumptionCategory) {
    // Packaged, labelled food is quoting a label, not identifying something wild.
    const labelled = category === 'food' && /\b(label|labell?ed|packaging|according to the (label|package)|best before|use by)\b/i.test(text);
    if (!labelled) {
      if (matchesWithoutNegation(text, CONSUMPTION_ASSURANCE)) return 'consume';
      if (HAZARD_DENIAL.some((re) => re.test(text))) return 'consume';
    }
  }
  if (category === 'medical' && DOSE_PATTERN.test(text)) return 'dose';
  const hazardous = hazards.some((h) => ['electrical', 'gas', 'pressure', 'fire', 'chemical', 'vehicle'].includes(h));
  if (hazardous || ['electronics', 'vehicle', 'chemical'].includes(category)) {
    if (matchesWithoutNegation(text, OPERATION_ASSURANCE)) return 'operate';
  }
  return null;
}

// ---------------------------------------------------------------------------
// The firewall
// ---------------------------------------------------------------------------

const DAY = 24 * 60 * 60 * 1000;

function plusDays(iso: string, days: number): string {
  const t = Date.parse(iso);
  return new Date((Number.isFinite(t) ? t : Date.now()) + days * DAY).toISOString();
}

const normKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function runFirewall(input: FirewallInput): FirewallResult {
  const regionIds = new Set(input.regions.map((r) => r.id));
  const sourceById = new Map(input.sources.map((s) => [s.id, s]));
  const report: FirewallReport = {
    checked: 0,
    downgraded: 0,
    dropped: 0,
    guarded: 0,
    citationsClaimed: 0,
    citationsVerified: 0,
    notes: [],
  };
  const note = (s: string) => {
    if (report.notes.length < 40) report.notes.push(s);
  };

  const out: Finding[] = [];

  for (const original of input.findings) {
    report.checked++;
    const f: Finding = {
      ...original,
      verification: { status: 'unverified', notes: [] },
      flags: [...original.flags],
    };
    const vnote = (s: string) => {
      if (f.verification.notes.length < 8) f.verification.notes.push(s);
    };

    // 0. Sanitize
    f.text = sanitizeText(f.text, 700);
    if (!f.text) {
      report.dropped++;
      note(`Dropped ${original.id}: empty after sanitising.`);
      continue;
    }
    f.quote = f.quote ? sanitizeText(f.quote, 500) || null : null;
    if (f.note) f.note = sanitizeText(f.note, 600) || null;

    // People's own notes bypass the evidence checks. They are labelled "Yours" and never graded.
    if (f.origin === 'user' || f.basis === 'user') {
      f.basis = 'user';
      f.confidence = null;
      f.verification = { status: 'not_applicable', notes: ['Added by you. Not checked.'] };
      out.push(f);
      continue;
    }

    // 1. Remove phantom ids
    const keptRegions = [...new Set(f.regionIds)].filter((id) => regionIds.has(id)).slice(0, 8);
    if (keptRegions.length !== f.regionIds.length) {
      vnote('Removed a reference to a region that does not exist.');
      note(`${f.id}: removed unknown region id.`);
    }
    f.regionIds = keptRegions;

    const keptSources = [...new Set(f.sourceIds)].filter((id) => sourceById.has(id)).slice(0, 8);
    if (keptSources.length !== f.sourceIds.length) {
      vnote('Removed a reference to a source that was never retrieved.');
      note(`${f.id}: removed unknown source id.`);
    }
    f.sourceIds = keptSources;

    // 2. Safety guards run before grading: the text itself may need replacing.
    const guard = guardKind(f.text, input.category, input.hazards);
    if (guard) {
      f.text = guardText(guard, input.category);
      f.basis = 'unknown';
      f.confidence = null;
      f.quote = null;
      f.verification = { status: 'guarded', notes: ['Replaced: an assurance like this cannot be made from a photo.'] };
      f.flags = [...new Set([...f.flags, 'safety-guard', 'high_stakes'])];
      report.guarded++;
      note(`${f.id}: replaced an unsafe assurance (${guard}).`);
      out.push(f);
      continue;
    }

    const highStakes =
      f.flags.includes('high_stakes') ||
      (f.section === 'safety' &&
        (HIGH_STAKES_CATEGORIES.includes(input.category) || input.hazards.some((h) => HIGH_STAKES_HAZARDS.includes(h))));
    if (highStakes && !f.flags.includes('high_stakes')) f.flags.push('high_stakes');

    // 3. Grade by basis
    const downgrade = (to: Basis, why: string) => {
      vnote(why);
      note(`${f.id}: ${BASIS_INFO[f.basis].label} to ${BASIS_INFO[to].label}. ${why}`);
      f.basis = to;
      f.verification.status = 'downgraded';
      report.downgraded++;
    };
    const fallbackBasis = (): Basis => ((f.confidence ?? 0.5) >= 0.6 ? 'inferred' : 'hypothesis');

    if (f.basis === 'observed') {
      f.verification.status = f.regionIds.length ? 'pinned' : 'unpinned';
      if (!f.regionIds.length) vnote('Seen in the photo, but not pinned to an outlined region.');
      f.sourceIds = []; // an observation is about the picture; sources belong to cited claims
    } else if (f.basis === 'sourced') {
      report.citationsClaimed++;
      const cited = f.sourceIds.map((id) => sourceById.get(id)!).filter(Boolean);
      if (!cited.length) {
        downgrade(fallbackBasis(), 'Cited with no valid source, so it is treated as reasoning.');
        f.quote = null;
      } else {
        const toolOnly = cited.every((s) => s.kind === 'search');
        const matched = f.quote ? cited.find((s) => quoteSupported(f.quote, s.snippet)) : undefined;
        if (matched) {
          f.verification.status = 'verified';
          vnote(`Quote found in "${matched.title}".`);
          report.citationsVerified++;
        } else if (toolOnly) {
          f.verification.status = 'tool_cited';
          vnote('Citation supplied by the search tool. The passage was not independently checked against the page.');
        } else if (!f.quote) {
          downgrade(fallbackBasis(), 'Cited without a quote, so the claim could not be checked against the source.');
        } else {
          downgrade(fallbackBasis(), 'The quoted words were not found in the cited source.');
          f.quote = null;
        }
        // Safety-critical claims need an authoritative source.
        if (f.basis === 'sourced' && highStakes) {
          const authoritative = cited.some((s) => s.tier <= 3);
          if (!authoritative) {
            downgrade('inferred', 'Safety-critical claims need an authoritative source (tier 1 to 3). Only community or general sources were found.');
            f.flags = [...new Set([...f.flags, 'needs_authoritative_source'])];
          }
        }
      }
    } else if (f.basis === 'inferred' || f.basis === 'hypothesis') {
      f.verification.status = 'not_applicable';
      f.regionIds = f.regionIds.slice(0, 4);
    } else if (f.basis === 'unknown') {
      f.verification.status = 'not_applicable';
      f.confidence = null;
      f.quote = null;
    }

    // Quotes mean nothing on non-sourced findings.
    if (f.basis !== 'sourced') f.quote = null;

    // 4. Confidence caps
    if (f.confidence != null) {
      const cap = BASIS_CONFIDENCE_CAP[f.basis];
      f.confidence = cap == null ? null : round2(Math.min(clamp01(f.confidence), cap));
    }

    // 5. Time-sensitive findings
    if (f.section === 'live' || f.flags.includes('time-sensitive')) {
      f.recheckAfter = f.recheckAfter ?? plusDays(input.now, f.section === 'live' ? 7 : 30);
      if (f.basis !== 'sourced') {
        // A live value nobody retrieved is not a live value.
        report.dropped++;
        note(`Dropped ${f.id}: a live value needs a retrieved source.`);
        continue;
      }
    }

    out.push(f);
  }

  // 6. Merge near-duplicates, keeping the better-evidenced one.
  const seen = new Map<string, number>();
  const final: Finding[] = [];
  for (const f of out) {
    const key = `${f.section}:${normKey(f.text)}`;
    const at = seen.get(key);
    if (at == null) {
      seen.set(key, final.length);
      final.push(f);
    } else {
      const prev = final[at]!;
      if (BASIS_INFO[f.basis].rank < BASIS_INFO[prev.basis].rank) final[at] = f;
      report.dropped++;
      note(`Merged a duplicate of ${prev.id}.`);
    }
  }

  return { findings: final, report };
}

/** Share of Cited claims whose quotes were found in the retrieved text. 1 when nothing was cited. */
export function citationPrecision(r: FirewallReport): number {
  return r.citationsClaimed === 0 ? 1 : r.citationsVerified / r.citationsClaimed;
}
