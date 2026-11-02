/**
 * A part drawn by hand: a loop around it, traced with a finger, pen or mouse. These turn the loop
 * into an outline like the ones SAM 3.1 draws (an SVG path in image pixels, its box, its share of
 * the photo, and a point well inside it for its dot).
 */
export type Pt = [number, number];

/** Ramer-Douglas-Peucker: drops points on near-straight runs, keeps the shape. */
export function simplifyLine(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = pts[a]!;
    const [bx, by] = pts[b]!;
    const len = Math.hypot(bx - ax, by - ay) || 1;
    let far = -1;
    let best = eps;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i]!;
      const d = Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len;
      if (d > best) {
        best = d;
        far = i;
      }
    }
    if (far >= 0) {
      keep[far] = 1;
      stack.push([a, far], [far, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Chaikin corner cutting on a closed loop: a hand-drawn wobble becomes a smooth curve. */
export function smoothLoop(pts: Pt[], rounds = 2): Pt[] {
  let out = pts;
  for (let r = 0; r < rounds && out.length >= 3; r++) {
    const next: Pt[] = [];
    for (let i = 0; i < out.length; i++) {
      const [x0, y0] = out[i]!;
      const [x1, y1] = out[(i + 1) % out.length]!;
      next.push([x0 * 0.75 + x1 * 0.25, y0 * 0.75 + y1 * 0.25], [x0 * 0.25 + x1 * 0.75, y0 * 0.25 + y1 * 0.75]);
    }
    out = next;
  }
  return out;
}

/** Signed area (shoelace), in square pixels. */
export function loopArea(pts: Pt[]): number {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j]![0] + pts[i]![0]) * (pts[j]![1] - pts[i]![1]);
  return Math.abs(a / 2);
}

export function insideLoop(pts: Pt[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]!;
    const [xj, yj] = pts[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-9) + xi) inside = !inside;
  }
  return inside;
}

/** A point well inside the loop: the middle if it is inside (a crescent's middle is not). */
export function pointInside(pts: Pt[]): { x: number; y: number } {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const cx = xs.reduce((a, b) => a + b, 0) / pts.length;
  const cy = ys.reduce((a, b) => a + b, 0) / pts.length;
  if (insideLoop(pts, cx, cy)) return { x: cx, y: cy };
  // Otherwise the inside point farthest from the edge, on a coarse grid.
  let best = { x: cx, y: cy, d: -1 };
  const n = 24;
  for (let gy = 0; gy <= n; gy++)
    for (let gx = 0; gx <= n; gx++) {
      const x = x0 + ((x1 - x0) * gx) / n;
      const y = y0 + ((y1 - y0) * gy) / n;
      if (!insideLoop(pts, x, y)) continue;
      let d = Infinity;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [ax, ay] = pts[j]!;
        const [bx, by] = pts[i]!;
        const l2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / l2));
        d = Math.min(d, Math.hypot(x - (ax + t * (bx - ax)), y - (ay + t * (by - ay))));
      }
      if (d > best.d) best = { x, y, d };
    }
  return { x: best.x, y: best.y };
}

/**
 * The outline of a loop drawn on a W × H photo, or null when it is too small or too thin to be
 * a part (a tap, or a stray line rather than a loop).
 */
export function outlineOf(raw: Pt[], W: number, H: number) {
  const clamp = (p: Pt): Pt => [Math.max(0, Math.min(W, p[0])), Math.max(0, Math.min(H, p[1]))];
  const pts = smoothLoop(simplifyLine(raw.map(clamp), Math.hypot(W, H) * 0.0012), 2);
  if (pts.length < 6) return null;
  const area = loopArea(pts);
  if (area < W * H * 0.0002) return null;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const box = { x: x0, y: y0, w: Math.max(...xs) - x0, h: Math.max(...ys) - y0 };
  // A loop, not a scribble along a line: it must enclose a fair share of its own box.
  if (area < box.w * box.h * 0.12) return null;
  const f = (n: number) => String(Math.round(n * 10) / 10);
  const path = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${f(x)} ${f(y)}`).join('') + 'Z';
  return { path, box, anchor: pointInside(pts), area: Math.min(1, area / (W * H)) };
}
