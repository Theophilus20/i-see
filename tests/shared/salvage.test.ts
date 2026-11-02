import { describe, expect, it } from 'vitest';
import { InsideDraftSchema, toStrictJsonSchema } from '../../src/shared/model-io';
import { salvage } from '../../src/shared/salvage';
import { positionalNames, tidyRegions } from '../../server/meta/sam';
import { segmentConcepts, cleanConcept } from '../../src/shared/orchestrator';

const claim = { basis: 'inferred', confidence: 0.5, regionIds: [], sourceIds: [], quote: null };
const part = { name: 'Driver', what: 'Makes sound.', how: 'A coil moves a cone.', regionId: null, visibleInPhoto: false, ...claim };

describe('salvage', () => {
  const js = toStrictJsonSchema(InsideDraftSchema);
  it('maps renamed keys back and fills missing nullables', () => {
    const raw = {
      kind: 'Machine',
      intro: 'x',
      groups: [{ name: 'Sound', role: 'r', parts: [{ ...part, quote: undefined }] }],
      flows: [{ name: 'From signal to sound', summary: 's', steps: [{ title: 'Signal', description: 'Arrives.' }, { label: 'Move', detail: 'Cone moves.' }], ...claim }],
      illustrationBrief: 'b',
    };
    expect(InsideDraftSchema.safeParse(raw).success).toBe(false);
    const r = salvage(InsideDraftSchema, js, raw);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.kind).toBe('machine');
      expect(r.value.flows[0]!.title).toBe('From signal to sound');
      expect(r.value.flows[0]!.steps[0]).toEqual({ label: 'Signal', detail: 'Arrives.' });
      expect(r.value.groups[0]!.parts[0]!.quote).toBeNull();
    }
  });
  it('drops a list item that cannot be repaired instead of inventing it', () => {
    const raw = { kind: 'machine', intro: 'x', groups: [{ name: 'g', role: 'r', parts: [part, { what: 'no name' }] }], flows: [{ summary: 'no title', steps: [], ...claim }], illustrationBrief: 'b' };
    const r = salvage(InsideDraftSchema, js, raw);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.groups[0]!.parts.length).toBe(1);
      expect(r.value.flows.length).toBe(0);
    }
  });
  it('gives up when the top level is missing', () => {
    expect(salvage(InsideDraftSchema, js, { groups: [] }).ok).toBe(false);
  });
});

describe('outline naming', () => {
  it('names paired instances by where they are in the photo', () => {
    expect(positionalNames('earcup', [{ x: 700, y: 300 }, { x: 200, y: 320 }])).toEqual(['right earcup', 'left earcup']);
    expect(positionalNames('drawer', [{ x: 100, y: 500 }, { x: 110, y: 100 }])).toEqual(['lower drawer', 'upper drawer']);
    expect(positionalNames('screw', [{ x: 1, y: 1 }])).toEqual(['screw']);
  });
  it('merges left/right phrases, drops the background and commands', () => {
    expect(segmentConcepts(['black over-ear headphones', 'left earcup', 'right earcup', 'headband', 'yellow background surface', 'segment the handle'])).toEqual(['black over-ear headphones', 'earcup', 'headband', 'handle']);
    expect(cleanConcept('Outline the safety valve')).toBe('safety valve');
  });
  it('drops duplicates and frame-filling background outlines', () => {
    const base = { kind: 'mask' as const, source: 'sam' as const, view: 0, path: 'M0 0Z', anchor: { x: 1, y: 1 }, confidence: null };
    const kept = tidyRegions(
      [
        { ...base, concept: 0, label: 'headphones', box: { x: 100, y: 50, w: 600, h: 500 }, area: 0.3 },
        { ...base, concept: 1, label: 'cushion', box: { x: 102, y: 52, w: 598, h: 498 }, area: 0.29 },
        { ...base, concept: 2, label: 'mat', box: { x: 0, y: 0, w: 800, h: 600 }, area: 0.7 },
        { ...base, concept: 3, label: 'earcup', box: { x: 120, y: 300, w: 150, h: 200 }, area: 0.05 },
      ],
      { width: 800, height: 600 },
    );
    expect(kept.map((k) => k.label)).toEqual(['headphones', 'earcup']);
  });
});

import { IdentifyOutputSchema, ProfileCoreDraftSchema, ProfileExtrasDraftSchema, ResolveOutputSchema, AskOutputSchema, CompareOutputSchema, GlanceOutputSchema } from '../../src/shared/model-io';
import { z } from 'zod';

/** Every field the model must fill has to be in the JSON schema it is shown. */
function fieldPaths(schema: z.ZodType, at = ''): string[] {
  const def = (schema as unknown as { _zod: { def: { type: string; shape?: Record<string, z.ZodType>; element?: z.ZodType; innerType?: z.ZodType } } })._zod.def;
  if (def.type === 'object') return Object.entries(def.shape!).flatMap(([k, v]) => [`${at}${k}`, ...fieldPaths(v, `${at}${k}.`)]);
  if (def.type === 'array') return fieldPaths(def.element!, at);
  if (def.innerType) return fieldPaths(def.innerType, at);
  return [];
}
function jsonPaths(js: Record<string, unknown>, at = ''): string[] {
  const alts = (js.anyOf ?? js.oneOf) as Array<Record<string, unknown>> | undefined;
  if (alts) return alts.flatMap((a) => jsonPaths(a, at));
  if (js.properties) return Object.entries(js.properties as Record<string, Record<string, unknown>>).flatMap(([k, v]) => [`${at}${k}`, ...jsonPaths(v, `${at}${k}.`)]);
  if (js.items) return jsonPaths(js.items as Record<string, unknown>, at);
  return [];
}
describe('the JSON schema shown to the model keeps every field', () => {
  for (const [name, schema] of Object.entries({ IdentifyOutputSchema, ProfileCoreDraftSchema, ProfileExtrasDraftSchema, ResolveOutputSchema, AskOutputSchema, CompareOutputSchema, GlanceOutputSchema, InsideDraftSchema })) {
    it(name, () => {
      const shown = new Set(jsonPaths(toStrictJsonSchema(schema)));
      expect(fieldPaths(schema).filter((p) => !shown.has(p))).toEqual([]);
    });
  }
});
