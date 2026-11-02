/**
 * Accurate part labels on an image (a photo or a drawing of the inside).
 *
 * Photos: regions first, names second (Set-of-Mark prompting, and SAM's own automatic mask
 * generation). Vision models place boxes poorly but choose among marked regions well (86%
 * against 26% on RefCOCOg in the Set-of-Mark study), and an image is only pixels: SAM traces
 * which pixels belong together. So:
 *   1. Look, don't list: Muse Spark says what it can see (only parts noticed in this photo are
 *      named; reference names are for naming only) and roughly where, and the whole object's box.
 *   2. SAM 3.1 outlines the whole object, then traces the region under a grid of points over it,
 *      under where each part was seen, and finds each part by its short name.
 *   3. Duplicates, the whole object and regions made of other regions are removed (as SAM's
 *      automatic mode does), leaving the object's own regions, each following real edges.
 *   4. Muse Spark names each numbered region (with close-ups of the small ones), or says it is
 *      not a part of this object (background, a pot, soil, another leaf). Pieces of one part
 *      that touch are joined; parts no region covered are outlined from a box.
 *   5. One outline per spot, short generic names, at most 16 parts.
 * If that cannot run, each part's box is outlined (SAM 3.1, also by name) and every outline is
 * checked without its name (steps 2b and 3 below). Drawings are named by numbered outlines too
 * (nameByMarks).
 */
import sharp from 'sharp';
import { buildObjectPrompt, decodeMaskToRaster, recordsOfKind } from '@meta-sam/parser';
import { CloseNameSchema, GroundOutputSchema, LabelCheckOutputSchema, MarkNamesSchema, NameOutlineSchema, PartMarksSchema, SecondOpinionSchema, type CloseName } from '../../src/shared/model-io';
import { CLOSE_NAME_SYSTEM, GROUND_SYSTEM, LABEL_CHECK_SYSTEM, PART_MARKS_SYSTEM, closeNameUser, groundUser, labelCheckUser, partMarksUser } from '../../src/shared/prompts';
import type { Region } from '../../src/shared/schema';
import type { ImagePayload } from '../../src/shared/tasks';
import { normalizeForMatch, sanitizeText } from '../../src/shared/text';
import type { HttpClient } from './http';
import { log } from '../log';
import { cleanRaster, coarseMask, dilate, fullRaster, interiorPoint, maskGeometry, positionalNames, runSam, samSegment, scalePath, tidyRegions } from './sam';
import { chatStructured } from './structured';
import { strokeNumber } from './digits';

export interface LabelDeps {
  client: HttpClient;
  samModel: string;
  sparkModel: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

type Box01k = { x_min: number; y_min: number; x_max: number; y_max: number };
type PxBox = { left: number; top: number; right: number; bottom: number };

const toPx = (b: Box01k, view: { width: number; height: number }): PxBox | null => {
  const c = (v: number, max: number) => Math.max(0, Math.min(max, Math.round((Math.max(0, Math.min(1000, Number(v) || 0)) / 1000) * max)));
  const left = c(Math.min(b.x_min, b.x_max), view.width);
  const right = c(Math.max(b.x_min, b.x_max), view.width);
  const top = c(Math.min(b.y_min, b.y_max), view.height);
  const bottom = c(Math.max(b.y_min, b.y_max), view.height);
  if (right - left < 3 || bottom - top < 3) return null;
  return { left, top, right, bottom };
};

/** Short label for display: "white-coated domestic cat with eyeglasses" → "white-coated domestic cat". */
export function shortName(name: string): string {
  const s = sanitizeText(name, 120).replace(/\s+/g, ' ').replace(/[\s!?.,;:]+$/, '').trim();
  const cut = s.split(/\s+(?:with|wearing|holding|on top of|in front of|next to|sitting on|lying on)\s+/i)[0] ?? s;
  const words = cut.split(' ');
  return words.length > 6 ? words.slice(0, 6).join(' ') : cut;
}

/** A part of the image, enlarged, for looking closely: the payload and how to map back. */
export async function zoomCrop(view: ImagePayload, box: PxBox, maxSide = 1024): Promise<{ img: ImagePayload; box: PxBox; scale: number }> {
  const left = Math.max(0, Math.floor(box.left));
  const top = Math.max(0, Math.floor(box.top));
  const width = Math.max(8, Math.min(view.width - left, Math.ceil(box.right - box.left)));
  const height = Math.max(8, Math.min(view.height - top, Math.ceil(box.bottom - box.top)));
  const scale = Math.min(4, maxSide / Math.max(width, height));
  const buf = await sharp(Buffer.from(view.base64, 'base64'))
    .extract({ left, top, width, height })
    .resize({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), kernel: 'lanczos3' })
    .jpeg({ quality: 90 })
    .toBuffer({ resolveWithObject: true });
  return {
    img: { mime: 'image/jpeg', base64: buf.data.toString('base64'), width: buf.info.width, height: buf.info.height, label: null },
    box: { left, top, right: left + width, bottom: top + height },
    scale,
  };
}

/**
 * Groups small boxes that sit close together (the eyes, nose, mouth and ears on a head) into
 * a few close-up areas, each with some context around it.
 */
export function smallClusters(boxes: PxBox[], view: { width: number; height: number }, maxClusters = 4): Array<{ area: PxBox; members: number[] }> {
  const W = view.width;
  const H = view.height;
  const small = boxes.map((b, i) => ({ b, i })).filter(({ b }) => (b.right - b.left) * (b.bottom - b.top) < W * H * 0.06);
  const grow = (b: PxBox, by: number): PxBox => ({ left: Math.max(0, b.left - by), top: Math.max(0, b.top - by), right: Math.min(W, b.right + by), bottom: Math.min(H, b.bottom + by) });
  const meets = (a: PxBox, b: PxBox) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  let clusters = small.map(({ b, i }) => ({ area: grow(b, Math.max(b.right - b.left, b.bottom - b.top) * 0.6), members: [i] }));
  for (let changed = true; changed; ) {
    changed = false;
    outer: for (let a = 0; a < clusters.length; a++)
      for (let b = a + 1; b < clusters.length; b++)
        if (meets(clusters[a]!.area, clusters[b]!.area)) {
          const x = clusters[a]!;
          const y = clusters[b]!;
          clusters[a] = { area: { left: Math.min(x.area.left, y.area.left), top: Math.min(x.area.top, y.area.top), right: Math.max(x.area.right, y.area.right), bottom: Math.max(x.area.bottom, y.area.bottom) }, members: [...x.members, ...y.members] };
          clusters.splice(b, 1);
          changed = true;
          break outer;
        }
  }
  // Some context round each close-up, and never smaller than a fifth of the image.
  const minSide = Math.min(W, H) * 0.2;
  clusters = clusters.map((c) => {
    const w = c.area.right - c.area.left;
    const h = c.area.bottom - c.area.top;
    const padX = Math.max(w * 0.25, (minSide - w) / 2, 0);
    const padY = Math.max(h * 0.25, (minSide - h) / 2, 0);
    return { ...c, area: { left: Math.max(0, c.area.left - padX), top: Math.max(0, c.area.top - padY), right: Math.min(W, c.area.right + padX), bottom: Math.min(H, c.area.bottom + padY) } };
  });
  return clusters.sort((a, b) => b.members.length - a.members.length).slice(0, maxClusters);
}

interface Item {
  name: string;
  /** Position of the name in the list (0 = the whole object). */
  rank: number;
  boxes: PxBox[];
}

/**
 * SAM 3.1 on boxes: one request, one object per box. Returns one region per box (mask, or the box itself).
 * With `clip`, the whole object's outline (the item ranked 0) bounds every part: parts are trimmed
 * to it, and a "part" that lies mostly outside the object is dropped. `within` reuses that bound.
 */
