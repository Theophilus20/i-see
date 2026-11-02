/**
 * The retriever: picks connectors for the object's category and the model's queries,
 * runs them in parallel under a time budget, and turns what comes back into Sources
 * with ids, content hashes and retrieval times. A failing connector becomes a note the
 * person can read, never a silent gap.
 */
import { createHash } from 'node:crypto';
import type { Source } from '../../src/shared/schema';
import type { Retriever, RetrieveQuery, RetrieveResult, CallCtx } from '../../src/shared/tasks';
import type { Category } from '../../src/shared/epistemics';
import { safeUrl } from '../../src/shared/schema';
import { log } from '../log';
import { aic } from './connectors/aic';
import { cpsc } from './connectors/cpsc';
import { gbif } from './connectors/gbif';
import { ifixit } from './connectors/ifixit';
import { met } from './connectors/met';
import { nhtsa } from './connectors/nhtsa';
import { openfoodfacts } from './connectors/openfoodfacts';
import { wikidata } from './connectors/wikidata';
import { wikipedia } from './connectors/wikipedia';
import type { Connector, RawSource } from './types';

export const CONNECTORS: Connector[] = [wikipedia, wikidata, met, aic, cpsc, nhtsa, gbif, openfoodfacts, ifixit];

export const USER_AGENT = `I-SEE/0.1 (object understanding app; ${process.env.CONTACT_EMAIL ?? 'self-hosted'})`;

export function makeFetchJson(fetchImpl: typeof fetch = fetch, timeoutMs = 6000) {
  return async (url: string, init: { signal?: AbortSignal; headers?: Record<string, string> } = {}): Promise<unknown> => {
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    const res = await fetchImpl(url, { headers: { Accept: 'application/json', 'User-Agent': USER_AGENT, ...init.headers }, signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (text.length > 3_000_000) throw new Error('response too large');
    return JSON.parse(text);
  };
}

export interface RetrieverOptions {
  fetch?: typeof fetch;
  connectors?: string[] | null;
  /** Web search grounding through Muse Spark; null when not configured. */
  search?: ((queries: string[], signal?: AbortSignal) => Promise<{ sources: RawSource[]; searched: boolean }>) | null;
  budgetMs?: number;
  searchBudgetMs?: number;
  perConnectorMs?: number;
  now?: () => string;
}

export function pageKey(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid|ref$)/i.test(k)) u.searchParams.delete(k);
    const host = u.hostname.toLowerCase().replace(/^www\./, '').replace(/^([a-z]{2,3})\.m\.wikipedia\.org$/, '$1.wikipedia.org').replace(/^m\./, '');
    return `${host}${decodeURIComponent(u.pathname).replace(/\/+$/, '')}${u.search}`.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

export class SourceRetriever implements Retriever {
  private readonly fetchJson: ReturnType<typeof makeFetchJson>;
  private readonly active: Connector[];
  constructor(private readonly o: RetrieverOptions = {}) {
    this.fetchJson = makeFetchJson(o.fetch, o.perConnectorMs ?? 6000);
    this.active = o.connectors ? CONNECTORS.filter((c) => o.connectors!.includes(c.id)) : CONNECTORS;
  }

  get connectorIds(): string[] {
    return [...this.active.map((c) => c.id), ...(this.o.search ? ['web-search'] : [])];
  }

  async retrieve(queries: RetrieveQuery[], ctx: CallCtx & { category: Category; textRead: string[] }): Promise<RetrieveResult> {
    const notes: string[] = [];
    const budget = AbortSignal.timeout(this.o.budgetMs ?? 15_000);
    const signal = ctx.signal ? AbortSignal.any([ctx.signal, budget]) : budget;
    // Web search reads and summarises pages, which takes longer than an API lookup.
    const searchBudget = AbortSignal.timeout(this.o.searchBudgetMs ?? 80_000);
    const searchSignal = ctx.signal ? AbortSignal.any([ctx.signal, searchBudget]) : searchBudget;
    const jobs: Array<{ label: string; run: () => Promise<Array<RawSource & { from: Connector | null }>> }> = [];

    for (const c of this.active) {
      for (const q of c.pick(queries, ctx.category, ctx.textRead)) {
        jobs.push({
          label: c.label,
          run: async () => (await c.search(q, { fetchJson: this.fetchJson, signal, category: ctx.category, textRead: ctx.textRead })).map((s) => ({ ...s, from: c })),
        });
      }
    }
    if (this.o.search && queries.length) {
      jobs.push({
        label: 'Muse Spark web search',
        run: async () => {
          const r = await this.o.search!(queries.map((q) => q.query), searchSignal);
          if (!r.searched) notes.push('Muse Spark chose not to search the web for this object.');
          return r.sources.map((s) => ({ ...s, from: null }));
        },
      });
    }

    const settled = await Promise.allSettled(jobs.map((j) => j.run()));
    const raw: Array<RawSource & { from: Connector | null }> = [];
    settled.forEach((s, i) => {
      if (s.status === 'fulfilled') raw.push(...s.value);
      else {
        const why = signal.aborted && !ctx.signal?.aborted ? 'took too long' : 'could not be reached';
        notes.push(`${jobs[i]!.label} ${why}.`);
        log('warn', 'connector failed', { connector: jobs[i]!.label, error: String((s.reason as Error)?.message ?? s.reason) });
      }
    });

    const now = this.o.now?.() ?? new Date().toISOString();
    const seen = new Set<string>();
    const sources: Source[] = [];
    for (const r of raw) {
      const url = r.url.trim();
      if (!safeUrl.safeParse(url).success || !url || !r.snippet) continue;
      // The same page under another address (mobile site, #section, tracking, trailing slash) counts once.
      const key = pageKey(url);
      if (seen.has(key)) continue;
      seen.add(key);
      const snippet = r.snippet.slice(0, 4000);
      sources.push({
        id: `s${sources.length + 1}`,
        connector: r.from?.id ?? 'web-search',
        kind: r.kind ?? 'connector',
        url,
        title: r.title.slice(0, 300) || url,
        publisher: r.publisher.slice(0, 160),
        tier: r.tier ?? r.from?.tier ?? 5,
        category: r.category ?? r.from?.sourceCategory ?? 'unknown',
        publishedAt: r.publishedAt ?? null,
        retrievedAt: now,
        snippet,
        contentHash: createHash('sha256').update(snippet).digest('hex'),
        license: (r.license ?? r.from?.license ?? null)?.slice(0, 120) ?? null,
        note: r.note?.slice(0, 300) ?? null,
      });
      if (sources.length >= 24) break;
    }
    // Most authoritative first: the model reads them in this order.
    sources.sort((a, b) => a.tier - b.tier);
    sources.forEach((s, i) => (s.id = `s${i + 1}`));
    if (!jobs.length) notes.push('No reference source covers this kind of object.');
    return { sources, notes: notes.slice(0, 10) };
  }
}
