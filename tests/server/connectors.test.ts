import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseAic } from '../../server/retrieval/connectors/aic';
import { parseCpsc } from '../../server/retrieval/connectors/cpsc';
import { parseGbif } from '../../server/retrieval/connectors/gbif';
import { parseIfixit } from '../../server/retrieval/connectors/ifixit';
import { parseMetObject } from '../../server/retrieval/connectors/met';
import { parseNhtsa, vehicleFrom } from '../../server/retrieval/connectors/nhtsa';
import { barcodeIn, parseOffProduct } from '../../server/retrieval/connectors/openfoodfacts';
import { parseWikidata } from '../../server/retrieval/connectors/wikidata';
import { parseWikipedia, wikipediaUrl, relevantTitle, historySection } from '../../server/retrieval/connectors/wikipedia';
import { SourceRetriever } from '../../server/retrieval';
import { parseGrounded } from '../../server/retrieval/search';
import { SourceSchema } from '../../src/shared/schema';
import type { CallCtx } from '../../src/shared/tasks';

const fx = (name: string) => JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8'));
const ctx = (category: string, textRead: string[] = []) =>
  ({ language: 'en', privacyTier: 'private', route: 'hosted', runId: 't', category, textRead }) as CallCtx & { category: never; textRead: string[] };

describe('connector parsers (fixtures in the documented shapes)', () => {
  it('Wikipedia', () => {
    const s = parseWikipedia(fx('wikipedia.json'), 'moka pot');
    expect(s[0]).toMatchObject({ title: 'Moka pot', url: 'https://en.wikipedia.org/wiki/Moka_pot', publisher: 'Wikipedia', publishedAt: null });
    expect(s[0]!.snippet).toMatch(/Luigi De Ponti/);
    expect(wikipediaUrl('moka pot')).toMatch(/generator=search&gsrsearch=moka\+pot/);
  });
  it('Wikipedia drops pages that are not about the query', () => {
    const json = { query: { pages: [
      { index: 1, title: 'Art', extract: 'Art is ... oil painting ...', fullurl: 'https://en.wikipedia.org/wiki/Art' },
      { index: 2, title: 'Carnival', extract: 'Carnival ...', fullurl: 'https://en.wikipedia.org/wiki/Carnival' },
      { index: 3, title: 'Goya Foods', extract: 'Goya Foods is a food company founded in 1936.', fullurl: 'https://en.wikipedia.org/wiki/Goya_Foods' },
    ] } };
    expect(parseWikipedia(json, 'Goya olive oil').map((p) => p.title)).toEqual(['Goya Foods']);
    expect(relevantTitle('Olive oil', 'extra virgin olive oils')).toBe(true);
  });
  it('Wikipedia history section is extracted', () => {
    const full = 'Intro.\n\n== History ==\nFounded in 1936 in Manhattan.\n=== Later ===\nExpanded in 1974.\n\n== Products ==\nBeans.';
    expect(historySection(full)).toBe('Founded in 1936 in Manhattan. Expanded in 1974.');
    expect(historySection('No sections here.')).toBeNull();
  });
  it('Wikidata keeps only items with a description, over https', () => {
    const s = parseWikidata(fx('wikidata.json'));
    expect(s).toHaveLength(1);
    expect(s[0]!.url).toBe('https://www.wikidata.org/entity/Q1328405');
  });
  it('The Met', () => {
    expect(parseMetObject(fx('met-object.json'))).toMatchObject({ publisher: 'The Metropolitan Museum of Art', license: 'CC0 (Open Access)' });
    expect(parseMetObject({})).toBeNull();
  });
  it('Art Institute of Chicago', () => {
    expect(parseAic(fx('aic.json'))[0]!.snippet).toMatch(/Aluminum and bakelite/);
  });
  it('CPSC drops non-http links and keeps the hazard and remedy', () => {
    const s = parseCpsc(fx('cpsc.json'));
    expect(s).toHaveLength(1);
    expect(s[0]!.snippet).toMatch(/Hazard: Burn\. Remedy: Replace\./);
    expect(s[0]!.publishedAt).toBe('2024-03-14');
  });
  it('NHTSA needs year, make and model', () => {
    expect(vehicleFrom('2015 Honda Civic recall')).toEqual({ year: '2015', make: 'Honda', model: 'Civic recall' });
    expect(vehicleFrom('a red car')).toBeNull();
    expect(parseNhtsa(fx('nhtsa.json'))[0]!.url).toBe('https://www.nhtsa.gov/recalls?nhtsaId=15V320000');
  });
  it('GBIF ignores non-matches', () => {
    expect(parseGbif(fx('gbif.json'))[0]!.snippet).toMatch(/family Asphodelaceae/);
    expect(parseGbif({ matchType: 'NONE' })).toEqual([]);
  });
  it('Open Food Facts', () => {
    expect(barcodeIn(['EAN 3017620422003'])).toBe('3017620422003');
    expect(parseOffProduct(fx('off-product.json').product, '3017620422003')!.snippet).toMatch(/Allergens listed: milk, nuts/);
  });
  it('iFixit drops non-http links', () => {
    expect(parseIfixit(fx('ifixit.json'))).toHaveLength(1);
  });
  it('web search grounding: url_citation spans become search sources', () => {
    const g = parseGrounded(fx('grounded.json'));
    expect(g.searched).toBe(true);
    expect(g.sources).toHaveLength(1);
    expect(g.sources[0]).toMatchObject({ url: 'https://www.bialetti.com/moka-express', kind: 'search', tier: 4, publisher: 'bialetti.com' });
    expect(g.sources[0]!.snippet).toMatch(/introduced by Bialetti in 1933\. … Its safety valve/);
  });
});

