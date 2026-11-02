/**
 * Numbers drawn as plain strokes (no font). Servers often have no fonts installed (a fresh
 * Railway or Docker image has none), and then SVG text renders as nothing: the numbered marks
 * a vision model is asked to read would be blank. Strokes render the same everywhere.
 *
 * Each digit is drawn in a 6 × 10 box; digits sit 7.6 apart.
 */
const GLYPH: Record<string, string> = {
  '0': 'M3 0Q6 0 6 5Q6 10 3 10Q0 10 0 5Q0 0 3 0Z',
  '1': 'M1.2 2.2L3.6 0V10M1.2 10H6',
  '2': 'M0.4 2.4Q0.8 0 3 0Q5.8 0 5.8 2.7Q5.8 4.6 3.6 6.4L0.2 10H6',
  '3': 'M0.4 1.2Q1.6 0 3 0Q5.8 0 5.8 2.6Q5.8 4.9 2.8 4.9Q6 4.9 6 7.5Q6 10 3 10Q1.2 10 0.2 8.8',
  '4': 'M4.4 10V0L0 6.8H6',
  '5': 'M5.6 0H1.2L0.6 4.6Q1.8 3.9 3.2 3.9Q6 3.9 6 6.9Q6 10 3 10Q1.2 10 0.2 8.9',
  '6': 'M5.2 0.8Q4.4 0 3.2 0Q0 0 0 5.4Q0 10 3 10Q6 10 6 7.1Q6 4.3 3.1 4.3Q1 4.3 0.2 6.2',
  '7': 'M0 0H6Q3.2 4 2.2 10',
  '8': 'M3 4.8Q0.4 4.8 0.4 2.4Q0.4 0 3 0Q5.6 0 5.6 2.4Q5.6 4.8 3 4.8Q0 4.8 0 7.4Q0 10 3 10Q6 10 6 7.4Q6 4.8 3 4.8Z',
  '9': 'M5.8 4.6Q5 5.7 2.9 5.7Q0 5.7 0 2.85Q0 0 3 0Q6 0 6 4.6Q6 10 2.8 10Q1.6 10 0.8 9.2',
};
const ADVANCE = 7.6;

/**
 * An SVG `<g>` drawing `n` centred on (cx, cy), at most `height` tall and `maxWidth` wide,
 * in `colour`, with strokes `weight` pixels thick.
 */
export function strokeNumber(n: number, cx: number, cy: number, height: number, maxWidth: number, colour = '#000', weight = Math.max(1.5, height * 0.16)): string {
  const s = String(Math.max(0, Math.round(n)));
  const width = 6 + (s.length - 1) * ADVANCE;
  const k = Math.min(height / 10, maxWidth / width);
  const x0 = cx - (width * k) / 2;
  const y0 = cy - (10 * k) / 2;
  const f = (v: number) => Math.round(v * 100) / 100;
  const paths = [...s].map((ch, i) => `<path d="${GLYPH[ch]}" transform="translate(${f(x0 + i * ADVANCE * k)} ${f(y0)}) scale(${f(k)})"/>`).join('');
  return `<g fill="none" stroke="${colour}" stroke-width="${f(weight / k)}" stroke-linecap="round" stroke-linejoin="round">${paths}</g>`;
}
