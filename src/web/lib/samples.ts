/**
 * Examples people can open without an account or a key.
 *
 *  - Recorded examples: real live runs on real photos, saved with `npm run sample:capture`
 *    and replayed. The output is genuine; it is labelled as recorded, with its date.
 *  - Built-in samples: hand-authored walkthroughs on rendered photos, labelled
 *    "Sample run". They exist so the app works before anything has been recorded.
 */
import type { Basis } from '@shared/epistemics';
import type { ScanEvent } from '@shared/api';
import type { Profile, Region } from '@shared/schema';
import mokaPhoto from '@fixtures/specimens/moka-pot/photo.jpg';
import fittingPhoto from '@fixtures/specimens/brass-fitting/photo.jpg';
import mokaMasks from '@fixtures/specimens/moka-pot/masks.json';
import fittingMasks from '@fixtures/specimens/brass-fitting/masks.json';
import { moka } from '@fixtures/samples/moka';
import { fitting } from '@fixtures/samples/fitting';
import { regionsFromMasks } from '@fixtures/samples/tasks';
import type { MaskEntry, SampleSpec } from '@fixtures/samples/types';

export interface Sample {
  spec: SampleSpec;
  photo: string;
  masks: MaskEntry[];
  width: number;
  height: number;
}

export const SAMPLES: Sample[] = [
  { spec: moka, photo: mokaPhoto, masks: mokaMasks as MaskEntry[], width: 1200, height: 900 },
  { spec: fitting, photo: fittingPhoto, masks: fittingMasks as MaskEntry[], width: 1200, height: 900 },
];

export const sampleById = (id: string): Sample | undefined => SAMPLES.find((s) => s.spec.id === id);

/** The built-in sample a profile came from, if it was a sample run. */
export function sampleForProfile(p: { displayName: string; trace: { mode: string } }): Sample | undefined {
  if (p.trace.mode !== 'sample') return undefined;
  return SAMPLES.find((s) => s.spec.core.displayName === p.displayName);
}

// ---------------------------------------------------------------------------
// Recorded examples (fixtures/recorded/<id>/{meta.json, photo.jpg, events.json})
// ---------------------------------------------------------------------------

export interface RecordedMeta {
  id: string;
  title: string;
  blurb: string;
  recordedAt: string;
  route: string;
  width: number;
  height: number;
}
export interface RecordedEvent {
  /** Milliseconds after the scan started. */
  t: number;
  e: ScanEvent;
}

const metas = import.meta.glob<RecordedMeta>('../../../fixtures/recorded/*/meta.json', { eager: true, import: 'default' });
const photos = import.meta.glob<string>('../../../fixtures/recorded/*/photo.jpg', { eager: true, query: '?url', import: 'default' });
const eventFiles = import.meta.glob<RecordedEvent[]>('../../../fixtures/recorded/*/events.json', { eager: true, import: 'default' });
const cutawayFiles = import.meta.glob<RecordedCutaway>('../../../fixtures/recorded/*/cutaway.json', { eager: true, import: 'default' });
const cutaways = import.meta.glob<string>('../../../fixtures/recorded/*/cutaway.{png,jpg,webp}', { eager: true, query: '?url', import: 'default' });

const dirOf = (path: string) => path.replace(/\/[^/]+$/, '');

export interface Recorded {
  meta: RecordedMeta;
  photo: string;
  events: RecordedEvent[];
  profile: Profile;
  /** The cutaway drawing made when the example was recorded, if any. */
  cutaway: string | null;
  /** Its labels and check, when recorded with them. */
  cutawayData: RecordedCutaway | null;
}
export type RecordedCutaway = { width: number; height: number; regions: Region[]; review: import('@shared/api').CutawayResponse['review']; labels?: import('@shared/api').CutawayResponse['labels'] };

export const RECORDED: Recorded[] = Object.entries(metas)
  .map(([path, meta]) => {
    const dir = dirOf(path);
    const events = eventFiles[`${dir}/events.json`] ?? [];
    const photo = photos[`${dir}/photo.jpg`];
    const prof = events.find((x) => x.e.type === 'profile')?.e as Extract<ScanEvent, { type: 'profile' }> | undefined;
    if (!photo || !prof) return null;
    const cut = Object.entries(cutaways).find(([k]) => k.startsWith(`${dir}/cutaway.`))?.[1] ?? null;
    return { meta, photo, events, profile: prof.profile, cutaway: cut, cutawayData: cutawayFiles[`${dir}/cutaway.json`] ?? null };
  })
  .filter((x): x is Recorded => !!x)
  .sort((a, b) => a.meta.title.localeCompare(b.meta.title));

