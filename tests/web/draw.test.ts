import { describe, expect, it } from 'vitest';
import { insideLoop, outlineOf, pointInside, type Pt } from '../../src/web/lib/draw';

/** A wobbly hand-drawn circle of radius r around (cx, cy). */
const circle = (cx: number, cy: number, r: number, n = 120): Pt[] => Array.from({ length: n }, (_, i) => [cx + r * Math.cos((i / n) * Math.PI * 2) + ((i * 7) % 3) - 1, cy + r * Math.sin((i / n) * Math.PI * 2) + ((i * 5) % 3) - 1] as Pt);

describe('a part drawn by hand', () => {
  it('becomes a closed outline around what was drawn, with its dot inside', () => {
    const o = outlineOf(circle(300, 200, 50), 800, 600)!;
    expect(o.path.startsWith('M')).toBe(true);
    expect(o.path.endsWith('Z')).toBe(true);
    expect(o.box.x).toBeGreaterThan(245);
    expect(o.box.x + o.box.w).toBeLessThan(355);
    expect(o.area).toBeGreaterThan((Math.PI * 45 ** 2) / (800 * 600));
    expect(Math.hypot(o.anchor.x - 300, o.anchor.y - 200)).toBeLessThan(10);
  });

  it('is not an outline when it is a tap or a line, not a loop', () => {
    expect(outlineOf([[10, 10], [11, 11], [12, 10]], 800, 600)).toBeNull();
    const line: Pt[] = Array.from({ length: 50 }, (_, i) => [100 + i * 8, 300 + (i % 2)]);
    expect(outlineOf(line, 800, 600)).toBeNull();
  });

  it('stays on the photo when the finger runs off the edge', () => {
    const o = outlineOf(circle(20, 20, 60), 400, 300)!;
    expect(o.box.x).toBeGreaterThanOrEqual(0);
    expect(o.box.y).toBeGreaterThanOrEqual(0);
  });

  it('puts the dot inside a crescent, not in the hollow', () => {
    // A C shape: the middle of its points is in the opening.
    const c: Pt[] = [
      [0, 0], [100, 0], [100, 20], [20, 20], [20, 80], [100, 80], [100, 100], [0, 100],
    ];
    const p = pointInside(c);
    expect(insideLoop(c, p.x, p.y)).toBe(true);
  });
});
