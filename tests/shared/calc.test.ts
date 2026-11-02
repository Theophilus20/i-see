import { describe, expect, it } from 'vitest';
import { checkWhatIf, describeDims, formatNumber, parseUnit, runWhatIf, sanitizeWhatIf, sensitivity, sweepWhatIf } from '../../src/shared/calc';
import type { WhatIf } from '../../src/shared/schema';
import { heatingWhatIf } from '../helpers';

/** A one-step what-if with plain numbers, for testing the evaluator alone. */
function plain(expr: string, extra: Partial<WhatIf['assumptions'][number]>[] = []): WhatIf {
  const base = { label: 'x', unit: '', min: -1e6, max: 1e6, step: 1, origin: 'assumed' as const, note: null };
  return heatingWhatIf({
    assumptions: [
      { key: 'a', value: 3, ...base },
      { key: 'b', value: 4, ...base },
      ...extra.map((e, i) => ({ key: `z${i}`, value: 1, ...base, ...e })),
    ],
    steps: [{ key: 'out', label: 'out', expr, unit: '' }],
    resultKey: 'out',
    sweepKey: 'a',
  });
}
const value = (expr: string): number => {
  const r = runWhatIf(plain(expr));
  if (!r.ok) throw new Error(r.issues[0]!.message);
  return r.result!.value;
};
const issue = (expr: string) => {
  const r = runWhatIf(plain(expr));
  return r.ok ? null : r.issues[0]!;
};

describe('arithmetic', () => {
  it('respects precedence and associativity', () => {
    expect(value('1 + 2 * 3')).toBe(7);
    expect(value('(1 + 2) * 3')).toBe(9);
    expect(value('2 ^ 3 ^ 2')).toBe(512); // right-associative
    expect(value('-2 ^ 2')).toBe(-4); // unary minus binds looser than ^
    expect(value('2 ^ -1')).toBe(0.5);
    expect(value('10 - 4 - 3')).toBe(3); // left-associative
    expect(value('8 / 4 / 2')).toBe(1);
  });

  it('uses assumption keys and the allowed functions', () => {
    expect(value('sqrt(a*a + b*b)')).toBe(5);
    expect(value('max(a, b) - min(a, b)')).toBe(1);
    expect(value('round(10 / 3, 2)')).toBe(3.33);
    expect(value('abs(a - b)')).toBe(1);
    expect(value('pow(a, 2)')).toBe(9);
    expect(value('log10(1000)')).toBeCloseTo(3, 12);
    expect(value('exp(0)')).toBe(1);
    expect(value('2 * pi')).toBeCloseTo(6.283185307, 8);
  });

  it('accepts the symbols a model tends to write', () => {
    expect(value('3 × 4')).toBe(12);
    expect(value('3 ** 2')).toBe(9);
    expect(value('10 − 4')).toBe(6);
    expect(value('9 ÷ 3')).toBe(3);
    expect(value('1.5e2 + .5')).toBe(150.5);
  });
});

describe('the evaluator refuses everything that is not arithmetic', () => {
  const hostile: Array<[string, string]> = [
    ['constructor', 'name'],
    ['__proto__', 'name'],
    ['a.constructor', 'syntax'],
    ['a["constructor"]', 'syntax'],
    ['a[0]', 'syntax'],
    ["process.exit(1)", 'syntax'],
    ["Function('return 1')()", 'syntax'],
    ["eval('1')", 'syntax'],
    ["import('fs')", 'syntax'],
    ['require("fs")', 'syntax'],
    ['Function(1)(2)', 'function'],
    ['eval(1)', 'function'],
    ['import(1)', 'function'],
    ['require(1)', 'function'],
    ['globalThis', 'name'],
    ['this', 'name'],
    ['a = 1', 'syntax'],
    ['a; b', 'syntax'],
    ['`1`', 'syntax'],
    ['"1"', 'syntax'],
    ['(1, 2)', 'syntax'],
    ['a ? b : 1', 'syntax'],
    ['a == b', 'syntax'],
    ['a => a', 'syntax'],
    ['{}', 'syntax'],
    ['[1, 2]', 'syntax'],
    ['', 'syntax'],
    ['1 +', 'syntax'],
    ['* 2', 'syntax'],
    ['2 3', 'syntax'],
    ['a b', 'syntax'],
    ['sqrt', 'name'],
    ['sqrt()', 'syntax'],
    ['max()', 'syntax'],
    ['unknown(1)', 'function'],
    ['zzz + 1', 'name'],
  ];
  for (const [expr, code] of hostile) {
    it(`rejects ${JSON.stringify(expr)}`, () => {
      const i = issue(expr);
      expect(i, `expected ${expr} to be refused`).not.toBeNull();
      expect(i!.code).toBe(code);
    });
  }

  it('does not let model text reach the prototype chain through a key', () => {
    const w = plain('a');
    w.assumptions[0]!.key = 'toString';
    w.steps[0]!.expr = 'toString + 1';
    w.sweepKey = 'toString';
    const r = runWhatIf(w);
    expect(r.ok).toBe(true); // a declared key named toString is just a number
    expect(r.ok && r.result!.value).toBe(4);
    const w2 = plain('hasOwnProperty');
    expect(runWhatIf(w2).ok).toBe(false);
  });

  it('caps size and nesting', () => {
    expect(issue('('.repeat(60) + '1' + ')'.repeat(60))?.code).toBe('complex');
    expect(issue('1' + ' + 1'.repeat(200))?.code).toBe('complex');
    expect(issue('1' + ' '.repeat(300) + '+ 1')?.code).toBe('complex');
  });
});

