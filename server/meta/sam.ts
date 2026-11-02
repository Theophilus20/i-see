/**
 * SAM 3.1 through the Meta Model API.
 *
 * One streaming Responses request per noun phrase (SAM returns every instance that
 * matches), or one request with box/point prompts for click-to-segment. The stream is
 * special-token text, parsed with Meta's own @meta-sam/parser; masks become SVG paths
 * in image pixels so the browser can draw them and claims can point at them.
 */
import {
  buildObjectPrompt,
  decodeMaskToRaster,
  parseImageStream,
  recordsOfKind,
  type ImageSegmentationResult,
  type ResponsesEvent,
  type SegmentationMaskRecord,
} from '@meta-sam/parser';
import type { Region } from '../../src/shared/schema';
import type { ImagePayload, SegmentInput } from '../../src/shared/tasks';
import { ApiError, readSse, type HttpClient } from './http';

/**
 * The live API emits `response.content_part.done` but not `response.output_text.done`, which
 * the parser needs to finalise a text lane. Synthesise it, once per lane (as Meta's cookbook does).
 */
export async function* normalizedEvents(stream: AsyncIterable<unknown>): AsyncGenerator<ResponsesEvent> {
  const completed = new Set<string>();
  for await (const raw of stream) {
    const event = raw as { type?: string; item_id?: unknown; output_index?: unknown; content_index?: unknown; part?: { type?: unknown; text?: unknown } | null };
    const lane = `${String(event.item_id)}:${String(event.output_index)}:${String(event.content_index)}`;
    if (event.type === 'response.output_text.done') {
      if (!completed.has(lane)) {
        completed.add(lane);
        yield event as unknown as ResponsesEvent;
      }
      continue;
    }
    yield event as unknown as ResponsesEvent;
    if (event.type === 'response.content_part.done' && !completed.has(lane) && event.part?.type === 'output_text' && typeof event.part.text === 'string') {
      completed.add(lane);
      yield { type: 'response.output_text.done', item_id: event.item_id, output_index: event.output_index, content_index: event.content_index, text: event.part.text } as unknown as ResponsesEvent;
    }
  }
}

/**
 * Moves a mask path (pixel-centre coordinates inside the mask raster) into image pixels and
 * drops points that lie on straight runs, which shrinks staircase outlines a lot.
 */
export function placePath(path: string, left: number, top: number): string {
  const out: string[] = [];
  const re = /([MLZ])([^MLZ]*)/gi;
  let sub: Array<[number, number]> = [];
  const flush = (close: boolean) => {
    if (!sub.length) return;
    const pts = sub.filter((p, i, a) => {
      if (i === 0 || i === a.length - 1) return true;
      const [ax, ay] = a[i - 1]!;
      const [cx, cy] = a[i + 1]!;
      return (p[0] - ax) * (cy - ay) - (p[1] - ay) * (cx - ax) !== 0;
    });
    const fmt = (n: number) => (Math.round(n * 10) / 10).toString();
    out.push(pts.map(([x, y], i) => `${i ? 'L' : 'M'}${fmt(x + left + 0.5)} ${fmt(y + top + 0.5)}`).join('') + (close ? 'Z' : ''));
    sub = [];
  };
  let m: RegExpExecArray | null;
  while ((m = re.exec(path))) {
    const cmd = m[1]!.toUpperCase();
    if (cmd === 'Z') {
      flush(true);
      continue;
    }
    const nums = (m[2]!.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []).map(Number);
    if (cmd === 'M') flush(false);
    for (let i = 0; i + 1 < nums.length; i += 2) sub.push([nums[i]!, nums[i + 1]!]);
  }
  flush(false);
  return out.join('');
}

export interface MaskGeometry {
  path: string | null;
  area: number;
  anchor: { x: number; y: number };
}

/**
 * Cleans a mask raster: keeps the main shape and any large pieces of it, drops specks,
 * and fills small holes. SAM masks of textured surfaces can come back as hundreds of
 * islands, which draw as a cloud of squiggles instead of an outline.
 */
