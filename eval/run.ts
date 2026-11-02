/**
 * Evaluation harness.
 *
 *   npm run eval -- --samples                  offline: the two sample runs (checks the harness, not a model)
 *   npm run eval -- eval/cases.json            live: needs MODEL_API_KEY; runs each photo through the real gateway
 *   npm run eval -- eval/cases.json --route consensus --out eval/report.json
 *
 * Reports top-1 and top-3 accuracy, honest doubt on ambiguous photos, calibration
 * (ECE), citation precision, the share of claims the firewall had to downgrade or
 * drop, safety guards, latency and cost.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { ScanEvent, ScanRequest } from '../src/shared/api';
import type { Profile, Route } from '../src/shared/schema';
import { runScan } from '../src/shared/orchestrator';
import { moka } from '../fixtures/samples/moka';
import { fitting } from '../fixtures/samples/fitting';
import { sampleRetriever, sampleTasks } from '../fixtures/samples/tasks';
import { scoreCase, summarize, type CaseResult, type EvalCase } from './metrics';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const route = (flag('--route') ?? 'hosted') as Route;
const out = flag('--out');

function request(base64: string, width: number, height: number): ScanRequest {
  return {
    taught: [],
    views: [{ mime: 'image/jpeg', base64, width, height, label: null }],
    hint: null,
    route,
    depth: 'deep',
    language: 'en',
    privacyTier: 'private',
    prior: null,
    clientQuality: null,
    consent: { sendImages: true, acknowledgedAt: new Date().toISOString() },
  };
}

async function samples(): Promise<CaseResult[]> {
  const cases: Array<[EvalCase, typeof moka]> = [
    [{ id: 'moka', image: '', expect: ['moka pot'] }, moka],
    [{ id: 'fitting', image: '', expect: ['npt', 'bsp'], ambiguous: true }, fitting],
  ];
  const results: CaseResult[] = [];
  for (const [c, spec] of cases) {
    const tasks = sampleTasks(spec, [], { speed: 0 });
    const t0 = Date.now();
    const p = await runScan(request('c2FtcGxl', 1200, 900), { tasks, secondary: tasks, retriever: sampleRetriever(spec, { speed: 0 }), emit: () => {}, mode: 'sample' });
    results.push(scoreCase(c, p!, Date.now() - t0));
  }
  return results;
}

async function live(casesPath: string): Promise<CaseResult[]> {
  const { createApp } = await import('../server/app');
  const { loadConfig } = await import('../server/config');
  const sharp = (await import('sharp')).default;
  const cfg = loadConfig();
  const { app, health, jobs } = createApp({ cfg });
  if (health().mode !== 'live') throw new Error('No model provider configured. Set MODEL_API_KEY (see .env.example).');
  const cases = JSON.parse(readFileSync(casesPath, 'utf8')) as EvalCase[];
  const results: CaseResult[] = [];
  for (const c of cases) {
    const file = resolve(dirname(casesPath), c.image);
    const img = sharp(readFileSync(file)).rotate().resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 });
    const { data, info } = await img.toBuffer({ resolveWithObject: true });
    const t0 = Date.now();
    const res = await app.fetch(new Request('http://eval/api/v1/scans', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request(data.toString('base64'), info.width, info.height)) }));
    if (!res.ok) throw new Error(`${c.id}: ${res.status} ${await res.text()}`);
    const { jobId } = (await res.json()) as { jobId: string };
    const ev = await app.fetch(new Request(`http://eval/api/v1/jobs/${jobId}/events`));
    const text = await ev.text();
    const events = text
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => JSON.parse(l.slice(5)) as ScanEvent);
    const prof = events.find((e): e is Extract<ScanEvent, { type: 'profile' }> => e.type === 'profile')?.profile as Profile | undefined;
    if (!prof) {
      console.error(`${c.id}: no profile (${events.filter((e) => e.type === 'error').map((e) => (e as { message: string }).message).join('; ')})`);
      continue;
    }
    const r = scoreCase(c, prof, Date.now() - t0);
    results.push(r);
    console.log(`${c.id.padEnd(24)} top1=${r.top1 ? 'yes' : 'no '} top3=${r.top3 ? 'yes' : 'no '} conf=${r.confidence.toFixed(2)} cites=${r.verified}/${r.claimed} ${Math.round(r.ms / 1000)}s`);
  }
  jobs.close();
  return results;
}

const pct = (x: number | null) => (x == null ? 'n/a' : `${Math.round(x * 100)}%`);

(async () => {
  const casesPath = args.find((a) => !a.startsWith('--') && a !== flag('--route') && a !== flag('--out'));
  const results = args.includes('--samples') || !casesPath ? await samples() : await live(casesPath);
  const s = summarize(results);
  console.log('\nI SEE evaluation' + (args.includes('--samples') || !casesPath ? ' (sample runs: checks the harness and the firewall, not a model)' : ` (${route})`));
  console.table({
    cases: s.cases,
    'top-1': pct(s.top1),
    'top-3': pct(s.top3),
    'honest doubt on ambiguous photos': pct(s.honestDoubt),
    'calibration error (ECE, lower is better)': s.ece.toFixed(3),
    'citation precision': pct(s.citationPrecision),
    'claims downgraded or dropped': pct(s.unsupportedRate),
    'safety guards': s.guarded,
    'median latency': `${(s.medianMs / 1000).toFixed(1)} s`,
    cost: s.costUsd == null ? 'n/a' : `$${s.costUsd.toFixed(4)}`,
  });
  if (out) writeFileSync(out, JSON.stringify({ summary: s, results }, null, 2));
})().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
