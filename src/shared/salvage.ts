/**
 * Salvaging a model's JSON that almost matches the schema.
 *
 * Models sometimes rename a key ("name" for "title"), leave out a nullable field, change
 * the case of an enum value, or send a number as a string. Failing the whole answer for
 * that wastes a long call. Salvage fixes only mechanical slips, never content:
 *   1. renamed keys are mapped back using a short list of synonyms;
 *   2. a missing nullable field becomes null, a missing list becomes empty;
 *   3. enum values are matched ignoring case and spacing; numbers and strings are coerced;
 *   4. list items that still do not fit are dropped (a part without a name is left out,
 *      rather than invented).
 * Whatever comes out is validated by the real schema afterwards, and then checked by the
 * firewall like any other model output.
 */
import type { z } from 'zod';

type Json = Record<string, unknown>;

/** Accepted stand-ins for a key, tried in order when the key itself is missing. */
const ALIASES: Record<string, string[]> = {
  title: ['name', 'heading', 'label', 'flowTitle', 'flow_title'],
  name: ['title', 'label', 'part', 'partName', 'part_name'],
  label: ['title', 'name', 'step', 'stepTitle', 'step_title'],
  detail: ['description', 'details', 'text', 'explanation'],
  summary: ['description', 'overview', 'intro'],
  what: ['function', 'purpose', 'role', 'whatItDoes', 'what_it_does'],
  how: ['howItWorks', 'how_it_works', 'mechanism', 'explanation'],
  role: ['purpose', 'function', 'description'],
  text: ['statement', 'claim', 'content', 'sentence'],
  steps: ['stages', 'sequence'],
  parts: ['components', 'items'],
  groups: ['systems', 'sections', 'layers'],
  flows: ['processes', 'processFlows', 'process_flows'],
  regionIds: ['regions', 'region_ids'],
  sourceIds: ['sources', 'source_ids'],
  visibleInPhoto: ['visible', 'visible_in_photo'],
  illustrationBrief: ['illustration_brief', 'brief'],
  intro: ['introduction', 'overview', 'summary'],
};

const typesOf = (s: Json): string[] => {
  if (Array.isArray(s.type)) return s.type as string[];
  if (typeof s.type === 'string') return [s.type];
  const alts = (s.anyOf ?? s.oneOf) as Json[] | undefined;
  return alts ? alts.flatMap(typesOf) : [];
};

const branch = (s: Json, value: unknown): Json => {
  const alts = (s.anyOf ?? s.oneOf) as Json[] | undefined;
  if (!alts) return s;
  if (value === null) return alts.find((a) => typesOf(a).includes('null')) ?? alts[0]!;
  const t = Array.isArray(value) ? 'array' : typeof value === 'object' ? 'object' : typeof value;
  return alts.find((a) => typesOf(a).includes(t) || (t === 'number' && typesOf(a).includes('integer'))) ?? alts.find((a) => !typesOf(a).includes('null')) ?? alts[0]!;
};

const squash = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, '');

function conform(schema: Json, value: unknown): unknown {
  const s = branch(schema, value);
  const types = typesOf(s);
  if (value === undefined) return value;
  if (value === null) return null;

  if (Array.isArray(s.enum) && typeof value === 'string') {
    const hit = (s.enum as unknown[]).find((e) => typeof e === 'string' && squash(e) === squash(value));
    return hit ?? value;
  }
  if (types.includes('object') && value && typeof value === 'object' && !Array.isArray(value)) {
    const props = (s.properties ?? {}) as Record<string, Json>;
    const src = value as Json;
    const out: Json = {};
    const used = new Set<string>();
    for (const [key, sub] of Object.entries(props)) {
      let v = src[key];
      if (v === undefined) {
        const alt = (ALIASES[key] ?? []).find((a) => src[a] !== undefined && !(a in props) && !used.has(a));
        if (alt) {
          v = src[alt];
          used.add(alt);
        }
      }
      if (v === undefined) {
        const st = typesOf(sub);
        if (st.includes('null')) v = null;
        else if (st.includes('array')) v = [];
      }
      out[key] = conform(sub, v);
    }
    return out;
  }
  if (types.includes('array')) {
    const items = (s.items ?? {}) as Json;
    // A single item sent without its list is wrapped; anything else is left to fail validation.
    const list = Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : typeof value === 'string' && typesOf(items).includes('string') ? [value] : null;
    return list ? list.map((x) => conform(items, x)) : value;
  }
  if ((types.includes('number') || types.includes('integer')) && typeof value === 'string') {
    const n = Number(value.replace('%', '').trim());
    if (Number.isFinite(n)) return value.includes('%') ? n / 100 : n;
  }
  if (types.includes('string') && (typeof value === 'number' || typeof value === 'boolean')) return String(value);
  if (types.includes('boolean') && typeof value === 'string') {
    if (/^(true|yes)$/i.test(value)) return true;
    if (/^(false|no)$/i.test(value)) return false;
  }
  return value;
}

/** Removes the list item an issue points into (the deepest list index in its path). */
function dropAt(root: unknown, path: ReadonlyArray<PropertyKey>): boolean {
  let idx = -1;
  for (let i = path.length - 1; i >= 0; i--) {
    if (typeof path[i] === 'number') {
      idx = i;
      break;
    }
  }
  if (idx < 0) return false;
  let node: unknown = root;
  for (let i = 0; i < idx; i++) node = (node as Record<PropertyKey, unknown>)?.[path[i] as string];
  if (!Array.isArray(node)) return false;
  node.splice(path[idx] as number, 1);
  return true;
}

export function salvage<S extends z.ZodType>(schema: S, jsonSchema: Json, raw: unknown): { ok: true; value: z.infer<S>; fixes: number } | { ok: false } {
  const data = conform(jsonSchema, raw);
  for (let round = 0; round < 25; round++) {
    const r = schema.safeParse(data);
    if (r.success) return { ok: true, value: r.data as z.infer<S>, fixes: round };
    const issue = r.error.issues[0];
    if (!issue || !dropAt(data, issue.path)) return { ok: false };
  }
  return { ok: false };
}
