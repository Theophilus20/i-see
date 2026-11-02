import { clip, firstOf, type Connector, type RawSource } from '../types';

export const cpscUrl = (q: string) => `https://www.saferproducts.gov/RestWebServices/Recall?${new URLSearchParams({ format: 'json', ProductName: q })}`;

export function parseCpsc(json: unknown): RawSource[] {
  const list = Array.isArray(json) ? (json as Array<Record<string, any>>) : []; // eslint-disable-line @typescript-eslint/no-explicit-any
  return list
    .filter((r) => typeof r.URL === 'string' && /^https?:/.test(r.URL) && (r.Title || r.Description))
    .sort((a, b) => String(b.RecallDate ?? '').localeCompare(String(a.RecallDate ?? '')))
    .slice(0, 3)
    .map((r) => {
      const hazards = (r.Hazards ?? []).map((h: { Name?: string }) => h.Name).filter(Boolean).join('; ');
      const remedies = (r.Remedies ?? []).map((h: { Name?: string }) => h.Name).filter(Boolean).join('; ');
      return {
        url: r.URL as string,
        title: clip(r.Title ?? `Recall ${r.RecallNumber ?? ''}`, 300),
        publisher: 'U.S. Consumer Product Safety Commission',
        snippet: clip([r.Description, hazards && `Hazard: ${hazards}.`, remedies && `Remedy: ${remedies}.`, r.RecallDate && `Recall date: ${String(r.RecallDate).slice(0, 10)}.`].filter(Boolean).join(' ')),
        publishedAt: r.RecallDate ? String(r.RecallDate).slice(0, 10) : null,
        note: 'A recall applies only to the specific products, models and dates it lists.',
      };
    });
}

export const cpsc: Connector = {
  id: 'cpsc',
  label: 'CPSC recalls',
  tier: 2,
  sourceCategory: 'government',
  license: 'U.S. government work',
  pick: (queries, category) => (['consumer_product', 'electronics', 'tool', 'furniture', 'machine', 'medical'].includes(category) ? firstOf(queries, ['safety', 'live', 'identify'], 1) : []),
  search: async (q, ctx) => parseCpsc(await ctx.fetchJson(cpscUrl(q), { signal: ctx.signal })),
};