describe('non-finite results are errors, not numbers', () => {
  it.each(['1 / 0', '10 ^ 400', 'log(0)', 'sqrt(-1)', '0 ^ -1', '(0 - 8) ^ 0.5', 'exp(1000)'])('%s', (expr) => {
    expect(issue(expr)?.code).toBe('nonfinite');
  });
});

describe('units', () => {
  it('parses compound units into dimensions', () => {
    expect(parseUnit('J/(kg*K)')).toEqual([2, 0, -2, -1, 0, 0].map((x, i) => (i === 1 ? 0 : x)));
    expect(parseUnit('W/m^2')).toEqual([0, 1, -3, 0, 0, 0]);
    expect(parseUnit('kg/m^3')).toEqual([-3, 1, 0, 0, 0, 0]);
    expect(parseUnit('m2')).toEqual([2, 0, 0, 0, 0, 0]);
    expect(parseUnit('m/s²')).toEqual([1, 0, -2, 0, 0, 0]);
    expect(parseUnit('kg m^-3')).toEqual([-3, 1, 0, 0, 0, 0]);
    expect(parseUnit('W/(m*K)')).toEqual([1, 1, -3, -1, 0, 0]);
    expect(parseUnit('J/kg/K')).toEqual(parseUnit('J/(kg*K)'));
    expect(parseUnit('')).toEqual([0, 0, 0, 0, 0, 0]);
    expect(parseUnit('°C')).toEqual(parseUnit('K'));
    expect(parseUnit('%')).toEqual(parseUnit(''));
  });

  it('rejects unknown or malformed units', () => {
    for (const u of ['furlong', 'kg*', '(kg', 'kg)', 'kg^', 'kg^x', 'm@s', 'a'.repeat(60), '2']) {
      expect(parseUnit(u), u).toBeNull();
    }
  });

  it('names dimensions in plain words', () => {
    expect(describeDims(parseUnit('J'))).toBe('energy (J)');
    expect(describeDims(parseUnit('W'))).toBe('power (W)');
    expect(describeDims(parseUnit('kg*m^2'))).toBe('kg·m²');
    expect(describeDims(null)).toBe('a plain number');
  });
});

