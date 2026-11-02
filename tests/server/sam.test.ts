import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { CircuitBreakers, HttpClient } from '../../server/meta/http';
import { normalizedEvents, placePath, samSegment } from '../../server/meta/sam';
import { RegionSchema } from '../../src/shared/schema';
import { SAM_WIRE } from './mock-meta';

function sseFetch(text: string, onBody?: (b: any) => void) { // eslint-disable-line @typescript-eslint/no-explicit-any
  return (async (_url: string, init: RequestInit) => {
    onBody?.(JSON.parse(String(init.body)));
    const lane = { item_id: 'm', output_index: 0, content_index: 0 };
    const events = [
      { type: 'response.created' },
      ...(text ? [{ type: 'response.output_text.delta', ...lane, delta: text.slice(0, 50) }, { type: 'response.output_text.delta', ...lane, delta: text.slice(50) }] : []),
      { type: 'response.content_part.done', ...lane, part: { type: 'output_text', text } },
      { type: 'response.completed' },
    ];
    return new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''), { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }) as unknown as typeof fetch;
}

const view = { mime: 'image/jpeg', base64: '/9j/AAAA', width: 320, height: 334, label: null };
const client = (f: typeof fetch) => new HttpClient({ baseUrl: 'https://api.meta.test/v1', apiKey: 'k', provider: 'Meta', fetch: f, breakers: new CircuitBreakers() });