export function cleanRaster(src: Uint8Array, w: number, h: number): Uint8Array {
  const r = src.slice();
  const label = new Int32Array(w * h).fill(-1);
  const sizes: number[] = [];
  const queue = new Int32Array(w * h);
  const flood = (start: number, value: number, id: number) => {
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    label[start] = id;
    let n = 0;
    let border = false;
    while (head < tail) {
      const i = queue[head++]!;
      n++;
      const x = i % w;
      const y = (i - x) / w;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border = true;
      const near = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
      for (const j of near) {
        if (j < 0 || label[j] !== -1 || r[j] !== value) continue;
        label[j] = id;
        queue[tail++] = j;
      }
    }
    return { n, border };
  };
  // Foreground pieces.
  for (let i = 0; i < r.length; i++) if (r[i] && label[i] === -1) sizes.push(flood(i, 1, sizes.length).n);
  if (!sizes.length) return r;
  const largest = Math.max(...sizes);
  const keep = sizes.map((n) => n >= Math.max(24, largest * 0.1));
  let total = 0;
  for (let i = 0; i < r.length; i++) {
    if (!r[i]) continue;
    if (!keep[label[i]!]) r[i] = 0;
    else total++;
  }
  // Small holes inside the shape are filled; real openings (a mug handle) stay.
  label.fill(-1);
  let id = 0;
  for (let i = 0; i < r.length; i++) {
    if (r[i] || label[i] !== -1) continue;
    const before = id++;
    const { n, border } = flood(i, 0, before);
    if (!border && n < total * 0.04) for (let j = 0; j < r.length; j++) if (label[j] === before) r[j] = 1;
  }
  return r;
}

/** Ramer-Douglas-Peucker on a closed loop. */
function simplify(pts: Array<[number, number]>, eps: number): Array<[number, number]> {
  if (pts.length < 5) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = pts[a]!;
    const [bx, by] = pts[b]!;
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    let best = -1;
    let at = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i]!;
      const d = Math.abs(dy * px - dx * py + bx * ay - by * ax) / len;
      if (d > best) {
        best = d;
        at = i;
      }
    }
    if (best > eps && at > 0) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** RDP on a closed ring (the last point may repeat the first): split at the point farthest from the start. */
function simplifyRing(ring: Array<[number, number]>, eps: number): Array<[number, number]> {
  const pts = ring.length > 1 && ring[0]![0] === ring.at(-1)![0] && ring[0]![1] === ring.at(-1)![1] ? ring.slice(0, -1) : ring;
  if (pts.length < 5) return pts;
  let far = 0;
  let best = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = (pts[i]![0] - pts[0]![0]) ** 2 + (pts[i]![1] - pts[0]![1]) ** 2;
    if (d > best) {
      best = d;
      far = i;
    }
  }
  const a = simplify(pts.slice(0, far + 1), eps);
  const b = simplify([...pts.slice(far), pts[0]!], eps);
  return [...a, ...b.slice(1, -1)];
}

/** Outline loops (outer edges and holes) of a raster, as an SVG path in image pixels. */
export function rasterToPath(r: Uint8Array, w: number, h: number, ox: number, oy: number, eps = 1.1): string {
  const W = w + 1;
  const next = new Map<number, number[]>();
  const add = (x1: number, y1: number, x2: number, y2: number) => {
    const k = y1 * W + x1;
    const list = next.get(k);
    if (list) list.push(y2 * W + x2);
    else next.set(k, [y2 * W + x2]);
  };
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && r[y * w + x] === 1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!at(x, y)) continue;
      if (!at(x, y - 1)) add(x, y, x + 1, y);
      if (!at(x + 1, y)) add(x + 1, y, x + 1, y + 1);
      if (!at(x, y + 1)) add(x + 1, y + 1, x, y + 1);
      if (!at(x - 1, y)) add(x, y + 1, x, y);
    }
  const parts: string[] = [];
  for (const [start] of next) {
    let list = next.get(start);
    if (!list?.length) continue;
    const loop: Array<[number, number]> = [];
    let k = start;
    for (let guard = 0; guard < 4 * (w + 1) * (h + 1); guard++) {
      list = next.get(k);
      if (!list?.length) break;
      loop.push([k % W, Math.floor(k / W)]);
      k = list.pop()!;
      if (k === start) break;
    }
    if (loop.length < 4) continue;
    // Drop the points in the middle of straight runs, then smooth the staircase.
    const pts = simplify(loop, eps);
    if (pts.length < 3) continue;
    const fmt = (n: number) => (Math.round(n * 10) / 10).toString();
    parts.push(pts.map(([x, y], i) => `${i ? 'L' : 'M'}${fmt(x + ox)} ${fmt(y + oy)}`).join('') + 'Z');
  }
  return parts.join('');
}

