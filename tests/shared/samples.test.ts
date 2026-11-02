/**
 * Runs both sample analyses through the real orchestrator and checks that the
 * firewall, calculator and assembler treat them exactly as the samples claim.
 * Masks are synthetic here; the specimen renderer supplies real ones to the app.
 */
import { describe, expect, it } from 'vitest';
import { runScan } from '../../src/shared/orchestrator';
import type { ScanEvent, ScanRequest } from '../../src/shared/api';
import { ProfileSchema } from '../../src/shared/schema';
import { runWhatIf } from '../../src/shared/calc';
import { quoteSupported } from '../../src/shared/text';
import { moka } from '../../fixtures/samples/moka';
import { fitting } from '../../fixtures/samples/fitting';
import { sampleRetriever, sampleTasks } from '../../fixtures/samples/tasks';
import type { MaskEntry, SampleSpec } from '../../fixtures/samples/types';

const fakeMasks = (spec: SampleSpec): MaskEntry[] =>
  spec.parts.map((part, i) => ({ part, label: part, path: `M${i} 0H${i + 10}V10H${i}Z`, box: { x: i, y: 0, w: 10, h: 10 }, anchor: { x: i + 5, y: 5 }, area: 0.05 }));

const request = (route: ScanRequest['route'] = 'hosted'): ScanRequest => ({
  taught: [],
  views: [{ mime: 'image/jpeg', base64: 'A'.repeat(64), width: 1200, height: 900, label: null }],
  hint: null,
  route,
  depth: 'deep',
  language: 'en',
  privacyTier: 'private',
  prior: null,
  clientQuality: { sharpness: 240, brightness: 0.55, clipped: 0.01 },
  consent: { sendImages: true, acknowledgedAt: '2026-10-28T10:00:00Z' },
});

async function run(spec: SampleSpec, route: ScanRequest['route'] = 'hosted') {
  const events: ScanEvent[] = [];
  const tasks = sampleTasks(spec, fakeMasks(spec), { speed: 0 });
  const profile = await runScan(request(route), {
    tasks,
    secondary: tasks,
    retriever: sampleRetriever(spec, { speed: 0 }),
    emit: (e) => events.push(e),
    mode: 'sample',
    now: () => '2026-10-28T10:00:00.000Z',
  });
  return { profile: profile!, events };
}

describe('every quote in the samples is really in its source', () => {
  for (const spec of [moka, fitting]) {
    it(spec.id, () => {
      const byId = new Map(spec.sources.map((s) => [s.id, s]));
      const claims = [
        ...spec.core.findings,
        ...spec.extras.timeline,
        ...spec.extras.safety,
        ...spec.questions.flatMap((q) => q.segments),
        ...(spec.inside?.groups.flatMap((g) => g.parts) ?? []),
        ...(spec.inside?.flows ?? []),
      ].filter((c) => c.quote);
      expect(claims.length).toBeGreaterThan(0);
      for (const c of claims) {
        const ok = c.sourceIds.some((id) => quoteSupported(c.quote, byId.get(id)!.snippet));
        expect(ok, `quote not found: ${c.quote}`).toBe(true);
      }
    });
  }
});

