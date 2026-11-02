import { clip, firstOf, type Connector, type RawSource } from '../types';

const BASE = 'https://collectionapi.metmuseum.org/public/collection/v1';

export function parseMetObject(o: unknown): RawSource | null {
  const x = o as Record<string, unknown>;
  if (!x || typeof x.title !== 'string' || typeof x.objectURL !== 'string' || !x.objectURL) return null;
  const parts = [
    x.objectName && `Object: ${x.objectName}.`,
    x.objectDate && `Date: ${x.objectDate}.`,
    x.culture && `Culture: ${x.culture}.`,
    x.period && `Period: ${x.period}.`,
    x.artistDisplayName && `Maker: ${x.artistDisplayName}.`,
    x.medium && `Medium: ${x.medium}.`,
    x.dimensions && `Dimensions: ${x.dimensions}.`,
    x.department && `Department: ${x.department}.`,
  ].filter(Boolean);
  return {
    url: x.objectURL,
    title: `${x.title} (The Met)`,
    publisher: 'The Metropolitan Museum of Art',
    snippet: clip(parts.join(' ')),
    license: x.isPublicDomain ? 'CC0 (Open Access)' : 'See object record',
  };
}

export const met: Connector = {
  id: 'met',
  label: 'The Met Collection',
  tier: 3,
  sourceCategory: 'museum',
  license: 'CC0 (Open Access data)',
  pick: (queries, category) =>
    ['artifact', 'furniture'].includes(category) || queries.some((q) => q.intent === 'history') ? firstOf(queries, ['history', 'identify'], 1) : [],
  async search(q, ctx) {
    const found = (await ctx.fetchJson(`${BASE}/search?${new URLSearchParams({ q, hasImages: 'true' })}`, { signal: ctx.signal })) as { objectIDs?: number[] | null };
    const ids = (found?.objectIDs ?? []).slice(0, 2);
    const objects = await Promise.all(ids.map((id) => ctx.fetchJson(`${BASE}/objects/${id}`, { signal: ctx.signal }).catch(() => null)));
    return objects.map(parseMetObject).filter((s): s is RawSource => !!s);
  },
};