/** Box blur in place (sliding window), radius r, along rows then columns. */
function boxBlur(f: Float64Array, w: number, h: number, r: number): void {
  const tmp = new Float64Array(Math.max(w, h));
  const win = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    const o = y * w;
    let sum = 0;
    for (let x = -r; x <= r; x++) sum += f[o + Math.min(w - 1, Math.max(0, x))]!;
    for (let x = 0; x < w; x++) {
      tmp[x] = sum / win;
      sum += f[o + Math.min(w - 1, x + r + 1)]! - f[o + Math.max(0, x - r)]!;
    }
    for (let x = 0; x < w; x++) f[o + x] = tmp[x]!;
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) sum += f[Math.min(h - 1, Math.max(0, y)) * w + x]!;
    for (let y = 0; y < h; y++) {
      tmp[y] = sum / win;
      sum += f[Math.min(h - 1, y + r + 1) * w + x]! - f[Math.max(0, y - r) * w + x]!;
    }
    for (let y = 0; y < h; y++) f[y * w + x] = tmp[y]!;
  }
}

/**
 * Marching squares at level `t` on a grid of values (value i covers pixel [i, i+1], so samples sit at
 * pixel centres). Edge crossings are interpolated, so the outline runs between pixels, not along them.
 * The grid must have a margin below `t` all round, so every ring closes.
 */
export function isoRings(f: Float64Array, W: number, H: number, t: number): Array<Array<[number, number]>> {
  const at = new Map<number, [number, number]>();
  const adj = new Map<number, number[]>();
  // Edge keys: horizontal edge (x,y)-(x+1,y) = 2*(y*W+x); vertical edge (x,y)-(x,y+1) = 2*(y*W+x)+1.
  const hKey = (x: number, y: number) => 2 * (y * W + x);
  const vKey = (x: number, y: number) => 2 * (y * W + x) + 1;
  const cross = (key: number) => {
    let p = at.get(key);
    if (p) return p;
    const i = key >> 1;
    const x = i % W;
    const y = (i - x) / W;
    const a = f[i]!;
    const b = key & 1 ? f[i + W]! : f[i + 1]!;
    const s = b === a ? 0.5 : Math.max(0, Math.min(1, (t - a) / (b - a)));
    p = key & 1 ? [x + 0.5, y + 0.5 + s] : [x + 0.5 + s, y + 0.5];
    at.set(key, p);
    return p;
  };
  const link = (a: number, b: number) => {
    cross(a);
    cross(b);
    const la = adj.get(a);
    if (la) la.push(b);
    else adj.set(a, [b]);
    const lb = adj.get(b);
    if (lb) lb.push(a);
    else adj.set(b, [a]);
  };
  for (let y = 0; y < H - 1; y++)
    for (let x = 0; x < W - 1; x++) {
      const tl = f[y * W + x]!;
      const tr = f[y * W + x + 1]!;
      const br = f[(y + 1) * W + x + 1]!;
      const bl = f[(y + 1) * W + x]!;
      const c = (tl >= t ? 8 : 0) | (tr >= t ? 4 : 0) | (br >= t ? 2 : 0) | (bl >= t ? 1 : 0);
      if (c === 0 || c === 15) continue;
      const top = hKey(x, y);
      const bottom = hKey(x, y + 1);
      const left = vKey(x, y);
      const right = vKey(x + 1, y);
      const centre = (tl + tr + br + bl) / 4 >= t;
      switch (c) {
        case 1:
        case 14:
          link(left, bottom);
          break;
        case 2:
        case 13:
          link(bottom, right);
          break;
        case 3:
        case 12:
          link(left, right);
          break;
        case 4:
        case 11:
          link(top, right);
          break;
        case 6:
        case 9:
          link(top, bottom);
          break;
        case 7:
        case 8:
          link(left, top);
          break;
        case 5:
          if (centre) {
            link(left, top);
            link(bottom, right);
          } else {
            link(left, bottom);
            link(top, right);
          }
          break;
        case 10:
          if (centre) {
            link(top, right);
            link(left, bottom);
          } else {
            link(left, top);
            link(bottom, right);
          }
          break;
      }
    }
  const rings: Array<Array<[number, number]>> = [];
  const seen = new Set<number>();
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const ring: Array<[number, number]> = [];
    let prev = -1;
    let cur = start;
    for (let guard = 0; guard <= adj.size; guard++) {
      seen.add(cur);
      ring.push(at.get(cur)!);
      const next = (adj.get(cur) ?? []).find((k) => k !== prev && !seen.has(k));
      if (next === undefined) break;
      prev = cur;
      cur = next;
    }
    if (ring.length >= 3) rings.push(ring);
  }
  return rings;
}

