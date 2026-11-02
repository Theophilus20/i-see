/**
 * What each model is known to do, and how we know it.
 *
 * Built from Meta's documentation ("documented"), then upgraded to "probed" or
 * "failed" by `npm run models:probe`, which sends a tiny real request per role.
 * The app never assumes a capability that is not in this table.
 */
import { readFileSync } from 'node:fs';
import type { ModelCapability } from '../src/shared/tasks';
import { sparkModel, type Config } from './config';

export function documentedCapabilities(cfg: Config): ModelCapability[] {
  const metaOn = !!cfg.meta.apiKey;
  const m = cfg.meta.models;
  const tier = cfg.privacyTier;
  const list: ModelCapability[] = [
    {
      role: 'identify',
      model: sparkModel(cfg, tier),
      provider: 'Meta Model API',
      hosting: 'meta-model-api',
      available: metaOn,
      verified: 'documented',
      inputs: ['text', 'image'],
      outputs: ['json_schema'],
      dataUse: tier === 'contributor' ? 'used-to-improve' : 'not-used-to-improve',
      notes: 'Muse Spark on Chat Completions with json_schema structured output and reasoning_effort. Also writes the profile, answers questions and compares objects.',
    },
    {
      role: 'compose',
      model: sparkModel(cfg, tier),
      provider: 'Meta Model API',
      hosting: 'meta-model-api',
      available: metaOn,
      verified: 'documented',
      inputs: ['text', 'image'],
      outputs: ['json_schema'],
      dataUse: tier === 'contributor' ? 'used-to-improve' : 'not-used-to-improve',
      notes: 'Two parallel calls: findings and parts; timeline, safety, related and what-if.',
    },
    {
      role: 'search',
      model: sparkModel(cfg, tier),
      provider: 'Meta Model API',
      hosting: 'meta-model-api',
      available: metaOn && cfg.searchGrounding,
      verified: 'documented',
      inputs: ['text'],
      outputs: ['text', 'url_citation'],
      dataUse: tier === 'contributor' ? 'used-to-improve' : 'not-used-to-improve',
      notes: 'Responses API web_search tool. Only the search queries are sent, never the photo. The model may choose not to search.',
    },
    {
      role: 'resolve',
      model: m.wonder,
      provider: 'Meta Model API',
      hosting: 'meta-model-api',
      available: metaOn,
      verified: 'documented',
      inputs: ['text'],
      outputs: ['json_schema'],
      dataUse: 'unknown',
      notes: 'Muse Wonder on the Responses API with high reasoning effort. Called only when candidates are close; receives text only, never the photo. Image input is not documented, so none is sent.',
    },
    {
      role: 'segment',
      model: m.sam,
      provider: 'Meta Model API',
      hosting: 'meta-model-api',
      available: metaOn,
      verified: 'documented',
      inputs: ['image', 'noun phrase', 'box', 'points'],
      outputs: ['masks', 'boxes', 'confidence'],
      dataUse: 'unknown',
      notes: 'SAM 3.1 streamed over the Responses API, parsed with @meta-sam/parser. One request per noun phrase returns every matching instance.',
    },
    {
      role: 'illustrate',
      model: m.image,
      provider: 'Meta Model API',
      hosting: 'meta-model-api',
      available: metaOn,
      verified: 'documented',
      inputs: ['text', 'image'],
      outputs: ['image'],
      dataUse: 'unknown',
      notes: 'Muse Image with store:false. Draws what is inside the person\'s object from their photo (sent only with their consent) and public-domain reference pictures. Always shown labelled as a drawing.',
    },
    {
      role: 'transcribe',
      model: m.asr,
      provider: 'Meta Model API',
      hosting: 'meta-model-api',
      available: metaOn,
      verified: 'documented',
      inputs: ['audio/wav (mono 16-bit PCM, 16 or 24 kHz, up to 10 min)'],
      outputs: ['text'],
      dataUse: 'unknown',
      notes: 'POST /asr/transcribe, PUSH_TO_TALK mode, keywords bias recognition toward part names from the profile.',
    },
  ];
  if (cfg.openWeight) {
    list.push({
      role: 'second-opinion',
      model: cfg.openWeight.model,
      provider: cfg.openWeight.baseUrl,
      hosting: 'open-weight',
      available: true,
      verified: 'unverified',
      inputs: cfg.openWeight.vision ? ['text', 'image'] : ['text'],
      outputs: [cfg.openWeight.jsonSchema ? 'json_schema' : 'json (prompted, validated)'],
      dataUse: /localhost|127\.0\.0\.1|\.internal|\.local/.test(cfg.openWeight.baseUrl) ? 'self-hosted' : 'unknown',
      notes: 'Muse Spark Open (open weights). Runs the private route and gives the independent second opinion on the consensus route. Data use depends on the host you chose.',
    });
  }
  if (cfg.local) {
    list.push({
      role: 'local-triage',
      model: cfg.local.model,
      provider: cfg.local.baseUrl,
      hosting: 'open-weight',
      available: true,
      verified: 'unverified',
      inputs: cfg.local.vision ? ['text', 'image'] : ['text'],
      outputs: [cfg.local.jsonSchema ? 'json_schema' : 'json (prompted, validated)'],
      dataUse: 'self-hosted',
      notes: 'Muse Glimmer (30B, Apache 2.0). First pass on the local-first route; nothing leaves your machine unless you approve an escalation.',
    });
  }
  return list;
}

export type ProbeRecord = { role: ModelCapability['role']; model: string; ok: boolean; note: string | null; at: string };

/** Merge saved probe results (PROBE_RESULTS file written by `npm run models:probe -- --save`). */
export function applyProbes(list: ModelCapability[], probes: ProbeRecord[]): ModelCapability[] {
  return list.map((c) => {
    const p = probes.find((x) => x.role === c.role && x.model === c.model);
    if (!p) return c;
    return { ...c, verified: p.ok ? 'probed' : 'failed', notes: p.note ? `${c.notes ?? ''} Probe ${p.at.slice(0, 10)}: ${p.note}`.trim() : c.notes };
  });
}

export function loadCapabilities(cfg: Config, probeFile = process.env.PROBE_RESULTS): ModelCapability[] {
  const docs = documentedCapabilities(cfg);
  if (!probeFile) return docs;
  try {
    return applyProbes(docs, JSON.parse(readFileSync(probeFile, 'utf8')) as ProbeRecord[]);
  } catch {
    return docs;
  }
}
