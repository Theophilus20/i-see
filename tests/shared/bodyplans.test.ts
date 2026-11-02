import { describe, expect, it } from 'vitest';
import { BODY_PLANS, OBJECT_PLANS, bodyPlanFor, planReference } from '../../src/shared/bodyplans';

describe('body plans', () => {
  it('finds the right plan for a named living thing', () => {
    expect(bodyPlanFor('Holstein Friesian cow', 'animal')?.id).toBe('ruminant');
    expect(bodyPlanFor('Domestic fancy rat', 'animal')?.id).toBe('rodent');
    expect(bodyPlanFor('Tabby cat', 'animal')?.id).toBe('carnivoran');
    expect(bodyPlanFor('Bald eagle', 'animal')?.id).toBe('bird');
    expect(bodyPlanFor('Nile tilapia', 'animal')?.id).toBe('fish');
    expect(bodyPlanFor('Great white shark', 'animal')?.id).toBe('shark');
    expect(bodyPlanFor('Seahorse', 'animal')?.id).toBe('fish');
    expect(bodyPlanFor('Monarch butterfly', 'animal')?.id).toBe('insect');
    expect(bodyPlanFor('Garden spider', 'animal')?.id).toBe('arachnid');
    expect(bodyPlanFor('Fancy-leaved caladium', 'plant')?.id).toBe('plant');
    expect(bodyPlanFor('Unknown houseplant', 'plant')?.id).toBe('plant');
    expect(bodyPlanFor('Fly agaric', 'fungus')?.id).toBe('fungus');
    expect(bodyPlanFor('Something odd', 'animal')).toBeNull();
  });

  it('finds the inner parts of common machines and objects', () => {
    expect(bodyPlanFor('Toyota Corolla car', 'vehicle')?.id).toBe('car');
    expect(bodyPlanFor('Blue tote bag', 'consumer_product')?.id).toBe('bag');
    expect(bodyPlanFor('Over-ear headphones', 'electronics')?.id).toBe('headphones');
    expect(bodyPlanFor('Stovetop moka pot', 'consumer_product')).toBeNull();
  });

  it('uses the correct terms and the facts that are easy to get wrong', () => {
    const cow = bodyPlanFor('cow', 'animal')!;
    expect(cow.internal).toEqual(expect.arrayContaining(['Rumen', 'Reticulum', 'Omasum', 'Abomasum']));
    expect(cow.facts).toMatch(/no upper front teeth/);
    // What the inside drawing labels is all inside: no udder, teat, torso or the animal's own name.
    expect(cow.label.join(' ')).not.toMatch(/Udder|Teat|Torso|Cow/);
    const ref = planReference(cow);
    expect(ref).toMatch(/Skeleton: Skull, Mandible/);
    expect(ref).toMatch(/four chambers/);
  });

  it('every plan is complete and its labels are its own inner parts', () => {
    for (const p of [...BODY_PLANS, ...OBJECT_PLANS]) {
      expect(p.external.length, p.id).toBeGreaterThan(3);
      expect(p.internal.length, p.id).toBeGreaterThan(3);
      expect(p.label.length, p.id).toBeGreaterThan(4);
      expect(p.label.length, p.id).toBeLessThanOrEqual(15);
      expect(p.facts.length, p.id).toBeGreaterThan(40);
    }
  });
});

describe('plans for objects called by a make or model', () => {
  it('finds a car from its kind, its summary or its category, and an electric car has no engine', async () => {
    const { planForObject, labelsFor, planKeyword, referenceQueries } = await import('../../src/shared/bodyplans');
    const byd = { displayName: 'BYD Atto 3', category: 'vehicle', subcategory: 'compact SUV', summary: 'The BYD Atto 3 is a compact all-electric SUV.' };
    const plan = planForObject(byd)!;
    expect(plan.id).toBe('car');
    expect(planForObject({ displayName: 'Toyota Corolla', category: 'vehicle' })!.id).toBe('car');
    expect(planForObject({ displayName: 'Bialetti Moka Express', category: 'consumer_product', candidates: [{ name: 'Moka pot', likelihood: 0.6 }, { name: 'Kettle', likelihood: 0.3 }] })).toBeNull();
    expect(labelsFor(plan, `${byd.displayName} ${byd.subcategory} ${byd.summary}`)).toEqual(expect.arrayContaining(['Battery pack', 'Electric motor', 'Inverter']));
    expect(labelsFor(plan, `${byd.displayName} ${byd.subcategory} ${byd.summary}`)).not.toContain('Fuel tank');
    expect(labelsFor(plan, 'Toyota Corolla saloon with electric windows')).toContain('Engine');
    expect(planKeyword('BYD Atto 3', plan)).toBe('car');
    expect(referenceQueries('BYD Atto 3', plan)[0]).toBe('car cutaway');
  });
});