async function samBoxes(
  deps: LabelDeps,
  view: ImagePayload,
  items: Item[],
  viewIndex: number,
  source: Region['source'],
  bound: { clip: boolean; within: Uint8Array | null } = { clip: false, within: null },
) {
  const flat = items.flatMap((it) => it.boxes.map((b) => ({ it, b }))).slice(0, 30);
  const out: Array<Omit<Region, 'id'> & { concept: number; name: string }> = [];
  if (!flat.length) return { out, within: bound.within, core: null as Uint8Array | null, masks: [] as Array<{ rank: number; m: ReturnType<typeof recordsOfKind<'mask'>>[number] }> };
  const areaOf = (b: PxBox) => Math.max(1, (b.right - b.left) * (b.bottom - b.top));
  const centre = (b: PxBox) => ({ x: Math.min(view.width - 1, Math.round((b.left + b.right) / 2)), y: Math.min(view.height - 1, Math.round((b.top + b.bottom) / 2)) });
  // A neighbouring part of similar size whose middle falls inside this box (the nose inside a
  // "mouth" box) is marked as "not this", so the outline does not spill onto it.
  const negativesFor = (f: (typeof flat)[number]) =>
    f.it.rank === 0
      ? []
      : flat
          .filter((o) => o.it !== f.it && o.it.rank !== 0)
          .filter((o) => {
            const c = centre(o.b);
            const ratio = areaOf(o.b) / areaOf(f.b);
            return c.x > f.b.left && c.x < f.b.right && c.y > f.b.top && c.y < f.b.bottom && ratio >= 0.2 && ratio <= 1.5;
          })
          .slice(0, 3)
          .map((o) => ({ ...centre(o.b), label: 'negative' as const }));
  const promptFor = (f: (typeof flat)[number], id: number) => ({
    id,
    prompts: [
      {
        box: { left: f.b.left, top: f.b.top, right: Math.min(view.width, Math.max(f.b.left + 1, f.b.right)), bottom: Math.min(view.height, Math.max(f.b.top + 1, f.b.bottom)) },
        points: [{ ...centre(f.b), label: 'positive' as const }, ...negativesFor(f)],
      },
    ],
  });
  type Mask = ReturnType<typeof recordsOfKind<'mask'>>[number];
  const found = new Map<number, Mask>();
  // An outline belongs to its box only if it actually sits on it. On the first try, a part's
  // outline must also not be far larger than its box (a "side mirror" outline that covers the
  // whole door window): such a part is asked for again on its own.
  const fits = (m: Mask, f: (typeof flat)[number], strict: boolean) => {
    const ix = Math.max(0, Math.min(m.bounds.right, f.b.right) - Math.max(m.bounds.left, f.b.left));
    const iy = Math.max(0, Math.min(m.bounds.bottom, f.b.bottom) - Math.max(m.bounds.top, f.b.top));
    const inter = ix * iy;
    const ma = Math.max(1, (m.bounds.right - m.bounds.left) * (m.bounds.bottom - m.bounds.top));
    const ba = Math.max(1, (f.b.right - f.b.left) * (f.b.bottom - f.b.top));
    if (strict && f.it.rank !== 0 && ma > ba * 4 && inter / ma < 0.5) return false;
    return inter / ma >= 0.3 || inter / ba >= 0.3;
  };
  // An outline far larger than its part's box has spilled onto other parts: it is cut to the box,
  // with a generous margin. An outline of about the right size is never cut (a box drawn a little
  // tight must not chop the edge off a good outline).
  const clipFor = (f: (typeof flat)[number], m: Mask) => {
    const ma = (m.bounds.right - m.bounds.left) * (m.bounds.bottom - m.bounds.top);
    const ba = Math.max(1, (f.b.right - f.b.left) * (f.b.bottom - f.b.top));
    if (f.it.rank === 0 || ma <= ba * 2.5) return null;
    const mx = Math.max(10, (f.b.right - f.b.left) * 0.3);
    const my = Math.max(10, (f.b.bottom - f.b.top) * 0.3);
    return { left: f.b.left - mx, top: f.b.top - my, right: f.b.right + mx, bottom: f.b.bottom + my };
  };
  const ask = async (idx: number[], strict = true) => {
    try {
      const text = buildObjectPrompt({ size: { width: view.width, height: view.height }, objects: idx.map((i) => promptFor(flat[i]!, i)) });
      const { result } = await runSam(deps.client, deps.samModel, text, view, deps.signal);
      for (const m of recordsOfKind(result.records, 'mask')) {
        const i = Number(m.objectId);
        if (!idx.includes(i) || found.has(i)) continue;
        if (fits(m, flat[i]!, strict)) found.set(i, m);
      }
      if (result.outcome.status !== 'completed') log('warn', 'outlining ended early', { status: result.outcome.status, asked: idx.length });
    } catch (e) {
      log('warn', 'box outlining failed', { error: (e as Error).message, asked: idx.length });
    }
  };
  // Several small requests rather than one big one: a long answer with many large outlines
  // can be cut short, which loses the outlines after the first few.
  const all = flat.map((_, i) => i);
  const batches: number[][] = [];
  for (let i = 0; i < all.length; i += 5) batches.push(all.slice(i, i + 5));
  const pool = async (jobs: number[][], limit: number, strict = true) => {
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, async () => {
      while (next < jobs.length) await ask(jobs[next++]!, strict);
    }));
  };
  await pool(batches, 3);
  // Anything still without an outline gets one request of its own.
  const missing = all.filter((i) => !found.has(i));
  // On its own, an outline that is still too large is accepted: it is cut to the part's box below.
  if (missing.length) await pool(missing.slice(0, 16).map((i) => [i]), 4, false);
  if (found.size < flat.length) log('info', 'some parts could not be outlined', { outlined: found.size, asked: flat.length });
  const maskOf = (i: number) => found.get(i);

  // The whole object's outline (`core`), and the same grown by a few pixels (`within`), so that
  // the very edge of a part is not shaved off. Only a few pixels: grown further, the parts'
  // outlines could run out onto the background around the object.
  let within = bound.within;
  let core: Uint8Array | null = null;
  if (bound.clip && !within) {
    const wi = flat.findIndex((f) => f.it.rank === 0);
    const m = wi >= 0 ? maskOf(wi) : undefined;
    const full = m ? fullRaster(m, view) : null;
    if (full) {
      let n = 0;
      for (let i = 0; i < full.length; i++) n += full[i]!;
      if (n > view.width * view.height * 0.01) {
        core = full;
        within = dilate(full, view.width, view.height, edgeMargin(view));
      }
    }
  }
  const geoms = flat.map((f, i) => {
    const m = maskOf(i);
    return m ? maskGeometry(m, view, f.it.rank === 0 ? null : within, clipFor(f, m)) : null;
  });
  // If the "whole object" outline would throw away most of the parts, it is the outline that is wrong.
  const parts = flat.map((f, i) => ({ f, g: geoms[i] })).filter((x) => x.f.it.rank !== 0 && x.g);
  const outside = parts.filter((x) => x.g!.kept < 0.3).length;
  const trust = !!within && (parts.length === 0 || outside <= Math.max(1, Math.floor(parts.length / 2)));
  flat.forEach((f, i) => {
    const m = maskOf(i);
    let g = geoms[i];
    if (m && within && !trust && f.it.rank !== 0) g = maskGeometry(m, view, null, clipFor(f, m));
    if (g && trust && f.it.rank !== 0 && g.kept < 0.3) return; // mostly outside the object
    // Cut down to its box and almost all of it was somewhere else: it outlined a different, larger thing.
    if (g && m && clipFor(f, m) && g.inBox < 0.12) {
      log('info', 'dropped an outline that lay outside its part', { part: f.it.name });
      return;
    }
    const b = g?.bounds ?? m?.bounds ?? null;
    const box = b ? { x: b.left, y: b.top, w: b.right - b.left, h: b.bottom - b.top } : { x: f.b.left, y: f.b.top, w: f.b.right - f.b.left, h: f.b.bottom - f.b.top };
    out.push({
      concept: f.it.rank,
      name: f.it.name,
      label: f.it.name,
      kind: g?.path ? 'mask' : 'box',
      source,
      view: viewIndex,
      box,
      path: g?.path ?? `M${box.x} ${box.y}H${box.x + box.w}V${box.y + box.h}H${box.x}Z`,
      anchor: g?.anchor ?? { x: box.x + box.w / 2, y: box.y + box.h / 2 },
      area: g?.area ?? (box.w * box.h) / (view.width * view.height),
      confidence: m?.confidence ?? null,
    });
  });
  // Several instances of one part: name them by where they are ("left earcup").
  for (const it of items) {
    const mine = out.filter((o) => o.name === it.name);
    if (mine.length > 1) {
      const names = positionalNames(it.name, mine.map((o) => o.anchor));
      mine.forEach((o, k) => (o.label = names[k]!));
    }
  }
  const masks = flat.map((f, i) => ({ rank: f.it.rank, m: maskOf(i) })).filter((x): x is { rank: number; m: Mask } => !!x.m);
  return { out, within: trust ? within : null, core: trust ? core : null, masks };
}

/** How far a part may reach past the whole object's outline, in pixels (about 0.6% of the photo). */
export const edgeMargin = (view: { width: number; height: number }) => Math.max(3, Math.round(Math.min(view.width, view.height) * 0.006));

/** The fraction of a mask's pixels that lie on the object (`core`, full image size). */
export function shareOn(m: MaskRec, view: { width: number; height: number }, core: Uint8Array): number {
  try {
    const w = m.mask.width;
    const h = m.mask.height;
    const r = decodeMaskToRaster(m.mask);
    const { left, top } = m.bounds;
    let n = 0;
    let on = 0;
    for (let y = 0; y < h; y++) {
      const gy = y + top;
      for (let x = 0; x < w; x++) {
        if (!r[y * w + x]) continue;
        n++;
        const gx = x + left;
        if (gx >= 0 && gy >= 0 && gx < view.width && gy < view.height && core[gy * view.width + gx]) on++;
      }
    }
    return n ? on / n : 0;
  } catch {
    return 0;
  }
}

const iou = (a: Region['box'], b: Region['box']) => {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
};

/** A second outline of the whole object under another name ("GOYA olive oil" for "oil bottle") is dropped. */
function dropWholeDuplicates<R extends { concept: number; box: Region['box']; area: number }>(list: R[]): R[] {
  const whole = list.find((r) => r.concept === 0);
  if (!whole) return list;
  return list.filter((r) => r === whole || !(iou(r.box, whole.box) > 0.8 && r.area > whole.area * 0.7));
}

/** Words that describe a feature, finish, size or colour, not which part it is. */
// (Colours and sizes are not removed: "small intestine", "white matter" and "large bowel" are names.)
const FEATURE_WORDS = /^(?:illuminated|automatic|auto|led|chrome|chromed|glossy|gloss|matte|polished|decorative|stylish|sleek|modern|signature|premium|sporty|aerodynamic|integrated|shiny|metallic|visible|prominent|distinctive|iconic|branded|brand|logo-bearing)$/i;
/** Short technical names that are part names, not brands. */
const KEEP_ACRONYMS = /^(?:USB|USB-C|HDMI|SIM|SD|LCD|OLED|AC|DC|CPU|GPU|RAM|SSD|ABS|AUX)$/;

/**
 * A part's name as a reference book would give it: generic and short ("Emblem", "Headlight"),
 * never a brand, model or sales feature ("Illuminated front Volkswagen logo", "Automatic LED
 * headlamps"). Short names are also what the outliner understands best (SAM 3 is built for
 * simple noun phrases).
 */
