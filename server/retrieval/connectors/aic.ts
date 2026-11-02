import { clip, firstOf, type Connector, type RawSource } from '../types';

export const aicUrl = (q: string) =>
  `https://api.artic.edu/api/v1/artworks/search?${new URLSearchParams({ q, limit: '2', fields: 'id,title,date_display,medium_display,place_of_origin,artwork_type_title,short_description,artist_display' })}`;

export function parseAic(json: unknown): RawSource[] {
  const data = (json as { data?: Array<Record<string, unknown>> })?.data ?? [];
  return data
    .filter((d) => typeof d.id === 'number' && typeof d.title === 'string')
    .map((d) => ({
      url: `https://www.artic.edu/artworks/${d.id}`,
      title: `${d.title} (Art Institute of Chicago)`,
      publisher: 'Art Institute of Chicago',
      snippet: clip(
        [
          d.artwork_type_title && `Type: ${d.artwork_type_title}.`,
          d.date_display && `Date: ${d.date_display}.`,
          d.place_of_origin && `Place of origin: ${d.place_of_origin}.`,
          d.artist_display && `Maker: ${String(d.artist_display).replace(/\n/g, ', ')}.`,
          d.medium_display && `Medium: ${d.medium_display}.`,
          d.short_description,
        ]
          .filter(Boolean)
          .join(' '),
      ),
    }));
}

export const aic: Connector = {
  id: 'aic',
  label: 'Art Institute of Chicago',
  tier: 3,
  sourceCategory: 'museum',
  license: 'CC0 (collection data)',
  pick: (queries, category) => (category === 'artifact' ? firstOf(queries, ['history', 'identify'], 1) : []),
  search: async (q, ctx) => parseAic(await ctx.fetchJson(aicUrl(q), { signal: ctx.signal })),
};
