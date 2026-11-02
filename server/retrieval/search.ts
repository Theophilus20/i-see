/**
 * Search grounding with Muse Spark (Responses API, built-in web_search tool).
 *
 * The model decides whether to search; when it does, each supported passage of its
 * answer carries a url_citation annotation. Those become Sources of kind "search".
 * Their snippet is the cited span of the model's answer, not the page itself, so the
 * firewall marks claims resting only on them as "tool-cited" rather than "verified".
 */
import type { HttpClient } from '../meta/http';
import { usageFrom } from '../meta/usage';
import type { Usage } from '../../src/shared/schema';
import type { RawSource } from './types';

interface Annotation {
  type?: string;
  url?: string;
  title?: string;
  start_index?: number;
  end_index?: number;
}

export function parseGrounded(data: unknown): { sources: RawSource[]; searched: boolean; text: string } {
  const output = (data as { output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string; annotations?: Annotation[] }> }> })?.output ?? [];
  const searched = output.some((o) => o?.type === 'web_search_call');
  const byUrl = new Map<string, { title: string; spans: string[] }>();
  let full = '';
  for (const item of output) {
    if (item?.type !== 'message') continue;
    for (const block of item.content ?? []) {
      if (block?.type !== 'output_text' || typeof block.text !== 'string') continue;
      full += block.text;
      for (const a of block.annotations ?? []) {
        if (a?.type !== 'url_citation' || typeof a.url !== 'string' || !/^https?:\/\//i.test(a.url)) continue;
        const s = Math.max(0, a.start_index ?? 0);
        const e = Math.min(block.text.length, a.end_index ?? s);
        // Extend a short span to the sentence it sits in, so the snippet reads as a claim.
        let from = s;
        while (from > 0 && !/[.!?\n]/.test(block.text[from - 1]!)) from--;
        const span = block.text.slice(from, Math.max(e, s)).trim();
        const entry = byUrl.get(a.url) ?? { title: a.title || a.url, spans: [] };
        if (span && !entry.spans.includes(span)) entry.spans.push(span);
        byUrl.set(a.url, entry);
      }
    }
  }
  const sources: RawSource[] = [...byUrl.entries()].slice(0, 8).map(([url, v]) => {
    let host = url;
    try {
      host = new URL(url).host.replace(/^www\./, '');
    } catch {
      /* keep */
    }
    return {
      url,
      title: v.title.slice(0, 300),
      publisher: host,
      snippet: v.spans.join(' … ').slice(0, 4000),
      kind: 'search',
      tier: 4,
      category: 'search',
      note: 'Found by Muse Spark web search. The snippet is the passage of the search answer that cites this page; the page itself was not fetched.',
    };
  });
  return { sources, searched, text: full };
}

export async function groundedSearch(
  client: HttpClient,
  model: string,
  queries: string[],
  signal?: AbortSignal,
): Promise<{ sources: RawSource[]; searched: boolean; usage: Usage | null }> {
  const prompt = `Find reliable reference information about this physical object. Look up: ${queries
    .slice(0, 5)
    .map((q) => JSON.stringify(q))
    .join(', ')}. In short factual sentences, cover: what it is, and the features that distinguish it from similar things; what it is like inside (its internal parts, or for a living thing its anatomy, organs and skeleton); who makes it (the brand or maker, and the maker's history: when, where and by whom it was founded); when and how this kind of object was invented or developed; what it is made of; specifications; and any safety notices or recalls. Only include facts about this object, its maker and its kind; nothing unrelated. Prefer the manufacturer, regulators, museums, encyclopedias and standards bodies. Cite every sentence.`;
  const { data } = await client.postJson('/responses', { model, input: prompt, tools: [{ type: 'web_search', search_context_size: 'high' }], store: false }, { signal, timeoutMs: 75_000, maxRetries: 0 });
  const parsed = parseGrounded(data);
  return { sources: parsed.sources, searched: parsed.searched, usage: usageFrom((data as { usage?: unknown }).usage, model) };
}