export function cleanPartName(name: string, object: string | null = null): string {
  // Only the first of alternatives ("Blade (bar/shank)", "Shank/blade") is the name.
  const raw = sanitizeText(name, 80)
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .split(/\s*(?:\/|\bor\b)\s*/i)[0]!
    .replace(/["“”{}()[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const brand = new Set(
    normalizeForMatch(object ?? '')
      .split(' ')
      .filter((w) => w.length >= 2),
  );
  const words = raw.split(' ').filter(Boolean);
  let kept = words.filter((w) => {
    const n = normalizeForMatch(w);
    if (!n) return false;
    if (FEATURE_WORDS.test(n)) return false;
    if (/\d/.test(w) && !KEEP_ACRONYMS.test(w)) return false; // model numbers
    if (/^[A-Z]{2,4}$/.test(w) && !KEEP_ACRONYMS.test(w)) return false; // brand initials ("VW")
    if (brand.has(n) && words.length > 1) return false; // the object's own make or model
    return true;
  });
  if (!kept.length) kept = words.slice(-2);
  if (kept.length > 3) kept = kept.slice(-3);
  const out = kept.join(' ');
  return out ? out.charAt(0).toUpperCase() + out.slice(1) : sanitizeText(name, 60);
}

/** The simplest noun phrase for the outliner: "headlight", "door handle" (no side, no case). */
export function simplePhrase(name: string): string {
  return normalizeForMatch(baseName(cleanPartName(name))).split(' ').slice(-3).join(' ');
}

/**
 * The same thing outlined twice under different names ("Headlight" and "Automatic LED
 * headlamps" on one spot): only the better one stays (non-maximum suppression across names, as
 * in standard segmentation pipelines). Better means: confirmed by two independent routes, then
 * a standard name, then more certain, then shorter.
 */
export function dropOverlaps<R extends { concept: number; label: string; box: Region['box']; area: number; confidence?: number | null; agreed?: boolean }>(list: R[], vocabulary: string[] = []): R[] {
  const known = new Set(vocabulary.map((v) => normalizeForMatch(v)));
  const score = (r: R) => (r.agreed ? 4 : 0) + (known.has(normalizeForMatch(baseName(r.label))) ? 1 : 0) + (r.confidence ?? 0) - r.label.split(' ').length * 0.05;
  const kept = new Set<R>();
  for (const r of [...list].sort((a, b) => score(b) - score(a))) {
    if (r.concept === 0) {
      kept.add(r);
      continue;
    }
    const dup = [...kept].some((k) => k.concept !== 0 && iou(k.box, r.box) > 0.6 && Math.min(k.area, r.area) / Math.max(k.area, r.area, 1e-9) > 0.45);
    if (!dup) kept.add(r);
  }
  return list.filter((r) => kept.has(r));
}

/**
 * At most `max` parts, so the picture stays readable: the most certain are kept (confirmed by
 * two routes, then by confidence, then the larger). The whole object always stays.
 */
export function limitParts<R extends { concept: number; area: number; confidence?: number | null; agreed?: boolean }>(list: R[], max: number): R[] {
  const parts = list.filter((r) => r.concept !== 0);
  if (parts.length <= max) return list;
  const keep = new Set([...parts].sort((a, b) => Number(!!b.agreed) - Number(!!a.agreed) || (b.confidence ?? 0) - (a.confidence ?? 0) || b.area - a.area).slice(0, max));
  return list.filter((r) => r.concept === 0 || keep.has(r));
}

/** Names for the same part, by region or trade (a windscreen is a windshield). */
const SYNONYMS: string[][] = [
  ['windscreen', 'windshield', 'front windscreen', 'front windshield', 'front window'],
  ['bonnet', 'hood', 'engine cover'],
  ['boot', 'trunk', 'tailgate', 'boot lid', 'trunk lid'],
  ['tyre', 'tire'],
  ['wheel', 'alloy wheel', 'rim', 'wheel rim', 'hubcap'],
  ['wing mirror', 'side mirror', 'door mirror', 'mirror', 'rearview mirror'],
  ['number plate', 'license plate', 'licence plate', 'registration plate', 'plate'],
  ['headlight', 'headlamp', 'head light', 'front light', 'headlight unit'],
  ['tail light', 'taillight', 'rear light', 'tail lamp', 'brake light'],
  ['grille', 'grill', 'radiator grille', 'front grille', 'air intake'],
  ['emblem', 'badge', 'logo', 'brand logo', 'car logo'],
  ['bumper', 'front bumper', 'bumper cover'],
  ['side window', 'door window', 'window'],
  ['nose', 'nostrils', 'nostril'],
  ['muzzle', 'snout'],
  ['hoof', 'hooves', 'cloven hoof'],
  ['ear', 'ears', 'pinna'],
  ['screen', 'display', 'touchscreen'],
  ['earcup', 'ear cup', 'ear cushion', 'earpad', 'ear pad'],
];

/** Whether two names mean the same part ("Front windshield" and "windscreen", "Cloven hoof" and "hoof"). */
export function sameThing(a: string, b: string): boolean {
  const n = (s: string) => normalizeForMatch(baseName(s)).replace(/(?<=[a-z]{3})s$/, '');
  const x = n(a);
  const y = n(b);
  if (!x || !y) return false;
  if (x === y || x.endsWith(` ${y}`) || y.endsWith(` ${x}`)) return true;
  const head = (s: string) => s.split(' ').at(-1) ?? s;
  const group = (s: string) => SYNONYMS.findIndex((g) => g.some((w) => n(w) === s));
  const gx = group(x) >= 0 ? group(x) : group(head(x));
  const gy = group(y) >= 0 ? group(y) : group(head(y));
  return gx >= 0 && gx === gy;
}

const POSITION_WORDS = /^(?:(?:left|right|upper|lower|top|bottom|middle|centre|center|front|back|rear|near|far|inner|outer)\s+)+/i;
const baseName = (s: string) => s.replace(POSITION_WORDS, '').trim();

/**
 * One name, one part. Two outlines with the same name on the same spot are one part (the larger
 * is kept); same-named outlines in different places are told apart by where they are.
 */
export function uniqueNames<R extends { concept: number; label: string; name?: string; box: Region['box']; area: number; anchor: { x: number; y: number } }>(list: R[]): R[] {
  const overlap = (a: Region['box'], b: Region['box']) => {
    const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
    const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    return (ix * iy) / Math.max(1e-9, Math.min(a.w * a.h, b.w * b.h));
  };
  const key = (r: R) => normalizeForMatch(baseName(r.label));
  // The last word names the thing ("cloven hoof" and "hoof" are both a hoof).
  const head = (r: R) => key(r).split(' ').at(-1) ?? '';
  const byArea = list.map((r, i) => ({ r, i })).sort((a, b) => b.r.area - a.r.area);
  const kept: Array<{ r: R; i: number }> = [];
  for (const x of byArea) {
    const twin = kept.some(
      (k) =>
        k.r.concept !== 0 &&
        ((key(k.r) === key(x.r) && (iou(k.r.box, x.r.box) > 0.3 || overlap(k.r.box, x.r.box) > 0.6)) ||
          (head(k.r) === head(x.r) && head(x.r).length > 2 && overlap(k.r.box, x.r.box) > 0.6)),
    );
    if (x.r.concept !== 0 && twin) continue;
    kept.push(x);
  }
  const out = kept.sort((a, b) => a.i - b.i).map((x) => ({ ...x.r }));
  const groups = new Map<string, R[]>();
  for (const r of out) {
    if (r.concept === 0) continue;
    const k = key(r);
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  // Where the front of a vehicle is, from the parts that are always at the front.
  // (Only parts that exist at the front alone: a bumper, plate or badge can be the rear one.)
  const fronts = out.filter((r) => r.concept !== 0 && !/^(?:rear|back)\b/i.test(r.label.trim()) && FRONT_PARTS.test(normalizeForMatch(baseName(r.label))));
  const front = fronts.length ? { x: fronts.reduce((a, r) => a + r.anchor.x, 0) / fronts.length, y: fronts.reduce((a, r) => a + r.anchor.y, 0) / fronts.length } : null;
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const labels = new Set(g.map((r) => normalizeForMatch(r.label)));
    const base = baseName(g[0]!.label) || g[0]!.label;
    // Two doors or two wheels of a vehicle seen from the side: the one clearly nearer the front
    // parts is the front one. (Seen head-on, the front parts sit between them: left and right.)
    const d = (r: R) => (front ? Math.hypot(r.anchor.x - front.x, r.anchor.y - front.y) : 0);
    const apart = g.length === 2 ? Math.hypot(g[0]!.anchor.x - g[1]!.anchor.x, g[0]!.anchor.y - g[1]!.anchor.y) : 0;
    const sidePair = !!front && g.length === 2 && FRONT_REAR.test(normalizeForMatch(base).split(' ').at(-1) ?? '') && Math.abs(d(g[0]!) - d(g[1]!)) > apart * 0.5;
    let names: string[];
    if (sidePair && !g.every((r) => /^(?:front|rear)\b/i.test(r.label.trim()))) {
      const nearer = d(g[0]!) <= d(g[1]!) ? 0 : 1;
      const b = base.toLowerCase();
      names = g.map((_, k) => (k === nearer ? `Front ${b}` : `Rear ${b}`));
    } else {
      // Distinct names are kept, unless one is the bare name ("door" beside "left door"), which
      // says nothing about which one it is.
      const bare = g.some((r) => normalizeForMatch(r.label) === normalizeForMatch(base));
      if (labels.size === g.length && !bare) continue;
      names = positionalNames(base, g.map((r) => r.anchor));
    }
    g.forEach((r, k) => {
      r.label = names[k]!;
      if (r.name !== undefined) r.name = names[k]!;
    });
  }
  return out;
}

/** Parts that are always at the front of a vehicle. */
const FRONT_PARTS = /^(?:headlights?|headlamps?|grilles?|grills?|upper grille|lower grille|radiator grille|bonnet|hood|windscreen|windshield)$/;
/** Parts a vehicle has at the front and at the back. */
const FRONT_REAR = /^(?:doors?|wheels?|tyres?|tires?|windows?|seats?|arch(?:es)?|rims?|hubcaps?)$/;

/**
 * One style for part names: sentence case ("Left door", not "Left Door"). Acronyms and words
 * with digits or inner capitals ("USB-C", "LED", "iPhone") are left as they are.
 */
export function sentenceCase(name: string): string {
  const words = name.trim().split(/\s+/);
  return words
    .map((w, i) => {
      if (i === 0) return w.charAt(0).toUpperCase() + w.slice(1);
      return /^[A-Z][a-z'’-]+$/.test(w) ? w.toLowerCase() : w;
    })
    .join(' ');
}

/** Not a part of the object: something behind or next to it. */
const NOT_THIS_OBJECT = /\b(?:background|backdrop|behind|another|neighbou?ring|nearby|surrounding|other (?:plant|leaf|leaves|pot|object|item)s?)\b/i;
/** An area of a surface with no edge of its own: it cannot be outlined honestly. */
const SURFACE_AREA = /^(?:(?:left|right|upper|lower|top|bottom|front|rear)\s+)?(?:back|belly|flank|flanks|side|sides|underside|rump|loin|withers|abdomen|abdomen surface|chest|breast|shoulder|shoulders|hip|hips|thigh|thighs|haunch|haunches|barrel|torso|body|forehead|cheek|cheeks|brisket)$/i;

/** Keeps only real, outlinable parts of this one object (the whole object always stays). */
export function realParts<R extends { concept: number; label: string }>(list: R[], vocabulary: string[] = []): R[] {
  // A term that is a real part of this kind of thing is kept (an insect's abdomen is a body segment).
  const known = new Set(vocabulary.map((v) => normalizeForMatch(v)));
  return list.filter((r) => r.concept === 0 || (!NOT_THIS_OBJECT.test(r.label) && (known.has(normalizeForMatch(r.label)) || !SURFACE_AREA.test(r.label.trim()))));
}

/**
 * Four or more outlines of one part (leaf stalks, rivets, spots) become a single part with one
 * name, instead of "petiole 2", "petiole 3", "petiole 4".
 */
export function mergeMany<R extends Omit<Region, 'id'> & { concept: number; name?: string }>(list: R[]): R[] {
  const key = (r: R) => normalizeForMatch(baseName(r.label).replace(/\s+\d+$/, ''));
  const groups = new Map<string, R[]>();
  for (const r of list) {
    if (r.concept === 0) continue;
    groups.set(key(r), [...(groups.get(key(r)) ?? []), r]);
  }
  const merged = new Set<R>();
  const out: R[] = [];
  for (const r of list) {
    if (merged.has(r)) continue;
    const g = r.concept === 0 ? [r] : (groups.get(key(r)) ?? [r]);
    if (g.length < 4) {
      out.push(r);
      continue;
    }
    g.forEach((x) => merged.add(x));
    const largest = [...g].sort((a, b) => b.area - a.area)[0]!;
    const x0 = Math.min(...g.map((x) => x.box.x));
    const y0 = Math.min(...g.map((x) => x.box.y));
    const x1 = Math.max(...g.map((x) => x.box.x + x.box.w));
    const y1 = Math.max(...g.map((x) => x.box.y + x.box.h));
    const name = baseName(largest.label).replace(/\s+\d+$/, '') || largest.label;
    out.push({
      ...largest,
      label: name,
      ...(largest.name !== undefined ? { name } : {}),
      kind: g.some((x) => x.kind === 'mask') ? 'mask' : largest.kind,
      path: g.map((x) => x.path).filter(Boolean).join(''),
      box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 },
      area: Math.min(1, g.reduce((a, x) => a + x.area, 0)),
      confidence: Math.max(...g.map((x) => x.confidence ?? 0)) || null,
    });
  }
  return out;
}

const COLOURS = ['#ff3b30', '#34c759', '#0a84ff', '#ffcc00', '#af52de', '#ff9500', '#5ac8fa', '#ff2d55', '#a2845e', '#30d158', '#64d2ff', '#ffd60a'];
const COLOUR_NAMES = ['red', 'green', 'blue', 'yellow', 'purple', 'orange', 'light blue', 'pink', 'brown', 'bright green', 'sky blue', 'gold'];
/** "head (red outline)": the colour helps if a number is hard to read. */
const withColour = (name: string, i: number) => `${name} (${COLOUR_NAMES[i % COLOUR_NAMES.length]} outline)`;
const stripColour = (name: string) => name.replace(/\s*\((?:[a-z ]+) outline\)\s*$/i, '');

/** The image with every outline drawn in its own colour and numbered, for the check. */
export async function overlay(view: ImagePayload, regions: Array<{ path: string | null; anchor: { x: number; y: number } }>): Promise<ImagePayload> {
  const w = view.width;
  const h = view.height;
  const sw = Math.max(2, Math.round(Math.min(w, h) / 220));
  const r = Math.max(11, Math.round(Math.min(w, h) / 45));
  const paths = regions.map((g, i) => (g.path ? `<path d="${g.path}" fill="none" stroke="${COLOURS[i % COLOURS.length]}" stroke-width="${sw}" stroke-linejoin="round"/>` : '')).join('');
  const tags = regions
    .map((g, i) => {
      // The number sits just above the part with a short stick, so it does not hide a small part.
      const ax = Math.max(0, Math.min(w, g.anchor.x));
      const ay = Math.max(0, Math.min(h, g.anchor.y));
      const x = Math.max(r, Math.min(w - r, ax + r * 0.9));
      const y = Math.max(r, Math.min(h - r, ay - r * 2.1));
      const c = COLOURS[i % COLOURS.length];
      return `<line x1="${ax}" y1="${ay}" x2="${x}" y2="${y}" stroke="${c}" stroke-width="${Math.max(2, sw)}"/><circle cx="${ax}" cy="${ay}" r="${Math.max(3, sw * 1.5)}" fill="${c}" stroke="#000" stroke-width="1"/><circle cx="${x}" cy="${y}" r="${r}" fill="${c}" stroke="#000" stroke-width="2"/>${strokeNumber(i + 1, x, y, r * 1.05, r * 1.45)}`;
    })
    .join('');
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${paths}${tags}</svg>`);
  const buf = await sharp(Buffer.from(view.base64, 'base64')).composite([{ input: svg, top: 0, left: 0 }]).jpeg({ quality: 85 }).toBuffer();
  return { mime: 'image/jpeg', base64: buf.toString('base64'), width: w, height: h, label: null };
}

type MaskRec = ReturnType<typeof recordsOfKind<'mask'>>[number];

/**
 * A smaller copy of the image for finding parts, and how to map back (k = original / copy).
 * SAM 3 works at about 1000 px inside, and vision models scale images down too, so a 2000 px
 * upload only costs time (and on a slow connection, requests that run out of time); the
 * outlines are scaled back up to the full image afterwards.
 */
export async function workingCopy(view: ImagePayload, maxSide: number): Promise<{ img: ImagePayload; kx: number; ky: number }> {
  const long = Math.max(view.width, view.height);
  if (long <= maxSide) return { img: view, kx: 1, ky: 1 };
  const k = maxSide / long;
  const w = Math.max(1, Math.round(view.width * k));
  const h = Math.max(1, Math.round(view.height * k));
  const buf = await sharp(Buffer.from(view.base64, 'base64')).resize(w, h, { fit: 'fill', kernel: 'lanczos3' }).jpeg({ quality: 90 }).toBuffer();
  return { img: { mime: 'image/jpeg', base64: buf.toString('base64'), width: w, height: h, label: view.label ?? null }, kx: view.width / w, ky: view.height / h };
}

/** Regions found on a working copy, mapped back onto the full image. */
export function scaleRegions(regions: Region[], kx: number, ky: number): Region[] {
  if (kx === 1 && ky === 1) return regions;
  const r1 = (n: number) => Math.round(n * 10) / 10;
  return regions.map((r) => ({
    ...r,
    box: { x: r1(r.box.x * kx), y: r1(r.box.y * ky), w: r1(r.box.w * kx), h: r1(r.box.h * ky) },
    anchor: { x: r1(r.anchor.x * kx), y: r1(r.anchor.y * ky) },
    path: r.path ? scalePath(r.path, kx, ky) : null,
  }));
}

/**
 * Where each region's dot goes: the point farthest from its edges, on the full-resolution mask
 * (so the dot for the nose sits on the nose), not counting smaller regions inside it (so the dot
 * for the face does not land on the nose).
 */
export function anchorsOnParts(masks: MaskRec[], view: { width: number; height: number }, within: Uint8Array | null): Array<{ x: number; y: number } | null> {
  const W = view.width;
  const ras = masks.map((m) => {
    try {
      const w = m.mask.width;
      const h = m.mask.height;
      const r = cleanRaster(decodeMaskToRaster(m.mask), w, h);
      const { left, top } = m.bounds;
      let n = 0;
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          if (!r[i]) continue;
          const gx = x + left;
          const gy = y + top;
          if (gx < 0 || gy < 0 || gx >= view.width || gy >= view.height || (within && !within[gy * W + gx])) r[i] = 0;
          else n++;
        }
      return { r, w, h, left, top, n };
    } catch {
      return null;
    }
  });
  const order = ras.map((x, i) => ({ x, i })).filter((o) => o.x && o.x.n > 0).sort((a, b) => a.x!.n - b.x!.n);
  const out: Array<{ x: number; y: number } | null> = masks.map(() => null);
  const done: number[] = [];
  for (const { x, i } of order) {
    const a = x!;
    const own = a.r.slice();
    let ownN = a.n;
    for (const j of done) {
      const b = ras[j]!;
      const x0 = Math.max(a.left, b.left);
      const y0 = Math.max(a.top, b.top);
      const x1 = Math.min(a.left + a.w, b.left + b.w);
      const y1 = Math.min(a.top + a.h, b.top + b.h);
      for (let gy = y0; gy < y1; gy++)
        for (let gx = x0; gx < x1; gx++) {
          const ai = (gy - a.top) * a.w + (gx - a.left);
          if (own[ai] && b.r[(gy - b.top) * b.w + (gx - b.left)]) {
            own[ai] = 0;
            ownN--;
          }
        }
    }
    const p = (ownN > a.n * 0.15 ? interiorPoint(own, a.w, a.h) : null) ?? interiorPoint(a.r, a.w, a.h);
    out[i] = p ? { x: p.x + a.left + 0.5, y: p.y + a.top + 0.5 } : null;
    done.push(i);
  }
  return out;
}

/**
 * Each part outlined from its name as well (SAM 3.1 concept prompts, one short noun phrase per
 * request). SAM finds every instance precisely and scores each one; the score already includes
 * how sure it is that the part is in the photo at all (SAM 3's presence score), so a part that
 * is not there ("boot" on a car seen from the front) comes back empty or unsure.
 */
async function conceptOutlines(deps: LabelDeps, view: ImagePayload, items: Item[]): Promise<Array<{ it: Item; m: MaskRec; conf: number }>> {
  const todo = items.filter((it) => it.rank !== 0).slice(0, 12);
  const out: Array<{ it: Item; m: MaskRec; conf: number }> = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, todo.length) }, async () => {
      while (next < todo.length) {
        const it = todo[next++]!;
        const phrase = simplePhrase(it.name);
        if (!phrase) continue;
        try {
          const { result } = await runSam(deps.client, deps.samModel, phrase, view, deps.signal);
          const boxes = recordsOfKind(result.records, 'box');
          for (const m of recordsOfKind(result.records, 'mask').slice(0, 6)) {
            const conf = m.confidence ?? boxes.find((b) => b.objectId === m.objectId)?.confidence ?? 0;
            if (conf >= 0.5) out.push({ it, m, conf });
          }
        } catch (e) {
          log('info', 'outlining by name failed for one part; its box is used', { part: phrase, error: (e as Error).message });
        }
      }
    }),
  );
  return out;
}

/**
 * Two independent routes to each outline: the box Muse Spark drew, outlined by SAM; and SAM
 * finding the part by its name. Where they agree on a spot, the name route's outline is kept
 * (it is SAM's own clean instance) and the part counts as confirmed. A confident name-route
 * outline where the first look drew no box is added (an instance it missed); the check that
 * follows still judges every one.
 */
function combine<R extends Omit<Region, 'id'> & { concept: number; name: string; agreed?: boolean }>(
  found: R[],
  text: Array<{ it: Item; m: MaskRec; conf: number }>,
  view: ImagePayload,
  within: Uint8Array | null,
  extra: { source: Region['source']; viewIndex: number },
): R[] {
  const out = [...found];
  const whole = found.find((f) => f.concept === 0);
  const wholeArea = whole?.area ?? 1;
  for (const t of [...text].sort((a, b) => b.conf - a.conf)) {
    const g = maskGeometry(t.m, view, within);
    if (!g.path || g.area < 0.0004) continue;
    if (within && g.kept < 0.5) continue; // mostly not on this object
    if (whole && g.area > wholeArea * 0.6) continue; // the whole object, not a part
    const b = g.bounds ?? t.m.bounds;
    const box = { x: b.left, y: b.top, w: b.right - b.left, h: b.bottom - b.top };
    const match = out
      .filter((f) => f.concept === t.it.rank && !f.agreed)
      .map((f) => ({ f, o: iou(f.box, box) }))
      .sort((a, b) => b.o - a.o)[0];
    if (match && match.o >= 0.5 && box.w * box.h <= match.f.box.w * match.f.box.h * 2) {
      Object.assign(match.f, { path: g.path, box, anchor: g.anchor, area: g.area, kind: 'mask', confidence: Math.max(match.f.confidence ?? 0, t.conf), agreed: true });
      continue;
    }
    if (t.conf >= 0.65 && !out.some((f) => f.concept !== 0 && iou(f.box, box) > 0.4)) {
      out.push({ concept: t.it.rank, name: t.it.name, label: t.it.name, kind: 'mask', source: extra.source, view: extra.viewIndex, box, path: g.path, anchor: g.anchor, area: g.area, confidence: t.conf } as unknown as R);
    }
  }
  return out;
}

/**
 * One region on its own: the photo with everything outside the region darkened and the region
 * outlined, cropped around it with some context; and the whole photo with the same outline, for
 * where it is. A model looking at one highlighted region cannot mix up numbered marks, which is
 * where naming many regions at once goes wrong on a busy photo.
 */
export async function spotlight(view: ImagePayload, region: { path: string; box: Region['box'] }): Promise<{ close: ImagePayload; whole: ImagePayload }> {
  const w = view.width;
  const h = view.height;
  const sw = Math.max(3, Math.round(Math.min(w, h) / 220));
  const edge = `<path d="${region.path}" fill="none" stroke="#000" stroke-opacity="0.75" stroke-width="${sw * 2.6}" stroke-linejoin="round"/><path d="${region.path}" fill="none" stroke="#00e5ff" stroke-width="${sw}" stroke-linejoin="round"/>`;
  const dim = `<path d="M0 0H${w}V${h}H0Z${region.path}" fill="#000" fill-opacity="0.55" fill-rule="evenodd"/>`;
  const svg = (body: string) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${body}</svg>`);
  const src = Buffer.from(view.base64, 'base64');
  const lit = await sharp(src).composite([{ input: svg(dim + edge), top: 0, left: 0 }]).jpeg({ quality: 88 }).toBuffer();
  const b = region.box;
  const padX = Math.max(b.w * 0.9, w * 0.08);
  const padY = Math.max(b.h * 0.9, h * 0.08);
  const close = (await zoomCrop({ ...view, base64: lit.toString('base64') }, { left: b.x - padX, top: b.y - padY, right: b.x + b.w + padX, bottom: b.y + b.h + padY }, 1024)).img;
  const k = Math.min(1, 900 / Math.max(w, h));
  const outlined = await sharp(src).composite([{ input: svg(edge), top: 0, left: 0 }]).resize(Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))).jpeg({ quality: 85 }).toBuffer({ resolveWithObject: true });
  return { close, whole: { mime: 'image/jpeg', base64: outlined.data.toString('base64'), width: outlined.info.width, height: outlined.info.height, label: null } };
}

