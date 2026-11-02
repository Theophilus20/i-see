import { describe, expect, it } from 'vitest';
import { applyDecision, candidatesFrom, cleanDisplayName } from '../../src/shared/assemble';

describe('one clear name', () => {
  it('takes hedges and second names out of the display name', () => {
    expect(cleanDisplayName('Domestic fancy rat (mouse not ruled out)')).toBe('Domestic fancy rat');
    expect(cleanDisplayName('Brass pipe adapter, 1/2" (thread type unconfirmed)')).toBe('Brass pipe adapter, 1/2"');
    expect(cleanDisplayName('Fancy rat, possibly a dumbo')).toBe('Fancy rat');
    expect(cleanDisplayName('Moka pot (6-cup)')).toBe('Moka pot (6-cup)');
  });
});

describe('settling close candidates', () => {
  const cands = candidatesFrom(
    [
      { name: 'Fancy rat', category: 'animal', likelihood: 0.45, evidenceFor: ['pointed snout'], evidenceAgainst: [], missing: [] },
      { name: 'Fancy mouse', category: 'animal', likelihood: 0.4, evidenceFor: ['large ears'], evidenceAgainst: [], missing: [] },
    ],
    'animal',
  );
  it('moves a clear answer to the top with the deciding features as evidence', () => {
    const r = applyDecision(cands, {
      features: [
        { feature: 'Thick, long tail', inPhoto: 'a thick tail as long as the body', pointsTo: 'Fancy rat' },
        { feature: 'Ear size relative to head', inPhoto: 'not visible', pointsTo: 'Fancy mouse' },
      ],
      answer: 'Fancy rat',
      confidence: 0.88,
      reason: 'Thick tail and body size.',
    });
    expect(r.winner?.name).toBe('Fancy rat');
    expect(r.candidates[0]!.likelihood).toBe(0.88);
    expect(r.candidates[1]!.likelihood).toBeLessThanOrEqual(0.12);
    expect(r.candidates[0]!.evidenceFor[0]).toMatch(/Thick, long tail/);
  });
  it('changes nothing when the photo cannot tell, or the answer is not a candidate', () => {
    expect(applyDecision(cands, { features: [], answer: 'cannot tell', confidence: 0.3, reason: '' }).winner).toBeNull();
    expect(applyDecision(cands, { features: [], answer: 'Hamster', confidence: 0.9, reason: '' }).winner).toBeNull();
    expect(applyDecision(cands, { features: [], answer: 'Fancy mouse', confidence: 0.4, reason: '' }).winner).toBeNull();
  });
});

import { cleanSummary } from '../../src/shared/assemble';
describe('a summary that reads like a museum label', () => {
  it('leaves out talk about confidence and warnings', () => {
    expect(
      cleanSummary(
        'The plant is a fancy-leaved caladium, grown for its heart-shaped pink leaves. Confidence is high at species level but the exact cultivar cannot be told from one leaf. Do not eat or handle it as food; identity alone does not prove safety.',
      ),
    ).toBe('The plant is a fancy-leaved caladium, grown for its heart-shaped pink leaves.');
    expect(cleanSummary('Confidence is high.')).toBe('Confidence is high.');
  });
});