describe('dimensional checking', () => {
  it('accepts a correct calculation and computes it', () => {
    const r = runWhatIf(heatingWhatIf());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const q = 0.3 * 4186 * 75;
    expect(r.steps[0]!.value).toBeCloseTo(q, 6);
    expect(r.result!.value).toBeCloseTo(q / (1500 * 0.4) / 60, 9);
    expect(r.result!.unit).toBe('min');
  });

  it('rejects a step whose units do not match what it declared', () => {
    const w = heatingWhatIf({ steps: [{ key: 'Q', label: 'Heat', expr: 'm * c * dT', unit: 's' }, { key: 't', label: 't', expr: 'Q', unit: 's' }] });
    const r = runWhatIf(w);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.issues[0]!.code).toBe('dimension');
    expect(r.issues[0]!.where).toBe('Q');
    expect(r.issues[0]!.message).toMatch(/energy/);
  });

  it('rejects adding quantities of different kinds', () => {
    const w = heatingWhatIf({ steps: [{ key: 't', label: 't', expr: 'm + P', unit: 'kg' }], resultKey: 't' });
    const r = runWhatIf(w);
    expect(!r.ok && r.issues[0]!.code).toBe('dimension');
  });

  it('allows a literal zero in any dimension (max(0, x))', () => {
    const w = heatingWhatIf({
      assumptions: [
        ...heatingWhatIf().assumptions,
        { key: 'dT0', label: 'Starting temperature', value: 20, unit: 'K', min: 0, max: 40, step: 1, origin: 'assumed', note: null },
      ],
      steps: [{ key: 'dT2', label: 'rise', expr: 'max(0, dT - dT0)', unit: 'K' }],
      resultKey: 'dT2',
    });
    expect(runWhatIf(w).ok).toBe(true);
  });

  it('refuses a bare number added to a quantity with units: declare it as an assumption instead', () => {
    const w = heatingWhatIf({ steps: [{ key: 'dT2', label: 'rise', expr: 'dT - 20', unit: 'K' }], resultKey: 'dT2' });
    const r = runWhatIf(w);
    expect(!r.ok && r.issues[0]!.code).toBe('dimension');
    expect(!r.ok && r.issues[0]!.message).toMatch(/plain number/);
  });

  it('halves dimensions under sqrt and multiplies them under a constant power', () => {
    const w = heatingWhatIf({
      assumptions: [{ key: 'A', label: 'Area', value: 4, unit: 'm^2', min: 1, max: 9, step: 1, origin: 'assumed', note: null }],
      steps: [
        { key: 'side', label: 'Side', expr: 'sqrt(A)', unit: 'm' },
        { key: 'vol', label: 'Cube volume', expr: 'side ^ 3', unit: 'm^3' },
      ],
      resultKey: 'vol',
      sweepKey: 'A',
    });
    const r = runWhatIf(w);
    expect(r.ok && r.result!.value).toBeCloseTo(8, 12);
  });

  it('refuses a variable exponent on a quantity with units', () => {
    const w = heatingWhatIf({ steps: [{ key: 't', label: 't', expr: 'm ^ eta', unit: 'kg' }], resultKey: 't' });
    expect(!runWhatIf(w).ok).toBe(true);
  });

  it('refuses transcendental functions of a quantity with units', () => {
    const w = heatingWhatIf({ steps: [{ key: 't', label: 't', expr: 'exp(dT)', unit: '' }], resultKey: 't' });
    const r = runWhatIf(w);
    expect(!r.ok && r.issues[0]!.code).toBe('dimension');
  });

  it('refuses unknown keys, unknown units and forward references', () => {
    expect(runWhatIf(heatingWhatIf({ steps: [{ key: 't', label: 't', expr: 'Q', unit: 's' }], resultKey: 't' })).ok).toBe(false);
    const badUnit = heatingWhatIf();
    badUnit.assumptions[0]!.unit = 'furlong';
    expect(runWhatIf(badUnit).ok).toBe(false);
  });

  it('refuses duplicate keys, empty ranges, out-of-range starts and dangling keys', () => {
    const dup = heatingWhatIf();
    dup.steps[0]!.key = 'm';
    expect(runWhatIf(dup).ok).toBe(false);
    const empty = heatingWhatIf();
    empty.assumptions[0]!.max = empty.assumptions[0]!.min;
    expect(runWhatIf(empty).ok).toBe(false);
    const out = heatingWhatIf();
    out.assumptions[0]!.value = 99;
    expect(runWhatIf(out).ok).toBe(false);
    expect(runWhatIf(heatingWhatIf({ resultKey: 'nope' })).ok).toBe(false);
    expect(runWhatIf(heatingWhatIf({ sweepKey: 'nope' })).ok).toBe(false);
  });
});