/** Each region named on its own, up close, by Muse Spark thinking hard (five at a time). Null where a look failed. */
async function closeNames(deps: LabelDeps, view: ImagePayload, regions: Array<{ path: string | null; box: Region['box'] }>, object: string | null, vocabulary: string[]): Promise<Array<CloseName | null>> {
  const out: Array<CloseName | null> = regions.map(() => null);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(5, regions.length) }, async () => {
      while (next < regions.length) {
        const i = next++;
        const r = regions[i]!;
        if (!r.path) continue;
        try {
          const { close, whole } = await spotlight(view, { path: r.path, box: r.box });
          const res = await chatStructured({
            client: deps.client,
            model: deps.sparkModel,
            mode: 'json_schema',
            instructionRole: 'developer',
            reasoningEffort: 'high',
            signal: deps.signal,
            timeoutMs: deps.timeoutMs,
            schema: CloseNameSchema,
            name: 'close_name',
            system: CLOSE_NAME_SYSTEM,
            user: closeNameUser(object, vocabulary),
            images: [close, whole],
          });
          out[i] = res.value;
        } catch (e) {
          log('info', 'naming one region up close failed; the first look is kept for it', { error: (e as Error).message });
        }
      }
    }),
  );
  return out;
}

/**
 * The name of one region from two independent looks: all regions at once (numbered) and this
 * one up close. Agreement confirms it; a close look that sees no part, or an outline that fits
 * badly, drops it; a disagreement is put to a third look as a choice between the two names.
 */
