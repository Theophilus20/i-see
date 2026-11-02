/**
 * The What-if calculator.
 *
 * A model proposes a calculation: assumptions with units and ranges, then steps whose
 * expressions combine them. Nothing about that is trusted. This module is a small
 * hand-written parser and evaluator, not an interpreter: there is no eval, no
 * property access, no strings, no assignment, no user-defined functions. The only
 * things an expression can contain are numbers, the keys the model declared, the
 * operators + - * / ^, parentheses, and a short allowlist of maths functions.
 *
 * On top of the arithmetic it does dimensional analysis. Every quantity carries its
 * physical dimensions (length, mass, time, temperature, current, amount), and every
 * step must come out with the dimensions of the unit the model declared for it.
 * "Seconds" that turn out to be joules are caught here, before anyone sees a number.
 * It checks dimensions, not unit scales: values are plain numbers in the declared units, and the
 * prompt tells the model to convert (mm to m) inside the expression. The expression is
 * shown to the person so they can read the arithmetic.
 *
 * A calculation that does not check out is not shown as a calculation. sanitizeWhatIf
 * turns it into a qualitative hypothesis and says why the numbers were removed.
 */
import type { WhatIf } from './schema';

// ---------------------------------------------------------------------------
// Dimensions and units
// ---------------------------------------------------------------------------

/** Exponents of: length, mass, time, temperature, current, amount. */
export type Dim = readonly [number, number, number, number, number, number];
const BASE_SYMBOLS = ['m', 'kg', 's', 'K', 'A', 'mol'] as const;
/** Reading order for unnamed dimensions: kg·m²·s⁻² rather than m²·kg·s⁻². */
const DISPLAY_ORDER = [1, 0, 2, 3, 4, 5] as const;
const D = (L = 0, M = 0, T = 0, Th = 0, I = 0, N = 0): Dim => [L, M, T, Th, I, N];
const NONE: Dim = D();

const UNIT_DIMS: Record<string, Dim> = {
  // dimensionless
  '1': NONE, '-': NONE, '%': NONE, ratio: NONE, fraction: NONE, rad: NONE, deg: NONE, count: NONE, cycles: NONE, turns: NONE,
  // length, area, volume
  m: D(1), mm: D(1), cm: D(1), km: D(1), um: D(1), 'µm': D(1), in: D(1), ft: D(1),
  L: D(3), l: D(3), mL: D(3), ml: D(3),
  // mass
  kg: D(0, 1), g: D(0, 1), mg: D(0, 1), lb: D(0, 1),
  // time
  s: D(0, 0, 1), ms: D(0, 0, 1), min: D(0, 0, 1), h: D(0, 0, 1), hr: D(0, 0, 1), day: D(0, 0, 1),
  // temperature (degC is treated as an interval or as an absolute value in linear formulas)
  K: D(0, 0, 0, 1), degC: D(0, 0, 0, 1), '°C': D(0, 0, 0, 1),
  // force, pressure, energy, power
  N: D(1, 1, -2), kN: D(1, 1, -2),
  Pa: D(-1, 1, -2), kPa: D(-1, 1, -2), MPa: D(-1, 1, -2), GPa: D(-1, 1, -2), bar: D(-1, 1, -2), mbar: D(-1, 1, -2), atm: D(-1, 1, -2), psi: D(-1, 1, -2),
  J: D(2, 1, -2), kJ: D(2, 1, -2), MJ: D(2, 1, -2), Wh: D(2, 1, -2), kWh: D(2, 1, -2), cal: D(2, 1, -2), kcal: D(2, 1, -2),
  W: D(2, 1, -3), kW: D(2, 1, -3), mW: D(2, 1, -3), MW: D(2, 1, -3),
  Hz: D(0, 0, -1), rpm: D(0, 0, -1),
  // electrical
  A: D(0, 0, 0, 0, 1), mA: D(0, 0, 0, 0, 1),
  V: D(2, 1, -3, 0, -1), mV: D(2, 1, -3, 0, -1),
  ohm: D(2, 1, -3, 0, -2), 'Ω': D(2, 1, -3, 0, -2),
  mol: D(0, 0, 0, 0, 0, 1),
};

