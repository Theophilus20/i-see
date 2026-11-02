/**
 * Which models this key can use. On start, the server asks the Meta Model API for its list
 * (`GET /models`, which costs nothing), writes it to the log, and, for any model name this key
 * does not have, switches to the closest version it does have ("muse-spark-1.2" for
 * "muse-spark-1.3"). A deployment then works with whatever versions the account offers, and
 * the log says exactly what is in use.
 */
import type { Config } from '../config';

export type ModelRoles = Config['meta']['models'];
export const MODEL_SETTING: Record<keyof ModelRoles, string> = {
  spark: 'MODEL_SPARK',
  sparkContributor: 'MODEL_SPARK_CONTRIBUTOR',
  wonder: 'MODEL_WONDER',
  image: 'MODEL_IMAGE',
  asr: 'MODEL_ASR',
  sam: 'MODEL_SAM',
};

/** The model ids this key can use, or the HTTP status when the list could not be read. */
export async function listModels(baseUrl: string, apiKey: string, fetchImpl: typeof fetch = fetch): Promise<{ ids: string[] } | { status: number | null; error: string }> {
  try {
    const res = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/models`, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return { status: res.status, error: `HTTP ${res.status}` };
    const body = (await res.json()) as unknown;
    const o = body as { data?: unknown; models?: unknown };
    const items: unknown[] = Array.isArray(body) ? body : Array.isArray(o?.data) ? o.data : Array.isArray(o?.models) ? o.models : [];
    const ids = items
      .map((x) => (typeof x === 'string' ? x : ((x as { id?: unknown; name?: unknown })?.id ?? (x as { name?: unknown })?.name)))
      .filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length < 200);
    return { ids: [...new Set(ids)] };
  } catch (e) {
    return { status: null, error: (e as Error).message };
  }
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