export function settleName(
  first: string,
  close: CloseName | null,
  object: string | null,
  isPart: (name: string) => boolean,
): { name: string; confirmed: boolean; fits: CloseName['fits'] | null } | { ask: [string, string]; fits: CloseName['fits'] } | null {
  const a = first && isPart(first) ? first : '';
  if (!close) return a ? { name: a, confirmed: false, fits: null } : null;
  const b = close.name ? cleanPartName(close.name, object) : '';
  if (!b || !isPart(b) || close.fits === 'badly') return null;
  if (a && sameThing(a, b)) return { name: a, confirmed: true, fits: close.fits };
  if (!a) return close.sure ? { name: b, confirmed: false, fits: close.fits } : null;
  return { ask: [a, b], fits: close.fits };
}

/** Not a part of this object, whatever the region looks like. */
const NOT_A_PART = /^(?:background|backdrop|floor|ground|road|street|pavement|table|tabletop|desk|wall|sky|grass|surface|shadow|reflection|plant pot|flower pot|pot|planter|potting soil|soil|dirt|compost|mulch|hand|finger|fingers|person|people|another leaf|other leaf|neighbouring leaf|stand|paddock stand)$/;

/**
 * Regions first, names second. Following Set-of-Mark prompting and SAM's own automatic mask
 * generation: SAM 3.1 traces the regions of the object from the pixels (from a grid of points
 * over the object, from where the parts were seen, and from each part's name), duplicates and
 * regions made of other regions are removed, and Muse Spark then names each numbered region, or
 * says it is not a part of this object. Vision models choose among marked regions far more
 * reliably than they place boxes (86% against 26% on RefCOCOg in the Set-of-Mark study), and
 * every outline follows real edges in the photo, because SAM drew it from the pixels.
 */
async function segmentsRoute(
  deps: LabelDeps,
  view: ImagePayload,
  items: Item[],
  opts: { object: string | null; viewIndex: number; source: Region['source']; vocabulary: string[]; preferred: string[]; spark: Parameters<typeof chatStructured>[0] extends infer P ? Omit<P & object, 'schema' | 'name' | 'system' | 'user' | 'images'> : never; taught?: Array<{ from: string; to: string }>; twoLooks?: boolean },
  diagnostics: string[],
): Promise<Array<Omit<Region, 'id'> & { concept: number; name: string; agreed?: boolean }> | null> {
  type F = Omit<Region, 'id'> & { concept: number; name: string; agreed?: boolean };
  const W = view.width;
  const H = view.height;

  // 1. The whole object, and each part where it was seen, outlined from their boxes (the box
  // outlines are one of three sources of candidate regions; the naming step chooses).
  const wholeItem = items.find((it) => it.rank === 0) ?? null;
  let whole: F | null = null;
  let within: Uint8Array | null = null;
  let core: Uint8Array | null = null;
  let boxMasks: Array<{ rank: number; m: MaskRec }> = [];
  if (items.length) {
    const r = await samBoxes(deps, view, items, opts.viewIndex, opts.source, { clip: true, within: null });
    whole = (r.out.find((f) => f.concept === 0) as F | undefined) ?? null;
    within = r.within;
    core = r.core;
    boxMasks = r.masks.filter((x) => x.rank !== 0);
  }

  // 2. Where to look: where the parts were seen, then a grid of points over the object. Every
  // point is on the object itself (not in the margin around it, which is background): a point on
  // the background traces a piece of background, such as the gap between legs or inside a handle.
  const objBox = whole?.box ?? { x: 0, y: 0, w: W, h: H };
  const seeds: Array<{ x: number; y: number }> = [];
  for (const it of items) if (it.rank !== 0) for (const b of it.boxes) seeds.push({ x: Math.round((b.left + b.right) / 2), y: Math.round((b.top + b.bottom) / 2) });
  const objPx = Math.max(1, (whole?.area ?? 1) * W * H);
  const step = Math.max(8, Math.sqrt(objPx / 32));
  for (let y = objBox.y + step / 2; y < objBox.y + objBox.h; y += step)
    for (let x = objBox.x + step / 2; x < objBox.x + objBox.w; x += step) {
      const xi = Math.min(W - 1, Math.round(x));
      const yi = Math.min(H - 1, Math.round(y));
      if ((core ?? within) && !(core ?? within)![yi * W + xi]) continue;
      if (seeds.some((p) => Math.hypot(p.x - xi, p.y - yi) < step * 0.5)) continue;
      seeds.push({ x: xi, y: yi });
    }
  const points = seeds.slice(0, 48);

  // 3. The region under each point, and each part found by its name, both traced by SAM 3.1.
  const [pointMasks, text] = await Promise.all([pointOutlines(deps, view, points), conceptOutlines(deps, view, items)]);

  // 4. Candidate regions: on the object, not the whole object, not tiny, not duplicates, and not
  // a region made up of other regions (the front of a car that holds its lights and grille).
  const GW = 128;
  const GH = Math.max(16, Math.round((128 * H) / W));
  const obj = new Uint8Array(GW * GH);
  for (let gy = 0; gy < GH; gy++)
    for (let gx = 0; gx < GW; gx++) {
      const px = Math.min(W - 1, Math.floor((gx + 0.5) * (W / GW)));
      const py = Math.min(H - 1, Math.floor((gy + 0.5) * (H / GH)));
      const on = core ?? within;
      obj[gy * GW + gx] = !on || on[py * W + px] ? 1 : 0;
    }
  let objN = 0;
  for (const v of obj) objN += v;
  type C = { m: MaskRec; conf: number; fromName: boolean; c: Uint8Array; n: number; g: ReturnType<typeof maskGeometry> };
  const cands: C[] = [];
  for (const x of [
    ...text.map((t) => ({ m: t.m, conf: t.conf, fromName: true })),
    ...pointMasks.map((p) => ({ m: p.m, conf: p.conf, fromName: false })),
    ...boxMasks.map((b) => ({ m: b.m, conf: Math.min(0.89, b.m.confidence ?? 0.8), fromName: false })),
  ]) {
    if (!x.fromName && x.conf < 0.5) continue;
    const g = maskGeometry(x.m, view, within);
    if (!g.path || g.area < 0.0006) continue;
    if (within && g.kept < 0.6) continue;
    // A region that runs well out past the object's own outline is background (or the object and
    // its surroundings together), not a part: three quarters of it must be on the object.
    if (core && shareOn(x.m, view, core) < 0.75) continue;
    const c = coarseMask(x.m, view, GW, GH);
    let n = 0;
    for (let i = 0; i < c.length; i++) if ((c[i] = c[i]! & obj[i]!)) n++;
    if (n < 2) continue;
    if (whole && n > objN * 0.7) continue; // the whole object, not a part
    cands.push({ ...x, c, n, g });
  }
  const overlapOf = (a: Uint8Array, b: Uint8Array) => {
    let i = 0;
    let u = 0;
    for (let k = 0; k < a.length; k++) {
      if (a[k] && b[k]) i++;
      if (a[k] || b[k]) u++;
    }
    return u ? i / u : 0;
  };
  // Duplicates: the same region from several points (or from a point and a name).
  const unique: C[] = [];
  for (const x of [...cands].sort((a, b) => Number(b.fromName) - Number(a.fromName) || b.conf - a.conf)) if (!unique.some((u) => overlapOf(u.c, x.c) > 0.7)) unique.push(x);
  // Smallest first: a region keeps only what smaller regions have not claimed; one that is
  // mostly made of others is not a part of its own.
  const claimed = new Uint8Array(GW * GH);
  const regions: Array<C & { own: Uint8Array; ownN: number }> = [];
  for (const x of [...unique].sort((a, b) => a.n - b.n)) {
    const own = new Uint8Array(GW * GH);
    let ownN = 0;
    for (let k = 0; k < own.length; k++) if (x.c[k] && !claimed[k]) (own[k] = 1), ownN++;
    if (ownN < x.n * 0.25 && !x.fromName) continue;
    for (let k = 0; k < own.length; k++) if (x.c[k]) claimed[k] = 1;
    regions.push({ ...x, own, ownN });
  }
  const marks = regions.sort((a, b) => Number(b.fromName) - Number(a.fromName) || b.ownN - a.ownN).slice(0, 24);
  if (!marks.length) return null;
  diagnostics.push(`Traced ${marks.length} region${marks.length === 1 ? '' : 's'} of the object from the photo.`);
  // Each dot on its own part, found on the full-resolution mask.
  const dots = anchorsOnParts(marks.map((x) => x.m), view, core ?? within);
  const marked: F[] = marks.map((x, i) => {
    const b = x.g.bounds ?? x.m.bounds;
    const anchor = dots[i] ?? x.g.anchor;
    return { concept: i + 1, name: '', label: '', kind: 'mask', source: opts.source, view: opts.viewIndex, box: { x: b.left, y: b.top, w: b.right - b.left, h: b.bottom - b.top }, path: x.g.path, anchor, area: x.g.area, confidence: x.conf, agreed: x.fromName };
  });

  // 5. Muse Spark names the regions, twice and independently, thinking hard each time: (a) all
  // of them at once, numbered on the photo (Set-of-Mark), which shows how the parts sit together;
  // and (b) each one on its own, up close, which cannot mix up the numbers. Where the two agree
  // the name is confirmed; where they differ, a third look chooses between the two names.
  const shot = await overlay(view, marked);
  const closeups: ImagePayload[] = [];
  for (const c of smallClusters(marked.map((f) => ({ left: f.box.x, top: f.box.y, right: f.box.x + f.box.w, bottom: f.box.y + f.box.h })), view, 3)) {
    try {
      closeups.push((await zoomCrop(shot, c.area, 900)).img);
    } catch {
      /* the whole picture still shows them */
    }
  }
  const [named, close] = await Promise.all([
    chatStructured({
      ...opts.spark,
      reasoningEffort: 'high',
      schema: PartMarksSchema,
      name: 'part_marks',
      system: PART_MARKS_SYSTEM,
      user:
        partMarksUser(opts.object, marked.length, opts.preferred, opts.vocabulary, opts.taught ?? []) +
        (closeups.length ? `\nThe first image shows everything. The next ${closeups.length === 1 ? 'image is a close-up' : `${closeups.length} images are close-ups`} of the small regions, with the same numbers and colours.` : ''),
      images: [shot, ...closeups],
    }),
    opts.twoLooks === false ? Promise.resolve(marked.map(() => null)) : closeNames(deps, view, marked, opts.object, opts.vocabulary),
  ]);
  const objectWords = new Set([opts.object ?? '', wholeItem?.name ?? ''].map((x) => normalizeForMatch(x)).filter(Boolean));
  const isPart = (name: string) => {
    const n = normalizeForMatch(name);
    return !!n && !NOT_A_PART.test(n) && !NOT_THIS_OBJECT.test(name) && !objectWords.has(n);
  };
  const byN = new Map(named.value.regions.map((r) => [Math.round(r.n), r.name]));
  let parts: F[] = [];
  let dropped = 0;
  let confirmed = 0;
  const disputes: Array<{ f: F; ask: [string, string]; fits: CloseName['fits'] }> = [];
  const keepPart = (f: F, name: string, sure: boolean, fits: CloseName['fits'] | null) => {
    const conf = Math.min(1, Math.max(f.confidence ?? 0, sure ? 0.9 : 0) * (fits === 'partly' ? 0.85 : 1));
    parts.push({ ...f, name, label: name, confidence: conf, agreed: f.agreed || sure });
  };
  marked.forEach((f, i) => {
    const raw = byN.get(i + 1);
    const first = raw ? cleanPartName(raw, opts.object) : '';
    const settled = settleName(first, close[i] ?? null, opts.object, isPart);
    if (!settled) return void dropped++;
    if ('ask' in settled) return void disputes.push({ f, ask: settled.ask, fits: settled.fits });
    if (settled.confirmed) confirmed++;
    keepPart(f, settled.name, settled.confirmed, settled.fits);
  });
  // A third look for each disagreement: which of the two names fits the outline (or neither).
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, disputes.length) }, async () => {
      while (next < disputes.length) {
        const d = disputes[next++]!;
        try {
          const v = await secondOpinion(deps, view, { path: d.f.path, box: d.f.box }, opts.object, d.ask, Math.random, 'high');
          if (v.pick === null) dropped++;
          else {
            confirmed++;
            keepPart(d.f, d.ask[v.pick], true, d.fits);
          }
        } catch {
          // No third look: the close look named this region on its own, so its name is kept.
          keepPart(d.f, d.ask[1], false, d.fits);
        }
      }
    }),
  );
  parts.sort((a, b) => a.concept - b.concept);
  if (opts.twoLooks !== false) diagnostics.push(`Named each region twice, independently${disputes.length ? `, and settled ${disputes.length} disagreement${disputes.length === 1 ? '' : 's'} with a third look` : ''}: ${confirmed} confirmed.`);
  if (dropped) diagnostics.push(`Left out ${dropped} region${dropped === 1 ? '' : 's'} that ${dropped === 1 ? 'is' : 'are'} not a part of this object.`);

  // 6. Pieces of one part that touch become one part ("Door" in two pieces is one door).
  const near = (a: F['box'], b: F['box']) => {
    const gap = Math.hypot(W, H) * 0.015;
    return a.x - gap <= b.x + b.w && b.x - gap <= a.x + a.w && a.y - gap <= b.y + b.h && b.y - gap <= a.y + a.h;
  };
  // Two outlines of the same part that lie over each other (one traced from a point, one from
  // the part's name) are not two pieces: adding them together would let the larger one's spill
  // stand. The one SAM found from the part's name is kept, as it is SAM's own outline of that part.
  const overlapping = (a: F['box'], b: F['box']) => {
    const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
    const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    return (ix * iy) / Math.max(1, Math.min(a.w * a.h, b.w * b.h)) > 0.6;
  };
  const merged: F[] = [];
  for (const f of parts.sort((a, b) => b.area - a.area)) {
    const same = merged.find((m) => normalizeForMatch(m.name) === normalizeForMatch(f.name) && near(m.box, f.box));
    if (!same) {
      merged.push({ ...f });
      continue;
    }
    if (overlapping(same.box, f.box) && (same.agreed || f.agreed)) {
      if (f.agreed && !same.agreed) Object.assign(same, { ...f });
      continue;
    }
    const x0 = Math.min(same.box.x, f.box.x);
    const y0 = Math.min(same.box.y, f.box.y);
    const x1 = Math.max(same.box.x + same.box.w, f.box.x + f.box.w);
    const y1 = Math.max(same.box.y + same.box.h, f.box.y + f.box.h);
    Object.assign(same, { path: `${same.path ?? ''}${f.path ?? ''}`, box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, area: Math.min(1, same.area + f.area), confidence: Math.max(same.confidence ?? 0, f.confidence ?? 0), agreed: same.agreed || f.agreed });
  }
  parts = merged;

  // 7. Visible parts no region covered: outlined from their boxes.
  const missing = named.value.missing
    .slice(0, 4)
    .map((m, k) => ({ name: cleanPartName(m.name, opts.object), rank: 200 + k, boxes: [toPx(m.box, view)].filter((b): b is PxBox => !!b) }))
    .filter((m) => m.name && isPart(m.name) && m.boxes.length);
  if (missing.length) {
    const more = (await samBoxes(deps, view, missing, opts.viewIndex, opts.source, { clip: !!within, within })).out as F[];
    const fresh = more.filter((m) => !parts.some((p) => iou(p.box, m.box) > 0.4));
    parts.push(...fresh);
    if (fresh.length) diagnostics.push(`Added ${fresh.length} part${fresh.length === 1 ? '' : 's'} no region covered.`);
  }
  return whole ? [{ ...whole, concept: 0 }, ...parts.map((p, i) => ({ ...p, concept: i + 1 }))] : parts.map((p, i) => ({ ...p, concept: i + 1 }));
}