const NAMED: Array<[Dim, string]> = [
  [NONE, 'a plain number'],
  [D(1), 'length (m)'], [D(0, 1), 'mass (kg)'], [D(0, 0, 1), 'time (s)'], [D(0, 0, 0, 1), 'temperature (K)'],
  [D(2), 'area (m²)'], [D(3), 'volume (m³)'], [D(1, 0, -1), 'speed (m/s)'], [D(1, 0, -2), 'acceleration (m/s²)'],
  [D(1, 1, -2), 'force (N)'], [D(-1, 1, -2), 'pressure (Pa)'], [D(2, 1, -2), 'energy (J)'], [D(2, 1, -3), 'power (W)'],
  [D(0, 0, -1), 'frequency (1/s)'], [D(-3, 1), 'density (kg/m³)'], [D(2, 0, -2, -1), 'specific heat (J/(kg·K))'],
  [D(1, 1, -3, -1), 'conductivity (W/(m·K))'], [D(0, 1, -3), 'flux (W/m²)'],
];

const sup = (n: number): string => {
  const map: Record<string, string> = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '.': '·' };
  return String(n).replace(/[-0-9.]/g, (c) => map[c] ?? c);
};

export function describeDims(d: Dim | null): string {
  if (!d) return 'a plain number';
  const hit = NAMED.find(([n]) => sameDim(n, d));
  if (hit) return hit[1];
  const parts: string[] = [];
  for (const i of DISPLAY_ORDER) {
    const e = d[i]!;
    if (Math.abs(e) < 1e-9) continue;
    parts.push(Math.abs(e - 1) < 1e-9 ? BASE_SYMBOLS[i]! : `${BASE_SYMBOLS[i]}${sup(Math.round(e * 100) / 100)}`);
  }
  return parts.join('·') || 'a plain number';
}

const EPS = 1e-9;
function sameDim(a: Dim, b: Dim): boolean {
  for (let i = 0; i < 6; i++) if (Math.abs(a[i]! - b[i]!) > EPS) return false;
  return true;
}
const isNone = (d: Dim): boolean => sameDim(d, NONE);
const addDim = (a: Dim, b: Dim, sign = 1): Dim => a.map((x, i) => x + sign * b[i]!) as unknown as Dim;
const mulDim = (a: Dim, k: number): Dim => a.map((x) => x * k) as unknown as Dim;

const SUPERSCRIPTS: Record<string, string> = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-' };

