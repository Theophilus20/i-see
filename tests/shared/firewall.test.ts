import { describe, expect, it } from 'vitest';
import { citationPrecision, guardKind, runFirewall } from '../../src/shared/firewall';
import type { Category, Hazard } from '../../src/shared/epistemics';
import type { Finding } from '../../src/shared/schema';
import { NOW, finding, region, src } from '../helpers';

function run(findings: Finding[], over: { category?: Category; hazards?: Hazard[]; sources?: ReturnType<typeof src>[] } = {}) {
  return runFirewall({
    findings,
    regions: [region({ id: 'r1' }), region({ id: 'r2', label: 'handle' })],
    sources: over.sources ?? [src({ id: 's1' })],
    category: over.category ?? 'consumer_product',
    hazards: over.hazards ?? [],
    now: NOW,
  });
}

describe('observed findings', () => {
  it('are pinned when they point at a region, unpinned when they do not', () => {
    const { findings } = run([finding({ id: 'a', regionIds: ['r1'] }), finding({ id: 'b', text: 'It has a handle.', regionIds: [] })]);
    expect(findings.find((f) => f.id === 'a')!.verification.status).toBe('pinned');
    expect(findings.find((f) => f.id === 'b')!.verification.status).toBe('unpinned');
  });

  it('lose references to regions that do not exist', () => {
    const { findings, report } = run([finding({ regionIds: ['r1', 'r99'] })]);
    expect(findings[0]!.regionIds).toEqual(['r1']);
    expect(findings[0]!.verification.notes.join(' ')).toMatch(/region that does not exist/);
    expect(report.notes.join(' ')).toMatch(/unknown region/);
  });

  it('never carry source ids (an observation is about the picture)', () => {
    const { findings } = run([finding({ sourceIds: ['s1'] })]);
    expect(findings[0]!.sourceIds).toEqual([]);
  });
});

describe('cited findings', () => {
  const quote = 'invented by Luigi De Ponti for Alfonso Bialetti in 1933';
  const cited = (over: Partial<Finding> = {}) =>
    finding({ id: 'c', section: 'history', text: 'It was invented in 1933.', basis: 'sourced', confidence: 0.9, regionIds: [], sourceIds: ['s1'], quote, ...over });

  it('are verified when the quote is in the retrieved text', () => {
    const { findings, report } = run([cited()]);
    expect(findings[0]!.basis).toBe('sourced');
    expect(findings[0]!.verification.status).toBe('verified');
    expect(report.citationsClaimed).toBe(1);
    expect(report.citationsVerified).toBe(1);
    expect(citationPrecision(report)).toBe(1);
  });

  it('tolerate case, punctuation and elided text in the quote', () => {
    const { findings } = run([cited({ quote: 'INVENTED by Luigi De Ponti … in 1933!' })]);
    expect(findings[0]!.verification.status).toBe('verified');
  });

  it('are downgraded when the quoted words are not in the source', () => {
    const { findings, report } = run([cited({ quote: 'was invented by Alfonso Bialetti himself on a Tuesday' })]);
    expect(findings[0]!.basis).toBe('inferred');
    expect(findings[0]!.verification.status).toBe('downgraded');
    expect(findings[0]!.quote).toBeNull();
    expect(report.downgraded).toBe(1);
    expect(report.citationsVerified).toBe(0);
    expect(citationPrecision(report)).toBe(0);
  });

  it('are downgraded to a guess when the claim was not confident to begin with', () => {
    const { findings } = run([cited({ quote: 'something the page never said at all', confidence: 0.4 })]);
    expect(findings[0]!.basis).toBe('hypothesis');
  });

  it('are downgraded when there is no quote', () => {
    const { findings } = run([cited({ quote: null })]);
    expect(findings[0]!.basis).not.toBe('sourced');
    expect(findings[0]!.verification.notes.join(' ')).toMatch(/without a quote/);
  });

  it('are downgraded when the only source id was never retrieved', () => {
    const { findings } = run([cited({ sourceIds: ['s404'] })]);
    expect(findings[0]!.basis).not.toBe('sourced');
    expect(findings[0]!.sourceIds).toEqual([]);
  });

  it('are too weak to verify when the quote is a few characters long', () => {
    const { findings } = run([cited({ quote: '1933' })]);
    expect(findings[0]!.basis).not.toBe('sourced');
  });

  it('stay cited but marked as tool-cited when only a search tool vouched for them', () => {
    const search = src({ id: 's9', kind: 'search', snippet: '', tier: 4 });
    const { findings } = run([cited({ sourceIds: ['s9'], quote: 'a passage the page text does not contain' })], { sources: [search] });
    expect(findings[0]!.basis).toBe('sourced');
    expect(findings[0]!.verification.status).toBe('tool_cited');
  });

  it('cannot rest on a community source when the claim is about safety', () => {
    const f = cited({ section: 'safety', text: 'Do not use the pot above a gas ring that is bigger than its base.', quote: 'invented by Luigi De Ponti for Alfonso Bialetti', flags: ['high_stakes'] });
    const community = src({ id: 's1', tier: 5 });
    const { findings } = run([f], { sources: [community] });
    expect(findings[0]!.basis).toBe('inferred');
    expect(findings[0]!.flags).toContain('needs_authoritative_source');
  });

  it('can rest on a tier 1 to 3 source when the claim is about safety', () => {
    const f = cited({ section: 'safety', text: 'The pot was invented in 1933.', quote: 'invented by Luigi De Ponti for Alfonso Bialetti', flags: ['high_stakes'] });
    const { findings } = run([f], { sources: [src({ id: 's1', tier: 2 })] });
    expect(findings[0]!.basis).toBe('sourced');
  });
});

