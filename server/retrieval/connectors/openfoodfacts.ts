import { clip, firstOf, type Connector, type RawSource } from '../types';

const FIELDS = 'code,product_name,brands,quantity,categories,ingredients_text,allergens_tags';
export const barcodeIn = (texts: string[]): string | null => {
  for (const t of texts) {
    const m = /\b(\d{8}|\d{12,14})\b/.exec(t.replace(/(\d)\s+(?=\d)/g, '$1'));
    if (m) return m[1]!;
  }
  return null;
};

export function parseOffProduct(p: Record<string, unknown> | undefined, code: string): RawSource | null {
  if (!p || !p.product_name) return null;
  const allergens = Array.isArray(p.allergens_tags) ? (p.allergens_tags as string[]).map((a) => a.replace(/^en:/, '')).join(', ') : '';
  return {
    url: `https://world.openfoodfacts.org/product/${encodeURIComponent(code)}`,
    title: `${p.product_name}${p.brands ? ` (${p.brands})` : ''}`,
    publisher: 'Open Food Facts',
    snippet: clip(
      [p.quantity && `Quantity: ${p.quantity}.`, p.categories && `Categories: ${p.categories}.`, p.ingredients_text && `Ingredients: ${p.ingredients_text}.`, allergens && `Allergens listed: ${allergens}.`].filter(Boolean).join(' '),
    ),
    note: 'Community-entered product data. The label on the product in your hand is the authority.',
  };
}

export function parseOffSearch(json: unknown): RawSource[] {
  const products = (json as { products?: Array<Record<string, unknown>> })?.products ?? [];
  return products
    .slice(0, 2)
    .map((p) => parseOffProduct(p, String(p.code ?? '')))
    .filter((s): s is RawSource => !!s && !s.url.endsWith('/product/'));
}

export const openfoodfacts: Connector = {
  id: 'openfoodfacts',
  label: 'Open Food Facts',
  tier: 5,
  sourceCategory: 'community',
  license: 'ODbL 1.0',
  pick: (queries, category, textRead) => {
    if (category !== 'food') return [];
    const code = barcodeIn(textRead);
    return code ? [`barcode:${code}`] : firstOf(queries, ['identify'], 1);
  },
  async search(q, ctx) {
    if (q.startsWith('barcode:')) {
      const code = q.slice(8);
      const json = (await ctx.fetchJson(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=${FIELDS}`, { signal: ctx.signal })) as { status?: number; product?: Record<string, unknown> };
      const s = json?.status === 1 ? parseOffProduct(json.product, code) : null;
      return s ? [s] : [];
    }
    return parseOffSearch(await ctx.fetchJson(`https://world.openfoodfacts.org/cgi/search.pl?${new URLSearchParams({ search_terms: q, json: '1', page_size: '2', fields: FIELDS })}`, { signal: ctx.signal }));
  },
};