/** The region SAM 3.1 traces under each point (one object per point, eight per request). */
async function pointOutlines(deps: LabelDeps, view: ImagePayload, points: Array<{ x: number; y: number }>): Promise<Array<{ m: MaskRec; conf: number }>> {
  const out: Array<{ m: MaskRec; conf: number }> = [];
  const batches: number[][] = [];
  for (let i = 0; i < points.length; i += 8) batches.push(points.slice(i, i + 8).map((_, k) => i + k));
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(3, batches.length) }, async () => {
      while (next < batches.length) {
        const idx = batches[next++]!;
        try {
          const text = buildObjectPrompt({
            size: { width: view.width, height: view.height },
            objects: idx.map((i) => ({ id: i, prompts: [{ points: [{ x: Math.max(0, Math.min(view.width - 1, points[i]!.x)), y: Math.max(0, Math.min(view.height - 1, points[i]!.y)), label: 'positive' as const }] }] })),
          });
          const { result } = await runSam(deps.client, deps.samModel, text, view, deps.signal);
          const boxes = recordsOfKind(result.records, 'box');
          for (const m of recordsOfKind(result.records, 'mask')) {
            if (!idx.includes(Number(m.objectId))) continue;
            out.push({ m, conf: m.confidence ?? boxes.find((b) => b.objectId === m.objectId)?.confidence ?? 1 });
          }
        } catch (e) {
          log('info', 'tracing regions from points failed for one batch', { error: (e as Error).message });
        }
      }
    }),
  );
  return out;
}