/** What a thing is like inside, researched on the web: anatomy and skeleton, internal parts, or structure. */
export function insideResearchPrompt(object: string, category: string): string {
  const living = ['animal', 'plant', 'fungus'].includes(category);
  const natural = category === 'mineral';
  if (living)
    return `Describe the real internal anatomy of a ${JSON.stringify(object)}: its skeleton (the main bones by name: skull, jaw, spine and its regions, ribs, shoulder, pelvis, limb bones, tail where it has one) and how the skeleton is arranged; its main organs (brain, heart, lungs, stomach, intestines, liver, kidneys and any special to it) and exactly where each sits in the body; and what each does. Include anything unusual about this species compared with similar animals. Use veterinary, zoological and anatomical references. Cite every sentence.`;
  if (natural)
    return `Describe the internal structure of ${JSON.stringify(object)}: what it is made of (minerals, layers, grains, crystals), how they are arranged from outside to inside, and how it formed. Use geological and museum references. Cite every sentence.`;
  return `Describe what is inside a ${JSON.stringify(object)}: every internal part by its real name, where it sits, what it is made of and what it does, and how the parts work together, step by step. Use the manufacturer's documentation, teardown and repair guides, engineering references and encyclopedias. Cite every sentence.`;
}

export async function insideResearch(
  client: HttpClient,
  model: string,
  object: string,
  category: string,
  signal?: AbortSignal,
): Promise<{ sources: RawSource[]; text: string; usage: Usage | null }> {
  const { data } = await client.postJson(
    '/responses',
    { model, input: insideResearchPrompt(object, category), tools: [{ type: 'web_search', search_context_size: 'high' }], store: false },
    { signal, timeoutMs: 75_000, maxRetries: 0 },
  );
  const parsed = parseGrounded(data);
  return { sources: parsed.sources, text: parsed.text, usage: usageFrom((data as { usage?: unknown }).usage, model) };
}

/** The named parts this kind of object has, from reference sources, so outlines use real names. */
export function partsResearchPrompt(object: string, category: string): string {
  const living = ['animal', 'plant', 'fungus'].includes(category);
  const what = living
    ? 'the distinct external body parts that can be seen on it (each a separate piece with a visible edge, such as head, ear, eye, muzzle or beak, horn, neck, leg, hoof or paw, tail, udder, wing, leaf blade, petiole, stem, flower; not surface areas such as back, belly, flank or rump), by the names vets, zoologists or botanists use'
    : 'every distinct part that can be seen on the outside of it (body, panels, handles or straps, closures, fittings, hardware such as rings, rivets and buckles, controls, trims, labels, decorations), each a separate piece with a visible edge, by the names its makers, retailers and repairers use';
  return `List ${what} for a ${JSON.stringify(object)}. Answer only as a list, one part per line, in the form "- Part name: what it is and where it sits". Use reliable sources: manufacturers, retailers' product descriptions, repair guides, encyclopedias and specialist references. Cite every line.`;
}

/** "- Handles: two shoulder straps…" → "Handles". */
export function partNamesFrom(text: string, max = 12): string[] {
  const names: string[] = [];
  for (const line of text.split(/\n+/)) {
    const m = /^\s*(?:[-*•]|\d+[.)])\s*(?:\*\*)?([^:*\n]{2,48}?)(?:\*\*)?\s*[:–—-]\s+\S/.exec(line);
    if (!m) continue;
    const name = m[1]!.replace(/\[[^\]]*\]|\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
    if (!name || name.split(' ').length > 5 || /^(?:note|source|sources|summary|overview)$/i.test(name)) continue;
    if (!names.some((n) => n.toLowerCase() === name.toLowerCase())) names.push(name);
    if (names.length >= max) break;
  }
  return names;
}

export async function partsResearch(
  client: HttpClient,
  model: string,
  object: string,
  category: string,
  signal?: AbortSignal,
): Promise<{ names: string[]; sources: RawSource[]; usage: Usage | null }> {
  const { data } = await client.postJson(
    '/responses',
    { model, input: partsResearchPrompt(object, category), tools: [{ type: 'web_search', search_context_size: 'medium' }], store: false },
    { signal, timeoutMs: 50_000, maxRetries: 0 },
  );
  const parsed = parseGrounded(data);
  return { names: partNamesFrom(parsed.text), sources: parsed.sources, usage: usageFrom((data as { usage?: unknown }).usage, model) };
}