/**
 * A smooth outline of a raster, as an SVG path in image pixels: the mask is blurred a little
 * (relative to its size) and traced at the half-way level with marching squares, so edges fall
 * between pixels instead of following the pixel staircase, and ragged bumps along the edge melt away.
 */
export function smoothOutline(r: Uint8Array, w: number, h: number, ox: number, oy: number, pixels?: number): string {
  let n = pixels ?? 0;
  if (pixels == null) for (let i = 0; i < r.length; i++) n += r[i]!;
  if (!n) return '';
  const radius = Math.max(1, Math.min(4, Math.round(Math.sqrt(n) * 0.012)));
  const pad = radius * 3 + 2;
  const W = w + 2 * pad;
  const H = h + 2 * pad;
  const f = new Float64Array(W * H);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (r[y * w + x]) f[(y + pad) * W + x + pad] = 1;
  boxBlur(f, W, H, radius);
  boxBlur(f, W, H, radius);
  const fmt = (v: number) => (Math.round(v * 10) / 10).toString();
  const minRing = Math.max(12, n * 0.002);
  const parts: string[] = [];
  for (const ring of isoRings(f, W, H, 0.5)) {
    if (ring.length < 4) continue;
    // Shoelace area: drop tiny rings left over from specks.
    let a = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j]![0] + ring[i]![0]) * (ring[j]![1] - ring[i]![1]);
    if (Math.abs(a / 2) < minRing) continue;
    const pts = simplifyRing(
      ring.map(([x, y]) => [x - pad + ox, y - pad + oy] as [number, number]),
      0.45,
    );
    if (pts.length < 3) continue;
    parts.push(pts.map(([x, y], i) => `${i ? 'L' : 'M'}${fmt(x)} ${fmt(y)}`).join('') + 'Z');
  }
  return parts.join('');
}

/** A point well inside the shape (not on its edge), as near its middle as possible. */
export function interiorPoint(r: Uint8Array, w: number, h: number): { x: number; y: number } | null {
  // Chamfer distance to the background (3-4 weights), two passes.
  const d = new Int32Array(w * h);
  const BIG = 1 << 28;
  let n = 0;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < r.length; i++) {
    d[i] = r[i] ? BIG : 0;
    if (r[i]) {
      n++;
      sx += i % w;
      sy += Math.floor(i / w);
    }
  }
  if (!n) return null;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : d[y * w + x]!);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i]!, at(x - 1, y) + 3, at(x, y - 1) + 3, at(x - 1, y - 1) + 4, at(x + 1, y - 1) + 4);
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i]!, at(x + 1, y) + 3, at(x, y + 1) + 3, at(x + 1, y + 1) + 4, at(x - 1, y + 1) + 4);
    }
  let max = 0;
  for (let i = 0; i < d.length; i++) if (d[i]! > max) max = d[i]!;
  const cx = sx / n;
  const cy = sy / n;
  let best = Infinity;
  let px = cx;
  let py = cy;
  for (let i = 0; i < d.length; i++) {
    if (d[i]! < max * 0.6) continue;
    const x = i % w;
    const y = (i - x) / w;
    const dd = (x - cx) ** 2 + (y - cy) ** 2;
    if (dd < best) {
      best = dd;
      px = x;
      py = y;
    }
  }
  return { x: px, y: py };
}

/** Grows a full-image raster by `r` pixels (square neighbourhood), in place. */
export function dilate(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const f = new Float64Array(src.length);
  for (let i = 0; i < src.length; i++) f[i] = src[i]!;
  boxBlur(f, w, h, r);
  const out = new Uint8Array(src.length);
  for (let i = 0; i < f.length; i++) out[i] = f[i]! > 1e-6 ? 1 : 0;
  return out;
}

