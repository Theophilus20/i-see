/**
 * Which models this key can use. On start, the server asks the Meta Model API for its list
 * (`GET /models`, which costs nothing), writes it to the log, and, for any model name this key
 * does not have, switches to the closest version it does have ("muse-spark-1.2" for
 * "muse-spark-1.3"). A deployment then works with whatever versions the account offers, and
 * the log says exactly what is in use.
 */
import type { Config } from '../config';
import type { ModelCheck } from '../../src/shared/api';

export type ModelRoles = Config['meta']['models'];
export const MODEL_SETTING: Record<keyof ModelRoles, string> = {
  spark: 'MODEL_SPARK',
  sparkContributor: 'MODEL_SPARK_CONTRIBUTOR',
  wonder: 'MODEL_WONDER',
  image: 'MODEL_IMAGE',
  asr: 'MODEL_ASR',
  sam: 'MODEL_SAM',
};

export type ModelList = { ids: string[]; reply: string; traceIds: Record<string, string> } | { status: number | null; error: string; reply?: string };

/**
 * The model ids this key can use, or the HTTP status when the list could not be read. With the
 * list comes the start of the service's reply and its request ids, for when the list is empty.
 */
export async function listModels(baseUrl: string, apiKey: string, fetchImpl: typeof fetch = fetch): Promise<ModelList> {
  try {
    const res = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/models`, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(20_000) });
    const text = await res.text();
    const reply = text.replace(/\s+/g, ' ').slice(0, 400);
    if (!res.ok) return { status: res.status, error: `HTTP ${res.status}`, reply };
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return { status: res.status, error: 'The reply was not JSON', reply };
    }
    const o = body as { data?: unknown; models?: unknown };
    const items: unknown[] = Array.isArray(body) ? body : Array.isArray(o?.data) ? o.data : Array.isArray(o?.models) ? o.models : [];
    const ids = items
      .map((x) => (typeof x === 'string' ? x : ((x as { id?: unknown; name?: unknown })?.id ?? (x as { name?: unknown })?.name)))
      .filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length < 200);
    // Request and trace ids, which the service's support can look up.
    const traceIds: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      if (/request-?id|trace|x-fb-|debug|region|served-by|via|server/i.test(k) && Object.keys(traceIds).length < 8) traceIds[k] = v.slice(0, 160);
    });
    return { ids: [...new Set(ids)], reply, traceIds };
  } catch (e) {
    return { status: null, error: (e as Error).message };
  }
}

/**
 * Where this server's requests come from, as the internet sees them: its public address and
 * country (Cloudflare's trace page answers with both). Services that limit by location decide
 * from this address. Null when it cannot be read.
 */
export async function publicNetwork(fetchImpl: typeof fetch = fetch, url = 'https://www.cloudflare.com/cdn-cgi/trace'): Promise<{ ip: string; country: string } | null> {
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const kv = Object.fromEntries(
      (await res.text())
        .split('\n')
        .map((l) => l.trim().split('='))
        .filter((p) => p.length === 2),
    ) as Record<string, string>;
    return kv.ip && kv.loc ? { ip: kv.ip.slice(0, 64), country: kv.loc.slice(0, 8) } : null;
  } catch {
    return null;
  }
}

/** The key's length and last four characters, to compare with your own copy without showing it. */
export function keyHint(key: string): { length: number; ends: string; unusual: boolean } {
  return { length: key.length, ends: key.length > 12 ? key.slice(-4) : '', unusual: /[^\x21-\x7e]/.test(key) };
}

const versionOf = (s: string): number[] => (/^(\d+(?:\.\d+)*)/.exec(s)?.[1] ?? '').split('.').filter(Boolean).map(Number);
const newer = (a: number[], b: number[]) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0);
  return 0;
};

/**
 * For each model name this key does not have, the closest one it does have: the same family
 * ("muse-spark" in "muse-spark-1.3"), the contributor variant only for the contributor role,
 * a released version before a "-preview" or other suffix, and the newest first.
 */
export function closestModels(models: ModelRoles, available: string[]): {
  switched: Array<{ role: keyof ModelRoles; from: string; to: string }>;
  unlisted: Array<{ role: keyof ModelRoles; name: string }>;
} {
  const have = new Set(available.map((x) => x.toLowerCase()));
  const switched: Array<{ role: keyof ModelRoles; from: string; to: string }> = [];
  const unlisted: Array<{ role: keyof ModelRoles; name: string }> = [];
  for (const role of Object.keys(models) as Array<keyof ModelRoles>) {
    const name = models[role];
    if (have.has(name.toLowerCase())) continue;
    const contributor = /-contributor$/i.test(name);
    const family = name.replace(/-contributor$/i, '').replace(/-\d+(?:\.\d+)*(?:-[a-z0-9]+)*$/i, '').toLowerCase();
    const options = available
      .map((id) => {
        const low = id.toLowerCase();
        if (/-contributor$/.test(low) !== contributor) return null;
        const core = low.replace(/-contributor$/, '');
        if (core === family) return { id, v: [Infinity], extra: 0 };
        if (!core.startsWith(`${family}-`)) return null;
        const rest = core.slice(family.length + 1);
        const v = versionOf(rest);
        if (!v.length) return null;
        return { id, v, extra: rest.length - v.join('.').length };
      })
      .filter((x): x is { id: string; v: number[]; extra: number } => !!x)
      // A released version before a "-preview" one, the newest first; a plain alias ("muse-spark")
      // last, since a named version is more predictable.
      .sort((a, b) => (a.v[0] === Infinity ? 1 : 0) - (b.v[0] === Infinity ? 1 : 0) || (a.extra ? 1 : 0) - (b.extra ? 1 : 0) || newer(b.v, a.v));
    if (options[0]) switched.push({ role, from: name, to: options[0].id });
    else unlisted.push({ role, name });
  }
  return { switched, unlisted };
}

let check: ModelCheck = { state: 'not-run', using: {}, listed: [], switched: [], unlisted: [], status: null, error: null, at: null };
/** The latest model check, for the health page. */
export function modelCheck(cfg: Config): ModelCheck {
  return { ...check, using: { ...cfg.meta.models } };
}

export interface ModelCheckOptions {
  /** The page that reports this server's public address; null to skip. */
  traceUrl?: string | null;
}

/**
 * Asks the service which models this key can use, writes the answer to the log, and switches any
 * name the key does not have to the closest one it does. Never throws.
 */
export async function runModelCheck(
  cfg: Config,
  log: (level: 'info' | 'warn' | 'error', msg: string, data?: Record<string, unknown>) => void,
  fetchImpl: typeof fetch = fetch,
  opts: ModelCheckOptions = {},
): Promise<ModelCheck> {
  if (!cfg.meta.apiKey) return modelCheck(cfg);
  const key = keyHint(cfg.meta.apiKey);
  check = { ...check, state: 'checking', at: new Date().toISOString(), key };
  log('info', 'Checking which models this key can use');
  try {
    const traceUrl = opts.traceUrl === undefined ? 'https://www.cloudflare.com/cdn-cgi/trace' : opts.traceUrl;
    const [r, network] = await Promise.all([listModels(cfg.meta.baseUrl, cfg.meta.apiKey, fetchImpl), traceUrl ? publicNetwork(fetchImpl, traceUrl) : Promise.resolve(null)]);
    const base = cfg.meta.baseUrl;
    if (!('ids' in r)) {
      check = { ...check, state: 'failed', listed: [], status: r.status, error: r.error.slice(0, 200), reply: r.reply ?? null, network, base };
      if (r.status === 401 || r.status === 403) log('error', 'The Meta Model API did not accept MODEL_API_KEY. Check that it is copied exactly, with no quotes or spaces.', { status: r.status, reply: r.reply });
      else log('warn', 'Could not list the models this key can use; using the configured names.', { status: r.status, error: r.error, reply: r.reply });
      return modelCheck(cfg);
    }
    log('info', 'Models this key can use', { models: r.ids.slice(0, 60), network });
    if (!r.ids.length) {
      log('warn', 'The service listed no models for this key when asked from this server. Calls will fail with "model not found". Compare the same key from another computer; the service decides by the key\'s team and may also decide by where the request comes from.', { reply: r.reply, ids: r.traceIds, network, keyEnds: key.ends });
    }
    const { switched, unlisted } = r.ids.length ? closestModels(cfg.meta.models, r.ids) : { switched: [], unlisted: [] };
    for (const x of switched) {
      cfg.meta.models[x.role] = x.to;
      log('warn', `${x.from} is not available to this key: using ${x.to} instead. Set ${MODEL_SETTING[x.role]} to choose another.`, { setting: MODEL_SETTING[x.role] });
    }
    for (const u of unlisted) log('warn', `${u.name} is not in this key's model list and has no close version there; calls to it may fail. Set ${MODEL_SETTING[u.role]} to a model from the list.`, { setting: MODEL_SETTING[u.role] });
    check = {
      ...check,
      state: 'done',
      listed: r.ids.slice(0, 100),
      switched,
      unlisted,
      status: 200,
      error: null,
      // The reply in full only when it listed nothing, to show what the service said instead.
      reply: r.ids.length ? null : r.reply,
      replyIds: r.ids.length ? undefined : r.traceIds,
      network,
      base,
    };
  } catch (e) {
    check = { ...check, state: 'failed', error: (e as Error).message.slice(0, 200) };
    log('warn', 'The model check failed; using the configured names.', { error: (e as Error).message });
  }
  return modelCheck(cfg);
}

let lastRecheck = 0;
/** Runs the check again on request (from the health page), at most once every 20 seconds. */
export async function recheckModels(cfg: Config, log: Parameters<typeof runModelCheck>[1], fetchImpl: typeof fetch = fetch, opts: ModelCheckOptions = {}, now = Date.now()): Promise<boolean> {
  if (!cfg.meta.apiKey || check.state === 'checking' || now - lastRecheck < 20_000) return false;
  lastRecheck = now;
  await runModelCheck(cfg, log, fetchImpl, opts);
  return true;
}