/** Parses "J/(kg*K)", "W/m^2", "kg m^-3", "m2", "m/s²" into dimensions. Returns null for an unknown unit. */
export function parseUnit(unit: string): Dim | null {
  const src = unit
    .trim()
    .replace(/[⁻⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, (m) => '^' + [...m].map((c) => SUPERSCRIPTS[c] ?? '').join(''))
    .replace(/·/g, '*');
  if (src === '') return NONE;
  type T = { k: 'name'; s: string; exp: number } | { k: 'num'; v: number } | { k: 'op'; s: string };
  const re = /\s*(?:([A-Za-zµΩ°%]+)(-?\d+)?|(\d+)|([()*/^-]))/y;
  const toks: T[] = [];
  let pos = 0;
  while (pos < src.length) {
    re.lastIndex = pos;
    const m = re.exec(src);
    if (!m) {
      // Only trailing whitespace may remain.
      if (src.slice(pos).trim() === '') break;
      return null;
    }
    pos = re.lastIndex;
    if (m[1]) toks.push({ k: 'name', s: m[1], exp: m[2] ? Number(m[2]) : 1 });
    else if (m[3]) toks.push({ k: 'num', v: Number(m[3]) });
    else if (m[4]) toks.push({ k: 'op', s: m[4] });
    if (toks.length > 40) return null;
  }

  let i = 0;
  const isOp = (t: T | undefined, s: string): boolean => !!t && t.k === 'op' && t.s === s;

  const atom = (depth: number): Dim | null => {
    if (depth > 8) return null;
    const t = toks[i++];
    if (!t) return null;
    if (t.k === 'num') return t.v === 1 ? NONE : null;
    if (t.k === 'name') {
      const base = UNIT_DIMS[t.s];
      return base ? mulDim(base, t.exp) : null;
    }
    if (t.s === '(') {
      const inner = seq(depth + 1);
      if (!inner || !isOp(toks[i], ')')) return null;
      i++;
      return inner;
    }
    return null;
  };
  const withPow = (depth: number): Dim | null => {
    const a = atom(depth);
    if (!a) return null;
    if (!isOp(toks[i], '^')) return a;
    i++;
    let sign = 1;
    if (isOp(toks[i], '-')) {
      sign = -1;
      i++;
    }
    const n = toks[i++];
    if (!n || n.k !== 'num') return null;
    return mulDim(a, sign * n.v);
  };
  const seq = (depth: number): Dim | null => {
    let acc = withPow(depth);
    if (!acc) return null;
    for (;;) {
      const t = toks[i];
      if (!t || isOp(t, ')')) break;
      if (isOp(t, '*')) {
        i++;
        const r = withPow(depth);
        if (!r) return null;
        acc = addDim(acc, r);
      } else if (isOp(t, '/')) {
        i++;
        const r = withPow(depth);
        if (!r) return null;
        acc = addDim(acc, r, -1);
      } else if (t.k === 'name') {
        const r = withPow(depth); // juxtaposition: "kg m"
        if (!r) return null;
        acc = addDim(acc, r);
      } else return null;
    }
    return acc;
  };
  const out = seq(0);
  return out && i === toks.length ? out : null;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

export type CalcCode = 'syntax' | 'name' | 'function' | 'dimension' | 'unit' | 'range' | 'nonfinite' | 'structure' | 'complex';
export interface CalcIssue {
  code: CalcCode;
  /** The key of the assumption or step the issue belongs to, or "whatIf". */
  where: string;
  message: string;
}
class CalcFail extends Error {
  constructor(readonly code: CalcCode, message: string) {
    super(message);
  }
}

type Node =
  | { t: 'num'; v: number }
  | { t: 'id'; name: string }
  | { t: 'neg'; a: Node }
  | { t: 'bin'; op: '+' | '-' | '*' | '/' | '^'; a: Node; b: Node }
  | { t: 'call'; fn: string; args: Node[] };

const MAX_NODES = 120;
const MAX_DEPTH = 24;
const MAX_ARGS = 6;

const FUNCTIONS = new Set(['sqrt', 'abs', 'min', 'max', 'exp', 'log', 'ln', 'log10', 'sin', 'cos', 'tan', 'atan', 'pow', 'round', 'floor', 'ceil']);
export const ALLOWED_FUNCTIONS: readonly string[] = [...FUNCTIONS];

type Tok = { k: 'num'; v: number } | { k: 'id'; s: string } | { k: 'op'; s: string } | { k: 'end' };

function tokenize(raw: string): Tok[] {
  const src = raw
    .replace(/[×·]/g, '*')
    .replace(/÷/g, '/')
    .replace(/[−–]/g, '-')
    .replace(/\*\*/g, '^');
  if (src.length > 240) throw new CalcFail('complex', 'Expression is longer than 240 characters.');
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i++;
    } else if (/[0-9.]/.test(c)) {
      const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i));
      if (!m) throw new CalcFail('syntax', `Unreadable number near "${src.slice(i, i + 8)}".`);
      const v = Number(m[0]);
      if (!Number.isFinite(v)) throw new CalcFail('nonfinite', 'A number in the expression is too large.');
      out.push({ k: 'num', v });
      i += m[0].length;
    } else if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))!;
      out.push({ k: 'id', s: m[0] });
      i += m[0].length;
    } else if ('+-*/^(),'.includes(c)) {
      out.push({ k: 'op', s: c });
      i++;
    } else {
      throw new CalcFail('syntax', `The character "${c}" is not allowed in an expression.`);
    }
    if (out.length > 400) throw new CalcFail('complex', 'Expression has too many parts.');
  }
  out.push({ k: 'end' });
  return out;
}