/** The cleaned mask of a record, placed in a full-size image raster. */
export function fullRaster(rec: SegmentationMaskRecord, image: { width: number; height: number }): Uint8Array | null {
  try {
    const w = rec.mask.width;
    const h = rec.mask.height;
    const r = cleanRaster(decodeMaskToRaster(rec.mask), w, h);
    const out = new Uint8Array(image.width * image.height);
    const { left, top } = rec.bounds;
    for (let y = 0; y < h; y++) {
      const iy = y + top;
      if (iy < 0 || iy >= image.height) continue;
      for (let x = 0; x < w; x++) {
        const ix = x + left;
        if (ix < 0 || ix >= image.width || !r[y * w + x]) continue;
        out[iy * image.width + ix] = 1;
      }
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * Path, covered fraction and an anchor point well inside the mask. With `within` (a full-size
 * raster of the whole object), the part is trimmed to the object, and `kept` says how much of
 * it was inside: a "part" that is mostly outside the object is not a part of it.
 */
export function maskGeometry(
  rec: SegmentationMaskRecord,
  image: { width: number; height: number },
  within?: Uint8Array | null,
  /** Keep only what lies in this box (a part's own box, with a margin): the outline cannot spill onto a neighbour. */
  clip?: { left: number; top: number; right: number; bottom: number } | null,
): MaskGeometry & { kept: number; inBox: number; bounds: { left: number; top: number; right: number; bottom: number } | null } {
  const { left, top, right, bottom } = rec.bounds;
  const boxCentre = { x: (left + right) / 2, y: (top + bottom) / 2 };
  try {
    const w = rec.mask.width;
    const h = rec.mask.height;
    let raster = cleanRaster(decodeMaskToRaster(rec.mask), w, h);
    let kept = 1;
    let inBox = 1;
    if (within || clip) {
      let before = 0;
      let inObject = 0;
      let boxed = 0;
      let after = 0;
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          if (!raster[i]) continue;
          before++;
          const ix = x + left;
          const iy = y + top;
          const onImage = ix >= 0 && iy >= 0 && ix < image.width && iy < image.height;
          const inObj = !within || (onImage && !!within[iy * image.width + ix]);
          const inClip = !clip || (ix >= clip.left && ix < clip.right && iy >= clip.top && iy < clip.bottom);
          if (inObj) inObject++;
          if (inClip) boxed++;
          if (onImage && inObj && inClip) after++;
          else raster[i] = 0;
        }
      kept = before ? inObject / before : 0;
      inBox = before ? boxed / before : 0;
      if (after) raster = cleanRaster(raster, w, h);
    }
    let n = 0;
    let x0 = w;
    let y0 = h;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (!raster[y * w + x]) continue;
        n++;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    if (!n) return { path: null, area: 0, anchor: boxCentre, kept, inBox, bounds: null };
    const inner = interiorPoint(raster, w, h) ?? { x: w / 2, y: h / 2 };
    let path: string | null = smoothOutline(raster, w, h, left, top, n);
    if (!path || path.length > 200_000) path = null;
    return {
      path,
      area: Math.min(1, n / (image.width * image.height)),
      anchor: { x: inner.x + left + 0.5, y: inner.y + top + 0.5 },
      kept,
      inBox,
      bounds: { left: x0 + left, top: y0 + top, right: x1 + left + 1, bottom: y1 + top + 1 },
    };
  } catch {
    return { path: null, area: ((right - left) * (bottom - top)) / (image.width * image.height), anchor: boxCentre, kept: 1, inBox: 1, bounds: null };
  }
}

/**
 * Names for several instances of one phrase, by where they sit in the photo:
 * "left earcup" and "right earcup" rather than "earcup 1" and "earcup 2".
 * Left and right are as seen in the photo.
 */
export function positionalNames(label: string, anchors: Array<{ x: number; y: number }>): string[] {
  const n = anchors.length;
  if (n <= 1) return anchors.map(() => label);
  const xs = anchors.map((a) => a.x);
  const ys = anchors.map((a) => a.y);
  const spreadX = Math.max(...xs) - Math.min(...xs);
  const spreadY = Math.max(...ys) - Math.min(...ys);
  const horizontal = spreadX >= spreadY;
  const order = anchors.map((a, i) => ({ i, v: horizontal ? a.x : a.y })).sort((a, b) => a.v - b.v);
  const words = n === 2 ? (horizontal ? ['left', 'right'] : ['upper', 'lower']) : n === 3 ? (horizontal ? ['left', 'middle', 'right'] : ['top', 'middle', 'bottom']) : null;
  const names = new Array<string>(n);
  order.forEach((o, rank) => {
    // Four or more of one part are not numbered ("petiole 4" means nothing to anyone): they keep
    // the plain name and are shown as one part.
    names[o.i] = words ? `${words[rank]} ${label}` : label;
  });
  return names;
}

const boxIoU = (a: Region['box'], b: Region['box']) => {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
};

/**
 * Drops outlines that are the same thing found by two phrases, and large outlines that
 * fill the frame edge to edge (the background) unless they belong to the first phrase,
 * which is the object itself.
 */
export function tidyRegions<R extends Omit<Region, 'id'> & { concept: number }>(found: R[], image: { width: number; height: number }): R[] {
  const kept: R[] = [];
  for (const r of found) {
    const edge = 0.02;
    const touches =
      Number(r.box.x <= image.width * edge) +
      Number(r.box.y <= image.height * edge) +
      Number(r.box.x + r.box.w >= image.width * (1 - edge)) +
      Number(r.box.y + r.box.h >= image.height * (1 - edge));
    if (r.concept > 0 && r.area > 0.4 && touches >= 3) continue;
    const dup = kept.find((k) => boxIoU(k.box, r.box) > 0.85 && Math.min(k.area, r.area) / Math.max(k.area, r.area, 1e-9) > 0.75);
    if (dup) continue;
    kept.push(r);
  }
  return kept;
}

export const dataUrl = (v: ImagePayload) => `data:${v.mime};base64,${v.base64}`;

export interface SamOptions {
  model: string;
  maxPerConcept?: number;
  maxRegions?: number;
  /** How many text concepts to outline (one request each). */
  maxConcepts?: number;
  concurrency?: number;
  signal?: AbortSignal;
}

export async function runSam(client: HttpClient, model: string, text: string, view: ImagePayload, signal?: AbortSignal): Promise<{ result: ImageSegmentationResult; ms: number }> {
  const body = {
    model,
    stream: true,
    input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text }, { type: 'input_image', image_url: dataUrl(view) }] }],
    metadata: { include_confidence: 'true' },
  };
  const { res, ms } = await client.postStream('/responses', body, { signal });
  const result = await parseImageStream(normalizedEvents(readSse(res, signal))).finalResult;
  return { result, ms };
}