describe('confidence', () => {
  it('is capped by basis so a guess can never read as strong', () => {
    const { findings } = run([
      finding({ id: 'h', text: 'Maybe a gift.', basis: 'hypothesis', confidence: 0.95, regionIds: [] }),
      finding({ id: 'i', text: 'Probably aluminium.', basis: 'inferred', confidence: 0.99, regionIds: ['r1'] }),
      finding({ id: 'o', text: 'It has a lid.', basis: 'observed', confidence: 1, regionIds: ['r1'] }),
      finding({ id: 'u', text: 'The maker is unclear.', basis: 'unknown', confidence: 0.8, regionIds: [] }),
    ]);
    const by = (id: string) => findings.find((f) => f.id === id)!;
    expect(by('h').confidence).toBe(0.6);
    expect(by('i').confidence).toBe(0.88);
    expect(by('o').confidence).toBe(0.97);
    expect(by('u').confidence).toBeNull();
  });
});

describe('safety guards', () => {
  it('replace an assurance that a wild plant is safe to eat', () => {
    const { findings, report } = run([finding({ text: 'The berries are edible and safe to eat.', basis: 'inferred', confidence: 0.8 })], { category: 'plant' });
    expect(findings[0]!.basis).toBe('unknown');
    expect(findings[0]!.verification.status).toBe('guarded');
    expect(findings[0]!.text).toMatch(/cannot be told from a photo/);
    expect(findings[0]!.text).not.toMatch(/edible/);
    expect(findings[0]!.flags).toContain('safety-guard');
    expect(report.guarded).toBe(1);
  });

  it('replace an assurance made by denying the hazard', () => {
    for (const t of ['This plant is not toxic.', 'It is completely harmless.', 'Non-toxic to pets.', 'It poses no risk to children.']) {
      expect(guardKind(t, 'plant', []), t).toBe('consume');
    }
  });

  it('leave warnings alone', () => {
    for (const t of ['Do not eat this; some lookalikes are deadly.', 'It is not safe to eat without expert identification.', 'The berries may be toxic.', 'Never taste unidentified mushrooms.']) {
      expect(guardKind(t, 'fungus', []), t).toBeNull();
    }
  });

  it('do not touch ordinary statements about a plant', () => {
    for (const t of ['A good plant to use as ground cover in shade.', 'Likely a succulent with thick leaves.', 'Grows well in partial shade.']) {
      expect(guardKind(t, 'plant', []), t).toBeNull();
    }
  });

  it('use wording that fits the category', () => {
    const { findings: pl } = run([finding({ text: 'Edible leaves.', basis: 'inferred', confidence: 0.7 })], { category: 'plant' });
    const { findings: fo } = run([finding({ text: 'Fine to eat.', basis: 'inferred', confidence: 0.7 })], { category: 'food' });
    expect(pl[0]!.text).toMatch(/extension service|botanical|mycological/);
    expect(fo[0]!.text).toMatch(/label/);
  });

  it('do not guard a quoted food label', () => {
    expect(guardKind('The label says it is fine to eat within three days of opening.', 'food', [])).toBeNull();
  });

  it('replace a dose given from a photo', () => {
    expect(guardKind('Take 500 mg twice daily with food.', 'medical', [])).toBe('dose');
    expect(guardKind('Each tablet contains 500 mg of paracetamol.', 'medical', [])).toBeNull();
  });

  it('replace an assurance that electrical or gas equipment is safe to use', () => {
    expect(guardKind('This regulator is safe to use on a propane cylinder.', 'tool', ['gas'])).toBe('operate');
    expect(guardKind('This adapter is fine to plug in.', 'electronics', [])).toBe('operate');
    expect(guardKind('It is not safe to use if the cable is frayed.', 'electronics', ['electrical'])).toBeNull();
    expect(guardKind('A sturdy chair, safe to use outdoors.', 'furniture', [])).toBeNull();
  });
});

