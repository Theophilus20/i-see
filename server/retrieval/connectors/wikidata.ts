import { clip, firstOf, type Connector, type RawSource } from '../types';

export const wikidataUrl = (q: string) =>
  `https://www.wikidata.org/w/api.php?${new URLSearchParams({ action: 'wbsearchentities', search: q, language: 'en', limit: '2', format: 'json', origin: '*' })}`;

export function parseWikidata(json: unknown): RawSource[] {
  const items = (json as { search?: Array<{ id?: string; label?: string; description?: string; concepturi?: string }> })?.search ?? [];
  return items
    .filter((i) => i.id && i.label && i.description)
    .map((i) => ({
      url: i.concepturi && /^https?:/.test(i.concepturi) ? i.concepturi.replace(/^http:/, 'https:') : `https://www.wikidata.org/wiki/${i.id}`,
      title: `${i.label} (${i.id})`,
      publisher: 'Wikidata',
      snippet: clip(`${i.label}: ${i.description}.`),
    }));
}

export const wikidata: Connector = {
  id: 'wikidata',
  label: 'Wikidata',
  tier: 5,
  sourceCategory: 'community',
  license: 'CC0 1.0',
  pick: (queries, category) => (['artifact', 'mineral', 'other', 'component', 'machine'].includes(category) ? firstOf(queries, ['identify'], 1) : []),
  search: async (q, ctx) => parseWikidata(await ctx.fetchJson(wikidataUrl(q), { signal: ctx.signal })),
};
