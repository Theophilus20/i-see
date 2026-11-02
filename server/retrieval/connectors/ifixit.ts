import { clip, firstOf, type Connector, type RawSource } from '../types';

export const ifixitUrl = (q: string) => `https://www.ifixit.com/api/2.0/search/${encodeURIComponent(q)}?${new URLSearchParams({ limit: '3' })}`;

export function parseIfixit(json: unknown): RawSource[] {
  const results = (json as { results?: Array<Record<string, unknown>> })?.results ?? [];
  return results
    .filter((r) => typeof r.url === 'string' && /^https?:/.test(r.url as string) && (r.title || r.display_title))
    .slice(0, 2)
    .map((r) => ({
      url: r.url as string,
      title: clip(r.display_title ?? r.title, 300),
      publisher: 'iFixit',
      snippet: clip(r.summary ?? r.text ?? r.introduction_rendered ?? ''),
    }))
    .filter((s) => s.snippet);
}

export const ifixit: Connector = {
  id: 'ifixit',
  label: 'iFixit',
  tier: 4,
  sourceCategory: 'specialist',
  license: 'CC BY-NC-SA 3.0',
  pick: (queries, category) =>
    ['electronics', 'machine', 'tool', 'consumer_product', 'vehicle'].includes(category) && queries.some((q) => q.intent === 'repair' || category === 'electronics')
      ? firstOf(queries, ['repair', 'identify'], 1)
      : [],
  search: async (q, ctx) => parseIfixit(await ctx.fetchJson(ifixitUrl(q), { signal: ctx.signal })),
};