describe('overrides, sweeps and sensitivity', () => {
  it('clamps slider values into the stated range', () => {
    const r = runWhatIf(heatingWhatIf(), { P: 1e9 });
    expect(r.ok && r.assumptions.P).toBe(3000);
    const r2 = runWhatIf(heatingWhatIf(), { P: Number.NaN });
    expect(r2.ok && r2.assumptions.P).toBe(1500);
  });

  it('sweeps one assumption across its range', () => {
    const s = sweepWhatIf(heatingWhatIf());
    expect(s).not.toBeNull();
    expect(s!.x[0]).toBe(500);
    expect(s!.x.at(-1)).toBe(3000);
    expect(s!.y[0]!).toBeGreaterThan(s!.y.at(-1)!); // more power, less time
    expect(s!.resultUnit).toBe('min');
  });

  it('ranks assumptions by how much they move the answer', () => {
    const s = sensitivity(heatingWhatIf());
    expect(s.length).toBe(5);
    expect(s[0]!.swing).toBeGreaterThanOrEqual(s[1]!.swing);
    // c barely changes (4000 to 4300), so it must rank last.
    expect(s.at(-1)!.key).toBe('c');
  });

  it('returns null for a sweep with nothing to sweep', () => {
    expect(sweepWhatIf(heatingWhatIf({ sweepKey: null }))).toBeNull();
    expect(sweepWhatIf(heatingWhatIf({ resultKey: null }))).toBeNull();
  });
});

describe('sanitizeWhatIf (the honesty rules)', () => {
  it('keeps a calculation that checks out', () => {
    const out = sanitizeWhatIf(heatingWhatIf());
    expect(out.kind).toBe('calculation');
    expect(out.steps.length).toBe(2);
  });

  it('turns a failing calculation into a hypothesis with no numbers, and says why', () => {
    const bad = heatingWhatIf({ steps: [{ key: 'Q', label: 'Heat', expr: 'm * c * dT', unit: 's' }, { key: 't', label: 't', expr: 'Q', unit: 's' }] });
    const out = sanitizeWhatIf(bad);
    expect(out.kind).toBe('hypothesis');
    expect(out.steps).toEqual([]);
    expect(out.assumptions).toEqual([]);
    expect(out.resultKey).toBeNull();
    expect(out.caveats[0]).toMatch(/did not check out/);
  });

  it('relabels a "simulation" as the calculation it is', () => {
    const out = sanitizeWhatIf(heatingWhatIf({ kind: 'simulation' }));
    expect(out.kind).toBe('calculation');
    expect(out.caveats[0]).toMatch(/No simulation was run/);
  });

  it('strips numbers from a hypothesis or unknown', () => {
    const out = sanitizeWhatIf(heatingWhatIf({ kind: 'hypothesis' }));
    expect(out.steps).toEqual([]);
    expect(out.assumptions).toEqual([]);
    expect(sanitizeWhatIf(heatingWhatIf({ kind: 'unknown' })).kind).toBe('unknown');
  });

  it('removes a "calculation" that has no steps to check', () => {
    const out = sanitizeWhatIf(heatingWhatIf({ steps: [], resultKey: null }));
    expect(out.kind).toBe('hypothesis');
  });

  it('checkWhatIf reports issues without throwing', () => {
    expect(checkWhatIf(heatingWhatIf())).toEqual([]);
    expect(checkWhatIf(plain('constructor')).length).toBe(1);
  });
});

describe('formatNumber', () => {
  it('uses three significant figures and scientific notation at the extremes', () => {
    expect(formatNumber(12.3456)).toBe('12.3');
    expect(formatNumber(0.0123456)).toBe('0.0123');
    expect(formatNumber(1234567)).toBe('1.23 × 10⁶');
    expect(formatNumber(0.0001234)).toBe('1.23 × 10⁻⁴');
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(Number.NaN)).toBe('—');
    expect(formatNumber(1500)).toBe('1,500');
  });
});

describe('quantities as people read them', () => {
  it('chooses the SI prefix that keeps the number short', async () => {
    const { formatQuantity } = await import('../../src/shared/calc');
    expect(formatQuantity(810185, 'J')).toEqual({ num: '810', unit: 'kJ' });
    expect(formatQuantity(1.37e6, 'J')).toEqual({ num: '1.37', unit: 'MJ' });
    expect(formatQuantity(72900, 'J')).toEqual({ num: '72.9', unit: 'kJ' });
    expect(formatQuantity(2500, 'kWh')).toEqual({ num: '2.5', unit: 'MWh' });
    expect(formatQuantity(0.25, 'W')).toEqual({ num: '250', unit: 'mW' });
    expect(formatQuantity(2100, 'kg')).toEqual({ num: '2,100', unit: 'kg' });
    expect(formatQuantity(100, 'km/h')).toEqual({ num: '100', unit: 'km/h' });
  });
});