describe('the whole object on the photo', () => {
  it('is found by its name or by holding the other parts, never a part like "Car door"', async () => {
    const { wholeObjectIds } = await import('../../src/shared/whole');
    const r = (id: string, label: string, area: number, x = 0, y = 0, w = 10, h = 10) => ({ id, label, area, box: { x, y, w, h }, anchor: { x: x + w / 2, y: y + h / 2 } });
    const car = { displayName: 'BYD Atto 3', category: 'vehicle', subcategory: 'compact SUV' };
    // By its kind's name (and its size).
    expect(wholeObjectIds([r('r1', 'Compact SUV', 0.35), r('r2', 'Car door', 0.03, 50), r('r3', 'Bonnet', 0.04, 80)], car)).toEqual(['r1']);
    // By its shape: large, with the other parts inside it.
    expect(wholeObjectIds([r('r1', 'Blue vehicle body', 0.5, 0, 0, 100, 100), r('r2', 'Car door', 0.03, 20, 20), r('r3', 'Bonnet', 0.04, 60, 30), r('r4', 'Wheel', 0.02, 30, 70)], car)).toEqual(['r1']);
    // Nothing that is only a part.
    expect(wholeObjectIds([r('r2', 'Car door', 0.03, 50), r('r3', 'Bonnet', 0.04, 80)], car)).toEqual([]);
    // A candidate's kind ("Coffee pot" for a moka pot).
    expect(wholeObjectIds([r('r1', 'Coffee pot', 0.3), r('r2', 'Lid', 0.01, 30)], { displayName: 'Moka pot', category: 'consumer_product' })).toEqual(['r1']);
  });
});

describe('the whole object, marked or guessed', () => {
  it('uses the mark when there is one, and never takes a part named like a guess', async () => {
    const { wholeObjectIds } = await import('../../src/shared/whole');
    const r = (id: string, label: string, area: number, whole?: boolean) => ({ id, label, area, whole, box: { x: 0, y: 0, w: 10, h: 10 }, anchor: { x: 5, y: 5 } });
    expect(wholeObjectIds([r('r1', 'Volkswagen ID.4', 0.4, true), r('r2', 'SUV', 0.5)], { displayName: 'Volkswagen ID.4', category: 'vehicle' })).toEqual(['r1']);
    const adapter = { displayName: 'Brass pipe adapter, 1/2"', category: 'component', candidates: [{ name: 'Brass adapter, 1/2-inch NPT male thread to solder cup', likelihood: 0.45 }] };
    expect(wholeObjectIds([r('r1', 'Hex body', 0.1), r('r3', 'Solder cup', 0.12)], adapter)).toEqual([]);
    expect(wholeObjectIds([r('r1', 'Hex body', 0.1), r('r3', 'Solder cup', 0.12)], { ...adapter, displayName: adapter.candidates[0]!.name })).toEqual([]);
  });
});

describe('the kind of object, for what a person teaches', () => {
  it('is the body plan, or else the last word of the name', async () => {
    const { kindKey } = await import('../../src/shared/bodyplans');
    expect(kindKey({ displayName: 'Volkswagen ID.4', category: 'vehicle', subcategory: 'compact SUV' })).toBe('car');
    expect(kindKey({ displayName: 'Holstein Friesian cow', category: 'animal' })).toBe('ruminant');
    expect(kindKey({ displayName: 'Bialetti Moka pot', category: 'consumer_product' })).toBe('pot');
  });
});