describe('SourceRetriever', () => {
  const routes: Record<string, string> = {
    'en.wikipedia.org': 'wikipedia.json',
    'saferproducts.gov': 'cpsc.json',
    'collectionapi.metmuseum.org/public/collection/v1/search': 'met-search.json',
    'collectionapi.metmuseum.org/public/collection/v1/objects': 'met-object.json',
    'api.gbif.org': 'gbif.json',
  };
  const fakeFetch = (async (url: string) => {
    const hit = Object.entries(routes).find(([k]) => url.includes(k));
    if (!hit) return new Response('nope', { status: 503 });
    return new Response(JSON.stringify(fx(hit[1])), { status: 200 });
  }) as unknown as typeof fetch;

  it('picks connectors by category, orders by authority, ids s1.., hashes content, and notes failures', async () => {
    const r = new SourceRetriever({ fetch: fakeFetch, now: () => '2026-10-28T00:00:00.000Z' });
    const out = await r.retrieve(
      [
        { query: 'moka pot', intent: 'identify' },
        { query: 'moka pot recall', intent: 'safety' },
        { query: 'moka pot history', intent: 'history' },
      ],
      ctx('consumer_product'),
    );
    expect(out.sources.length).toBeGreaterThanOrEqual(3);
    for (const s of out.sources) expect(SourceSchema.safeParse(s).success).toBe(true);
    expect(out.sources.map((s) => s.id)).toEqual(out.sources.map((_, i) => `s${i + 1}`));
    expect(out.sources[0]!.publisher).toMatch(/Consumer Product Safety/);
    const tiers = out.sources.map((s) => s.tier);
    expect([...tiers].sort((a, b) => a - b)).toEqual(tiers);
    expect(out.sources[0]!.contentHash).toMatch(/^[0-9a-f]{64}$/);
    // de-duplicated by URL (Wikipedia was queried twice)
    expect(new Set(out.sources.map((s) => s.url)).size).toBe(out.sources.length);
    expect(out.notes).toEqual([]);
  });

  it('turns connector failures into readable notes', async () => {
    const down = (async () => new Response('down', { status: 503 })) as unknown as typeof fetch;
    const out = await new SourceRetriever({ fetch: down }).retrieve([{ query: 'moka pot', intent: 'identify' }], ctx('consumer_product'));
    expect(out.sources).toEqual([]);
    expect(out.notes.join(' ')).toMatch(/Wikipedia could not be reached/);
  });

  it('uses GBIF for plants and not CPSC', async () => {
    const out = await new SourceRetriever({ fetch: fakeFetch }).retrieve([{ query: 'Aloe vera', intent: 'identify' }], ctx('plant'));
    expect(out.sources.some((s) => s.connector === 'gbif')).toBe(true);
    expect(out.sources.some((s) => s.connector === 'cpsc')).toBe(false);
  });

  it('respects the time budget', async () => {
    const slow = ((_u: string, init: RequestInit) => new Promise((_, rej) => init.signal?.addEventListener('abort', () => rej(new Error('aborted'))))) as unknown as typeof fetch;
    const t0 = Date.now();
    const out = await new SourceRetriever({ fetch: slow, budgetMs: 200 }).retrieve([{ query: 'x', intent: 'identify' }], ctx('consumer_product'));
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(out.sources).toEqual([]);
    expect(out.notes.join(' ')).toMatch(/took too long/);
  });

  it('can be restricted to chosen connectors and includes web search when given', async () => {
    const r = new SourceRetriever({ fetch: fakeFetch, connectors: ['wikipedia'], search: async () => ({ sources: parseGrounded(fx('grounded.json')).sources, searched: true }) });
    expect(r.connectorIds).toEqual(['wikipedia', 'web-search']);
    const out = await r.retrieve([{ query: 'moka pot', intent: 'identify' }], ctx('consumer_product'));
    expect(out.sources.find((s) => s.kind === 'search')?.connector).toBe('web-search');
  });
});
