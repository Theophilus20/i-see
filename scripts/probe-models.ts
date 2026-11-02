/**
 * Live capability probe: one tiny real request per role, then a matrix.
 *
 *   npm run models:probe                 # text, vision, Wonder, SAM, search, voice, open-weight
 *   npm run models:probe -- --with-image # also Muse Image (costs about $0.01)
 *   npm run models:probe -- --save probe.json   # then set PROBE_RESULTS=probe.json for the server
 *
 * Needs MODEL_API_KEY (and optional open-weight endpoints) in .env. Never run in CI with real keys
 * unless you mean to spend a few cents.
 */
import { writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { z } from 'zod';
import type { ModelCapability } from '../src/shared/tasks';
import { documentedCapabilities, type ProbeRecord } from '../server/capabilities';
import { loadConfig, sparkModel } from '../server/config';
import { HttpClient } from '../server/meta/http';
import { MetaTasks } from '../server/meta/tasks';
import { OpenWeightTasks } from '../server/openweight/tasks';
import { samSegment } from '../server/meta/sam';
import { chatStructured, responsesStructured } from '../server/meta/structured';
import { groundedSearch } from '../server/retrieval/search';

const args = process.argv.slice(2);
const withImage = args.includes('--with-image');
const saveAt = args.includes('--save') ? args[args.indexOf('--save') + 1] : null;

const cfg = loadConfig();
const records: ProbeRecord[] = [];
const now = new Date().toISOString();
const Ok = z.object({ ok: z.boolean(), colour: z.string() });

async function probe(role: ModelCapability['role'], model: string, fn: () => Promise<string | null>): Promise<void> {
  const t0 = Date.now();
  try {
    const note = await fn();
    records.push({ role, model, ok: true, note: note ? `${note} (${Date.now() - t0} ms)` : `${Date.now() - t0} ms`, at: now });
  } catch (e) {
    records.push({ role, model, ok: false, note: String((e as Error).message).slice(0, 160), at: now });
  }
}

async function main(): Promise<void> {
  const square = await sharp({ create: { width: 256, height: 256, channels: 3, background: '#ffffff' } })
    .composite([{ input: await sharp({ create: { width: 120, height: 120, channels: 3, background: '#0064e0' } }).png().toBuffer(), left: 68, top: 68 }])
    .jpeg()
    .toBuffer();
  const view = { mime: 'image/jpeg', base64: square.toString('base64'), width: 256, height: 256, label: null };

  if (cfg.meta.apiKey) {
    const meta = MetaTasks.create(cfg);
    const client = meta.client;
    const spark = sparkModel(cfg, cfg.privacyTier);
    await probe('identify', spark, async () => {
      const r = await chatStructured({ client, model: spark, schema: Ok, name: 'probe', system: 'Answer about the image.', user: 'Set ok true and name the colour of the square.', images: [view], mode: 'json_schema', instructionRole: 'developer', reasoningEffort: 'minimal' });
      return `vision + json_schema: "${r.value.colour}"`;
    });
    await probe('resolve', cfg.meta.models.wonder, async () => {
      const r = await responsesStructured({ client, model: cfg.meta.models.wonder, schema: Ok, name: 'probe', system: 'Reply in JSON.', user: 'Set ok true and colour "blue".', reasoningEffort: 'low' });
      return `text.format json_schema: ${r.value.ok}`;
    });
    await probe('segment', cfg.meta.models.sam, async () => {
      const r = await samSegment(client, { view, viewIndex: 0, concepts: ['blue square'] }, { model: cfg.meta.models.sam });
      return `${r.regions.length} mask(s), area ${r.regions[0]?.area.toFixed(3) ?? '0'}`;
    });
    await probe('search', spark, async () => {
      const r = await groundedSearch(client, spark, ['moka pot inventor'], undefined);
      return `searched=${r.searched}, ${r.sources.length} cited source(s)`;
    });
    await probe('transcribe', cfg.meta.models.asr, async () => {
      const rate = 24000;
      const n = rate; // one second of silence
      const b = Buffer.alloc(44 + n * 2);
      b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16);
      b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
      b.write('data', 36); b.writeUInt32LE(n * 2, 40);
      const r = await meta.transcribe({ wav: new Uint8Array(b), keywords: [], languageBias: ['en'] }, { language: 'en', privacyTier: cfg.privacyTier, route: 'hosted', runId: 'probe' });
      return `duration ${r.value.durationMs ?? '?'} ms`;
    });
    if (withImage) {
      await probe('illustrate', cfg.meta.models.image, async () => {
        const r = await meta.illustrate({ digest: { id: 'p', displayName: 'teapot', category: 'consumer_product', summary: '', candidates: [], findings: [], components: [], regions: [], sources: [], openQuestions: [] } }, { language: 'en', privacyTier: cfg.privacyTier, route: 'hosted', runId: 'probe' });
        return `${r.value.mime}, ${Math.round((r.value.base64.length * 3) / 4 / 1024)} KB`;
      });
    }
  } else {
    console.log('MODEL_API_KEY is not set: skipping Meta Model API probes.');
  }

  for (const [endpoint, role] of [[cfg.openWeight, 'second-opinion'], [cfg.local, 'local-triage']] as const) {
    if (!endpoint) continue;
    const ow = OpenWeightTasks.create(endpoint, role);
    await probe(role, endpoint.model, async () => {
      const client: HttpClient = ow.client;
      const r = await chatStructured({ client, model: endpoint.model, schema: Ok, name: 'probe', system: 'Answer about the image.', user: 'Set ok true and name the colour of the square.', images: endpoint.vision ? [view] : [], mode: endpoint.jsonSchema ? 'json_schema' : 'prompt', instructionRole: 'system' });
      return `${endpoint.jsonSchema ? 'json_schema' : 'prompted JSON'}${endpoint.vision ? ' + vision' : ''}: "${r.value.colour}"`;
    });
  }

  const docs = documentedCapabilities(cfg);
  const rows = docs.map((c) => {
    const p = records.find((r) => r.role === c.role && r.model === c.model);
    return { role: c.role, model: c.model, documented: c.inputs.join('+'), probe: p ? (p.ok ? 'OK' : 'FAIL') : '—', note: p?.note ?? (c.available ? 'not probed' : 'not configured') };
  });
  console.table(rows);
  if (saveAt) {
    writeFileSync(saveAt, JSON.stringify(records, null, 2));
    console.log(`Saved ${records.length} probe results to ${saveAt}. Set PROBE_RESULTS=${saveAt} to show them in /health.`);
  }
  if (records.some((r) => !r.ok)) process.exitCode = 1;
}

void main();
