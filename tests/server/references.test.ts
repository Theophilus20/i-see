import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { commonsSearchUrl, needsNoCredit, pickCommons, referencePictures } from '../../server/retrieval/references';
import { referenceQueries, bodyPlanFor } from '../../src/shared/bodyplans';

const page = (title: string, desc: string, license = 'Public domain', width = 1600) => ({
  title: `File:${title}`,
  index: 1,
  imageinfo: [
    {
      thumburl: `https://upload.wikimedia.org/thumb/${encodeURIComponent(title)}.png`,
      descriptionurl: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(title)}`,
      mime: 'image/png',
      width,
      height: 1000,
      extmetadata: { ImageDescription: { value: desc }, LicenseShortName: { value: license }, Artist: { value: '<a href="x">A. Illustrator</a>' } },
    },
  ],
});

describe('real reference pictures', () => {
  it('searches Commons for pictures of the inside of this kind of thing', () => {
    expect(referenceQueries('Holstein Friesian cow', bodyPlanFor('Holstein Friesian cow', 'animal'))).toEqual(['cow skeleton', 'cow anatomy organs', 'cow internal anatomy', 'ruminant anatomy']);
    expect(referenceQueries('Toyota Corolla car', bodyPlanFor('Toyota Corolla car', 'vehicle'))[0]).toBe('car cutaway');
    expect(commonsSearchUrl('cow skeleton')).toContain('gsrnamespace=6');
  });

  it('uses only pictures that need no credit', () => {
    expect(needsNoCredit('Public domain', 'false')).toBe(true);
    expect(needsNoCredit('PD-old-70', undefined)).toBe(true);
    expect(needsNoCredit('CC0', 'false')).toBe(true);
    expect(needsNoCredit('CC BY-SA 4.0', 'true')).toBe(false);
    expect(needsNoCredit('CC BY 2.0', undefined)).toBe(false);
    expect(needsNoCredit('Public domain', 'true')).toBe(false);
  });

  it('keeps public-domain pictures of the inside, and leaves out maps, meat cuts, small images and credit-only licences', () => {
    const json = {
      query: {
        pages: [
          page('Beef cuts diagram', 'Butcher chart of beef cuts'),
          page('Cow skeleton', 'Skeleton of a domestic cow, lateral view'),
          page('Cow on a farm', 'A cow in a field'),
          page('Cow anatomy tiny', 'anatomy', 'CC0', 300),
          page('Cow organs', 'Visceral anatomy of the cow', 'All rights reserved'),
          page('Cow skeleton museum', 'Skeleton of a cow in a museum', 'CC BY-SA 4.0'),
        ],
      },
    };
    const out = pickCommons(json, 'cow skeleton');
    expect(out.map((x) => x.title)).toEqual(['Cow skeleton']);
    expect(out[0]!.license).toBe('Public domain');
    expect(out[0]!.page).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
  });

  it('downloads them for the drawing and as a small preview', async () => {
    const png = await sharp({ create: { width: 1600, height: 1000, channels: 3, background: '#eeeeee' } }).png().toBuffer();
    const fetchImpl = (async (url: string) =>
      url.includes('api.php') ? new Response(JSON.stringify({ query: { pages: [page('Cow skeleton', 'Skeleton of a cow')] } })) : new Response(png)) as unknown as typeof fetch;
    const out = await referencePictures(fetchImpl, ['cow skeleton', 'cow anatomy organs'], 2);
    expect(out.length).toBe(1);
    expect(out[0]!.image.width).toBe(1024);
  });
});