const BIN: Record<string, { l: number; r: number }> = {
  '+': { l: 1, r: 2 },
  '-': { l: 1, r: 2 },
  '*': { l: 3, r: 4 },
  '/': { l: 3, r: 4 },
  '^': { l: 7, r: 6 }, // right-associative
};

function parseExpression(src: string): Node {
  const toks = tokenize(src);
  let i = 0;
  let nodes = 0;
  const peek = (): Tok => toks[i]!;
  const bump = () => {
    if (++nodes > MAX_NODES) throw new CalcFail('complex', 'Expression has too many parts.');
  };
  const expectOp = (s: string) => {
    const t = toks[i++]!;
    if (t.k !== 'op' || t.s !== s) throw new CalcFail('syntax', `Expected "${s}".`);
  };
  const expr = (minBp: number, depth: number): Node => {
    if (depth > MAX_DEPTH) throw new CalcFail('complex', 'Expression is nested too deeply.');
    let left = nud(depth);
    for (;;) {
      const t = peek();
      if (t.k !== 'op') break;
      const bp = BIN[t.s];
      if (!bp || bp.l < minBp) break;
      i++;
      const right = expr(bp.r, depth + 1);
      bump();
      left = { t: 'bin', op: t.s as '+' | '-' | '*' | '/' | '^', a: left, b: right };
    }
    return left;
  };
  const nud = (depth: number): Node => {
    const t = toks[i++]!;
    bump();
    if (t.k === 'num') return { t: 'num', v: t.v };
    if (t.k === 'id') {
      const nx = peek();
      if (nx.k === 'op' && nx.s === '(') {
        if (!FUNCTIONS.has(t.s)) throw new CalcFail('function', `"${t.s}" is not an allowed function.`);
        i++;
        const args: Node[] = [];
        if (!(peek().k === 'op' && (peek() as { s: string }).s === ')')) {
          for (;;) {
            args.push(expr(0, depth + 1));
            if (args.length > MAX_ARGS) throw new CalcFail('complex', 'Too many arguments.');
            const sep = peek();
            if (sep.k === 'op' && sep.s === ',') {
              i++;
              continue;
            }
            break;
          }
        }
        expectOp(')');
        return { t: 'call', fn: t.s, args };
      }
      return { t: 'id', name: t.s };
    }
    if (t.k === 'op') {
      if (t.s === '(') {
        const inner = expr(0, depth + 1);
        expectOp(')');
        return inner;
      }
      if (t.s === '-') return { t: 'neg', a: expr(5, depth + 1) };
      if (t.s === '+') return expr(5, depth + 1);
    }
    throw new CalcFail('syntax', 'The expression is incomplete or has an unexpected symbol.');
  };
  const tree = expr(0, 0);
  if (peek().k !== 'end') throw new CalcFail('syntax', 'Unexpected text after the end of the expression.');
  return tree;
}

/** Names an expression refers to, so unknown ones can be reported before evaluating. */
function collectNames(n: Node, into: Set<string>): void {
  if (n.t === 'id') into.add(n.name);
  else if (n.t === 'neg') collectNames(n.a, into);
  else if (n.t === 'bin') {
    collectNames(n.a, into);
    collectNames(n.b, into);
  } else if (n.t === 'call') n.args.forEach((a) => collectNames(a, into));
}

const isConst = (n: Node): boolean =>
  n.t === 'num' || (n.t === 'neg' && isConst(n.a)) || (n.t === 'bin' && isConst(n.a) && isConst(n.b)) || (n.t === 'call' && n.args.every(isConst));

// ---------------------------------------------------------------------------
// Evaluator
// ---------------------------------------------------------------------------

/** `d` is null only for a literal zero, which can stand in for any dimension (as in max(0, x)). */
interface Q {
  v: number;
  d: Dim | null;
}
const dimOf = (q: Q): Dim => q.d ?? NONE;