export const recordedById = (id: string) => RECORDED.find((r) => r.meta.id === id);
export const recordedForProfile = (p: { id: string; trace: { mode: string } }) => (p.trace.mode === 'recorded' ? RECORDED.find((r) => r.profile.id === p.id) : undefined);

// ---------------------------------------------------------------------------
// One list for the interface
// ---------------------------------------------------------------------------

export interface Example {
  id: string;
  kind: 'recorded' | 'sample';
  title: string;
  blurb: string;
  photo: string;
  width: number;
  height: number;
  regions: Region[];
  /** Findings that point at regions, for annotations. */
  pinned: Array<{ text: string; basis: Basis; regionIds: string[] }>;
  candidates: Array<{ name: string; likelihood: number; out: boolean }>;
  nextShot: { instruction: string; why: string } | null;
  status: 'identified' | 'candidates' | 'unknown';
}

function fromSample(s: Sample): Example {
  return {
    id: s.spec.id,
    kind: 'sample',
    title: s.spec.title,
    blurb: s.spec.blurb,
    photo: s.photo,
    width: s.width,
    height: s.height,
    regions: regionsFromMasks(s.spec, s.masks),
    pinned: s.spec.core.findings.map((f) => ({ text: f.text, basis: f.basis, regionIds: f.regionIds })),
    candidates: (s.spec.resolve?.ranking ?? s.spec.identify.candidates.map((c) => ({ candidateName: c.name, likelihood: c.likelihood }))).map((c) => ({
      name: c.candidateName,
      likelihood: c.likelihood,
      out: c.likelihood < 0.05,
    })),
    nextShot: s.spec.resolve?.nextShot ? { instruction: s.spec.resolve.nextShot.instruction, why: s.spec.resolve.nextShot.why } : null,
    status: s.spec.core.identityStatus,
  };
}

function fromRecorded(r: Recorded): Example {
  const p = r.profile;
  return {
    id: r.meta.id,
    kind: 'recorded',
    title: r.meta.title,
    blurb: r.meta.blurb,
    photo: r.photo,
    width: p.views[0]?.width ?? r.meta.width,
    height: p.views[0]?.height ?? r.meta.height,
    regions: p.regions.filter((x) => x.view === 0),
    pinned: p.findings.map((f) => ({ text: f.text, basis: f.basis, regionIds: f.regionIds })),
    candidates: p.candidates.map((c) => ({ name: c.name, likelihood: c.likelihood, out: c.eliminated })),
    nextShot: p.nextShot ? { instruction: p.nextShot.instruction, why: p.nextShot.why } : null,
    status: p.identity.status,
  };
}

/** Recorded examples first: they are real. Built-in samples fill in until enough are recorded. */
export const EXAMPLES: Example[] = [...RECORDED.map(fromRecorded), ...SAMPLES.map(fromSample)];
export const exampleById = (id: string) => EXAMPLES.find((e) => e.id === id);

/** The example that best shows doubt being handled: several live candidates and a next shot. */
export function doubtExample(): Example | undefined {
  return EXAMPLES.find((e) => e.nextShot && e.candidates.filter((c) => !c.out).length > 1) ?? EXAMPLES.find((e) => e.candidates.length > 1);
}

export interface Callout {
  region: Region;
  title: string;
  text: string;
  basis: Basis;
}

/** Up to `n` annotations for a photo: one per region, preferring the best-evidenced finding. */
export function calloutsFor(ex: Example, n = 3): Callout[] {
  const rank: Record<Basis, number> = { sourced: 0, observed: 1, inferred: 2, hypothesis: 3, unknown: 4, user: 5 };
  const out: Callout[] = [];
  const used = new Set<string>();
  const findings = [...ex.pinned].filter((f) => f.regionIds.length && f.basis !== 'unknown').sort((a, b) => rank[a.basis] - rank[b.basis]);
  // Prefer small parts (more interesting than "the whole object").
  const regions = [...ex.regions].sort((a, b) => a.area - b.area);
  for (const r of regions) {
    if (out.length >= n) break;
    const f = findings.find((x) => x.regionIds.includes(r.id) && x.regionIds.length <= 2);
    if (!f || used.has(f.text)) continue;
    used.add(f.text);
    const title = r.label.charAt(0).toUpperCase() + r.label.slice(1);
    out.push({ region: r, title, text: f.text.length > 96 ? `${f.text.slice(0, 94).trimEnd()}…` : f.text, basis: f.basis });
  }
  return out;
}