describe('SAM 3.1 adapter', () => {
  it('turns the documented wire format into mask regions with SVG paths in image pixels', async () => {
    const bodies: any[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
    const r = await samSegment(client(sseFetch(SAM_WIRE, (b) => bodies.push(b))), { view, viewIndex: 0, concepts: ['button'] }, { model: 'sam-3.1' });
    expect(bodies[0]).toMatchObject({ model: 'sam-3.1', stream: true, metadata: { include_confidence: 'true' } });
    expect(bodies[0].input[0].content[0]).toEqual({ type: 'input_text', text: 'button' });
    expect(bodies[0].input[0].content[1].image_url).toMatch(/^data:image\/jpeg;base64,/);
    expect(r.regions).toHaveLength(2);
    for (const reg of r.regions) {
      expect(RegionSchema.safeParse(reg).success).toBe(true);
      expect(reg.kind).toBe('mask');
      expect(reg.source).toBe('sam');
      expect(reg.path).toMatch(/^M[\d.]+ [\d.]+L/);
      // Every path coordinate lies inside the object's box.
      const nums = reg.path!.match(/-?[\d.]+/g)!.map(Number);
      for (let i = 0; i < nums.length; i += 2) {
        expect(nums[i]!).toBeGreaterThanOrEqual(reg.box.x - 0.01);
        expect(nums[i]!).toBeLessThanOrEqual(reg.box.x + reg.box.w + 0.01);
        expect(nums[i + 1]!).toBeGreaterThanOrEqual(reg.box.y - 0.01);
        expect(nums[i + 1]!).toBeLessThanOrEqual(reg.box.y + reg.box.h + 0.01);
      }
      expect(reg.anchor.x).toBeGreaterThan(reg.box.x);
      expect(reg.anchor.x).toBeLessThan(reg.box.x + reg.box.w);
      expect(reg.area).toBeGreaterThan(0.005);
      expect(reg.area).toBeLessThan(0.03);
    }
    expect(r.regions[0]!.confidence).toBe(0.91);
    expect(r.regions.map((x) => x.id)).toEqual(['r1', 'r2']);
    expect(r.regions[0]!.label).toMatch(/^(left|right|upper|lower) button$/);
    expect(new Set(r.regions.map((x) => x.label)).size).toBe(2);
  });

  it('reports a concept that matched nothing', async () => {
    const r = await samSegment(client(sseFetch('')), { view, viewIndex: 0, concepts: ['unicorn'] }, { model: 'sam-3.1' });
    expect(r.regions).toEqual([]);
    expect(r.diagnostics.join(' ')).toMatch(/Nothing matched "unicorn"/);
  });

  it('sends box and point prompts as an object prompt for click-to-segment', async () => {
    const bodies: any[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
    const r = await samSegment(client(sseFetch(SAM_WIRE, (b) => bodies.push(b))), { view, viewIndex: 0, points: [{ x: 230.7, y: 240.2 }, { x: 10, y: 10, label: 'negative' }] }, { model: 'sam-3.1' });
    expect(bodies[0].input[0].content[0].text).toBe('<0f>1<|point;x=230;y=240;w=320;h=334|>-<|point;x=10;y=10;w=320;h=334|>');
    expect(r.regions[0]!.source).toBe('user');
  });

  it('keeps going when one concept fails', async () => {
    let n = 0;
    const f = (async (url: string, init: RequestInit) => {
      n++;
      if (n === 1) return new Response(JSON.stringify({ error: { message: 'bad phrase' } }), { status: 400 });
      return sseFetch(SAM_WIRE)(url, init);
    }) as unknown as typeof fetch;
    const r = await samSegment(client(f), { view, viewIndex: 0, concepts: ['a', 'b'] }, { model: 'sam-3.1', concurrency: 1 });
    expect(r.regions.length).toBe(2);
    expect(r.diagnostics.join(' ')).toMatch(/Could not outline "a"/);
  });

  it('synthesises output_text.done from content_part.done exactly once', async () => {
    async function* src() {
      yield { type: 'response.content_part.done', item_id: 'm', output_index: 0, content_index: 0, part: { type: 'output_text', text: 'x' } };
      yield { type: 'response.output_text.done', item_id: 'm', output_index: 0, content_index: 0, text: 'x' };
    }
    const types: string[] = [];
    for await (const e of normalizedEvents(src())) types.push(e.type);
    expect(types).toEqual(['response.content_part.done', 'response.output_text.done']);
  });

  it('places and simplifies paths', () => {
    expect(placePath('M0 0L1 0L2 0L2 1L2 2L0 2Z', 10, 20)).toBe('M10.5 20.5L12.5 20.5L12.5 22.5L10.5 22.5Z');
  });
});

import { cleanRaster, rasterToPath } from '../../server/meta/sam';
describe('mask clean-up', () => {
  it('drops specks, fills small holes, keeps real openings, and traces clean loops', () => {
    const w = 40;
    const h = 40;
    const r = new Uint8Array(w * h);
    const set = (x: number, y: number, v = 1) => (r[y * w + x] = v);
    for (let y = 5; y < 35; y++) for (let x = 5; x < 35; x++) set(x, y);
    set(1, 1); // speck
    set(38, 2); // speck
    set(10, 10, 0); // tiny hole
    for (let y = 15; y < 25; y++) for (let x = 15; x < 25; x++) set(x, y, 0); // real opening (100 px of 800)
    const c = cleanRaster(r, w, h);
    expect(c[1 * w + 1]).toBe(0);
    expect(c[2 * w + 38]).toBe(0);
    expect(c[10 * w + 10]).toBe(1);
    expect(c[20 * w + 20]).toBe(0);
    const path = rasterToPath(c, w, h, 100, 200);
    expect(path.match(/M/g)!.length).toBe(2);
    expect(path).toMatch(/^M\d/);
    expect(path).toContain('M105 205');
  });
});

import { interiorPoint, smoothOutline } from '../../server/meta/sam';
import { uniqueNames } from '../../server/meta/label';
describe('smooth outlines', () => {
  it('traces between pixels, keeps holes, and melts a ragged edge', () => {
    const w = 60;
    const h = 60;
    const r = new Uint8Array(w * h);
    for (let y = 10; y < 50; y++) for (let x = 10; x < 50; x++) r[y * w + x] = 1;
    for (let y = 25; y < 35; y++) for (let x = 25; x < 35; x++) r[y * w + x] = 0;
    // Ragged bumps along the top edge, one pixel each.
    for (let x = 12; x < 48; x += 3) r[9 * w + x] = 1;
    const path = smoothOutline(r, w, h, 100, 200);
    expect(path.match(/M/g)!.length).toBe(2);
    const ys = [...path.matchAll(/[ML][\d.]+ ([\d.]+)/g)].map((m) => Number(m[1]));
    // The top edge sits near y=210 (image pixels); the one-pixel bumps do not survive.
    expect(Math.min(...ys)).toBeGreaterThan(208.5);
    expect(Math.min(...ys)).toBeLessThan(211);
  });

  it('puts the pin well inside a curved shape, not on its edge', () => {
    const w = 80;
    const h = 80;
    const r = new Uint8Array(w * h);
    // A thick arc (like a headband): the centroid falls in the empty middle.
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const d = Math.hypot(x - 40, y - 60);
        if (d > 28 && d < 38 && y < 60) r[y * w + x] = 1;
      }
    const p = interiorPoint(r, w, h)!;
    expect(r[p.y * w + p.x]).toBe(1);
    const d = Math.hypot(p.x - 40, p.y - 60);
    expect(d).toBeGreaterThan(30);
    expect(d).toBeLessThan(36);
  });
});

describe('one name, one part', () => {
  const reg = (label: string, x: number, area = 0.02, concept = 1) => ({ concept, label, box: { x, y: 100, w: 100, h: 100 }, area, anchor: { x: x + 50, y: 150 } });
  it('merges same-named outlines on one spot and tells separate ones apart', () => {
    const out = uniqueNames([reg('Headphones', 0, 0.4, 0), reg('Left earcup', 100), reg('Right earcup', 400, 0.03), reg('Right earcup', 410, 0.02)]);
    expect(out.map((r) => r.label)).toEqual(['Headphones', 'Left earcup', 'Right earcup']);
    const two = uniqueNames([reg('Earcup', 100), reg('Earcup', 500)]);
    expect(two.map((r) => r.label)).toEqual(['left Earcup', 'right Earcup']);
  });
});

import { mergeMany, realParts } from '../../server/meta/label';
describe('only real parts of this object', () => {
  const reg = (label: string, x: number, concept = 1, area = 0.01) => ({ concept, label, kind: 'mask' as const, source: 'sam' as const, view: 0, box: { x, y: 10, w: 20, h: 20 }, path: `M${x} 10h20v20h-20Z`, anchor: { x: x + 10, y: 20 }, area, confidence: 0.9 });
  it('leaves out the background, other objects and surface areas without an edge', () => {
    const out = realParts([reg('Caladium plant', 0, 0), reg('Background white pot', 10), reg('Right background leaf', 20), reg('Back', 30), reg('Belly', 40), reg('Leaf blade', 50), reg('Udder', 60)]);
    expect(out.map((r) => r.label)).toEqual(['Caladium plant', 'Leaf blade', 'Udder']);
  });
  it('shows four or more of one part as one part, not numbered', () => {
    const out = mergeMany([reg('Plant', 0, 0, 0.3), reg('Leaf petiole', 10), reg('Leaf petiole', 40, 1, 0.02), reg('Leaf petiole', 70), reg('Leaf petiole', 100), reg('Leaf blade', 130)]);
    expect(out.map((r) => r.label)).toEqual(['Plant', 'Leaf petiole', 'Leaf blade']);
    const merged = out[1]!;
    expect(merged.box).toEqual({ x: 10, y: 10, w: 110, h: 20 });
    expect(merged.path.match(/M/g)!.length).toBe(4);
    expect(merged.anchor).toEqual({ x: 50, y: 20 });
  });
});

import { smallClusters } from '../../server/meta/label';
describe('looking closely at small parts', () => {
  it('groups small parts that sit together into one close-up, with context, and leaves big parts out', () => {
    const view = { width: 1000, height: 800 };
    const b = (l: number, t: number, w: number, h: number) => ({ left: l, top: t, right: l + w, bottom: t + h });
    const out = smallClusters([b(800, 100, 40, 30), b(830, 150, 50, 30), b(760, 90, 30, 30), b(100, 600, 40, 40), b(0, 0, 900, 700)], view);
    expect(out.length).toBe(2);
    expect(out[0]!.members.sort()).toEqual([0, 1, 2]); // eye, nose, mouth on the head
    expect(out[1]!.members).toEqual([3]); // a hoof on its own
    const a = out[0]!.area;
    expect(a.left).toBeLessThan(760);
    expect(a.right).toBeGreaterThan(880);
    expect(Math.min(a.right - a.left, a.bottom - a.top)).toBeGreaterThanOrEqual(160); // at least a fifth of the image
  });
});

import { sentenceCase } from '../../server/meta/label';
import { maskGeometry } from '../../server/meta/sam';
import { encodeSegmentationMask } from '../../node_modules/@meta-sam/parser/dist/mask-codec.js';
describe('clear names and tight outlines', () => {
  const reg = (label: string, x: number, y = 100, area = 0.02, concept = 1) => ({ concept, label, box: { x, y, w: 80, h: 80 }, area, anchor: { x: x + 40, y: y + 40 } });
  it('names a vehicle’s two doors and wheels front and rear, from where its front parts are', () => {
    // Front of the car on the right (headlight, grille); "Left Door" and a bare "Door" say nothing useful.
    const out = uniqueNames([reg('Car', 0, 0, 0.6, 0), reg('Headlight', 800), reg('Grille', 880), reg('Left Door', 150), reg('Door', 450), reg('Wheel', 120, 400), reg('Wheel', 600, 400)]);
    const names = out.map((r) => r.label);
    expect(names).toContain('Front door');
    expect(names).toContain('Rear door');
    expect(out.find((r) => r.label === 'Front door')!.box.x).toBe(450);
    expect(out.find((r) => r.label === 'Front wheel')!.box.x).toBe(600);
    expect(out.find((r) => r.label === 'Rear wheel')!.box.x).toBe(120);
  });

  it('writes part names in sentence case, keeping acronyms', () => {
    expect(sentenceCase('Left Door')).toBe('Left door');
    expect(sentenceCase('Upper Grille')).toBe('Upper grille');
    expect(sentenceCase('left Earcup')).toBe('Left earcup');
    expect(sentenceCase('USB-C port')).toBe('USB-C port');
    expect(sentenceCase('LED Indicator')).toBe('LED indicator');
  });

  it('cuts an outline to its own part’s box, so it cannot spill onto a neighbour', () => {
    // A full 100 x 100 mask at (0,0); the part's box is only its top-left corner.
    const raster = new Uint8Array(100 * 100).fill(1);
    const rec = { bounds: { left: 0, top: 0, right: 100, bottom: 100 }, mask: encodeSegmentationMask(raster, 100, 100) } as never;
    const g = maskGeometry(rec, { width: 200, height: 200 }, null, { left: 0, top: 0, right: 40, bottom: 40 });
    expect(g.bounds!.right).toBeLessThanOrEqual(40);
    expect(g.bounds!.bottom).toBeLessThanOrEqual(40);
    expect(g.inBox).toBeCloseTo(0.16, 1);
  });
});

import { sameThing } from '../../server/meta/label';
describe('telling whether two names mean the same part', () => {
  it('matches regional names and qualifiers, and keeps different parts apart', () => {
    expect(sameThing('Front windshield', 'Windscreen')).toBe(true);
    expect(sameThing('Bonnet', 'hood')).toBe(true);
    expect(sameThing('Cloven hoof', 'Hoof')).toBe(true);
    expect(sameThing('Wing mirror', 'Side mirror')).toBe(true);
    expect(sameThing('Number plate', 'License plate')).toBe(true);
    expect(sameThing('Left alloy wheel', 'Wheel')).toBe(true);
    expect(sameThing('Tail light', 'Side mirror')).toBe(false);
    expect(sameThing('Boot', 'Rear side window')).toBe(false);
    expect(sameThing('Nose', 'Mouth')).toBe(false);
    expect(sameThing('Headlight', 'Grille')).toBe(false);
  });

  it('names two wheels seen head-on left and right, not front and rear', () => {
    const reg = (label: string, x: number, y = 100, concept = 1) => ({ concept, label, box: { x, y, w: 80, h: 80 }, area: 0.02, anchor: { x: x + 40, y: y + 40 } });
    // Grille and headlights between the two wheels: a head-on view.
    const out = uniqueNames([reg('Car', 0, 0, 0), reg('Grille', 400), reg('Headlight', 250), reg('Headlight', 550), reg('Wheel', 100, 400), reg('Wheel', 700, 400)]);
    const wheels = out.filter((r) => /wheel/i.test(r.label)).map((r) => r.label.toLowerCase());
    expect(wheels.some((w) => w.startsWith('front') || w.startsWith('rear'))).toBe(false);
    expect(wheels).toEqual(expect.arrayContaining(['left wheel', 'right wheel']));
  });
});

import { cleanPartName, dropOverlaps, limitParts, simplePhrase } from '../../server/meta/label';
describe('clear, short part names and no duplicates', () => {
  it('names parts as a reference book would: generic and short, never a brand or sales feature', () => {
    expect(cleanPartName('Illuminated front Volkswagen logo', 'Volkswagen ID.4')).toBe('Front logo');
    expect(cleanPartName('Automatic LED headlamps', 'Volkswagen ID.4')).toBe('Headlamps');
    expect(cleanPartName('VW emblem', 'Volkswagen ID.4')).toBe('Emblem');
    expect(cleanPartName('License plate holder', 'Volkswagen ID.4')).toBe('License plate holder');
    expect(cleanPartName('USB-C port', 'Pixel 8')).toBe('USB-C port');
    expect(cleanPartName('Pot lid', 'Moka pot')).toBe('Lid');
    expect(simplePhrase('Left door handle')).toBe('door handle');
    expect(cleanPartName('Blade (bar/shank)', 'Stanley 100 Plus screwdriver')).toBe('Blade');
    expect(cleanPartName('Shank/blade', 'Stanley screwdriver')).toBe('Shank');
    expect(cleanPartName('Hand guard or bolster', 'Chef knife')).toBe('Hand guard');
  });

  it('keeps one outline where two names cover the same spot, preferring the confirmed, standard one', () => {
    const reg = (label: string, x: number, extra: { agreed?: boolean; confidence?: number } = {}, concept = 1) => ({ concept, label, box: { x, y: 100, w: 100, h: 60 }, area: 0.01, confidence: extra.confidence ?? 0.8, agreed: extra.agreed });
    const out = dropOverlaps([reg('SUV', 0, {}, 0), reg('Automatic LED headlamps', 400), reg('Headlight', 405, { agreed: true }), reg('Grille', 600)], ['Headlight', 'Grille']);
    expect(out.map((r) => r.label)).toEqual(['SUV', 'Headlight', 'Grille']);
  });

  it('shows at most so many parts, keeping the most certain', () => {
    const reg = (i: number, agreed: boolean) => ({ concept: i === 0 ? 0 : 1, area: 0.01, confidence: 0.6, agreed, label: `p${i}` });
    const list = Array.from({ length: 21 }, (_, i) => reg(i, i % 2 === 0));
    const out = limitParts(list, 16);
    expect(out.length).toBe(17);
    expect(out[0]!.label).toBe('p0');
    expect(out.filter((r) => r.agreed).length).toBe(11);
  });
});

import { anchorsOnParts, scaleRegions, workingCopy } from '../../server/meta/label';
describe('working copies and dots on their parts', () => {
  it('finds parts on a smaller copy and maps them back onto the full image', async () => {
    const big = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#888' } }).jpeg().toBuffer();
    const view = { mime: 'image/jpeg', base64: big.toString('base64'), width: 3000, height: 2000, label: null };
    const work = await workingCopy(view, 1500);
    expect([work.img.width, work.img.height]).toEqual([1500, 1000]);
    const [r] = scaleRegions([{ id: 'r1', label: 'Nose', kind: 'mask', source: 'sam', view: 0, box: { x: 100, y: 50, w: 20, h: 10 }, path: 'M100 50L120 50L120 60Z', anchor: { x: 110, y: 55 }, area: 0.001, confidence: 0.9 }], work.kx, work.ky);
    expect(r!.box).toEqual({ x: 200, y: 100, w: 40, h: 20 });
    expect(r!.anchor).toEqual({ x: 220, y: 110 });
    expect(r!.path).toBe('M200 100L240 100L240 120Z');
  });

  it('puts each dot on its own part: the nose dot on the nose, the face dot off it', () => {
    const rect = (x: number, y: number, w: number, h: number) => ({ objectId: '1', bounds: { left: x, top: y, right: x + w, bottom: y + h }, mask: encodeSegmentationMask(new Uint8Array(w * h).fill(1), w, h) }) as never;
    // A face 100 x 100, with a nose 20 x 20 in its middle.
    const [face, nose] = anchorsOnParts([rect(0, 0, 100, 100), rect(40, 40, 20, 20)], { width: 200, height: 200 }, null);
    expect(nose!.x).toBeGreaterThanOrEqual(40);
    expect(nose!.x).toBeLessThanOrEqual(60);
    expect(nose!.y).toBeGreaterThanOrEqual(40);
    expect(nose!.y).toBeLessThanOrEqual(60);
    const onNose = face!.x >= 40 && face!.x <= 60 && face!.y >= 40 && face!.y <= 60;
    expect(onNose).toBe(false);
    expect(face!.x).toBeLessThanOrEqual(100);
  });

  it('keeps colour and size words that are part of a real name', () => {
    expect(cleanPartName('Small intestine', 'Holstein cow')).toBe('Small intestine');
    expect(cleanPartName('Large intestine', 'Holstein cow')).toBe('Large intestine');
    expect(cleanPartName('White matter', 'Human brain model')).toBe('White matter');
  });
});

describe('a preferred word for the same part', () => {
  it('is a word, not a mix-up: "Hood" and "Bonnet" are the same part, "Tail light" and "Wing mirror" are not', () => {
    expect(sameThing('Hood', 'Bonnet')).toBe(true);
    expect(sameThing('Tail light', 'Wing mirror')).toBe(false);
  });
});

import { edgeMargin, shareOn } from '../../server/meta/label';
describe('outlines stay on the object', () => {
  const rect = (x: number, y: number, w: number, h: number) => ({ objectId: '1', bounds: { left: x, top: y, right: x + w, bottom: y + h }, mask: encodeSegmentationMask(new Uint8Array(w * h).fill(1), w, h) }) as never;
  // The object: a 100 x 100 square at (50, 50) in a 200 x 200 photo.
  const view = { width: 200, height: 200 };
  const core = new Uint8Array(200 * 200);
  for (let y = 50; y < 150; y++) for (let x = 50; x < 150; x++) core[y * 200 + x] = 1;

  it('measures how much of a region lies on the object', () => {
    expect(shareOn(rect(60, 60, 20, 20), view, core)).toBe(1); // a part inside it
    expect(shareOn(rect(140, 60, 40, 20), view, core)).toBeCloseTo(0.25); // mostly background
    expect(shareOn(rect(0, 0, 40, 40), view, core)).toBe(0); // all background
  });

  it('lets a part reach only a few pixels past the object, not onto the background around it', () => {
    expect(edgeMargin({ width: 1536, height: 1152 })).toBeLessThanOrEqual(8);
    expect(edgeMargin({ width: 300, height: 200 })).toBe(3);
  });
});

import { settleName } from '../../server/meta/label';
describe('settling a region name from two independent looks', () => {
  const isPart = (n: string) => !/^background$/i.test(n);
  const look = (name: string | null, fits: 'well' | 'partly' | 'badly' = 'well', sure = true) => ({ looks: 'x', name, fits, sure });
  it('confirms a name both looks give', () => {
    expect(settleName('Left headlight', look('Headlight'), 'Car', isPart)).toMatchObject({ name: 'Left headlight', confirmed: true });
  });
  it('drops a region the close look sees no part in, or whose outline fits badly', () => {
    expect(settleName('Headlight', look(null), 'Car', isPart)).toBeNull();
    expect(settleName('Headlight', look('Headlight', 'badly'), 'Car', isPart)).toBeNull();
  });
  it('asks a third look when the two disagree', () => {
    expect(settleName('Headlight', look('Side window'), 'Car', isPart)).toMatchObject({ ask: ['Headlight', 'Side window'] });
  });
  it('keeps the close name alone only when it is sure, and the first name when the close look failed', () => {
    expect(settleName('', look('Badge'), 'Car', isPart)).toMatchObject({ name: 'Badge', confirmed: false });
    expect(settleName('', look('Badge', 'well', false), 'Car', isPart)).toBeNull();
    expect(settleName('Bonnet', null, 'Car', isPart)).toMatchObject({ name: 'Bonnet', confirmed: false });
  });
});
