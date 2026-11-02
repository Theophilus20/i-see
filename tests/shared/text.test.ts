import { describe, expect, it } from 'vitest';
import { clamp01, describeLocation, describeSize, fnv1a, normalizeForMatch, quoteSupported, sanitizeText, sha256Hex } from '../../src/shared/text';

describe('sanitizeText', () => {
  it('removes tags, emphasis markers, fences and control characters', () => {
    expect(sanitizeText('<script>alert(1)</script>Hello **there** `x`')).toBe('alert(1) Hello there x');
    expect(sanitizeText('a\u0000b‮c​d')).toBe('abcd');
    expect(sanitizeText('before ```js\nevil()\n``` after')).toBe('before after');
  });

  it('collapses whitespace and list markers', () => {
    expect(sanitizeText('  one\n\n  two   three ')).toBe('one two three');
    expect(sanitizeText('- item\n* item 2\n# head')).toBe('item item 2 head');
  });

  it('truncates at a word boundary with an ellipsis', () => {
    const out = sanitizeText('word '.repeat(100), 50);
    expect(out.length).toBeLessThanOrEqual(50);
    expect(out.endsWith('…')).toBe(true);
    expect(out).not.toMatch(/wor…$/);
  });

  it('tolerates non-strings', () => {
    expect(sanitizeText(undefined as unknown as string)).toBe('undefined'.slice(0, 0) || '');
  });
});

describe('quote matching', () => {
  const snippet = 'The Moka pot, invented by Luigi De Ponti for Alfonso Bialetti in 1933, is a stove-top coffee maker.';
  it('ignores case, accents and punctuation', () => {
    expect(normalizeForMatch('Café—BIALETTI!')).toBe('cafe bialetti');
    expect(quoteSupported('invented BY luigi de ponti for alfonso bialetti', snippet)).toBe(true);
  });
  it('requires elided fragments to appear in order', () => {
    expect(quoteSupported('invented by Luigi … stove-top coffee maker', snippet)).toBe(true);
    expect(quoteSupported('stove-top coffee maker ... invented by Luigi', snippet)).toBe(false);
  });
  it('rejects missing, short or empty quotes', () => {
    expect(quoteSupported(null, snippet)).toBe(false);
    expect(quoteSupported('', snippet)).toBe(false);
    expect(quoteSupported('1933', snippet)).toBe(false);
    expect(quoteSupported('invented by someone else entirely', snippet)).toBe(false);
  });
});

describe('small helpers', () => {
  it('clamps', () => {
    expect(clamp01(1.4)).toBe(1);
    expect(clamp01(-3)).toBe(0);
    expect(clamp01(Number.NaN)).toBe(0);
  });
  it('describes where something is for people who cannot see the overlay', () => {
    expect(describeLocation(50, 50, 100, 100)).toBe('centre');
    expect(describeLocation(10, 10, 100, 100)).toBe('upper left');
    expect(describeLocation(90, 90, 100, 100)).toBe('lower right');
    expect(describeLocation(50, 5, 100, 100)).toBe('top');
    expect(describeLocation(95, 50, 100, 100)).toBe('right');
  });
  it('describes size', () => {
    expect(describeSize(0.5)).toBe('large');
    expect(describeSize(0.1)).toBe('medium');
    expect(describeSize(0.02)).toBe('small');
    expect(describeSize(0.001)).toBe('tiny');
  });
  it('hashes deterministically', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(fnv1a('abc')).toBe(fnv1a('abc'));
    expect(fnv1a('abc')).not.toBe(fnv1a('abd'));
  });
});

import { scrubProviderNames } from '../../src/shared/text';
describe('scrubProviderNames', () => {
  it('removes model and provider names from user-facing notes', () => {
    expect(scrubProviderNames('Outlining (SAM 3.1) is not available on Muse Spark Open via inference.baseten.co.')).toBe('Outlining is not available on the AI.');
    expect(scrubProviderNames('Voice needs Muse Voice Transcribe on the Meta Model API, which is not configured.')).not.toMatch(/Muse|Meta/);
    expect(scrubProviderNames('2 sources. Wikipedia could not be reached.')).toBe('2 sources. Wikipedia could not be reached.');
  });
});