describe('moka pot sample', () => {
  it('produces a valid, identified profile with verified citations', async () => {
    const { profile, events } = await run(moka);
    expect(ProfileSchema.safeParse(profile).success).toBe(true);
    expect(profile.identity.status).toBe('identified');
    expect(profile.trace.mode).toBe('sample');
    expect(profile.trace.firewall.citationsClaimed).toBeGreaterThan(5);
    expect(profile.trace.firewall.citationsVerified).toBe(profile.trace.firewall.citationsClaimed);
    expect(profile.trace.firewall.guarded).toBe(0);
    expect(events.at(-1)).toEqual({ type: 'done' });
    // No doubt worth resolving.
    expect(profile.trace.stages.find((s) => s.id === 'resolve')!.status).toBe('skipped');
  });

  it('keeps the heating calculation and computes a plausible time', async () => {
    const { profile } = await run(moka);
    const w = profile.whatIf.find((x) => x.kind === 'calculation')!;
    const r = runWhatIf(w);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result!.value).toBeGreaterThan(1);
    expect(r.ok && r.result!.value).toBeLessThan(10);
  });

  it('records the disagreement between its two sources', async () => {
    const { profile } = await run(moka);
    expect(profile.conflicts.length).toBe(1);
    const ids = profile.conflicts[0]!.findingIds;
    expect(ids.every((id) => profile.findings.find((f) => f.id === id)!.disputed)).toBe(true);
  });

  it('places hidden parts in the profile without claiming they were seen', async () => {
    const { profile } = await run(moka);
    const gasket = profile.components.find((c) => c.name === 'Gasket')!;
    expect(gasket.visible).toBe(false);
    expect(gasket.regionId).toBeNull();
  });

  it('adds a second opinion on the consensus route', async () => {
    const { profile } = await run(moka, 'consensus');
    expect(profile.secondOpinion?.agreement).toBe('agrees');
  });
});

describe('brass fitting sample', () => {
  it('stays unresolved, asks Muse Wonder, and proposes the deciding photo', async () => {
    const { profile } = await run(fitting);
    expect(ProfileSchema.safeParse(profile).success).toBe(true);
    expect(profile.identity.status).toBe('candidates');
    expect(profile.trace.stages.find((s) => s.id === 'resolve')!.status).toBe('done');
    expect(profile.nextShot?.capture).toBe('detail');
    expect(profile.nextShot?.separates.length).toBe(2);
    const compression = profile.candidates.find((c) => c.name.includes('compression'))!;
    expect(compression.eliminated).toBe(true);
  });

  it('downgrades the safety claim that only a specialist blog supports', async () => {
    const { profile } = await run(fitting);
    const f = profile.findings.find((x) => x.section === 'safety' && /Mismatched threads/.test(x.text))!;
    expect(f.basis).toBe('inferred');
    expect(f.flags).toContain('needs_authoritative_source');
  });

  it('replaces the unsafe gas assurance', async () => {
    const { profile } = await run(fitting);
    expect(profile.trace.firewall.guarded).toBe(1);
    expect(profile.findings.some((f) => /safe to use on a gas line/i.test(f.text))).toBe(false);
    const guarded = profile.findings.find((f) => f.verification.status === 'guarded')!;
    expect(guarded.text).toMatch(/cannot be told from a photo/);
    expect(profile.safety.find((s) => s.findingId === guarded.id)!.professionalReview).toBe(true);
  });

  it('keeps the force calculation', async () => {
    const { profile } = await run(fitting);
    const w = profile.whatIf.find((x) => x.kind === 'calculation')!;
    const r = runWhatIf(w);
    expect(r.ok && Math.round(r.result!.value)).toBe(53);
  });

  it('reports a differing second opinion honestly', async () => {
    const { profile } = await run(fitting, 'consensus');
    expect(profile.secondOpinion?.agreement).not.toBe('agrees');
  });
});

import { assembleInside } from '../../src/shared/inside';
describe('sample inside views survive the firewall intact', () => {
  for (const spec of [moka, fitting]) {
    it(spec.id, () => {
      const regions = fakeMasks(spec).map((m, i) => ({ id: `r${i + 1}`, label: m.part, kind: 'mask' as const, source: 'sample' as const, view: 0, box: m.box, path: m.path, anchor: m.anchor, area: m.area, confidence: null }));
      const inside = assembleInside({ draft: spec.inside!, regions, sources: spec.sources, category: spec.identify.primary.category, hazards: spec.identify.primary.hazards, now: '2026-10-29T10:00:00.000Z' });
      const parts = inside.groups.flatMap((g) => g.parts);
      expect(parts.length).toBe(spec.inside!.groups.flatMap((g) => g.parts).length);
      expect(inside.findings.filter((f) => f.verification.status === 'downgraded')).toEqual([]);
      expect(inside.flows.length).toBe(spec.inside!.flows.length);
    });
  }
});
