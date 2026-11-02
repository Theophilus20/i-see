/** Small text utilities shared by the firewall, the assembler and the UI. */

const CONTROL = new RegExp(
  '[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F\\u200B-\\u200F\\u202A-\\u202E\\u2066-\\u2069\\uFEFF]',
  'g',
);

/**
 * Makes model text safe to store and render as plain text: strips control and
 * bidi-override characters, HTML tags, markdown emphasis and code fences,
 * and collapses whitespace. The UI never uses innerHTML; this is defence in depth.
 */
export function sanitizeText(input: string, max = 700): string {
  let s = String(input ?? '');
  s = s.replace(CONTROL, '');
  s = s.replace(/<\/?[a-zA-Z][^>]*>/g, ' ');
  s = s.replace(/```[\s\S]*?```/g, ' ');
  s = s.replace(/(\*\*|__|~~|`)/g, '');
  s = s.replace(/^\s*[#>*-]+\s+/gm, '');
  s = s.replace(/\s+/g, ' ').trim();
  if (s.length > max) {
    const cut = s.slice(0, max - 1);
    const lastSpace = cut.lastIndexOf(' ');
    s = (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + '…';
  }
  return s;
}

/** Lowercase, accent-free, punctuation-free form for matching quotes against sources. */
export function normalizeForMatch(input: string): string {
  return String(input ?? '')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * True when `quote` appears in `snippet`, allowing differences in case, punctuation
 * and whitespace. A quote may use "…" or "..." to skip text; each fragment must
 * appear, in order. Quotes shorter than 12 characters are too weak to verify.
 */
export function quoteSupported(quote: string | null | undefined, snippet: string): boolean {
  if (!quote) return false;
  const fragments = quote
    .split(/…|\.{3}/)
    .map(normalizeForMatch)
    .filter((f) => f.length > 0);
  if (!fragments.length) return false;
  if (fragments.join(' ').length < 12) return false;
  const hay = normalizeForMatch(snippet);
  let cursor = 0;
  for (const f of fragments) {
    const at = hay.indexOf(f, cursor);
    if (at < 0) return false;
    cursor = at + f.length;
  }
  return true;
}

export const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
export const clamp01 = (n: number): number => (Number.isFinite(n) ? clamp(n, 0, 1) : 0);
export const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Plain-language position of a point in an image, for readers who cannot see the overlay. */
export function describeLocation(x: number, y: number, width: number, height: number): string {
  const fx = x / width;
  const fy = y / height;
  const col = fx < 0.34 ? 'left' : fx > 0.66 ? 'right' : 'centre';
  const row = fy < 0.34 ? 'upper' : fy > 0.66 ? 'lower' : 'middle';
  if (row === 'middle' && col === 'centre') return 'centre';
  if (row === 'middle') return col;
  if (col === 'centre') return row === 'upper' ? 'top' : 'bottom';
  return `${row} ${col}`;
}

export function describeSize(area: number): string {
  if (area >= 0.35) return 'large';
  if (area >= 0.08) return 'medium';
  if (area >= 0.01) return 'small';
  return 'tiny';
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Cheap stable hash when async crypto is not wanted (sample data, keys). Not for security. */
export function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Removes model and provider names from text shown to people (stage notes, errors).
 * The interface describes what happened, not which vendor did it; traces keep the detail.
 */
export function scrubProviderNames(text: string): string {
  return text
    .replace(/\s*\((?:SAM 3\.1|Muse [A-Z][A-Za-z]+(?: [A-Z][a-z]+)*)\)/g, '')
    .replace(/\bon (?:the )?Meta Model API\b/g, 'on this route')
    .replace(/\bMuse (?:Spark|Wonder|Image|Glimmer|Voice Transcribe|Code)(?: Open)?(?: \d+(?:\.\d+)?)?\b/g, 'the AI')
    .replace(/\bSAM 3\.1\b/g, 'outlining')
    .replace(/\b(?:Meta Model API|Meta's|Meta’s|Meta)\b/g, 'the AI service')
    .replace(/\s+via [\w.-]+\.[a-z]{2,}\b/g, '')
    .replace(/\b(?:Baseten|Fireworks|OpenRouter|Modal|Ollama|vLLM)\b/g, 'the AI service')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
