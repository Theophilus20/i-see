import { describe, expect, it } from 'vitest';
import { closestModels, listModels } from '../../server/meta/models';
import { failureKind } from '../../src/shared/orchestrator';

const DEFAULTS = { spark: 'muse-spark-1.3', sparkContributor: 'muse-spark-1.3-contributor', wonder: 'muse-wonder-1.0', image: 'muse-image-1.0', asr: 'muse-voice-transcribe-1.0', sam: 'sam-3.1' };

describe('the models this key can use', () => {
  it('keeps every name the key has', () => {
    const r = closestModels(DEFAULTS, Object.values(DEFAULTS));
    expect(r.switched).toEqual([]);
    expect(r.unlisted).toEqual([]);
  });

  it('switches a missing name to the closest version the key has, contributor to contributor', () => {
    const r = closestModels(DEFAULTS, ['muse-spark-1.2', 'muse-spark-1.1', 'muse-spark-1.2-contributor', 'sam-3', 'muse-image-1.0', 'muse-wonder-1.0']);
    expect(r.switched).toEqual([
      { role: 'spark', from: 'muse-spark-1.3', to: 'muse-spark-1.2' },
      { role: 'sparkContributor', from: 'muse-spark-1.3-contributor', to: 'muse-spark-1.2-contributor' },
      { role: 'sam', from: 'sam-3.1', to: 'sam-3' },
    ]);
    // Not in the list and nothing close: left alone, and named in the log.
    expect(r.unlisted).toEqual([{ role: 'asr', name: 'muse-voice-transcribe-1.0' }]);
  });

  it('prefers a released version to a preview, and a named version to a plain alias', () => {
    expect(closestModels(DEFAULTS, ['muse-spark-1.4-preview', 'muse-spark-1.2', 'muse-spark']).switched[0]).toEqual({ role: 'spark', from: 'muse-spark-1.3', to: 'muse-spark-1.2' });
    expect(closestModels(DEFAULTS, ['muse-spark']).switched[0]?.to).toBe('muse-spark');
    // Another family is never taken for this one.
    expect(closestModels(DEFAULTS, ['muse-spark-open-1026']).switched.find((s) => s.role === 'spark')).toBeUndefined();
  });

  it('reads the list in the shapes model services use', async () => {
    const answer = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
    expect(await listModels('https://x/v1', 'k', answer({ data: [{ id: 'muse-spark-1.2' }, { id: 'sam-3' }] }))).toEqual({ ids: ['muse-spark-1.2', 'sam-3'] });
    expect(await listModels('https://x/v1', 'k', answer({ models: [{ name: 'muse-spark-1.2' }] }))).toEqual({ ids: ['muse-spark-1.2'] });
    expect(await listModels('https://x/v1', 'k', answer({ error: 'no' }, 401))).toMatchObject({ status: 401 });
  });

  it('tells apart the failures a person can do something about', () => {
    expect(failureKind({ status: 404, code: 'model_not_found' })).toBe('model');
    expect(failureKind({ status: 401, code: 'http_401' })).toBe('key');
    expect(failureKind({ status: 429, code: 'http_429' })).toBe('busy');
    expect(failureKind({ status: 504, code: 'timeout' })).toBe('slow');
    expect(failureKind({ status: 0, code: 'network' })).toBe('unreachable');
    expect(failureKind(new Error('odd'))).toBe('other');
  });
});

import { modelCheck, runModelCheck } from '../../server/meta/models';
import { loadConfig } from '../../server/config';
describe('the start-up model check', () => {
  const cfgWith = () => loadConfig({ MODEL_API_KEY: 'LLM|1|secretvalue', META_API_BASE: 'https://x/v1' } as NodeJS.ProcessEnv);
  const lines: string[] = [];
  const log = (_l: string, msg: string) => void lines.push(msg);

  it('switches to the versions the key has, and reports it for the health page', async () => {
    const cfg = cfgWith();
    const list = (async () => new Response(JSON.stringify({ data: ['muse-spark-1.2', 'sam-3.1', 'muse-wonder-1.0', 'muse-image-1.0', 'muse-voice-transcribe-1.0', 'muse-spark-1.2-contributor'].map((id) => ({ id })) }))) as unknown as typeof fetch;
    const r = await runModelCheck(cfg, log, list);
    expect(r.state).toBe('done');
    expect(cfg.meta.models.spark).toBe('muse-spark-1.2');
    expect(modelCheck(cfg).using.spark).toBe('muse-spark-1.2');
    expect(lines.join(' | ')).toMatch(/Checking which models.*Models this key can use.*muse-spark-1.3 is not available to this key: using muse-spark-1.2/);
  });

  it('says plainly when the key is refused, and never throws', async () => {
    const cfg = cfgWith();
    lines.length = 0;
    const refused = (async () => new Response('{}', { status: 401 })) as unknown as typeof fetch;
    expect((await runModelCheck(cfg, log, refused)).state).toBe('failed');
    expect(lines.join(' ')).toMatch(/did not accept MODEL_API_KEY/);
    const broken = (async () => {
      throw new Error('socket hang up');
    }) as unknown as typeof fetch;
    expect((await runModelCheck(cfg, log, broken)).state).toBe('failed');
    expect(cfg.meta.models.spark).toBe('muse-spark-1.3');
  });
});