async function pool<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!, i);
      }
    }),
  );
  return out;
}

export async function samSegment(client: HttpClient, input: SegmentInput, o: SamOptions): Promise<{ regions: Region[]; diagnostics: string[]; ms: number }> {
  const view = input.view;
  const started = Date.now();
  const diagnostics: string[] = [];
  const found: Array<Omit<Region, 'id'> & { concept: number }> = [];
  const maxPer = o.maxPerConcept ?? 4;
  const maxRegions = o.maxRegions ?? 40;

  const collect = (label: string, result: ImageSegmentationResult, source: Region['source'], concept: number) => {
    if (result.outcome.status !== 'completed') diagnostics.push(`Outlining "${label}" ended early (${result.outcome.status}).`);
    const errors = result.diagnostics.filter((d) => d.severity === 'error');
    if (errors.length) diagnostics.push(`${errors.length} malformed outline record${errors.length === 1 ? '' : 's'} for "${label}" were skipped.`);
    const masks = recordsOfKind(result.records, 'mask');
    const boxes = recordsOfKind(result.records, 'box');
    const geo = masks
      .map((m) => ({ m, g: maskGeometry(m, view), conf: m.confidence ?? boxes.find((b) => b.objectId === m.objectId)?.confidence ?? null }))
      .filter((x) => x.g.area >= 0.0005)
      .sort((a, b) => (b.conf ?? 0) - (a.conf ?? 0) || b.g.area - a.g.area)
      .slice(0, maxPer);
    const names = positionalNames(label, geo.map((x) => x.g.anchor));
    geo.forEach(({ m, g, conf }, k) => {
      const { left, top, right, bottom } = m.bounds;
      found.push({
        concept,
        label: names[k]!,
        kind: g.path ? 'mask' : 'box',
        source,
        view: input.viewIndex,
        box: { x: left, y: top, w: right - left, h: bottom - top },
        path: g.path ?? `M${left} ${top}H${right}V${bottom}H${left}Z`,
        anchor: g.anchor,
        area: g.area,
        confidence: conf,
      });
    });
    if (!masks.length) diagnostics.push(`Nothing matched "${label}".`);
  };

  if (input.points?.length || input.box) {
    const clampX = (x: number) => Math.max(0, Math.min(view.width - 1, Math.floor(x)));
    const clampY = (y: number) => Math.max(0, Math.min(view.height - 1, Math.floor(y)));
    const b = input.box;
    let text: string;
    try {
      text = buildObjectPrompt({
        size: { width: view.width, height: view.height },
        objects: [
          {
            id: 1,
            prompts: [
              {
                ...(b ? { box: { left: clampX(b.x), top: clampY(b.y), right: Math.max(clampX(b.x) + 1, Math.min(view.width, Math.ceil(b.x + b.w))), bottom: Math.max(clampY(b.y) + 1, Math.min(view.height, Math.ceil(b.y + b.h))) } } : {}),
                ...(input.points?.length ? { points: input.points.slice(0, 8).map((p) => ({ x: clampX(p.x), y: clampY(p.y), label: p.label ?? 'positive' })) } : {}),
              },
            ],
          },
        ],
      });
    } catch (e) {
      throw new ApiError(`Could not build the outline prompt: ${(e as Error).message}`, 400, 'bad_prompt', false, 'SAM 3.1');
    }
    const { result } = await runSam(client, o.model, text, view, o.signal);
    collect('your selection', result, 'user', 0);
  } else {
    const concepts = (input.concepts ?? []).slice(0, o.maxConcepts ?? 8);
    const results = await pool(concepts, o.concurrency ?? 3, async (c) => {
      try {
        return { c, r: (await runSam(client, o.model, c, view, o.signal)).result };
      } catch (e) {
        if (e instanceof ApiError && !e.retryable && e.status === 401) throw e;
        diagnostics.push(`Could not outline "${c}": ${(e as Error).message}`);
        return null;
      }
    });
    results.forEach((x, i) => {
      if (x) collect(x.c, x.r, 'sam', i);
    });
  }

  const tidy = input.points?.length || input.box ? found : tidyRegions(found, view);
  const regions: Region[] = tidy.slice(0, maxRegions).map(({ concept: _c, ...r }, i) => ({ id: `r${i + 1}`, ...r }));
  return { regions, diagnostics: diagnostics.slice(0, 10), ms: Date.now() - started };
}

