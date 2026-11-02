/**
 * Turns a real photo into a recorded example.
 *
 *   npm run sample:capture -- photo.jpg --id desk-lamp --title "Desk lamp" --blurb "An angle-poise lamp with a dimmer"
 *   options: --route hosted|consensus|private   --hint "what you already know"   --depth quick|deep
 *
 * Runs one real live scan through the gateway with your keys from .env, and saves
 * fixtures/recorded/<id>/{photo.jpg, events.json, meta.json, cutaway.jpg, cutaway.json}. The app shows recorded
 * examples first, replays them at their real pace, and labels them "Recorded example".
 * The photo is stored in the project: only use photos you are happy to publish.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import type { ScanEvent, ScanRequest } from '../src/shared/api';
import { ScanEventSchema } from '../src/shared/api';
import type { Route } from '../src/shared/schema';
import { createApp } from '../server/app';
import { loadConfig } from '../server/config';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const flagged = new Set(['--id', '--title', '--blurb', '--route', '--hint', '--depth'].flatMap((f) => [f, flag(f)]).filter(Boolean) as string[]);
const photos = args.filter((a) => !a.startsWith('--') && !flagged.has(a));

if (!photos.length) {
  console.error('Usage: npm run sample:capture -- photo.jpg --id my-object --title "My object" [--blurb "..."] [--route hosted] [--hint "..."]');
  process.exit(1);
}
const id = (flag('--id') ?? photos[0]!.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, ''))
  .toLowerCase()
  .replace(/[^a-z0-9-]+/g, '-')
  .replace(/^-|-$/g, '');
const route = (flag('--route') ?? 'hosted') as Route;

const cfg = loadConfig();
const { app, health, jobs } = createApp({ cfg });
if (health().mode !== 'live') {
  console.error('No model provider is configured. Put MODEL_API_KEY in .env first.');
  process.exit(1);
}

const views = await Promise.all(
  photos.map(async (p, i) => {
    const img = sharp(readFileSync(resolve(p))).rotate().resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88 });
    const { data, info } = await img.toBuffer({ resolveWithObject: true });
    return { data, upload: { mime: 'image/jpeg' as const, base64: data.toString('base64'), width: info.width, height: info.height, label: i === 0 ? null : `View ${i + 1}` } };
  }),
);

const req: ScanRequest = {
  taught: [],
  views: views.map((v) => v.upload),
  hint: flag('--hint') ?? null,
  route,
  depth: (flag('--depth') as 'quick' | 'deep') ?? 'deep',
  language: 'en',
  privacyTier: cfg.privacyTier,
  prior: null,
  clientQuality: null,
  consent: { sendImages: true, acknowledgedAt: new Date().toISOString() },
};

console.log(`Examining ${photos.length} photo${photos.length > 1 ? 's' : ''} on the ${route} route…`);
const t0 = Date.now();
const res = await app.fetch(new Request('http://capture/api/v1/scans', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req) }));
if (!res.ok) {
  console.error(`The scan did not start: ${res.status} ${await res.text()}`);
  process.exit(1);
}
const { jobId } = (await res.json()) as { jobId: string };
const stream = await app.fetch(new Request(`http://capture/api/v1/jobs/${jobId}/events`));
const reader = stream.body!.getReader();
const decoder = new TextDecoder();
const recorded: Array<{ t: number; e: ScanEvent }> = [];
let buf = '';
let finished = false;
while (!finished) {
  const { value, done } = await reader.read();
  if (done) break;
  buf += decoder.decode(value, { stream: true });
  let cut: number;
  while ((cut = buf.indexOf('\n\n')) >= 0) {
    const frame = buf.slice(0, cut);
    buf = buf.slice(cut + 2);
    const data = frame
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trimStart())
      .join('\n');
    if (!data) continue;
    const parsed = ScanEventSchema.safeParse(JSON.parse(data));
    if (!parsed.success) continue;
    const e = parsed.data;
    recorded.push({ t: Date.now() - t0, e });
    if (e.type === 'stage' && e.status !== 'start') console.log(`  ${e.label}: ${e.status}${e.note ? ` (${e.note})` : ''}`);
    if (e.type === 'error') console.error(`  Error: ${e.message}`);
    if (e.type === 'done' || e.type === 'error') finished = true;
  }
}
jobs.close();

const profileEvent = recorded.find((r) => r.e.type === 'profile');
if (!profileEvent) {
  console.error('No profile was produced, so nothing was saved.');
  process.exit(1);
}
const profile = (profileEvent.e as Extract<ScanEvent, { type: 'profile' }>).profile;
const dir = join('fixtures', 'recorded', id);
mkdirSync(dir, { recursive: true });

// The inside view and the cutaway drawing, so the example shows them without a server.
const post = (path: string, body: unknown) =>
  app.fetch(new Request(`http://capture/api/v1${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
const { digestOf } = await import('../src/shared/schema');
console.log('  Working out how it works inside…');
const insideRes = await post('/inside', {
  digest: digestOf(profile),
  regions: profile.regions.map((r) => ({ ...r, path: null })),
  sources: profile.sources,
  hazards: [...new Set(profile.safety.map((s) => s.hazard))],
  route,
  language: 'en',
  privacyTier: cfg.privacyTier,
});
if (insideRes.ok) {
  const { inside } = (await insideRes.json()) as { inside: NonNullable<typeof profile.inside> };
  profile.inside = inside;
  console.log(`  Inside: ${inside.groups.reduce((n, g) => n + g.parts.length, 0)} parts, ${inside.flows.length} flows`);
  const consent = { sendImages: true, acknowledgedAt: new Date().toISOString() };
  const cutRes = await post('/cutaway', {
    digest: digestOf(profile),
    inside: { kind: inside.kind, brief: inside.brief, parts: inside.groups.flatMap((g) => g.parts.map((p) => p.name)).slice(0, 16) },
    view: views[0]!.upload,
    consent,
    privacyTier: cfg.privacyTier,
  });
  if (cutRes.ok) {
    const cut = (await cutRes.json()) as { image: { base64: string; width: number; height: number }; regions: unknown[]; review: unknown; labels: { expected: string[]; correct: string[] } | null };
    writeFileSync(join(dir, 'cutaway.jpg'), Buffer.from(cut.image.base64, 'base64'));
    writeFileSync(join(dir, 'cutaway.json'), JSON.stringify({ width: cut.image.width, height: cut.image.height, regions: cut.regions, review: cut.review, labels: cut.labels }));
    console.log(`  Cutaway saved (${cut.labels ? `${cut.labels.correct.length}/${cut.labels.expected.length} labels proofread correct` : 'no labels'})`);
  } else console.log(`  No cutaway drawing (${cutRes.status})`);
} else console.log(`  No inside view (${insideRes.status}: ${(await insideRes.text()).slice(0, 200)})`);
writeFileSync(join(dir, 'photo.jpg'), views[0]!.data);
writeFileSync(join(dir, 'events.json'), JSON.stringify(recorded));
writeFileSync(
  join(dir, 'meta.json'),
  JSON.stringify(
    {
      id,
      title: flag('--title') ?? profile.displayName,
      blurb: flag('--blurb') ?? profile.summary.split(/(?<=\.)\s/)[0],
      recordedAt: new Date().toISOString(),
      route,
      width: views[0]!.upload.width,
      height: views[0]!.upload.height,
    },
    null,
    2,
  ),
);
const fw = profile.trace.firewall;
console.log(`\nSaved ${dir}`);
console.log(`  ${profile.displayName} · ${profile.identity.status} · ${profile.regions.length} outlines · ${profile.sources.length} sources · ${fw.citationsVerified}/${fw.citationsClaimed} quotes checked · ${Math.round((Date.now() - t0) / 1000)} s`);
console.log('Restart `npm run dev` (or rebuild) to see it under Examples.');