function unify(a: Q, b: Q, what: string): Dim | null {
  if (a.d === null) return b.d;
  if (b.d === null) return a.d;
  if (!sameDim(a.d, b.d)) {
    throw new CalcFail('dimension', `Cannot ${what} ${describeDims(a.d)} and ${describeDims(b.d)}.`);
  }
  return a.d;
}

function finite(v: number): number {
  if (!Number.isFinite(v)) throw new CalcFail('nonfinite', 'The calculation divides by zero, overflows or is undefined.');
  return v;
}

function power(base: Q, exp: Q, expIsConst: boolean): Q {
  if (exp.d !== null && !isNone(exp.d)) throw new CalcFail('dimension', 'An exponent must be a plain number.');
  const bd = base.d;
  if (bd === null || isNone(bd)) return { v: finite(Math.pow(base.v, exp.v)), d: bd === null ? null : NONE };
  if (!expIsConst) throw new CalcFail('dimension', `A quantity with units (${describeDims(bd)}) can only be raised to a fixed power.`);
  return { v: finite(Math.pow(base.v, exp.v)), d: mulDim(bd, exp.v) };
}

function evalNode(n: Node, env: Map<string, Q>): Q {
  switch (n.t) {
    case 'num':
      return { v: n.v, d: n.v === 0 ? null : NONE };
    case 'id': {
      if (env.has(n.name)) return env.get(n.name)!;
      if (n.name === 'pi') return { v: Math.PI, d: NONE };
      throw new CalcFail('name', `"${n.name}" is not an assumption or an earlier step.`);
    }
    case 'neg': {
      const a = evalNode(n.a, env);
      return { v: -a.v, d: a.d };
    }
    case 'bin': {
      const a = evalNode(n.a, env);
      const b = evalNode(n.b, env);
      switch (n.op) {
        case '+': {
          const d = unify(a, b, 'add');
          return { v: finite(a.v + b.v), d };
        }
        case '-': {
          const d = unify(a, b, 'subtract');
          return { v: finite(a.v - b.v), d };
        }
        case '*':
          return { v: finite(a.v * b.v), d: a.d === null || b.d === null ? (a.v === 0 || b.v === 0 ? null : NONE) : addDim(a.d, b.d) };
        case '/':
          return { v: finite(a.v / b.v), d: a.d === null ? (b.d === null ? NONE : null) : addDim(a.d, dimOf(b), -1) };
        case '^':
          return power(a, b, isConst(n.b));
      }
    }
    // falls through (unreachable)
    case 'call':
      return evalCall(n, env);
  }
}

function evalCall(n: Extract<Node, { t: 'call' }>, env: Map<string, Q>): Q {
  const args = n.args.map((a) => evalNode(a, env));
  const need = (min: number, max = min) => {
    if (args.length < min || args.length > max) {
      throw new CalcFail('syntax', `${n.fn}() takes ${min === max ? min : `${min} to ${max}`} argument${max === 1 ? '' : 's'}.`);
    }
  };
  const plain = (q: Q) => {
    if (q.d !== null && !isNone(q.d)) throw new CalcFail('dimension', `${n.fn}() needs a plain number, not ${describeDims(q.d)}.`);
  };
  switch (n.fn) {
    case 'sqrt': {
      need(1);
      const a = args[0]!;
      if (a.v < 0) throw new CalcFail('nonfinite', 'sqrt() of a negative number.');
      return { v: finite(Math.sqrt(a.v)), d: a.d === null ? null : mulDim(a.d, 0.5) };
    }
    case 'abs':
    case 'floor':
    case 'ceil': {
      need(1);
      const a = args[0]!;
      const f = n.fn === 'abs' ? Math.abs : n.fn === 'floor' ? Math.floor : Math.ceil;
      return { v: f(a.v), d: a.d };
    }
    case 'round': {
      need(1, 2);
      const a = args[0]!;
      let places = 0;
      if (args[1]) {
        plain(args[1]);
        places = Math.round(args[1].v);
        if (places < 0 || places > 6) throw new CalcFail('range', 'round() keeps between 0 and 6 decimal places.');
      }
      const k = 10 ** places;
      return { v: Math.round(a.v * k) / k, d: a.d };
    }
    case 'min':
    case 'max': {
      need(1, MAX_ARGS);
      let acc = args[0]!;
      for (const q of args.slice(1)) {
        const d = unify(acc, q, n.fn === 'min' ? 'compare' : 'compare');
        acc = { v: n.fn === 'min' ? Math.min(acc.v, q.v) : Math.max(acc.v, q.v), d };
      }
      return acc;
    }
    case 'pow': {
      need(2);
      return power(args[0]!, args[1]!, isConst(n.args[1]!));
    }
    case 'exp':
    case 'log':
    case 'ln':
    case 'log10':
    case 'sin':
    case 'cos':
    case 'tan':
    case 'atan': {
      need(1);
      const a = args[0]!;
      plain(a);
      if ((n.fn === 'log' || n.fn === 'ln' || n.fn === 'log10') && a.v <= 0) throw new CalcFail('nonfinite', `${n.fn}() of a number that is not positive.`);
      const f: Record<string, (x: number) => number> = { exp: Math.exp, log: Math.log, ln: Math.log, log10: Math.log10, sin: Math.sin, cos: Math.cos, tan: Math.tan, atan: Math.atan };
      return { v: finite(f[n.fn]!(a.v)), d: NONE };
    }
    default:
      throw new CalcFail('function', `"${n.fn}" is not an allowed function.`);
  }
}

