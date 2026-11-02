/** Evaluation metrics. Pure functions, so they can be tested without any model. */
import type { Profile } from '../src/shared/schema';
import { normalizeForMatch } from '../src/shared/text';

export interface EvalCase {
  id: string;
  /** Path to a photo, relative to the cases file. */
  image: string;
  /** Any of these names (case and punctuation ignored) counts as correct. */
  expect: string[];
  /** True when the honest answer is "cannot tell": the case passes if I SEE says unknown or candidates. */
  ambiguous?: boolean;
}

export interface CaseResult {
  id: string;
  top1: boolean;
  top3: boolean;
  honestDoubt: boolean | null;
  confidence: number;
  checked: number;
  claimed: number;
  verified: number;
  downgraded: number;
  dropped: number;
  guarded: number;
  ms: number;
  costUsd: number | null;
}

const matches = (name: string, expect: string[]) => {
  const n = normalizeForMatch(name);
  return expect.some((e) => n.includes(normalizeForMatch(e)));
};

export function scoreCase(c: EvalCase, p: Profile, ms: number): CaseResult {
  const live = p.candidates.filter((x) => !x.eliminated);
  const fw = p.trace.firewall;
  return {
    id: c.id,
    top1: !!live[0] && matches(live[0].name, c.expect),
    top3: live.slice(0, 3).some((x) => matches(x.name, c.expect)),
    honestDoubt: c.ambiguous ? p.identity.status !== 'identified' : null,
    confidence: live[0]?.likelihood ?? 0,
    checked: fw.checked,
    claimed: fw.citationsClaimed,
    verified: fw.citationsVerified,
    downgraded: fw.downgraded,
    dropped: fw.dropped,
    guarded: fw.guarded,
    ms,
    costUsd: p.trace.costUsd,
  };
}

/** Expected calibration error of the top candidate's likelihood against top-1 correctness. */
export function ece(results: Array<Pick<CaseResult, 'confidence' | 'top1'>>, bins = 5): number {
  if (!results.length) return 0;
  let total = 0;
  for (let b = 0; b < bins; b++) {
    const lo = b / bins;
    const hi = (b + 1) / bins;
    const inBin = results.filter((r) => r.confidence >= lo && (b === bins - 1 ? r.confidence <= hi : r.confidence < hi));
    if (!inBin.length) continue;
    const acc = inBin.filter((r) => r.top1).length / inBin.length;
    const conf = inBin.reduce((a, r) => a + r.confidence, 0) / inBin.length;
    total += (inBin.length / results.length) * Math.abs(acc - conf);
  }
  return total;
}

export interface Summary {
  cases: number;
  top1: number;
  top3: number;
  honestDoubt: number | null;
  ece: number;
  citationPrecision: number | null;
  unsupportedRate: number;
  guarded: number;
  medianMs: number;
  costUsd: number | null;
}

export function summarize(rs: CaseResult[]): Summary {
  const n = rs.length || 1;
  const claimed = rs.reduce((a, r) => a + r.claimed, 0);
  const verified = rs.reduce((a, r) => a + r.verified, 0);
  const checked = rs.reduce((a, r) => a + r.checked, 0);
  const amb = rs.filter((r) => r.honestDoubt !== null);
  const ms = rs.map((r) => r.ms).sort((a, b) => a - b);
  const costs = rs.map((r) => r.costUsd).filter((c): c is number => c != null);
  return {
    cases: rs.length,
    top1: rs.filter((r) => r.top1).length / n,
    top3: rs.filter((r) => r.top3).length / n,
    honestDoubt: amb.length ? amb.filter((r) => r.honestDoubt).length / amb.length : null,
    ece: ece(rs),
    citationPrecision: claimed ? verified / claimed : null,
    unsupportedRate: checked ? rs.reduce((a, r) => a + r.downgraded + r.dropped, 0) / checked : 0,
    guarded: rs.reduce((a, r) => a + r.guarded, 0),
    medianMs: ms[Math.floor(ms.length / 2)] ?? 0,
    costUsd: costs.length ? costs.reduce((a, b) => a + b, 0) : null,
  };
}
