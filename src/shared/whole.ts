/**
 * Which outline on the photo is the whole object (not one of its parts). Its name is already
 * the page title, and a name pin for it lands in the middle of some part, where it reads as a
 * wrong label ("Compact SUV" pointing at the bonnet), so the photo shows only its dashed edge.
 */
import { planForObject } from './bodyplans';
import { normalizeForMatch } from './text';

interface R {
  id: string;
  whole?: boolean;
  label: string;
  area: number;
  box: { x: number; y: number; w: number; h: number };
  anchor: { x: number; y: number };
}

export function wholeObjectIds(
  regions: R[],
  object: { displayName: string; category: string; subcategory?: string | null; candidates?: Array<{ name: string; likelihood?: number }>; summary?: string },
): string[] {
  // Marked when it was outlined (scans from this version on).
  const marked = regions.filter((r) => r.whole).map((r) => r.id);
  if (marked.length) return marked.slice(0, 1);
  const names = new Set([object.displayName, object.subcategory ?? '', ...(object.candidates ?? []).map((c) => c.name)].filter(Boolean).map((n) => normalizeForMatch(n)));
  const plan = planForObject(object);
  const last = (s: string) => normalizeForMatch(s).split(' ').at(-1) ?? '';
  // Kind words: the plan's, and the last word of the main name and kind (not of other guesses,
  // whose last word can be a part: "… to solder cup").
  const kindWords = new Set([...(plan?.words ?? []), last(object.displayName), last(object.subcategory ?? '')].filter((w) => w.length > 2));
  // Named as the object itself: its name, its kind, or a candidate's name ("Coffee pot" for a moka pot).
  // (Also large: the whole object fills much of the photo, a part named like it does not.)
  const byName = (r: R) => r.area >= 0.2 && (names.has(normalizeForMatch(r.label)) || (normalizeForMatch(r.label).split(' ').length <= 3 && kindWords.has(last(r.label))));
  // Or shaped like it: a large outline that holds most of the other parts.
  const holds = (r: R) =>
    r.area > 0.2 &&
    regions.filter((o) => o !== r && o.anchor.x >= r.box.x && o.anchor.x <= r.box.x + r.box.w && o.anchor.y >= r.box.y && o.anchor.y <= r.box.y + r.box.h).length >= Math.max(2, (regions.length - 1) * 0.6);
  return regions
    .filter((r) => byName(r) || holds(r))
    .sort((a, b) => b.area - a.area)
    .slice(0, 1)
    .map((r) => r.id);
}