// ---------------------------------------------------------------------------
// Running a What-if
// ---------------------------------------------------------------------------

export interface StepResult {
  key: string;
  label: string;
  unit: string;
  expr: string;
  value: number;
}
export type RunResult =
  | { ok: true; assumptions: Record<string, number>; steps: StepResult[]; result: StepResult | null }
  | { ok: false; issues: CalcIssue[] };

const fail = (where: string, e: unknown): CalcIssue =>
  e instanceof CalcFail ? { code: e.code, where, message: e.message } : { code: 'syntax', where, message: 'The expression could not be evaluated.' };

/** Structural checks that do not need evaluation. */
function structureIssues(w: WhatIf): CalcIssue[] {
  const issues: CalcIssue[] = [];
  const seen = new Set<string>();
  for (const a of w.assumptions) {
    if (seen.has(a.key)) issues.push({ code: 'structure', where: a.key, message: `The key "${a.key}" is used twice.` });
    seen.add(a.key);
    if (!(a.min < a.max)) issues.push({ code: 'range', where: a.key, message: 'The range of this assumption is empty.' });
    else if (a.value < a.min || a.value > a.max) issues.push({ code: 'range', where: a.key, message: 'The starting value is outside its own range.' });
    if (!parseUnit(a.unit)) issues.push({ code: 'unit', where: a.key, message: `The unit "${a.unit}" is not recognised.` });
  }
  for (const s of w.steps) {
    if (seen.has(s.key)) issues.push({ code: 'structure', where: s.key, message: `The key "${s.key}" is used twice.` });
    seen.add(s.key);
    if (!parseUnit(s.unit)) issues.push({ code: 'unit', where: s.key, message: `The unit "${s.unit}" is not recognised.` });
  }
  if (w.resultKey && !w.steps.some((s) => s.key === w.resultKey)) issues.push({ code: 'structure', where: 'whatIf', message: 'The headline result is not one of the steps.' });
  if (w.sweepKey && !w.assumptions.some((a) => a.key === w.sweepKey)) issues.push({ code: 'structure', where: 'whatIf', message: 'The swept value is not one of the assumptions.' });
  return issues;
}

const parseCache = new Map<string, Node | CalcFail>();
function compile(expr: string): Node {
  const hit = parseCache.get(expr);
  if (hit instanceof CalcFail) throw hit;
  if (hit) return hit;
  try {
    const node = parseExpression(expr);
    if (parseCache.size > 500) parseCache.clear();
    parseCache.set(expr, node);
    return node;
  } catch (e) {
    if (e instanceof CalcFail) {
      parseCache.set(expr, e);
      throw e;
    }
    throw new CalcFail('syntax', 'The expression could not be read.');
  }
}

