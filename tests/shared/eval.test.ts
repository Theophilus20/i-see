import { describe, expect, it } from 'vitest';
import { ece, summarize, type CaseResult } from '../../eval/metrics';

const r = (over: Partial<CaseResult>): CaseResult => ({ id: 'x', top1: true, top3: true, honestDoubt: null, confidence: 0.9, checked: 10, claimed: 4, verified: 3, downgraded: 1, dropped: 1, guarded: 0, ms: 1000, costUsd: 0.01, ...over });

describe('eval metrics', () => {
  it('is zero for perfectly calibrated results', () => {
    expect(ece([{ confidence: 1, top1: true }, { confidence: 0, top1: false }])).toBe(0);
  });
  it('measures overconfidence', () => {
    expect(ece([{ confidence: 0.9, top1: false }, { confidence: 0.9, top1: false }])).toBeCloseTo(0.9, 6);
  });
  it('summarises', () => {
    const s = summarize([r({}), r({ top1: false, top3: false, honestDoubt: true })]);
    expect(s.top1).toBe(0.5);
    expect(s.citationPrecision).toBe(0.75);
    expect(s.unsupportedRate).toBe(0.2);
    expect(s.honestDoubt).toBe(1);
    expect(s.costUsd).toBeCloseTo(0.02);
  });
});
