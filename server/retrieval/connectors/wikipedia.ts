import { clip, type Connector, type RawSource } from '../types';

/**
 * Wikipedia: search, keep only pages that are really about the query, and include the
 * article's History section (not just its introduction), so dated facts can be quoted.
 */

const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'what', 'how', 'of', 'a', 'an', 'in', 'on', 'to', 'is', 'are', 'history', 'specifications', 'specification', 'specs', 'safety', 'recall', 'recalls', 'repair', 'guide', 'type', 'types', 'made', 'used', 'use', 'uses']);
export const words = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOP.has(w))
    .map((w) => (w.length > 4 ? w.replace(/(ies|es|s)$/, '') : w));

/** A page is about the query if its title shares a meaningful word with it. */
export function relevantTitle(title: string, query: string): boolean {
  const q = new Set(words(query));
  return words(title).some((w) => q.has(w));
}

export function wikipediaUrl(q: string): string {
  const p = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: q,
    gsrlimit: '3',
    prop: 'extracts|info',
    exintro: '1',
    explaintext: '1',
    exchars: '1500',
    inprop: 'url',
    format: 'json',
    formatversion: '2',
    origin: '*',
  });
  return `https://en.wikipedia.org/w/api.php?${p}`;
}

/** The full plain text of one article, with == Section == markers. */
export function wikipediaFullUrl(title: string): string {
  const p = new URLSearchParams({
    action: 'query',
    titles: title,
    prop: 'extracts',
    explaintext: '1',
    exsectionformat: 'wiki',
    format: 'json',
    formatversion: '2',
    origin: '*',
  });
  return `https://en.wikipedia.org/w/api.php?${p}`;
}

/** The History (or Origins, Background) section of an article's plain text. */
export function historySection(full: string, max = 2400): string | null {
  const m = /^==\s*(History|Origins?|Background|Development|Corporate history|Early history)\s*==\s*$/im.exec(full);
  if (!m) return null;
  const rest = full.slice(m.index + m[0].length);
  const end = rest.search(/^==\s*[^=].*==\s*$/m);
  const body = (end >= 0 ? rest.slice(0, end) : rest).replace(/^===.*===\s*$/gm, '').replace(/\n{2,}/g, '\n').trim();
  return body ? clip(body, max) : null;
}

export function parseWikipedia(json: unknown, query: string): Array<RawSource & { pageTitle: string }> {
  const pages = (json as { query?: { pages?: Array<{ title?: string; extract?: string; fullurl?: string; index?: number }> } })?.query?.pages ?? [];
  return [...pages]
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .filter((p) => p.title && p.extract && p.fullurl && relevantTitle(p.title, query))
    .slice(0, 2)
    // No publication date: Wikipedia articles are edited continuously.
    .map((p) => ({ url: p.fullurl!, title: p.title!, pageTitle: p.title!, publisher: 'Wikipedia', snippet: clip(p.extract, 1500), publishedAt: null }));
}

export const wikipedia: Connector = {
  id: 'wikipedia',
  label: 'Wikipedia',
  tier: 5,
  sourceCategory: 'community',
  license: 'CC BY-SA 4.0',
  // Short encyclopedic queries first: the thing itself, its maker, its material, its history.
  pick: (queries) => {
    const order = ['identify', 'history', 'material', 'specs', 'safety', 'repair'];
    return [...new Set([...queries].sort((a, b) => order.indexOf(a.intent) - order.indexOf(b.intent)).map((q) => q.query))].slice(0, 4);
  },
  search: async (q, ctx) => {
    const found = parseWikipedia(await ctx.fetchJson(wikipediaUrl(q), { signal: ctx.signal }), q);
    // Add the History section of the best match, so its dates can be quoted.
    const top = found[0];
    if (top) {
      try {
        const full = (await ctx.fetchJson(wikipediaFullUrl(top.pageTitle), { signal: ctx.signal })) as { query?: { pages?: Array<{ extract?: string }> } };
        const hist = historySection(full?.query?.pages?.[0]?.extract ?? '');
        if (hist) top.snippet = clip(`${top.snippet}\n\nHistory: ${hist}`, 4000);
      } catch {
        /* the introduction alone is still useful */
      }
    }
    return found.map(({ pageTitle: _t, ...s }) => s);
  },
};