export function runWhatIf(w: WhatIf, overrides: Record<string, number> = {}): RunResult {
  const issues = structureIssues(w);
  if (issues.length) return { ok: false, issues };

  const env = new Map<string, Q>();
  const values: Record<string, number> = {};
  for (const a of w.assumptions) {
    const raw = overrides[a.key];
    const v = typeof raw === 'number' && Number.isFinite(raw) ? Math.min(a.max, Math.max(a.min, raw)) : a.value;
    values[a.key] = v;
    env.set(a.key, { v, d: parseUnit(a.unit)! });
  }

  const steps: StepResult[] = [];
  for (const s of w.steps) {
    try {
      const node = compile(s.expr);
      const names = new Set<string>();
      collectNames(node, names);
      for (const name of names) {
        if (!env.has(name) && name !== 'pi') throw new CalcFail('name', `"${name}" is not an assumption or an earlier step.`);
      }
      const q = evalNode(node, env);
      finite(q.v);
      const want = parseUnit(s.unit)!;
      if (q.d !== null && !sameDim(q.d, want)) {
        throw new CalcFail('dimension', `Declared as ${describeDims(want)} but the expression works out to ${describeDims(q.d)}.`);
      }
      if (q.d === null && q.v !== 0) throw new CalcFail('dimension', 'The expression has no units.');
      env.set(s.key, { v: q.v, d: want });
      steps.push({ key: s.key, label: s.label, unit: s.unit, expr: s.expr, value: q.v });
    } catch (e) {
      return { ok: false, issues: [fail(s.key, e)] };
    }
  }
  const result = w.resultKey ? (steps.find((s) => s.key === w.resultKey) ?? null) : null;
  return { ok: true, assumptions: values, steps, result };
}

export function checkWhatIf(w: WhatIf): CalcIssue[] {
  const r = runWhatIf(w);
  return r.ok ? [] : r.issues;
}

export interface Sweep {
  key: string;
  unit: string;
  resultKey: string;
  resultUnit: string;
  x: number[];
  y: number[];
}

export function sweepWhatIf(w: WhatIf, key: string | null = w.sweepKey, overrides: Record<string, number> = {}, points = 41): Sweep | null {
  if (!key || !w.resultKey) return null;
  const a = w.assumptions.find((x) => x.key === key);
  const rs = w.steps.find((s) => s.key === w.resultKey);
  if (!a || !rs) return null;
  const x: number[] = [];
  const y: number[] = [];
  for (let i = 0; i < points; i++) {
    const v = a.min + ((a.max - a.min) * i) / (points - 1);
    const r = runWhatIf(w, { ...overrides, [key]: v });
    if (!r.ok || !r.result) continue; // a point can fail (division by zero at one end); the rest still plot
    x.push(v);
    y.push(r.result.value);
  }
  return x.length >= 2 ? { key, unit: a.unit, resultKey: rs.key, resultUnit: rs.unit, x, y } : null;
}

export interface Sensitivity {
  key: string;
  label: string;
  unit: string;
  low: number;
  high: number;
  /** Headline result with this assumption at its minimum and at its maximum, all others as set. */
  atMin: number;
  atMax: number;
  /** Absolute swing relative to the current result. */
  swing: number;
}

/** Which assumptions move the answer most. Ranks by the swing across each one's whole stated range. */
export function sensitivity(w: WhatIf, overrides: Record<string, number> = {}): Sensitivity[] {
  const base = runWhatIf(w, overrides);
  if (!base.ok || !base.result) return [];
  const cur = base.result.value;
  const out: Sensitivity[] = [];
  for (const a of w.assumptions) {
    const lo = runWhatIf(w, { ...overrides, [a.key]: a.min });
    const hi = runWhatIf(w, { ...overrides, [a.key]: a.max });
    if (!lo.ok || !hi.ok || !lo.result || !hi.result) continue;
    const swing = cur === 0 ? Math.abs(hi.result.value - lo.result.value) : Math.abs(hi.result.value - lo.result.value) / Math.abs(cur);
    out.push({ key: a.key, label: a.label, unit: a.unit, low: a.min, high: a.max, atMin: lo.result.value, atMax: hi.result.value, swing });
  }
  return out.sort((p, q) => q.swing - p.swing);
}