describe('time-sensitive findings', () => {
  it('get a recheck date, and are dropped when nothing retrieved supports them', () => {
    const live = finding({ id: 'l', section: 'live', text: 'Currently listed at about 30 dollars.', basis: 'sourced', confidence: 0.8, regionIds: [], sourceIds: ['s1'], quote: 'It was invented by Luigi De Ponti' });
    const { findings } = run([live]);
    expect(findings[0]!.recheckAfter).toBe('2026-11-04T10:00:00.000Z');

    const unsupported = finding({ id: 'l2', section: 'live', text: 'There is a recall.', basis: 'inferred', confidence: 0.7, regionIds: [] });
    const r2 = run([unsupported]);
    expect(r2.findings).toEqual([]);
    expect(r2.report.dropped).toBe(1);
  });
});

describe('everything else', () => {
  it("never grades the person's own notes", () => {
    const { findings } = run([finding({ id: 'u', origin: 'user', basis: 'user', confidence: 0.99, text: 'My grandmother used this every Sunday.', regionIds: [] })]);
    expect(findings[0]!.basis).toBe('user');
    expect(findings[0]!.confidence).toBeNull();
    expect(findings[0]!.verification.status).toBe('not_applicable');
  });

  it('strips markup and control characters from model text', () => {
    const { findings } = run([finding({ text: 'It has a <b>handle</b>‮\u0007 and **a lid**.' })]);
    expect(findings[0]!.text).toBe('It has a handle and a lid.');
  });

  it('drops empty findings and merges duplicates, keeping the better-evidenced one', () => {
    const quote = 'invented by Luigi De Ponti for Alfonso Bialetti in 1933';
    const dup1 = finding({ id: 'd1', section: 'history', text: 'Invented in 1933.', basis: 'inferred', confidence: 0.7, regionIds: [] });
    const dup2 = finding({ id: 'd2', section: 'history', text: 'invented in 1933', basis: 'sourced', confidence: 0.9, regionIds: [], sourceIds: ['s1'], quote });
    const empty = finding({ id: 'e', text: '<br>' });
    const { findings, report } = run([dup1, dup2, empty]);
    expect(findings.map((f) => f.id)).toEqual(['d2']);
    expect(report.dropped).toBe(2);
  });

  it('never throws on a finding with nothing in it', () => {
    expect(() => run([finding({ text: '   ', regionIds: [], sourceIds: [], quote: '' })])).not.toThrow();
  });

  it('does not mutate its input', () => {
    const f = finding({ regionIds: ['r1', 'r99'], text: 'It has a <i>lid</i>.' });
    const copy = structuredClone(f);
    run([f]);
    expect(f).toEqual(copy);
  });
});
