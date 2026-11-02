/**
 * Real reference pictures of what is inside a kind of thing (a cow's skeleton, a cow's organs,
 * the inside of a car engine), from Wikimedia Commons. They are given to the image model, with
 * the photo, so it copies true anatomy instead of drawing from memory. They are not shown.
 *
 * Only pictures that need no credit are used: public domain (old anatomy plates, government
 * works) or CC0. Pictures under licences that ask for credit (CC BY, CC BY-SA) are skipped, so
 * nothing has to be credited on the page. If none is found, the drawing is made without one.
 */
import sharp from 'sharp';
import type { ImagePayload } from '../../src/shared/tasks';
import { log } from '../log';

export interface ReferencePicture {
  title: string;
  /** The file's page on Wikimedia Commons. */
  page: string;
  license: string;
  /** For the image model: at most 1024 px. */
  image: ImagePayload;
}

const strip = (html: unknown) =>
  String(html ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);

/** Words that mark a picture as a picture of the inside. */
const INSIDE = /\b(skeleton|skeletal|anatomy|anatomical|organs?|viscera|visceral|internal|dissection|cutaway|cut-away|cross[- ]section|interior|inside|engine|teardown|exploded|bones?|osteology|digestive|rumen|stomach)\b/i;
/** Pictures that would mislead: maps, charts, logos, texts, butchery. */
const UNWANTED = /\b(map|logo|icon|flag|chart|graph|stamp|coin|meat cuts?|beef cuts?|butcher|menu|poster|book cover|pdf|djvu)\b/i;
/** Licences that ask for nothing: public domain (any PD tag, the Public Domain Mark) and CC0. */
const NO_CREDIT = /^(public domain|pd\b|pd[- ]|pdm\b|cc0|cc[- ]zero|cc pdm|no restrictions)/i;

export function needsNoCredit(license: string, attributionRequired: unknown): boolean {
  return NO_CREDIT.test(license.trim()) && String(attributionRequired ?? '').toLowerCase() !== 'true';
}

export function commonsSearchUrl(query: string, limit = 20): string {
  const p = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrnamespace: '6',
    gsrsearch: `${query} filetype:bitmap|drawing`,
    gsrlimit: String(limit),
    prop: 'imageinfo',
    iiprop: 'url|mime|size|extmetadata',
    iiurlwidth: '1024',
    format: 'json',
    formatversion: '2',
    origin: '*',
  });
  return `https://commons.wikimedia.org/w/api.php?${p}`;
}

interface CommonsPage {
  title?: string;
  index?: number;
  imageinfo?: Array<{
    thumburl?: string;
    descriptionurl?: string;
    mime?: string;
    width?: number;
    height?: number;
    extmetadata?: Record<string, { value?: unknown }>;
  }>;
}

/** The best candidates in a Commons search answer: pictures of the inside, large enough, needing no credit. */
export function pickCommons(json: unknown, query: string): Array<{ title: string; page: string; thumb: string; license: string }> {
  const pages = ((json as { query?: { pages?: CommonsPage[] } })?.query?.pages ?? []).slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const want = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  return pages
    .map((p) => {
      const ii = p.imageinfo?.[0];
      const meta = ii?.extmetadata ?? {};
      const title = String(p.title ?? '').replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, '').replace(/_/g, ' ');
      const text = `${title} ${strip(meta.ImageDescription?.value)} ${strip(meta.Categories?.value)}`;
      const license = strip(meta.LicenseShortName?.value);
      const ok =
        !!ii?.thumburl &&
        /^image\/(jpeg|png|svg\+xml|webp)$/.test(String(ii.mime)) &&
        (ii.width ?? 0) >= 500 &&
        INSIDE.test(text) &&
        !UNWANTED.test(text) &&
        needsNoCredit(license, meta.AttributionRequired?.value);
      // Rank: how many of the query's words the title has, and diagrams of the whole body first.
      const score = want.filter((w) => title.toLowerCase().includes(w)).length + (/skeleton|anatomy|organs/i.test(title) ? 1 : 0);
      return ok ? { title, page: String(ii!.descriptionurl ?? ''), thumb: String(ii!.thumburl), license, score } : null;
    })
    .filter((x): x is NonNullable<typeof x> => !!x && /^https:\/\//.test(x.page) && /^https:\/\//.test(x.thumb))
    .sort((a, b) => b.score - a.score)
    .map(({ score: _s, ...x }) => x);
}

/**
 * Up to `max` reference pictures for the given searches, in order (one per search first), each
 * downloaded and prepared for the image model.
 */
export async function referencePictures(fetchImpl: typeof fetch, queries: string[], max = 2, signal?: AbortSignal): Promise<ReferencePicture[]> {
  const budget = AbortSignal.timeout(20_000);
  const sig = signal ? AbortSignal.any([signal, budget]) : budget;
  const headers = { 'user-agent': 'I-SEE/0.1 (object explainer; reference pictures)' };
  const found: Array<ReturnType<typeof pickCommons>[number]> = [];
  for (const q of queries.slice(0, 5)) {
    if (found.length >= max) break;
    try {
      const res = await fetchImpl(commonsSearchUrl(q), { signal: sig, headers });
      if (!res.ok) continue;
      const best = pickCommons(await res.json(), q).find((c) => !found.some((f) => f.page === c.page));
      if (best) found.push(best);
    } catch (e) {
      log('warn', 'reference picture search failed', { query: q, error: (e as Error).message });
    }
  }
  const out: ReferencePicture[] = [];
  for (const f of found.slice(0, max)) {
    try {
      const res = await fetchImpl(f.thumb, { signal: sig, headers });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      const big = await sharp(buf).flatten({ background: '#ffffff' }).resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer({ resolveWithObject: true });
      out.push({
        title: f.title,
        page: f.page,
        license: f.license,
        image: { mime: 'image/jpeg', base64: big.data.toString('base64'), width: big.info.width, height: big.info.height, label: null },
      });
    } catch (e) {
      log('warn', 'reference picture download failed', { title: f.title, error: (e as Error).message });
    }
  }
  if (!out.length) log('info', 'no public-domain reference picture found; drawing without one', { queries: queries.slice(0, 5) });
  return out;
}