export async function labelImage(
  deps: LabelDeps,
  view: ImagePayload,
  names: string[],
  opts: {
    object: string | null;
    viewIndex: number;
    source: Region['source'];
    verify?: boolean;
    max?: number;
    clipToObject?: boolean;
    /** Correct names for this kind of thing, used when naming extra or wrong outlines. */
    vocabulary?: string[];
    /** False when the first name is not the whole object (a drawing of the inside). */
    wholeFirst?: boolean;
    /** False to skip outlining each part by its name as well. */
    byName?: boolean;
    /** At most this many parts (the whole object not counted). */
    maxParts?: number;
    /**
     * 'segments' (photos): regions are found from the pixels first and then named. 'boxes': each
     * part's box is outlined and then checked. Defaults to 'boxes'.
     */
    method?: 'segments' | 'boxes';
    /** Names this person taught for this kind of object. */
    taught?: Array<{ from: string; to: string }>;
    /** Name each region a second time, on its own and up close (default true; false on a quick look). */
    twoLooks?: boolean;
    /** How hard Muse Spark thinks at each step: 'high' (photos, the default) or 'medium' (drawings). */
    effort?: 'high' | 'medium';
  },
): Promise<{ regions: Region[]; diagnostics: string[] }> {
  const diagnostics: string[] = [];
  // Short, generic part names (the whole object, first, keeps its own name).
  const list = [...new Set(names.map((n, i) => (i === 0 && opts.wholeFirst !== false ? sanitizeText(n, 120) : cleanPartName(n, opts.object))).filter(Boolean))].slice(0, opts.max ?? 20);
  const vocabulary = [...new Set((opts.vocabulary ?? []).map((v) => cleanPartName(v, opts.object)).filter(Boolean))];
  opts = { ...opts, vocabulary };
  // Muse Spark thinks hard at every step of labelling: where each part is, what each region is,
  // and the checks. Accuracy matters more here than a few seconds.
  const spark = { client: deps.client, model: deps.sparkModel, mode: 'json_schema' as const, instructionRole: 'developer' as const, reasoningEffort: (opts.effort ?? 'high') as 'high' | 'medium', signal: deps.signal, timeoutMs: deps.timeoutMs };

  // 1. Where is each part?
  let items: Item[] = [];
  try {
    const g = await chatStructured({ ...spark, schema: GroundOutputSchema, name: 'ground', system: GROUND_SYSTEM, user: groundUser(opts.object, list, opts.vocabulary ?? []), images: [view] });
    const byName = new Map(list.map((n, i) => [normalizeForMatch(n), i]));
    const sameOrder = g.value.parts.length === list.length;
    g.value.parts.forEach((p, idx) => {
      // Match the name back to the list: exactly, by position, or by the words it shares.
      const n = normalizeForMatch(String(p.name));
      let rank = byName.get(n);
      if (rank === undefined && sameOrder) rank = idx;
      if (rank === undefined) rank = list.findIndex((x) => normalizeForMatch(x).includes(n) || n.includes(normalizeForMatch(x)));
      if (rank === undefined || rank < 0) return;
      // Rank 0 means "the whole object"; a drawing of the inside has no such first name.
      if (opts.wholeFirst === false) rank += 1;
      if (!p.visible || items.some((it) => it.rank === rank)) return;
      const boxes = p.boxes.map((b) => toPx(b, view)).filter((b): b is PxBox => !!b).slice(0, 4);
      if (boxes.length) items.push({ name: list[opts.wholeFirst === false ? rank - 1 : rank]!, rank, boxes });
    });
    for (const e of g.value.extra.slice(0, 14)) {
      const name = cleanPartName(e.name, opts.object);
      if (!name || /\b(background|floor|wall|table|road|ground|sky|surface|shadow)\b/i.test(name)) continue;
      const boxes = e.boxes.map((b) => toPx(b, view)).filter((b): b is PxBox => !!b).slice(0, 2);
      // Already in the list, on the same spot (another instance elsewhere, like the rear door, is kept).
      const pxIou = (p: PxBox, q: PxBox) => iou({ x: p.left, y: p.top, w: p.right - p.left, h: p.bottom - p.top }, { x: q.left, y: q.top, w: q.right - q.left, h: q.bottom - q.top });
      if (items.some((it) => sameThing(it.name, name) && it.boxes.some((b) => boxes.some((x) => pxIou(b, x) > 0.3)))) continue;
      if (boxes.length) items.push({ name, rank: list.length + 1 + items.length, boxes });
    }
    items.sort((a, b) => a.rank - b.rank);
    const missed = list.filter((n) => !items.some((it) => it.name === n));
    if (missed.length) diagnostics.push(`Not visible: ${missed.join(', ')}.`);
  } catch (e) {
    log('warn', 'grounding failed; outlining by name instead', { error: (e as Error).message });
    items = [];
  }

  // 1b. Look again, close up, at small parts: they are found far more reliably in an enlarged
  // crop than in the whole picture (the nose and the mouth on a muzzle, the eyes and the ears).
  if (items.length) {
    try {
      const flatBoxes = items.flatMap((it, ii) => it.boxes.map((b, bi) => ({ ii, bi, b })));
      const clusters = smallClusters(flatBoxes.map((x) => x.b), view);
      await Promise.all(
        clusters.map(async (c) => {
          const members = c.members.map((m) => flatBoxes[m]!);
          const names = [...new Set(members.map((m) => items[m.ii]!.name))];
          if (!names.length) return;
          const z = await zoomCrop(view, c.area);
          const g = await chatStructured({
            ...spark,
            schema: GroundOutputSchema,
            name: 'ground',
            system: GROUND_SYSTEM,
            user: groundUser(opts.object ? `a close-up of part of the ${opts.object}` : 'a close-up', names, opts.vocabulary ?? []),
            images: [z.img],
          });
          for (const p of g.value.parts) {
            const name = names.find((n) => normalizeForMatch(n) === normalizeForMatch(String(p.name))) ?? names[g.value.parts.indexOf(p)];
            if (!name || !p.visible) continue; // not seen up close: keep the first look
            const refined = p.boxes
              .map((b) => toPx(b, z.img))
              .filter((b): b is PxBox => !!b)
              .map((b) => ({ left: z.box.left + b.left / z.scale, top: z.box.top + b.top / z.scale, right: z.box.left + b.right / z.scale, bottom: z.box.top + b.bottom / z.scale }))
              .map((b) => ({ left: Math.round(b.left), top: Math.round(b.top), right: Math.round(b.right), bottom: Math.round(b.bottom) }));
            if (!refined.length) continue;
            const ii = members.find((m) => items[m.ii]!.name === name)!.ii;
            const keep = items[ii]!.boxes.filter((_, bi) => !members.some((m) => m.ii === ii && m.bi === bi));
            items[ii]!.boxes = [...keep, ...refined].slice(0, 4);
          }
        }),
      );
      if (clusters.length) diagnostics.push(`Looked again close up at ${clusters.length} area${clusters.length === 1 ? '' : 's'} with small parts.`);
    } catch (e) {
      log('warn', 'close-up check of small parts failed; using the first look', { error: (e as Error).message });
    }
  }

  // 2. Regions first, names second (the main route for photos). If it cannot run, the parts
  // are outlined from their boxes and checked (steps 2b and 3).
  let found: Array<Omit<Region, 'id'> & { concept: number; name: string }> = [];
  let within: Uint8Array | null = null;
  let done = false;
  if (items.length && opts.method === 'segments') {
    try {
      const preferred = items.filter((it) => it.rank !== 0).map((it) => it.name);
      const r = await segmentsRoute(deps, view, items, { object: opts.object, viewIndex: opts.viewIndex, source: opts.source, vocabulary: opts.vocabulary ?? [], preferred, spark, taught: opts.taught ?? [], twoLooks: opts.twoLooks !== false }, diagnostics);
      if (r && r.some((f) => f.concept !== 0)) {
        found = uniqueNames(mergeMany(realParts(dropOverlaps(dropWholeDuplicates(tidyRegions(r, view)), opts.vocabulary), opts.vocabulary)));
        done = true;
      }
    } catch (e) {
      log('warn', 'finding regions from the pixels failed; outlining the boxes instead', { error: (e as Error).message });
    }
  }
  // 2b. Outline each box precisely. Without boxes, fall back to outlining by name.
  if (done) {
    /* named regions are ready */
  } else if (items.length) {
    const [r, text] = await Promise.all([
      samBoxes(deps, view, items, opts.viewIndex, opts.source, { clip: !!opts.clipToObject, within: null }),
      opts.byName === false ? Promise.resolve([]) : conceptOutlines(deps, view, items),
    ]);
    within = r.within;
    found = combine(r.out, text, view, within, { source: opts.source, viewIndex: opts.viewIndex });
    const agreed = found.filter((f) => (f as { agreed?: boolean }).agreed).length;
    if (text.length) diagnostics.push(`${agreed} part${agreed === 1 ? '' : 's'} confirmed by finding ${agreed === 1 ? 'it' : 'them'} two ways.`);
  }
  else {
    const r = await samSegment(deps.client, { view, viewIndex: opts.viewIndex, concepts: list.slice(0, 8) }, { model: deps.samModel, signal: deps.signal });
    diagnostics.push(...r.diagnostics);
    found = r.regions.map((x, i) => ({ ...x, concept: opts.wholeFirst === false ? i + 1 : i, name: x.label }));
  }
  if (!done) found = uniqueNames(mergeMany(realParts(dropOverlaps(dropWholeDuplicates(tidyRegions(found, view)), opts.vocabulary), opts.vocabulary)));

  // 3. Check every outline without its name (the checker says what each one really covers),
  // then compare: a matching name is kept, a different one is replaced by what is really there,
  // and an outline that covers nothing nameable, or fits badly, is dropped. Parts still missing
  // are added.
  if (!done && opts.verify !== false && found.length) {
    try {
      const parts = found.filter((f) => f.concept !== 0);
      const shot = await overlay(view, parts);
      // Close-ups of the small parts, with the same numbered outlines, so they can be judged properly.
      const closeups: ImagePayload[] = [];
      for (const c of smallClusters(parts.map((f) => ({ left: f.box.x, top: f.box.y, right: f.box.x + f.box.w, bottom: f.box.y + f.box.h })), view, 3)) {
        try {
          closeups.push((await zoomCrop(shot, c.area, 900)).img);
        } catch {
          /* the whole picture still shows them */
        }
      }
      const check = parts.length
        ? await chatStructured({
            ...spark,
            schema: LabelCheckOutputSchema,
            name: 'label_check',
            system: LABEL_CHECK_SYSTEM,
            user:
              labelCheckUser(opts.object, parts.length, opts.vocabulary ?? []) +
              (closeups.length ? `\nThe first image shows everything. The next ${closeups.length === 1 ? 'image is a close-up' : `${closeups.length} images are close-ups`} of the small parts, with the same numbers and colours: use ${closeups.length === 1 ? 'it' : 'them'} to judge the small parts.` : ''),
            images: [shot, ...closeups],
          })
        : null;
      const verdict = new Map((check?.value.regions ?? []).map((r) => [Math.round(r.n), r]));
      const objectWords = new Set([opts.object ?? '', ...(found.filter((f) => f.concept === 0).map((f) => f.label))].map((x) => normalizeForMatch(x)).filter(Boolean));
      const plan = (f: (typeof found)[number]) => {
        const v = verdict.get(parts.indexOf(f) + 1);
        if (!v) return { keep: true as const, label: f.label };
        const said = v.covers ? cleanPartName(stripColour(v.covers), opts.object) : '';
        const nothing = !said || /\b(background|floor|wall|table|road|ground|sky|tree|surface|shadow|reflection)\b/i.test(said) || objectWords.has(normalizeForMatch(said));
        if (nothing) return { keep: false as const, why: `"${f.label}" did not cover a part` };
        if (!v.fits) return { keep: false as const, why: `the outline for "${f.label}" did not fit the part` };
        if (sameThing(f.label, said)) return { keep: true as const, label: f.label };
        return { keep: true as const, label: said, renamed: true };
      };
      const plans = parts.map((f) => ({ f, p: plan(f) }));
      // A check that would throw away most of the outlines is more likely confused than right:
      // then it may rename outlines, but not remove them.
      const drops = plans.filter((x) => !x.p.keep).length;
      const mayDrop = drops <= Math.max(1, Math.floor((parts.length * 2) / 3));
      const kept: typeof found = found.filter((f) => f.concept === 0);
      for (const { f, p } of plans) {
        if (p.keep) {
          if ('renamed' in p && p.renamed) diagnostics.push(`Renamed "${f.label}" to "${p.label}", which is what the outline covers.`);
          kept.push(p.label === f.label ? f : { ...f, label: p.label, name: p.label });
        } else if (!mayDrop) kept.push(f);
        else diagnostics.push(`Dropped an outline: ${p.why}.`);
      }
      const extra = (check?.value.missing ?? [])
        .slice(0, 4)
        .map((m, k) => ({ name: cleanPartName(m.name, opts.object), rank: 100 + k, boxes: [toPx(m.box, view)].filter((b): b is PxBox => !!b) }))
        .filter((m) => m.name && m.boxes.length && !objectWords.has(normalizeForMatch(m.name)) && !/\b(background|floor|wall|table|road|ground|sky|tree|surface|shadow)\b/i.test(m.name));
      if (extra.length) {
        const more = (await samBoxes(deps, view, extra, opts.viewIndex, opts.source, { clip: !!within, within })).out;
        // Not a second outline of a part that is already there.
        const fresh = more.filter((m) => !kept.some((k) => k.concept !== 0 && sameThing(k.label, m.label) && iou(k.box, m.box) > 0.3));
        kept.push(...fresh);
        if (fresh.length) diagnostics.push(`Added ${fresh.length} part${fresh.length === 1 ? '' : 's'} that had been missed.`);
      }
      found = uniqueNames(mergeMany(realParts(dropOverlaps(dropWholeDuplicates(tidyRegions(kept, view)), opts.vocabulary), opts.vocabulary)));
    } catch (e) {
      log('warn', 'label check failed; keeping the outlines as found', { error: (e as Error).message });
    }
  }

  // A part that could not be outlined has only a rough box, whose middle can fall off the part
  // (on the background, for a curved part). Show only real outlines when there are any.
  if (found.some((f) => f.kind === 'mask')) found = found.filter((f) => f.kind === 'mask');
  // A readable picture: at most 16 parts, the most certain ones.
  found = limitParts(found, opts.maxParts ?? 16);
  // The words this person prefers for a part ("Hood" → "Bonnet"; same part, their word).
  for (const t of opts.taught ?? []) {
    if (!sameThing(t.from, t.to)) continue; // a mix-up, not a word: a hint only (it may be right elsewhere)
    for (const f of found) {
      if (f.concept === 0 || normalizeForMatch(baseName(f.label)) !== normalizeForMatch(baseName(t.from))) continue;
      const base = baseName(f.label);
      const side = f.label.slice(0, f.label.length - base.length); // "Left " in "Left hood"
      f.label = side ? `${side}${t.to.toLowerCase()}` : t.to;
    }
  }
  const regions: Region[] = found.slice(0, 40).map(({ concept, name: _n, ...r }, i) => {
    const { agreed: _a, ...rest } = r as typeof r & { agreed?: boolean };
    const whole = concept === 0 && opts.wholeFirst !== false;
    return { ...rest, label: whole ? shortName(r.label) : sentenceCase(shortName(r.label)), id: `r${i + 1}`, ...(whole ? { whole: true } : {}) };
  });
  return { regions, diagnostics: diagnostics.slice(0, 10) };
}

