import type { Category } from '../../src/shared/epistemics';
import type { Source } from '../../src/shared/schema';
import type { RetrieveQuery } from '../../src/shared/tasks';

/** A source before it gets an id, a hash and a retrieval time. */
export type RawSource = Pick<Source, 'url' | 'title' | 'publisher' | 'snippet'> &
  Partial<Pick<Source, 'publishedAt' | 'license' | 'note' | 'tier' | 'category' | 'kind'>>;

export interface ConnectorCtx {
  fetchJson: (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<unknown>;
  signal?: AbortSignal;
  category: Category;
  textRead: string[];
}

export interface Connector {
  id: string;
  label: string;
  tier: Source['tier'];
  sourceCategory: Source['category'];
  license: string | null;
  /** Which queries this connector should run for an object of this category. Empty means skip. */
  pick(queries: RetrieveQuery[], category: Category, textRead: string[]): string[];
  search(query: string, ctx: ConnectorCtx): Promise<RawSource[]>;
}

export const clip = (s: unknown, n = 4000): string =>
  String(s ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, n);

export const firstOf = (queries: RetrieveQuery[], intents: RetrieveQuery['intent'][], n = 1): string[] => {
  const hit = queries.filter((q) => intents.includes(q.intent)).map((q) => q.query);
  const rest = queries.map((q) => q.query);
  return [...new Set([...hit, ...rest])].slice(0, n);
};
