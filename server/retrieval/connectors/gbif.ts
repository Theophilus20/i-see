import { clip, type Connector, type RawSource } from '../types';

export const gbifUrl = (name: string) => `https://api.gbif.org/v1/species/match?${new URLSearchParams({ name, verbose: 'false' })}`;

export function parseGbif(json: unknown): RawSource[] {
  const x = json as Record<string, unknown>;
  if (!x || x.matchType === 'NONE' || typeof x.usageKey !== 'number' || typeof x.scientificName !== 'string') return [];
  const lineage = ['kingdom', 'phylum', 'class', 'order', 'family', 'genus'].map((k) => (x[k] ? `${k} ${x[k]}` : null)).filter(Boolean).join(', ');
  return [
    {
      url: `https://www.gbif.org/species/${x.usageKey}`,
      title: `${x.scientificName} (GBIF Backbone Taxonomy)`,
      publisher: 'Global Biodiversity Information Facility',
      snippet: clip(`${x.scientificName} is accepted at rank ${String(x.rank ?? 'unknown').toLowerCase()} with taxonomic status ${String(x.status ?? 'unknown').toLowerCase()}. Lineage: ${lineage}. Name match type ${x.matchType} with confidence ${x.confidence ?? 'n/a'}.`),
      note: 'A name match confirms the name exists in the taxonomy, not that the photo shows this species.',
    },
  ];
}

export const gbif: Connector = {
  id: 'gbif',
  label: 'GBIF',
  tier: 3,
  sourceCategory: 'academic',
  license: 'CC BY 4.0',
  pick: (queries, category) => (['plant', 'fungus', 'animal'].includes(category) ? queries.filter((q) => q.intent === 'identify').map((q) => q.query).slice(0, 2) : []),
  search: async (q, ctx) => parseGbif(await ctx.fetchJson(gbifUrl(q), { signal: ctx.signal })),
};