/**
 * An independent second look at a correction (the adjudicator in crowdsourced labelling): the
 * outlined part, with a close-up, and two names in a random order. The model is not told which
 * name came from I SEE and which from the person, and it is asked to choose, not to agree (a
 * yes/no question invites a yes). Returns the index of the name that fits, or null for neither.
 */
export async function secondOpinion(
  deps: LabelDeps,
  view: ImagePayload,
  region: { path: string | null; box: Region['box'] },
  object: string | null,
  options: [string, string],
  rand: () => number = Math.random,
  effort: 'medium' | 'high' = 'medium',
): Promise<{ pick: 0 | 1 | null; sure: boolean; reason: string }> {
  const flip = rand() < 0.5;
  const shown: [string, string] = flip ? [options[1], options[0]] : options;
  const anchor = { x: region.box.x + region.box.w / 2, y: region.box.y + region.box.h / 2 };
  const shot = await overlay(view, [{ path: region.path ?? `M${region.box.x} ${region.box.y}h${region.box.w}v${region.box.h}h${-region.box.w}Z`, anchor }]);
  const pad = 0.6;
  const close = await zoomCrop(shot, { left: region.box.x - region.box.w * pad, top: region.box.y - region.box.h * pad, right: region.box.x + region.box.w * (1 + pad), bottom: region.box.y + region.box.h * (1 + pad) }, 900).catch(() => null);
  const r = await chatStructured({
    client: deps.client,
    model: deps.sparkModel,
    mode: 'json_schema',
    instructionRole: 'developer',
    reasoningEffort: effort,
    signal: deps.signal,
    timeoutMs: deps.timeoutMs,
    schema: SecondOpinionSchema,
    name: 'second_opinion',
    system: 'Return the JSON object that matches the schema. You give an independent second opinion on what an outlined part of a photo is, judging only from what is inside the outline.',
    user: [
      `The photo shows ${object ? `a ${object}` : 'an object'}. One region is outlined in colour and marked 1.${close ? ' The second image is a close-up of it.' : ''}`,
      `Which name fits the outlined region: A) "${shown[0]}" or B) "${shown[1]}"? If neither fits (it is background, another part, or something else), say neither.`,
      'Look at the shape, size and position of what is inside the outline, and where it sits on the object. Two people disagreed about it, so look carefully.',
    ].join('\n'),
    images: close ? [shot, close.img] : [shot],
  });
  const c = r.value.choice;
  const shownPick = c === 'A' ? 0 : c === 'B' ? 1 : null;
  const pick = shownPick === null ? null : ((flip ? 1 - shownPick : shownPick) as 0 | 1);
  return { pick, sure: !!r.value.sure, reason: sanitizeText(r.value.reason, 240) };
}

/** Names a single outline the person tapped (what part of the object it is). */
/** The name of a tapped outline; `background` when it shows no part of the object; null if it could not be checked. */
export async function nameOutline(deps: LabelDeps, view: ImagePayload, region: { path: string | null; anchor: { x: number; y: number } }, object: string | null): Promise<string | null> {
  try {
    const shot = await overlay(view, [region]);
    const check = await chatStructured({
      client: deps.client,
      model: deps.sparkModel,
      mode: 'json_schema',
      instructionRole: 'developer',
      reasoningEffort: 'low',
      signal: deps.signal,
      timeoutMs: deps.timeoutMs,
      schema: NameOutlineSchema,
      name: 'name_outline',
      system: 'Return the JSON object that matches the schema.',
      user: `${object ? `The image shows: ${object}. ` : ''}A person tapped one spot and it was outlined in red with the number 1. Name the part of the object inside that outline, as specifically as you can see (for example "cap", "label", "left ear", "power button"). If it is mostly background, the floor or a hand, name is null.`,
      images: [shot],
    });
    return check.value.name ? shortName(stripColour(check.value.name)) : 'background';
  } catch {
    return null;
  }
}

/**
 * Names parts in an illustration by numbered marks (Set-of-Mark prompting), which works better
 * than asking a vision model to point at a named part: models lean on what anatomy usually looks
 * like, and do much better when they only see numbered outlines and choose a name for each.
 *
 *   1. Candidate outlines, from two independent sources: each name located and outlined
 *      (Muse Spark boxes, SAM 3.1 masks), and each name outlined directly by SAM 3.1 from text.
 *   2. Overlapping candidates are merged; the image shows only numbers, never names.
 *   3. Muse Spark picks, for each number, which one name it shows (or none), with close-ups
 *      of the small ones. Each name is used once.
 */
export async function nameByMarks(
  deps: LabelDeps,
  view: ImagePayload,
  names: string[],
  opts: { object: string; vocabulary?: string[] },
): Promise<{ regions: Region[]; diagnostics: string[] }> {
  const list = [...new Set(names.map((n) => sanitizeText(n, 80)).filter(Boolean))].slice(0, 14);
  const diagnostics: string[] = [];
  const [located, outlined] = await Promise.all([
    // A drawing needs no more than medium thinking: at high, the long answers can run out of
    // time and leave the drawing with no labels at all.
    labelImage(deps, view, list, { object: opts.object, viewIndex: 0, source: 'sam', verify: false, max: 14, wholeFirst: false, vocabulary: opts.vocabulary, effort: 'medium' }).catch((e: unknown) => {
      log('warn', 'locating parts by name failed', { error: (e as Error).message });
      return { regions: [] as Region[], diagnostics: [] as string[] };
    }),
    samSegment(deps.client, { view, viewIndex: 0, concepts: list.map((n) => n.toLowerCase()) }, { model: deps.samModel, signal: deps.signal, maxPerConcept: 2, maxConcepts: 14, concurrency: 4 }).catch((e: unknown) => {
      log('warn', 'outlining parts by name failed', { error: (e as Error).message });
      return { regions: [] as Region[], diagnostics: [] as string[], ms: 0 };
    }),
  ]);
  // Candidates: masks only, the same outline found twice counted once, the largest-covering last.
  const all = [...located.regions, ...outlined.regions].filter((r) => r.kind === 'mask' && r.path && r.area < 0.6);
  const candidates: Region[] = [];
  for (const r of all) {
    const twin = candidates.find((c) => iou(c.box, r.box) > 0.7 && Math.min(c.area, r.area) / Math.max(c.area, r.area, 1e-9) > 0.6);
    if (!twin) candidates.push(r);
  }
  candidates.sort((a, b) => b.area - a.area);
  const marks = candidates.slice(0, 22);
  if (!marks.length) return { regions: [], diagnostics: ['No parts could be outlined in the drawing.'] };

  try {
    const shot = await overlay(view, marks);
    const closeups: ImagePayload[] = [];
    for (const c of smallClusters(marks.map((f) => ({ left: f.box.x, top: f.box.y, right: f.box.x + f.box.w, bottom: f.box.y + f.box.h })), view, 3)) {
      try {
        closeups.push((await zoomCrop(shot, c.area, 900)).img);
      } catch {
        /* the whole picture still shows them */
      }
    }
    const r = await chatStructured({
      client: deps.client,
      model: deps.sparkModel,
      mode: 'json_schema',
      instructionRole: 'developer',
      reasoningEffort: 'medium',
      signal: deps.signal,
      timeoutMs: deps.timeoutMs,
      schema: MarkNamesSchema,
      name: 'mark_names',
      system: 'Return the JSON object that matches the schema. You name the numbered outlines in an illustration, judging only from what is drawn inside each outline.',
      user: [
        `This is an illustration of ${opts.object}. Each coloured outline has a number.`,
        `Names to choose from: ${list.map((n) => `"${n}"`).join(', ')}.`,
        'For each number, decide which one name the outline shows, from the shape, colour, texture and size of what is drawn inside it, and where it sits relative to the other parts. Do not go by the number or the order of the list.',
        'Each name fits at most one outline: if two outlines show the same thing, give the name to the one that shows it best and null to the other. If an outline covers several different parts, part of the background, or none of the names, give null.',
        closeups.length ? `The first image shows everything. The next ${closeups.length === 1 ? 'image is a close-up' : `${closeups.length} images are close-ups`} of the small outlines, with the same numbers and colours.` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      images: [shot, ...closeups],
    });
    const byName = new Map(list.map((n) => [normalizeForMatch(n), n]));
    const chosen = new Map<string, { r: Region; sure: boolean }>();
    for (const m of r.value.marks) {
      const region = marks[Math.round(m.n) - 1];
      const name = m.name ? byName.get(normalizeForMatch(stripColour(m.name))) : undefined;
      if (!region || !name) continue;
      const prev = chosen.get(name);
      // Each name once: a sure answer beats an unsure one; otherwise the outline whose own search found that name.
      const better = !prev || (m.sure && !prev.sure) || (m.sure === prev.sure && normalizeForMatch(region.label) === normalizeForMatch(name) && normalizeForMatch(prev.r.label) !== normalizeForMatch(name));
      if (better) chosen.set(name, { r: region, sure: m.sure });
    }
    const regions = [...chosen.entries()].map(([name, { r }], i) => ({ ...r, label: name, id: `r${i + 1}` }));
    diagnostics.push(`Named ${regions.length} of ${marks.length} outlines by their numbers.`);
    if (regions.length) return { regions, diagnostics };
    // No outline could be named by its number: keep the outlines that were found by their own
    // names instead of leaving the drawing with no labels.
    const own = byOwnName(located.regions, outlined.regions, list);
    if (own.length) {
      log('info', 'no numbered outline was named; using the parts as located by name', { parts: own.length });
      diagnostics.push(`Used ${own.length} part${own.length === 1 ? '' : 's'} as located by name.`);
    }
    return { regions: own, diagnostics };
  } catch (e) {
    log('warn', 'naming the numbered outlines failed; using the parts as located', { error: (e as Error).message });
    // Fall back to the outlines found by name, checked the usual way.
    const checked = await labelImage(deps, view, list, { object: opts.object, viewIndex: 0, source: 'sam', verify: true, max: 14, wholeFirst: false, vocabulary: opts.vocabulary, effort: 'medium' }).catch(() => null);
    if (checked?.regions.length) return { regions: checked.regions, diagnostics: [...diagnostics, ...checked.diagnostics] };
    return { regions: byOwnName(located.regions, outlined.regions, list), diagnostics: [...diagnostics, ...(checked?.diagnostics ?? [])] };
  }
}

/**
 * The outlines found by their own names, one per name: those located in the drawing by name
 * first, then those SAM outlined from the name with a fair score. Used only when the numbered
 * outlines could not be named.
 */
function byOwnName(located: Region[], outlined: Region[], list: string[]): Region[] {
  const byName = new Map(list.map((n) => [normalizeForMatch(n), n]));
  const nameOf = (label: string) => {
    const n = normalizeForMatch(label);
    return byName.get(n) ?? [...byName.entries()].find(([k]) => n.includes(k) || k.includes(n))?.[1] ?? null;
  };
  const out: Region[] = [];
  const taken = new Set<string>();
  for (const r of [...located, ...outlined.filter((x) => (x.confidence ?? 0) >= 0.5)]) {
    if (r.kind !== 'mask' || !r.path || r.area >= 0.6) continue;
    const name = nameOf(r.label);
    if (!name || taken.has(name)) continue;
    taken.add(name);
    out.push({ ...r, label: name, id: `r${out.length + 1}` });
  }
  return out;
}