/**
 * A mask on a small, fixed grid over the whole image (`gw` × `gh` cells): cheap enough to
 * compare many masks with each other (overlap, which one holds which) without full rasters.
 */
export function coarseMask(rec: SegmentationMaskRecord, image: { width: number; height: number }, gw: number, gh: number): Uint8Array {
  const out = new Uint8Array(gw * gh);
  try {
    const raster = decodeMaskToRaster(rec.mask);
    const w = rec.mask.width;
    const h = rec.mask.height;
    const { left, top } = rec.bounds;
    const sx = image.width / gw;
    const sy = image.height / gh;
    const x0 = Math.max(0, Math.floor(left / sx));
    const y0 = Math.max(0, Math.floor(top / sy));
    const x1 = Math.min(gw - 1, Math.ceil((left + w) / sx));
    const y1 = Math.min(gh - 1, Math.ceil((top + h) / sy));
    for (let gy = y0; gy <= y1; gy++)
      for (let gx = x0; gx <= x1; gx++) {
        const lx = Math.floor((gx + 0.5) * sx) - left;
        const ly = Math.floor((gy + 0.5) * sy) - top;
        if (lx >= 0 && ly >= 0 && lx < w && ly < h && raster[ly * w + lx]) out[gy * gw + gx] = 1;
      }
  } catch {
    /* an unreadable mask covers nothing */
  }
  return out;
}

/** Scales every coordinate pair in an M/L/H/V/Z path. */
export function scalePath(path: string, kx: number, ky: number): string {
  const f = (n: number) => String(Math.round(n * 10) / 10);
  return path.replace(/([MLHV])([^MLHVZ]*)/gi, (_m, cmd: string, args: string) => {
    const nums = (args.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []).map(Number);
    const C = cmd.toUpperCase();
    if (C === 'H') return `H${nums.map((n) => f(n * kx)).join(' ')}`;
    if (C === 'V') return `V${nums.map((n) => f(n * ky)).join(' ')}`;
    const out: string[] = [];
    for (let i = 0; i + 1 < nums.length; i += 2) out.push(`${f(nums[i]! * kx)} ${f(nums[i + 1]! * ky)}`);
    return `${C}${out.join(' ')}`;
  });
}