/**
 * Applies the honesty rules to a model-written what-if:
 *  - a calculation that does not check out loses its numbers and becomes a hypothesis;
 *  - "simulation" is not a thing this app runs, so it is relabelled as the calculation it is, or a hypothesis;
 *  - hypotheses and unknowns carry no numbers at all.
 */
export function sanitizeWhatIf(w: WhatIf): WhatIf {
  const strip = (extra: string | null): WhatIf => ({
    ...w,
    kind: w.kind === 'unknown' ? 'unknown' : 'hypothesis',
    assumptions: [],
    steps: [],
    resultKey: null,
    sweepKey: null,
    caveats: extra ? [extra, ...w.caveats].slice(0, 6) : w.caveats,
  });

  if (w.kind === 'hypothesis' || w.kind === 'unknown') return strip(null);

  if (!w.steps.length || !w.resultKey) {
    return w.kind === 'principle' ? { ...w, assumptions: [], steps: [], resultKey: null, sweepKey: null } : strip('The numbers were removed: there was no calculation to check.');
  }
  const run = runWhatIf(w);
  if (!run.ok) {
    const first = run.issues[0]!;
    const where = first.where === 'whatIf' ? '' : ` (${first.where})`;
    const text = `The numbers were removed because the calculation did not check out${where}: ${first.message}`;
    return strip(text);
  }
  const caveats = [...w.caveats];
  let kind = w.kind;
  if (kind === 'simulation') {
    kind = 'calculation';
    caveats.unshift('No simulation was run. This is a short calculation with the assumptions shown.');
  }
  return { ...w, kind, caveats: caveats.slice(0, 6) };
}

// ---------------------------------------------------------------------------
// Number formatting
// ---------------------------------------------------------------------------

const SUP_DIGITS: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻' };

/** Three significant figures, scientific notation outside 0.001 to 1,000,000. */
export function formatNumber(v: number, sig = 3): string {
  if (!Number.isFinite(v)) return '—';
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e6 || a < 1e-3) {
    const [m, e] = v.toExponential(sig - 1).split('e');
    const exp = String(Number(e)).replace(/[-0-9]/g, (c) => SUP_DIGITS[c] ?? c);
    return `${m} × 10${exp}`;
  }
  const rounded = Number(v.toPrecision(sig));
  return rounded.toLocaleString('en-US', { maximumFractionDigits: 6 });
}

/** Units that take an SI prefix, and the factor of each to its base unit. */
const PREFIXED: Record<string, { base: string; f: number }> = (() => {
  const out: Record<string, { base: string; f: number }> = {};
  const P: Array<[string, number]> = [['m', 1e-3], ['', 1], ['k', 1e3], ['M', 1e6], ['G', 1e9], ['T', 1e12]];
  for (const base of ['J', 'W', 'Wh', 'N', 'Pa', 'Hz', 'V', 'A', 'B']) for (const [p, f] of P) out[`${p}${base}`] = { base, f };
  return out;
})();

/**
 * A quantity as people read it: "810 kJ" rather than "810,000 J", "1.37 MJ" rather than
 * "1.37 × 10⁶ J". Units without SI prefixes (kg, km/h, °C) are left as they are.
 */
export function formatQuantity(v: number, unit: string, sig = 3): { num: string; unit: string } {
  const u = PREFIXED[unit.trim()];
  if (!u || !Number.isFinite(v) || v === 0) return { num: formatNumber(v, sig), unit };
  const base = v * u.f;
  const a = Math.abs(base);
  const steps: Array<[number, string]> = [[1e12, 'T'], [1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm']];
  const pick = steps.find(([f]) => a >= f) ?? steps[steps.length - 1]!;
  const [f, p] = pick;
  return { num: formatNumber(base / f, sig), unit: `${p}${u.base}` };
}
