import { clip, type Connector, type RawSource } from '../types';

/** NHTSA needs make, model and year. Only queries shaped like "2015 Honda Civic" are used. */
export function vehicleFrom(q: string): { year: string; make: string; model: string } | null {
  const m = /\b(19[5-9]\d|20[0-3]\d)\s+([A-Za-z-]+)\s+([A-Za-z0-9-]+(?:\s[A-Za-z0-9-]+)?)/.exec(q);
  return m ? { year: m[1]!, make: m[2]!, model: m[3]! } : null;
}

export const nhtsaUrl = (v: { year: string; make: string; model: string }) =>
  `https://api.nhtsa.gov/recalls/recallsByVehicle?${new URLSearchParams({ make: v.make, model: v.model, modelYear: v.year })}`;

export function parseNhtsa(json: unknown): RawSource[] {
  const results = (json as { results?: Array<Record<string, string>> })?.results ?? [];
  return results
    .filter((r) => r.NHTSACampaignNumber)
    .slice(0, 3)
    .map((r) => ({
      url: `https://www.nhtsa.gov/recalls?nhtsaId=${encodeURIComponent(r.NHTSACampaignNumber!)}`,
      title: `NHTSA recall ${r.NHTSACampaignNumber}: ${r.ModelYear ?? ''} ${r.Make ?? ''} ${r.Model ?? ''} ${r.Component ?? ''}`.replace(/\s+/g, ' ').trim(),
      publisher: 'U.S. National Highway Traffic Safety Administration',
      snippet: clip([r.Summary, r.Consequence && `Consequence: ${r.Consequence}`, r.Remedy && `Remedy: ${r.Remedy}`].filter(Boolean).join(' ')),
      publishedAt: r.ReportReceivedDate ?? null,
      note: 'Check your vehicle identification number (VIN) on nhtsa.gov to see whether a recall applies to your vehicle.',
    }));
}

export const nhtsa: Connector = {
  id: 'nhtsa',
  label: 'NHTSA recalls',
  tier: 2,
  sourceCategory: 'government',
  license: 'U.S. government work',
  pick: (queries, category) => (category === 'vehicle' ? queries.map((q) => q.query).filter((q) => vehicleFrom(q)).slice(0, 1) : []),
  async search(q, ctx) {
    const v = vehicleFrom(q);
    return v ? parseNhtsa(await ctx.fetchJson(nhtsaUrl(v), { signal: ctx.signal })) : [];
  },
};
