/**
 * Train: an eye test for I SEE. The person checks what it saw on their own photos, and puts
 * right what it got wrong. Levels are the lines of an eye chart: the more mistakes caught and
 * parts confirmed, the further down the chart I SEE can read.
 *
 * Three kinds of question, ten to a round:
 *   - Right or wrong? A close-up of one outlined part: "Is this the headlight?"
 *   - Which one? Three numbered outlines: "Which one is the nose?" If I SEE swapped two names
 *     (the nose and the mouth), the person swaps them back.
 *   - Where is it? The whole photo: "Tap the wing mirror." If the outline is elsewhere, the
 *     person can trace the real part with a tap.
 *
 * The person can be wrong too, so answers are checked the way large labelling projects check
 * volunteers (check questions with known answers, an independent reviewer for disagreements,
 * and agreement across answers):
 *   1. A correction fixes the person's own scan (it is their data).
 *   2. An independent second look (Muse Spark, shown both names in a random order, not told
 *      whose is whose) picks the name that fits. If it disagrees, the person sees why and
 *      decides.
 *   3. Once a round, a check question from the built-in examples, whose answer is known.
 *   4. A name teaches I SEE (goes with later scans) only when the second look agreed, or when
 *      the person made the same fix on two photos and does well on check questions.
 *
 * What keeps volunteers going is meaningful recognition of what they did (Iacovides et al., on
 * Foldit and Eyewire), so the page leads with the mistakes caught and fixes made, by name.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'wouter';
import type { Profile, Region } from '@shared/schema';
import { kindKey, planForObject } from '@shared/bodyplans';
import { wholeObjectIds } from '@shared/whole';
import { getEntry, listEntries, putEntry } from '../lib/passport';
import { EXAMPLES } from '../lib/samples';
import { BADGES, DAILY_GOAL, LEVELS, levelOf, trustOf, useTeach, type Taught, type Verdict } from '../lib/teach';
import { useSettings } from '../lib/settings';
import { useHealth } from '../lib/health';
import { segmentAt, userMessage, verifyLabel } from '../lib/api';
import { outlineOf, type Pt } from '../lib/draw';
import { Icon } from '../components/Icon';

interface Subject {
  key: string;
  entryId: string | null;
  title: string;
  kind: string;
  photo: string;
  width: number;
  height: number;
  regions: Region[];
  vocab: string[];
  blob: Blob | null;
  /** A built-in example whose answers are known: its questions are check questions. */
  gold: boolean;
}
type Mode = 'mixed' | 'check' | 'which' | 'find';
interface Card {
  type: 'check' | 'which' | 'find';
  s: Subject;
  r: Region;
  /** For "Which one?": three outlines, one of them the part asked about. */
  options?: Region[];
  /** The name asked about (kept when the person renames the part). */
  asked: string;
}
type Box = { x: number; y: number; w: number; h: number };
type Phase = 'ask' | 'fix' | 'found' | 'missed' | 'swap' | 'draw' | 'checking' | 'dispute' | 'done';
type Geometry = Pick<Region, 'path' | 'box' | 'anchor' | 'area' | 'kind' | 'confidence'> & { source?: Region['source'] };
/** A part being drawn by hand: the loop, and SAM's outline snapped to the photo's edges from it. */
interface Drawing {
  loop: ReturnType<typeof outlineOf>;
  snapped: (Geometry & { label: string }) | null;
  zoom: boolean;
}
/** A correction waiting on its second look, or disputed by it. */
interface Pending {
  what: 'rename' | 'remove' | 'swap' | 'move';
  /** I SEE's name, and the person's. */
  ai: string;
  mine: string;
  region: Region;
  geometry?: Geometry;
  /** The second look's view, when it disagrees. */
  verdict?: { thinks: string | null; reason: string };
}

const ROUND = 10;
/** The round's progress, as a line of eye-chart letters. */
const ROUND_LETTERS = 'EDFCZPTOLE';
const NOT_A_PART = 'Not a part of this object';
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const FIXES: Verdict[] = ['renamed', 'removed', 'moved', 'swapped'];
const same = (a: string, b: string) => {
  const n = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  return n(a) === n(b) || n(a).endsWith(` ${n(b)}`) || n(b).endsWith(` ${n(a)}`);
};

/** The parts worth asking about: real outlines, not the whole object, not specks. */
function partsOf(p: Profile): Region[] {
  const view0 = p.regions.filter((r) => r.view === 0);
  const whole = new Set(wholeObjectIds(view0, p));
  return view0.filter((r) => r.kind === 'mask' && r.path && !whole.has(r.id) && r.area >= 0.0004);
}

function exampleSubjects(): Subject[] {
  return EXAMPLES.map((ex) => {
    const regions = ex.regions.filter((r) => r.kind === 'mask' && r.path && r.area >= 0.0004 && r.area < 0.5);
    const plan = planForObject({ displayName: ex.title, category: 'other' });
    return {
      key: `ex-${ex.id}`,
      entryId: null,
      title: ex.title,
      kind: kindKey({ displayName: ex.title, category: 'other' }),
      photo: ex.photo,
      width: ex.width,
      height: ex.height,
      regions,
      vocab: [...new Set([...(plan?.external ?? []), ...ex.regions.map((r) => cap(r.label))])],
      blob: null,
      // The built-in samples were labelled by hand: their answers are known.
      gold: ex.kind === 'sample',
    } satisfies Subject;
  }).filter((s) => s.regions.length);
}

async function loadSubjects(): Promise<{ subjects: Subject[]; gold: Subject[]; practice: boolean; urls: string[] }> {
  const urls: string[] = [];
  const own: Subject[] = [];
  for (const e of await listEntries().catch(() => [])) {
    const p = e.profile;
    const blob = e.images[0];
    const regions = partsOf(p);
    if (!blob || !regions.length) continue;
    const url = URL.createObjectURL(blob);
    urls.push(url);
    const plan = planForObject(p);
    own.push({
      key: e.id,
      entryId: e.id,
      title: p.displayName,
      kind: kindKey(p),
      photo: url,
      width: p.views[0]!.width,
      height: p.views[0]!.height,
      regions,
      vocab: [...new Set([...(plan?.external ?? []), ...p.regions.map((r) => cap(r.label)), ...p.components.map((c) => cap(c.name))])],
      blob,
      gold: false,
    });
  }
  const examples = exampleSubjects();
  const gold = examples.filter((s) => s.gold);
  // Nothing scanned yet: practise on the examples (answers count; nothing is saved to them).
  return own.length ? { subjects: own, gold, practice: false, urls } : { subjects: examples, gold, practice: true, urls };
}

function shuffle<T>(a: T[]): T[] {
  const out = [...a];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Two other parts of the same photo with other names, for a "Which one?" question. */
function optionsFor(s: Subject, r: Region): Region[] | null {
  const others = shuffle(s.regions.filter((o) => o.id !== r.id && o.label.toLowerCase() !== r.label.toLowerCase() && o.area < 0.4)).slice(0, 2);
  return others.length === 2 ? shuffle([r, ...others]) : null;
}

function cardFor(s: Subject, r: Region, want: Card['type']): Card {
  const asked = r.label.toLowerCase();
  const which = want === 'which' ? optionsFor(s, r) : null;
  if (which) return { type: 'which', s, r, options: which, asked };
  if (want === 'find' && r.area >= 0.0015) return { type: 'find', s, r, asked };
  return { type: 'check', s, r, asked };
}

function buildDeck(subjects: Subject[], gold: Subject[], reviewed: Set<string>, mode: Mode, practice: boolean): Card[] {
  const pool = shuffle(subjects.flatMap((s) => s.regions.map((r) => ({ s, r, seen: reviewed.has(`${s.key}:${r.id}`) }))));
  pool.sort((a, b) => Number(a.seen) - Number(b.seen)); // new parts first
  const kinds = (k: number): Card['type'] => (mode === 'mixed' ? (['check', 'which', 'find'] as const)[k % 3]! : mode);
  const deck = pool.slice(0, ROUND).map(({ s, r }, k) => cardFor(s, r, kinds(k)));
  // One check question a round, from an example whose answer is known (practice is all examples).
  if (!practice && gold.length && deck.length >= 4) {
    const s = gold[Math.floor(Math.random() * gold.length)]!;
    const r = s.regions[Math.floor(Math.random() * s.regions.length)]!;
    const at = 2 + Math.floor(Math.random() * (deck.length - 3));
    deck[at] = cardFor(s, r, kinds(at));
  }
  return deck;
}

/** A close-up around the part, in a 4:3 frame, inside the photo. */
function cropFor(b: Box, W: number, H: number, aspect = 4 / 3): Box {
  let w = Math.max(b.w * 2.6, W * 0.3);
  let h = Math.max(b.h * 2.6, H * 0.3);
  if (w / h > aspect) h = w / aspect;
  else w = h * aspect;
  if (w > W) {
    w = W;
    h = Math.min(H, w / aspect);
  }
  if (h > H) {
    h = H;
    w = Math.min(W, h * aspect);
  }
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  return { x: Math.max(0, Math.min(W - w, cx - w / 2)), y: Math.max(0, Math.min(H - h, cy - h / 2)), w, h };
}

/** Whether a tap lands on the part's outline (its filled shape). */
let probe: SVGPathElement | null = null;
function hits(r: Region, pt: { x: number; y: number }, W: number, H: number): boolean {
  try {
    if (!probe) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width', '0');
      svg.setAttribute('height', '0');
      svg.style.position = 'absolute';
      svg.setAttribute('aria-hidden', 'true');
      probe = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      probe.setAttribute('fill-rule', 'evenodd');
      svg.appendChild(probe);
      document.body.appendChild(svg);
    }
    probe.setAttribute('d', r.path ?? '');
    if (probe.isPointInFill(new DOMPoint(pt.x, pt.y))) return true;
  } catch {
    /* fall back to the box */
  }
  // A small part gets a little leeway around it (fingers are wider than a nose).
  const tol = Math.hypot(W, H) * (r.area < 0.01 ? 0.015 : 0);
  return pt.x >= r.box.x - tol && pt.x <= r.box.x + r.box.w + tol && pt.y >= r.box.y - tol && pt.y <= r.box.y + r.box.h + tol && (r.area < 0.01 || !probe);
}

async function blobToBase64(b: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).replace(/^data:[^,]+,/, ''));
    r.onerror = () => rej(new Error('read'));
    r.readAsDataURL(b);
  });
}

async function applyFix(entryId: string, regionId: string, change: { label?: string; remove?: boolean; geometry?: Geometry }) {
  const e = await getEntry(entryId);
  if (!e) return;
  let p = e.profile;
  if (change.remove) {
    p = { ...p, regions: p.regions.filter((r) => r.id !== regionId), findings: p.findings.map((f) => (f.regionIds.includes(regionId) ? { ...f, regionIds: f.regionIds.filter((x) => x !== regionId) } : f)) };
  } else {
    p = { ...p, regions: p.regions.map((r) => (r.id === regionId ? { ...r, ...(change.label ? { label: change.label } : {}), ...(change.geometry ?? {}) } : r)) };
  }
  await putEntry({ ...e, profile: { ...p, updatedAt: new Date().toISOString() } });
}

/**
 * The independent second look: which of two names fits the outline (null for neither). Returns
 * undefined when it cannot be had (offline, or an example with no photo of yours to send).
 */
async function secondLook(s: Subject, region: Pick<Region, 'path' | 'box'>, options: [string, string], language: string, privacyTier: 'private' | 'contributor'): Promise<{ pick: 0 | 1 | null; reason: string } | undefined> {
  if (!s.blob) return undefined;
  try {
    const r = await verifyLabel({ view: { mime: 'image/jpeg', base64: await blobToBase64(s.blob), width: s.width, height: s.height, label: null }, region: { path: region.path, box: region.box }, object: s.title, options, language, privacyTier });
    return { pick: r.pick as 0 | 1 | null, reason: r.reason };
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Pictures
// ---------------------------------------------------------------------------

/**
 * The eye chart. The lines I SEE can read on your things are sharp; the lines below are out of
 * focus. When a new line is reached it comes into focus (the page's one bit of motion).
 */
function EyeChart({ level, focusIn = false, compact = false }: { level: number; focusIn?: boolean; compact?: boolean }) {
  return (
    <figure className={`eye-chart ${compact ? 'compact' : ''}`} aria-hidden="true">
      <ol>
        {LEVELS.map((l, i) => (
          <li key={l.acuity} className={`ec-line ${i < level ? 'read' : i === level ? `now ${focusIn ? 'focus-in' : ''}` : 'blur'}`} style={{ '--i': i, '--d': Math.max(0, i - level) } as CSSProperties}>
            <span className="ec-letters">{l.letters.split('').join(' ')}</span>
            <span className="ec-acuity num">{l.acuity}</span>
          </li>
        ))}
      </ol>
      <div className="ec-duo">
        <span />
        <span />
      </div>
    </figure>
  );
}

/** The photo, close up on one part (or whole), with its outline when shown. */
function PartView({ card, zoom, outline, tap, onTap, busy }: { card: Card; zoom: boolean; outline: 'none' | 'ask' | 'good' | 'bad'; tap: { x: number; y: number } | null; onTap?: (pt: { x: number; y: number }) => void; busy?: boolean }) {
  const { s, r } = card;
  const W = s.width;
  const H = s.height;
  const crop = zoom ? cropFor(r.box, W, H) : { x: 0, y: 0, w: W, h: H };
  const layer: CSSProperties = { width: `${(W / crop.w) * 100}%`, height: `${(H / crop.h) * 100}%`, left: `${(-crop.x / crop.w) * 100}%`, top: `${(-crop.y / crop.h) * 100}%` };
  return (
    <div
      className={`tv-frame ${onTap ? 'tappable' : ''} ${busy ? 'busy' : ''}`}
      style={{ aspectRatio: `${crop.w} / ${crop.h}`, maxWidth: `calc(60vh * ${(crop.w / crop.h).toFixed(4)})` }}
      onClick={(e) => {
        if (!onTap) return;
        const b = e.currentTarget.getBoundingClientRect();
        onTap({ x: crop.x + ((e.clientX - b.left) / b.width) * crop.w, y: crop.y + ((e.clientY - b.top) / b.height) * crop.h });
      }}
    >
      <div className="tv-layer" style={layer}>
        <img src={s.photo} alt="" draggable={false} />
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
          {outline !== 'none' && r.path && (
            <g className={`tv-outline ${outline}`}>
              <path d={r.path} fillRule="evenodd" className="halo" vectorEffect="non-scaling-stroke" />
              <path d={r.path} fillRule="evenodd" className="edge" vectorEffect="non-scaling-stroke" />
            </g>
          )}
          {tap && <circle cx={tap.x} cy={tap.y} r={Math.max(W, H) * 0.012} className="tv-tap" vectorEffect="non-scaling-stroke" />}
        </svg>
      </div>
      {zoom && (
        <span className="tv-mini" aria-hidden="true">
          <img src={s.photo} alt="" />
          <span style={{ left: `${(crop.x / W) * 100}%`, top: `${(crop.y / H) * 100}%`, width: `${(crop.w / W) * 100}%`, height: `${(crop.h / H) * 100}%` }} />
        </span>
      )}
    </div>
  );
}

/** "Which one?": the whole photo with three numbered outlines. */
function WhichView({ card, picked, reveal }: { card: Card; picked: number | null; reveal: boolean }) {
  const { s, r, options = [] } = card;
  const W = s.width;
  const H = s.height;
  const tag = Math.max(W, H) * 0.028;
  return (
    <div className="tv-frame" style={{ aspectRatio: `${W} / ${H}`, maxWidth: `calc(60vh * ${(W / H).toFixed(4)})` }}>
      <div className="tv-layer" style={{ inset: 0, width: '100%', height: '100%' }}>
        <img src={s.photo} alt="" draggable={false} />
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
          {options.map((o, k) => {
            const state = reveal && o.id === r.id ? 'good' : picked === k ? (reveal && o.id !== r.id ? 'bad' : 'ask') : 'opt';
            return (
              <g key={o.id} className={`tv-outline ${state}`}>
                <path d={o.path!} fillRule="evenodd" className="halo" vectorEffect="non-scaling-stroke" />
                <path d={o.path!} fillRule="evenodd" className="edge" vectorEffect="non-scaling-stroke" />
              </g>
            );
          })}
          {options.map((o, k) => (
            <g key={`n-${o.id}`} className="tv-num">
              <circle cx={o.anchor.x} cy={o.anchor.y} r={tag} />
              <text x={o.anchor.x} y={o.anchor.y + tag * 0.36} fontSize={tag * 1.05} textAnchor="middle">
                {k + 1}
              </text>
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}

/**
 * Drawing the part by hand: a loop around it with a finger, pen or mouse, on the whole photo or
 * closer in. I SEE's outline shows faintly, for reference; a snapped outline shows in green.
 */
function DrawView({ card, focus, drawing, onLoop }: { card: Card; focus: Box | null; drawing: Drawing; onLoop: (pts: Pt[]) => void }) {
  const { s, r } = card;
  const W = s.width;
  const H = s.height;
  const crop = drawing.zoom && focus ? cropFor(focus, W, H) : { x: 0, y: 0, w: W, h: H };
  const layer: CSSProperties = { width: `${(W / crop.w) * 100}%`, height: `${(H / crop.h) * 100}%`, left: `${(-crop.x / crop.w) * 100}%`, top: `${(-crop.y / crop.h) * 100}%` };
  const pts = useRef<Pt[] | null>(null);
  const [live, setLive] = useState<string | null>(null);
  const frame = useRef<number | null>(null);
  const at = (e: React.PointerEvent<HTMLDivElement>): Pt => {
    const b = e.currentTarget.getBoundingClientRect();
    return [crop.x + ((e.clientX - b.left) / b.width) * crop.w, crop.y + ((e.clientY - b.top) / b.height) * crop.h];
  };
  const paint = () => {
    frame.current = null;
    const p = pts.current;
    setLive(p && p.length > 1 ? p.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('') : null);
  };
  const stroke = Math.max(crop.w, crop.h) * 0.004;
  return (
    <div
      className="tv-frame drawable"
      style={{ aspectRatio: `${crop.w} / ${crop.h}`, maxWidth: `calc(60vh * ${(crop.w / crop.h).toFixed(4)})` }}
      onPointerDown={(e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        pts.current = [at(e)];
        paint();
      }}
      onPointerMove={(e) => {
        const p = pts.current;
        if (!p) return;
        const q = at(e);
        const last = p[p.length - 1]!;
        if (Math.hypot(q[0] - last[0], q[1] - last[1]) < Math.max(crop.w, crop.h) * 0.002) return;
        p.push(q);
        if (frame.current === null) frame.current = requestAnimationFrame(paint);
      }}
      onPointerUp={() => {
        const p = pts.current;
        pts.current = null;
        setLive(null);
        if (p && p.length > 4) onLoop(p);
      }}
      onPointerCancel={() => {
        pts.current = null;
        setLive(null);
      }}
    >
      <div className="tv-layer" style={layer}>
        <img src={s.photo} alt="" draggable={false} />
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
          {r.path && <path d={r.path} fillRule="evenodd" className="tv-ref" vectorEffect="non-scaling-stroke" />}
          {drawing.snapped?.path && (
            <g className="tv-outline good">
              <path d={drawing.snapped.path} fillRule="evenodd" className="halo" vectorEffect="non-scaling-stroke" />
              <path d={drawing.snapped.path} fillRule="evenodd" className="edge" vectorEffect="non-scaling-stroke" />
            </g>
          )}
          {drawing.loop && <path d={drawing.loop.path} className={`tv-drawn ${drawing.snapped ? 'faint' : ''}`} vectorEffect="non-scaling-stroke" />}
          {live && <path d={live} className="tv-live" strokeWidth={stroke} />}
        </svg>
      </div>
    </div>
  );
}

const STATUS: Record<Taught['status'], { label: string; icon: string }> = {
  verified: { label: 'Confirmed by a second look', icon: 'check' },
  disputed: { label: 'Disputed: the second look disagreed', icon: 'alert' },
  pending: { label: 'Waiting for a second look', icon: 'clock' },
};

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

export function Train() {
  const teach = useTeach();
  const settings = useSettings();
  const online = useHealth((s) => s.state) === 'live';
  const [data, setData] = useState<{ subjects: Subject[]; gold: Subject[]; practice: boolean } | null>(null);
  const [mode, setMode] = useState<Mode>('mixed');
  const [deck, setDeck] = useState<Card[] | null>(null);
  const [i, setI] = useState(0);
  const [phase, setPhase] = useState<Phase>('ask');
  const [combo, setCombo] = useState(0);
  const [round, setRound] = useState({ xp: 0, agreed: 0, caught: 0, confirmed: 0, taught: 0, skips: 0, gold: null as boolean | null, badges: [] as string[], levelUp: null as number | null, fixes: [] as string[] });
  const [flash, setFlash] = useState<{ text: string; tone: 'good' | 'caught' | 'calm'; xp: number; key: number; auto: boolean } | null>(null);
  const [tap, setTap] = useState<{ x: number; y: number } | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [rename, setRename] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const [drawing, setDrawing] = useState<Drawing | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOn, setConfirmOn] = useState(false);
  const next = useRef<number | null>(null);
  const top = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const rechecked = useRef(false);
  const switchRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let urls: string[] = [];
    void loadSubjects().then((d) => {
      urls = d.urls;
      setData({ subjects: d.subjects, gold: d.gold, practice: d.practice });
    });
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u));
      if (next.current) window.clearTimeout(next.current);
    };
  }, []);

  // Corrections made offline get their second look once I SEE is online (a few at a time).
  useEffect(() => {
    if (!online || rechecked.current) return;
    rechecked.current = true;
    void (async () => {
      for (const t of useTeach.getState().taught.filter((x) => (x.status ?? 'pending') === 'pending' && x.entryId && x.regionId).slice(0, 5)) {
        const e = await getEntry(t.entryId!).catch(() => null);
        const r = e?.profile.regions.find((x) => x.id === t.regionId);
        if (!e || !r || !e.images[0]) continue;
        const s = { blob: e.images[0], width: e.profile.views[0]!.width, height: e.profile.views[0]!.height, title: e.profile.displayName } as Subject;
        const v = await secondLook(s, r, [t.from, t.to], settings.language, settings.privacyTier);
        if (v) useTeach.getState().settle(t.at, v.pick === 1 ? 'verified' : 'disputed');
      }
    })();
  }, [online, settings.language, settings.privacyTier]);

  const card = deck?.[i] ?? null;
  const level = levelOf(teach.xp);
  const today = teach.today.day === new Date().toISOString().slice(0, 10) ? teach.today.count : 0;
  const trust = trustOf(teach);

  // Each new question starts at the top, with the whole photo in view, and its question read out.
  useEffect(() => {
    if (!deck) return;
    top.current?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    heading.current?.focus({ preventScroll: true });
  }, [deck, i, phase === 'done']);

  // What comes after an answer (a fix to type, a second look, a disagreement) is brought into view.
  useEffect(() => {
    if (!deck || phase === 'ask' || phase === 'done') return;
    if (phase === 'draw' && !drawing?.loop) {
      // The question and the photo in view, ready to draw on.
      top.current?.querySelector('.tp-q')?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      return;
    }
    const el = top.current?.querySelector('.tp-dispute, .tp-flash, .tp-fix, .tp-decide, .tp-draw-actions');
    el?.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [deck, phase, flash, !!drawing?.loop]);

  const start = (m: Mode = mode) => {
    if (!data) return;
    const d = buildDeck(data.subjects, data.gold, new Set(teach.reviewed), m, data.practice);
    if (!d.length) return;
    teach.seeIntro();
    setDeck(d);
    setI(0);
    setPhase('ask');
    setCombo(0);
    setTap(null);
    setPicked(null);
    setRename('');
    setPending(null);
    setDrawing(null);
    setError(null);
    setFlash(null);
    setRound({ xp: 0, agreed: 0, caught: 0, confirmed: 0, taught: 0, skips: 0, gold: null, badges: [], levelUp: null, fixes: [] });
  };

  const advance = useCallback(() => {
    if (next.current) window.clearTimeout(next.current);
    next.current = null;
    setTap(null);
    setPicked(null);
    setRename('');
    setPending(null);
    setDrawing(null);
    setError(null);
    setFlash(null);
    if (!deck) return;
    if (i + 1 >= deck.length) {
      setRound((r) => ({ ...r, badges: [...r.badges, ...useTeach.getState().finishRound(r.skips)] }));
      setPhase('done');
    } else {
      setI(i + 1);
      setPhase('ask');
    }
  }, [deck, i]);

  /** Scores one answer: points (more for a confirmed catch), a combo, badges, a new line. */
  const award = (base: number, verdict: Verdict, extra: { to?: string; text: string; tone: 'good' | 'caught' | 'calm'; auto?: boolean; fix?: string; confirmed?: boolean }) => {
    if (!card) return;
    const before = levelOf(useTeach.getState().xp).index;
    // A skip, or a check question missed, ends the run of answers.
    const nextCombo = verdict === 'skipped' || base === 0 ? 0 : combo + 1;
    const mult = nextCombo >= 6 ? 3 : nextCombo >= 3 ? 2 : 1;
    const xp = verdict === 'skipped' ? 0 : base * mult;
    const unlocked = teach.answer({
      xp,
      verdict,
      combo: nextCombo,
      key: `${card.s.key}:${card.r.id}`,
      which: card.type === 'which',
      log: { kind: card.s.kind, object: card.s.title, part: cap(card.asked), to: extra.to, box: [card.r.box.x, card.r.box.y, card.r.box.w, card.r.box.h], photo: card.s.key },
    });
    const after = levelOf(useTeach.getState().xp);
    setCombo(nextCombo);
    setRound((r) => ({
      ...r,
      xp: r.xp + xp,
      agreed: r.agreed + (verdict === 'right' || verdict === 'found' ? 1 : 0),
      caught: r.caught + (FIXES.includes(verdict) ? 1 : 0),
      confirmed: r.confirmed + (extra.confirmed ? 1 : 0),
      skips: r.skips + (verdict === 'skipped' ? 1 : 0),
      badges: [...r.badges, ...unlocked],
      levelUp: after.index > before ? after.index : r.levelUp,
      fixes: extra.fix ? [...r.fixes, extra.fix] : r.fixes,
    }));
    setFlash({ text: after.index > before ? `${extra.text} I SEE can now read line ${after.index + 1}, ${after.acuity}.` : extra.text, tone: extra.tone, xp, key: Date.now(), auto: !!extra.auto });
    if (extra.auto) next.current = window.setTimeout(advance, 1150);
  };

  /** A check question answered: right, or the known answer shown. */
  const gold = (right: boolean, known: string) => {
    const unlocked = teach.gold(right);
    setRound((r) => ({ ...r, gold: right, badges: [...r.badges, ...unlocked] }));
    if (right) award(10, card?.type === 'check' ? 'right' : 'found', { text: 'Right. That was a check question, and you got it.', tone: 'good', auto: true });
    else award(0, 'missed', { text: `That was a check question: it really is the ${known}. Check questions keep everyone's training accurate.`, tone: 'calm' });
  };

  // ---------- The person's answers ----------
  const right = () => {
    if (card?.s.gold) return gold(true, card.asked);
    award(10, 'right', { text: 'Confirmed. I SEE had it right.', tone: 'good', auto: true });
  };
  const wrong = () => {
    if (card?.s.gold) return gold(false, card.asked);
    setPhase('fix');
  };
  const skip = () => {
    award(0, 'skipped', { text: 'Skipped.', tone: 'calm' });
    advance();
  };

  /**
   * Sends a correction for its second look. Agreement: the fix is saved and teaches I SEE. The
   * second look disagrees: the person sees why, and decides. No second look to be had (offline,
   * or practice): the fix is saved, and waits to be checked before it teaches anything.
   */
  const check = async (p: Pending, options: [string, string]) => {
    if (!card) return;
    setPending(p);
    if (!card.s.entryId) {
      // Practice on an example: nothing to save, nothing to teach.
      award(5, 'disputed', { text: 'Noted. On your own scans, this fixes the part and gets a second look.', tone: 'calm' });
      return;
    }
    setPhase('checking');
    const v = online ? await secondLook(card.s, p.region, options, settings.language, settings.privacyTier) : undefined;
    if (v === undefined) return keep(p, 'pending');
    if (v.pick === 1) return keep(p, 'verified');
    setPending({ ...p, verdict: { thinks: v.pick === 0 ? options[0] : null, reason: v.reason } });
    setPhase('dispute');
  };

  /** Saves a correction to the Passport, and what it teaches, with its status. */
  const keep = async (p: Pending, status: Taught['status']) => {
    if (!card || !card.s.entryId) return;
    const id = card.s.entryId;
    const ref = { entryId: id, regionId: p.region.id };
    let unlocked: string[] = [];
    if (p.what === 'rename') {
      await applyFix(id, p.region.id, { label: p.mine });
      unlocked = teach.teach(card.s.kind, p.ai, p.mine, status, ref);
      card.r = { ...card.r, label: p.mine };
    } else if (p.what === 'remove') {
      await applyFix(id, p.region.id, { remove: true });
    } else if (p.what === 'swap' && card.options) {
      await applyFix(id, p.region.id, { label: p.mine });
      await applyFix(id, card.r.id, { label: p.ai });
      unlocked = [...teach.teach(card.s.kind, p.ai, p.mine, status, ref), ...teach.teach(card.s.kind, p.mine, p.ai, status, { entryId: id, regionId: card.r.id })];
    } else if (p.what === 'move' && p.geometry) {
      await applyFix(id, card.r.id, { geometry: p.geometry });
      card.r = { ...card.r, ...p.geometry };
    }
    setRound((r) => ({ ...r, taught: r.taught + (p.what === 'rename' ? 1 : p.what === 'swap' ? 2 : 0), badges: [...r.badges, ...unlocked] }));
    const fix =
      p.what === 'rename' ? `${card.s.title}: ${p.ai} → ${p.mine}` : p.what === 'remove' ? `${card.s.title}: removed “${p.ai}”` : p.what === 'swap' ? `${card.s.title}: swapped ${p.ai} and ${p.mine}` : `${card.s.title}: re-traced the ${p.ai.toLowerCase()}`;
    const verdict: Verdict = p.what === 'rename' ? 'renamed' : p.what === 'remove' ? 'removed' : p.what === 'swap' ? 'swapped' : 'moved';
    if (status === 'verified') award(25, verdict, { to: p.mine, fix, confirmed: true, tone: 'caught', text: `You caught a mistake, and a second look agrees. ${p.what === 'remove' || p.what === 'move' ? 'Your scan is fixed.' : 'I SEE will remember.'}` });
    else if (status === 'pending') award(15, verdict, { to: p.mine, fix, tone: 'caught', text: 'Saved to your scan. A second look will check it before I SEE learns from it.' });
    else award(10, verdict, { to: p.mine, fix, tone: 'calm', text: 'Kept. Your scan is fixed; I SEE learns this only if you make the same fix on another photo.' });
  };

  const saveRename = () => {
    if (!card) return;
    const mine = cap(rename.trim().replace(/\s+/g, ' ')).slice(0, 60);
    if (!mine) return;
    const ai = cap(card.r.label);
    // The same name I SEE gave it: that is agreeing, not a fix.
    if (mine.toLowerCase() === ai.toLowerCase()) return award(10, 'right', { text: 'That is the name I SEE gave it, so you agree. Confirmed.', tone: 'good', auto: true });
    void check({ what: 'rename', ai, mine, region: card.r }, [ai, mine]);
  };
  const removePart = () => {
    if (!card) return;
    const ai = cap(card.r.label);
    void check({ what: 'remove', ai, mine: NOT_A_PART, region: card.r }, [ai, NOT_A_PART]);
  };
  const onFindTap = (pt: { x: number; y: number }) => {
    if (!card || phase !== 'ask') return;
    setTap(pt);
    const hit = hits(card.r, pt, card.s.width, card.s.height);
    if (card.s.gold) {
      setPhase(hit ? 'found' : 'missed');
      return gold(hit, card.asked);
    }
    if (hit) {
      setPhase('found');
      award(10, 'found', { text: 'Spot on. You and I SEE agree.', tone: 'good', auto: true });
    } else setPhase('missed');
  };
  const fixOutline = async () => {
    if (!card || !tap || !card.s.entryId || !card.s.blob) return;
    setBusy(true);
    setError(null);
    try {
      const out = await segmentAt({ view: { mime: 'image/jpeg', base64: await blobToBase64(card.s.blob), width: card.s.width, height: card.s.height, label: null }, viewIndex: 0, concept: null, points: [{ x: tap.x, y: tap.y, label: 'positive' }], box: null, object: card.s.title, language: settings.language });
      const best = out.regions[0];
      if (!best || !best.path || best.area > 0.45) {
        setError('That spot did not trace as one part. Tap the middle of the part.');
        setPhase('ask');
        setTap(null);
        return;
      }
      const geometry = { path: best.path, box: best.box, anchor: best.anchor, area: best.area, kind: best.kind, confidence: best.confidence };
      const traced = { ...card.r, ...geometry };
      const p: Pending = { what: 'move', ai: cap(card.asked), mine: cap(card.asked), region: traced, geometry };
      // The new outline is named blind when it is traced: if that name agrees, it is confirmed.
      const named = best.label && !/^your selection$|^background$/i.test(best.label) ? best.label : null;
      if (named && same(named, card.asked)) return void keep(p, 'verified');
      void check(p, [named && !same(named, card.asked) ? cap(named) : 'Something else', cap(card.asked)]);
    } catch (e) {
      setError(userMessage(e, 'The outline could not be traced this time.'));
    } finally {
      setBusy(false);
    }
  };
  const pick = (k: number) => {
    if (!card?.options || phase !== 'ask') return;
    setPicked(k);
    const hit = card.options[k]!.id === card.r.id;
    if (card.s.gold) {
      setPhase(hit ? 'found' : 'swap');
      return gold(hit, card.asked);
    }
    if (hit) {
      setPhase('found');
      award(10, 'found', { text: `Right. That is the ${card.asked}.`, tone: 'good', auto: true });
    } else setPhase('swap');
  };
  const swapNames = () => {
    if (!card?.options || picked === null) return;
    const chosen = card.options[picked]!;
    // The person says the chosen outline is the part asked about: check that outline.
    void check({ what: 'swap', ai: cap(chosen.label), mine: cap(card.asked), region: chosen }, [cap(chosen.label), cap(card.asked)]);
  };

  // ---------- Drawing the part by hand ----------
  /** Where to look closer: where the person tapped, or I SEE's outline. */
  const drawFocus = (): Box | null => {
    if (!card) return null;
    if (tap) {
      const s = Math.max(card.s.width, card.s.height) * 0.12;
      return { x: tap.x - s / 2, y: tap.y - s / 2, w: s, h: s };
    }
    return card.r.box;
  };
  const startDraw = () => {
    setError(null);
    setDrawing({ loop: null, snapped: null, zoom: false });
    setPhase('draw');
  };
  const onLoop = (pts: Pt[]) => {
    if (!card) return;
    const loop = outlineOf(pts, card.s.width, card.s.height);
    if (!loop) {
      setError('Draw all the way around the part, back to where you started.');
      return;
    }
    setError(null);
    setDrawing((d) => ({ zoom: d?.zoom ?? false, loop, snapped: null }));
  };
  /** SAM 3.1 outlines the part inside the drawn loop, following the photo's own edges. */
  const snapDrawing = async () => {
    if (!card || !drawing?.loop || !card.s.blob) return;
    setBusy(true);
    setError(null);
    try {
      const l = drawing.loop;
      const out = await segmentAt({ view: { mime: 'image/jpeg', base64: await blobToBase64(card.s.blob), width: card.s.width, height: card.s.height, label: null }, viewIndex: 0, concept: null, points: [{ x: l.anchor.x, y: l.anchor.y, label: 'positive' }], box: l.box, object: card.s.title, language: settings.language });
      const best = out.regions[0];
      if (!best?.path || best.area > l.area * 3 + 0.01) {
        setError('The edges could not be found inside your drawing. You can save your drawing as it is.');
        return;
      }
      setDrawing((d) => (d ? { ...d, snapped: { path: best.path, box: best.box, anchor: best.anchor, area: best.area, kind: best.kind, confidence: best.confidence, source: 'sam', label: best.label } } : d));
    } catch (e) {
      setError(userMessage(e, 'The edges could not be found this time. You can save your drawing as it is.'));
    } finally {
      setBusy(false);
    }
  };
  const saveDrawing = (use: 'mine' | 'snapped') => {
    if (!card || !drawing?.loop) return;
    const snapped = use === 'snapped' ? drawing.snapped : null;
    const geometry: Geometry = snapped
      ? { path: snapped.path, box: snapped.box, anchor: snapped.anchor, area: snapped.area, kind: snapped.kind, confidence: snapped.confidence, source: 'sam' }
      : { ...drawing.loop, kind: 'mask', confidence: null, source: 'user' };
    const p: Pending = { what: 'move', ai: cap(card.asked), mine: cap(card.asked), region: { ...card.r, ...geometry }, geometry };
    // A snapped outline is named blind as it is traced: if that name agrees, it is confirmed.
    const named = snapped?.label && !/^your selection$|^background$/i.test(snapped.label) ? snapped.label : null;
    setDrawing(null);
    if (named && same(named, card.asked)) return void keep(p, 'verified');
    void check(p, [named && !same(named, card.asked) ? cap(named) : 'Something else', cap(card.asked)]);
  };

  // Keyboard: Y right, N wrong, S skip, 1 2 3 for "Which one?", Enter next.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (!card || (e.target as HTMLElement)?.tagName === 'INPUT') return;
      const k = e.key.toLowerCase();
      if (phase === 'ask' && card.type === 'check') {
        if (k === 'y') right();
        else if (k === 'n') wrong();
        else if (k === 's') skip();
      } else if (phase === 'ask' && card.type === 'which' && ['1', '2', '3'].includes(k)) pick(Number(k) - 1);
      else if (k === 'enter' && flash && !flash.auto) advance();
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  });

  // ---------------------------------------------------------------------------
  // A round in progress
  // ---------------------------------------------------------------------------
  if (deck && card && phase !== 'done') {
    const name = card.asked;
    const mult = combo >= 6 ? 3 : combo >= 3 ? 2 : 1;
    const canTrace = !!card.s.entryId && !!card.s.blob && online;
    return (
      <div className="tr-room tr-play-room">
        <div className="wrap page-pad tr-play" ref={top}>
          <div className="tp-bar">
            <button type="button" className="tp-end" onClick={() => setDeck(null)}>
              <Icon name="close" size={15} /> End round
            </button>
            <ol className="tp-letters" aria-label={`Question ${i + 1} of ${deck.length}`}>
              {ROUND_LETTERS.slice(0, deck.length)
                .split('')
                .map((l, k) => (
                  <li key={k} className={k < i ? 'done' : k === i ? 'now' : ''} aria-hidden="true">
                    {l}
                  </li>
                ))}
            </ol>
            <span className="tp-score num" aria-label={`${round.xp} points this round${mult > 1 ? `, points times ${mult} for answers in a row` : ''}`}>
              {round.xp}
              {mult > 1 && <em>×{mult}</em>}
            </span>
          </div>

          <div className="tp-card">
            <p className="tp-from">
              {card.s.title}
              {!card.s.entryId && <span> (example)</span>}
            </p>
            <h1 className="tp-q" ref={heading} tabIndex={-1}>
              {card.type === 'check' && (
                <>
                  Is this the <strong>{name}</strong>?
                </>
              )}
              {card.type === 'which' && (
                <>
                  Which one is the <strong>{name}</strong>?
                </>
              )}
              {card.type === 'find' && (
                <>
                  Tap the <strong>{name}</strong>
                </>
              )}
            </h1>

            {phase === 'draw' && drawing ? (
              <DrawView card={card} focus={drawFocus()} drawing={drawing} onLoop={onLoop} />
            ) : card.type === 'which' ? (
              <WhichView card={card} picked={picked} reveal={phase !== 'ask'} />
            ) : (
              <PartView
                card={card}
                zoom={card.type === 'check'}
                outline={card.type === 'check' ? 'ask' : phase === 'found' ? 'good' : phase === 'missed' ? 'bad' : 'none'}
                tap={tap}
                onTap={card.type === 'find' && phase === 'ask' ? onFindTap : undefined}
                busy={busy}
              />
            )}

            <div className="tp-feedback" aria-live="polite">
              {phase === 'checking' && !flash && (
                <div className="tp-flash calm tp-checking">
                  <Icon name="eye" size={18} />
                  <span className="tp-flash-text">Getting an independent second look…</span>
                </div>
              )}
              {flash && (
                <div className={`tp-flash ${flash.tone}`} key={flash.key}>
                  <Icon name={flash.tone === 'caught' ? 'star' : flash.tone === 'good' ? 'check' : 'info'} size={18} />
                  <span className="tp-flash-text">{flash.text}</span>
                  {flash.xp > 0 && <span className="tp-plus num">+{flash.xp}</span>}
                  {!flash.auto && (
                    <button type="button" className="btn btn-primary btn-sm" onClick={advance}>
                      Next question
                    </button>
                  )}
                </div>
              )}
            </div>

            {!flash && card.type === 'check' && phase === 'ask' && (
              <div className="tp-answers">
                <button type="button" className="tp-btn yes" onClick={right}>
                  <Icon name="check" /> Right <kbd>Y</kbd>
                </button>
                <button type="button" className="tp-btn no" onClick={wrong}>
                  <Icon name="close" /> Wrong <kbd>N</kbd>
                </button>
                <button type="button" className="tp-btn skip" onClick={skip}>
                  Not sure <kbd>S</kbd>
                </button>
              </div>
            )}

            {!flash && card.type === 'which' && phase === 'ask' && (
              <div className="tp-answers tp-which">
                {card.options!.map((_, k) => (
                  <button key={k} type="button" className="tp-btn num-btn" onClick={() => pick(k)} aria-label={`Number ${k + 1}`}>
                    {k + 1}
                  </button>
                ))}
                <button type="button" className="tp-btn skip" onClick={skip}>
                  Not sure
                </button>
              </div>
            )}

            {!flash && phase === 'swap' && picked !== null && card.options && (
              <div className="tp-decide">
                <p>
                  I SEE calls number {picked + 1} the <strong>{card.options[picked]!.label.toLowerCase()}</strong>, and number {card.options.findIndex((o) => o.id === card.r.id) + 1} the <strong>{name}</strong>. Who is right?
                </p>
                <div className="tp-answers two">
                  <button type="button" className="tp-btn no" onClick={swapNames}>
                    <Icon name="undo" /> Me: swap the names
                  </button>
                  <button type="button" className="tp-btn skip" onClick={() => award(5, 'missed', { text: 'Fair enough. The names stay.', tone: 'calm' })}>
                    I SEE was right
                  </button>
                </div>
              </div>
            )}

            {!flash && phase === 'dispute' && pending?.verdict && (
              <div className="tp-dispute">
                <p className="tp-dispute-head">
                  <Icon name="alert" size={18} /> A second look disagrees.
                </p>
                <p>
                  {pending.verdict.thinks === null ? (
                    <>It thinks neither name fits this outline.</>
                  ) : pending.what === 'remove' ? (
                    <>
                      It thinks this is the <strong>{pending.ai.toLowerCase()}</strong>, a real part.
                    </>
                  ) : (
                    <>
                      It thinks this is the <strong>{pending.verdict.thinks.toLowerCase()}</strong>, not the {pending.mine.toLowerCase()}.
                    </>
                  )}{' '}
                  {pending.verdict.reason && <span className="tp-reason">“{pending.verdict.reason}”</span>}
                </p>
                <p className="tp-note">You can still keep your answer: it fixes your scan, and teaches I SEE only if you make the same fix on another photo.</p>
                <div className="tp-answers three">
                  <button type="button" className="tp-btn keep" onClick={() => void keep(pending, 'disputed')}>
                    Keep my answer
                  </button>
                  <button type="button" className="tp-btn skip" onClick={() => award(5, 'missed', { text: 'Thanks for checking. Nothing changed.', tone: 'calm' })}>
                    I SEE is right
                  </button>
                  {pending.what === 'rename' && (
                    <button
                      type="button"
                      className="tp-btn skip"
                      onClick={() => {
                        setPending(null);
                        setPhase('fix');
                      }}
                    >
                      Change my answer
                    </button>
                  )}
                </div>
              </div>
            )}

            {!flash && phase === 'fix' && (
              <form
                className="tp-fix"
                onSubmit={(e) => {
                  e.preventDefault();
                  saveRename();
                }}
              >
                <label htmlFor="tp-name">What is it really?</label>
                <div className="tp-fix-row">
                  <input id="tp-name" list="tp-names" value={rename} onChange={(e) => setRename(e.target.value)} placeholder="Its name, as a reference book would give it" autoFocus autoComplete="off" maxLength={60} />
                  <datalist id="tp-names">
                    {card.s.vocab
                      .filter((v) => v.toLowerCase() !== card.r.label.toLowerCase())
                      .map((v) => (
                        <option key={v} value={v} />
                      ))}
                  </datalist>
                  <button type="submit" className="btn btn-primary" disabled={!rename.trim()}>
                    Teach this name
                  </button>
                </div>
                <div className="tp-chips">
                  {card.s.vocab
                    .filter((v) => v.toLowerCase() !== card.r.label.toLowerCase())
                    .slice(0, 8)
                    .map((v) => (
                      <button key={v} type="button" className="tp-chip" onClick={() => setRename(v)}>
                        {v}
                      </button>
                    ))}
                </div>
                <div className="tp-fix-more">
                  <button type="button" className="tp-text-btn" onClick={startDraw}>
                    <Icon name="pen" size={15} /> The name is right, the outline is not: draw it
                  </button>
                  <button type="button" className="tp-text-btn" onClick={removePart}>
                    <Icon name="trash" size={15} /> It is not a part of this {card.s.title.toLowerCase()}
                  </button>
                  <button type="button" className="tp-text-btn" onClick={skip}>
                    Skip this one
                  </button>
                </div>
                {card.s.entryId && <p className="tp-note">Your answer gets an independent second look before I SEE learns from it.</p>}
              </form>
            )}

            {!flash && phase === 'draw' && drawing && (
              <div className="tp-draw">
                <div className="tp-draw-head">
                  <p>
                    {drawing.snapped ? (
                      <>
                        The green outline follows the edges in your photo. <strong>Use it</strong>, or keep your own drawing.
                      </>
                    ) : drawing.loop ? (
                      <>
                        That is your outline of the <strong>{name}</strong>. Save it, or draw again.
                      </>
                    ) : (
                      <>
                        Draw around the <strong>{name}</strong> with your finger, pen or mouse, back to where you started.
                      </>
                    )}
                  </p>
                  <button type="button" className={`tp-zoom ${drawing.zoom ? 'on' : ''}`} onClick={() => setDrawing((d) => (d ? { ...d, zoom: !d.zoom } : d))}>
                    <Icon name={drawing.zoom ? 'image' : 'scan'} size={16} /> {drawing.zoom ? 'Whole photo' : 'Closer'}
                  </button>
                </div>
                {drawing.loop && (
                  <div className="tp-draw-actions">
                    {drawing.snapped ? (
                      <>
                        <button type="button" className="tp-btn keep" onClick={() => saveDrawing('snapped')}>
                          <Icon name="check" /> Use the green outline
                        </button>
                        <button type="button" className="tp-btn skip" onClick={() => saveDrawing('mine')}>
                          Keep my drawing
                        </button>
                      </>
                    ) : (
                      <>
                        <button type="button" className="tp-btn keep" onClick={() => saveDrawing('mine')}>
                          <Icon name="check" /> Save my outline
                        </button>
                        {canTrace && (
                          <button type="button" className="tp-btn skip" disabled={busy} onClick={() => void snapDrawing()}>
                            <Icon name="spark" /> {busy ? 'Finding the edges…' : 'Snap to the edges'}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                )}
                <div className="tp-fix-more">
                  {drawing.loop && (
                    <button type="button" className="tp-text-btn" onClick={() => setDrawing((d) => (d ? { ...d, loop: null, snapped: null } : d))}>
                      <Icon name="undo" size={15} /> Draw again
                    </button>
                  )}
                  <button
                    type="button"
                    className="tp-text-btn"
                    onClick={() => {
                      setDrawing(null);
                      setError(null);
                      setPhase(card.type === 'find' ? 'missed' : 'fix');
                    }}
                  >
                    Back
                  </button>
                </div>
                {error && <p className="notice warn">{error}</p>}
                <p className="tp-note">{card.s.entryId ? 'Your outline replaces I SEE’s in your scan, and gets an independent second look.' : 'On your own scans, your outline replaces I SEE’s.'}</p>
              </div>
            )}

            {!flash && card.type === 'find' && phase === 'ask' && <p className="tp-hint">Tap right on it. For small parts, close is close enough.</p>}

            {!flash && phase === 'missed' && !card.s.gold && (
              <div className="tp-decide">
                <p>
                  I SEE outlined it here, in amber. <strong>Who is right?</strong>
                </p>
                <div className={`tp-answers ${canTrace ? 'three' : 'two'}`}>
                  {canTrace && (
                    <button type="button" className="tp-btn no" disabled={busy} onClick={() => void fixOutline()}>
                      <Icon name="target" /> {busy ? 'Tracing the part…' : 'Me: trace where I tapped'}
                    </button>
                  )}
                  <button type="button" className={`tp-btn ${canTrace ? 'keep' : 'no'}`} disabled={busy} onClick={startDraw}>
                    <Icon name="pen" /> {canTrace ? 'Me: draw it myself' : 'Me: draw it'}
                  </button>
                  <button type="button" className="tp-btn skip" onClick={() => award(5, 'missed', { text: 'Fair enough. The outline stays.', tone: 'calm' })}>
                    I SEE was right
                  </button>
                </div>
                {canTrace && <p className="tp-note">Tracing sends this photo once more. Nothing is kept on the server.</p>}
                {error && <p className="notice warn">{error}</p>}
              </div>
            )}
            {error && phase === 'ask' && <p className="notice warn">{error}</p>}
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // End of a round
  // ---------------------------------------------------------------------------
  if (deck && phase === 'done') {
    const fresh = [...new Set(round.badges)].map((id) => BADGES.find((b) => b.id === id)).filter(Boolean);
    const now = levelOf(teach.xp);
    return (
      <div className="tr-room">
        <div className="wrap page-pad tr-summary" ref={top}>
          <div className="ts-copy">
            <h1 ref={heading} tabIndex={-1}>
              {round.caught > 0 ? `You caught ${round.caught} mistake${round.caught === 1 ? '' : 's'}.` : round.agreed > 0 ? 'I SEE passed your eye test.' : 'Round done.'}
            </h1>
            <p className="ts-lede">
              {round.levelUp !== null ? `I SEE can now read line ${now.index + 1} of the chart, ${now.acuity}, on your things.` : now.to ? `${now.to - teach.xp} points to the next line of the chart.` : 'I SEE reads the whole chart.'}
            </p>
            <dl className="ts-stats">
              <div>
                <dt>Points</dt>
                <dd className="num">+{round.xp}</dd>
              </div>
              <div>
                <dt>Mistakes caught</dt>
                <dd className="num">{round.caught}</dd>
              </div>
              <div>
                <dt>Confirmed by a second look</dt>
                <dd className="num">{round.confirmed}</dd>
              </div>
              <div>
                <dt>Check question</dt>
                <dd>{round.gold === null ? '—' : round.gold ? 'Right' : 'Missed'}</dd>
              </div>
            </dl>
            {round.fixes.length > 0 && (
              <div className="ts-fixes">
                <h2>What you fixed</h2>
                <ul>
                  {round.fixes.map((f, k) => (
                    <li key={k}>{f}</li>
                  ))}
                </ul>
              </div>
            )}
            {fresh.length > 0 && (
              <div className="ts-badges">
                <h2>New lens{fresh.length === 1 ? '' : 'es'} for your kit</h2>
                <ul className="lens-kit small">
                  {fresh.map((b) => (
                    <li key={b!.id} className="have">
                      <span className="lens">
                        <span className="num">{b!.mark}</span>
                      </span>
                      <strong>{b!.name}</strong>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="ts-actions">
              <button type="button" className="btn btn-primary btn-lg" onClick={() => start()}>
                Play another round
              </button>
              <button type="button" className="tp-text-btn light" onClick={() => setDeck(null)}>
                Back to training
              </button>
            </div>
          </div>
          <EyeChart level={now.index} focusIn={round.levelUp !== null} compact />
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // The training page
  // ---------------------------------------------------------------------------
  const parts = data?.subjects.reduce((n, s) => n + s.regions.length, 0) ?? 0;
  const contributing = settings.privacyTier === 'contributor';
  const recent = teach.log.filter((l) => FIXES.includes(l.verdict)).slice(-6).reverse();
  const statusOf = (l: (typeof recent)[number]): Taught['status'] | null => {
    const t = [...teach.taught].reverse().find((x) => x.kind === l.kind && x.from.toLowerCase() === l.part.toLowerCase() && (!l.to || x.to.toLowerCase() === l.to.toLowerCase()));
    return t ? (t.status ?? 'pending') : null;
  };
  const confirmedNames = teach.taught.filter((t) => t.status === 'verified').length;
  return (
    <div className="train">
      <section className="tr-room tr-hero">
        <div className="wrap tr-hero-inner">
          <div className="tr-copy">
            <h1>Give I SEE an eye test.</h1>
            <p className="tr-lede">It shows you what it saw on your photos. You say whether it is right, and put it right when it is not. Every fix corrects your scan straight away, and once it is confirmed, teaches I SEE for next time.</p>

            {!teach.introSeen && (
              <ol className="tr-intro" aria-label="How to play">
                <li>
                  <span>
                    <strong>Look.</strong> A part of one of your photos, outlined, with the name I SEE gave it.
                  </span>
                </li>
                <li>
                  <span>
                    <strong>Answer.</strong> Right, wrong, which one, or where it really is. Not sure is fine.
                  </span>
                </li>
                <li>
                  <span>
                    <strong>Fix.</strong> When I SEE is wrong, give the right name or tap the real part. That is a mistake caught.
                  </span>
                </li>
              </ol>
            )}

            <div className="tr-modes" role="radiogroup" aria-label="Kind of round">
              {(
                [
                  ['mixed', 'Mixed'],
                  ['check', 'Right or wrong?'],
                  ['which', 'Which one?'],
                  ['find', 'Where is it?'],
                ] as const
              ).map(([m, title]) => (
                <button key={m} type="button" role="radio" aria-checked={mode === m} className={`tr-mode ${mode === m ? 'on' : ''}`} onClick={() => setMode(m)}>
                  {title}
                </button>
              ))}
            </div>
            <div className="tr-cta">
              <button type="button" className="btn btn-primary btn-lg" disabled={!data || !parts} onClick={() => start()}>
                Start a round
              </button>
              <p className="tr-cta-note">{!data ? 'Getting your scans…' : parts ? `Ten questions, about a minute. ${parts} parts are waiting to be checked.` : 'Scan something first: there are no outlined parts to check yet.'}</p>
            </div>
            {data?.practice && (
              <p className="tr-practice">
                You are practising on the examples. <Link href="/scan">Scan your own things</Link> to teach I SEE about them.
              </p>
            )}
          </div>

          <div className="tr-chart">
            <EyeChart level={level.index} />
            <p className="tr-chart-caption">
              <span className="sr-only">Level {level.index + 1}: </span>I SEE reads line {level.index + 1}, <span className="num">{level.acuity}</span>
              {level.to ? (
                <>
                  . <span className="num">{level.to - teach.xp}</span> points to the next line.
                </>
              ) : (
                '. That is the whole chart.'
              )}
            </p>
          </div>
        </div>
      </section>

      {/* Helping Meta's models: the one thing a person can switch on to make their scans count. */}
      <section className={`tr-meta ${contributing ? 'on' : ''}`} aria-labelledby="tr-meta-h">
        <div className="wrap tr-meta-inner">
          <div className="tr-meta-copy">
            <h2 id="tr-meta-h">Help improve Meta’s models</h2>
            <p className="tr-meta-lede">Your game answers stay on this device. What Meta can learn from is your scans: switch this on, and your next scans are analysed by the contributor version of Meta’s AI, which Meta uses to improve its models.</p>
            <div className="tr-meta-lists">
              <div>
                <h3>Used to improve Meta’s models, when on</h3>
                <ul>
                  <li>The photos you scan, as Meta’s AI analyses them</li>
                  <li>Your questions about them</li>
                  <li>The confirmed names you have taught, which go with your scans</li>
                </ul>
              </div>
              <div>
                <h3>Not affected by this switch</h3>
                <ul>
                  <li>Your answers in this game and your Passport, which stay on this device</li>
                  <li>Outlining, drawing and voice, which have no contributor version</li>
                </ul>
              </div>
            </div>
          </div>

          <div className="tr-meta-card">
            <div className="tr-switch-row">
              <span id="tr-switch-l" className="tr-switch-label">
                Use my scans to improve Meta’s models
              </span>
              <button
                type="button"
                ref={switchRef}
                role="switch"
                aria-checked={contributing}
                aria-labelledby="tr-switch-l"
                className={`tr-switch ${contributing ? 'on' : ''}`}
                onClick={() => {
                  if (contributing) settings.set({ privacyTier: 'private' });
                  else setConfirmOn(true);
                }}
              >
                <span />
              </button>
            </div>
            {contributing ? (
              <p className="tr-meta-state on">
                <Icon name="check" size={16} /> On. Every scan you make from now on helps improve Meta’s models. You can switch it off at any time.
              </p>
            ) : confirmOn ? (
              <div className="tr-meta-confirm">
                <p>Your future photos and questions may then be used by Meta to improve its AI. You can switch this off here or in Settings at any time.</p>
                <div>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => {
                      settings.set({ privacyTier: 'contributor' });
                      setConfirmOn(false);
                      switchRef.current?.focus();
                    }}
                  >
                    Switch on
                  </button>{' '}
                  <button type="button" className="tp-text-btn" onClick={() => setConfirmOn(false)}>
                    Not now
                  </button>
                </div>
              </div>
            ) : (
              <p className="tr-meta-state">Off. Your scans use the standard version of Meta’s AI.</p>
            )}
          </div>
        </div>
      </section>

      <div className="wrap page-pad tr-body">
        <section className="tr-today" aria-label="Your training">
          <div className="tr-goal">
            <span className="tr-goal-letters" aria-hidden="true">
              {'EFPTOZLPED'.split('').map((l, k) => (
                <span key={k} className={k < today ? 'on' : ''}>
                  {l}
                </span>
              ))}
            </span>
            <span>
              <strong className="num">{Math.min(today, DAILY_GOAL)}</strong> of {DAILY_GOAL} answers today · <strong className="num">{teach.streak.days}</strong> day{teach.streak.days === 1 ? '' : 's'} in a row
            </span>
          </div>
          <dl className="tr-facts">
            <div className="lead">
              <dt>Mistakes you caught</dt>
              <dd className="num">{teach.caught}</dd>
            </div>
            <div>
              <dt>Names confirmed by a second look</dt>
              <dd className="num">{confirmedNames}</dd>
            </div>
            <div>
              <dt>Check questions right</dt>
              <dd className="num">
                {teach.goldRight}
                <small>/{teach.goldSeen}</small>
              </dd>
            </div>
            <div>
              <dt>Parts confirmed</dt>
              <dd className="num">{teach.agreed}</dd>
            </div>
          </dl>
        </section>

        {recent.length > 0 && (
          <section className="tr-section" aria-labelledby="tr-recent-h">
            <h2 id="tr-recent-h">Your latest fixes</h2>
            <ul className="tr-recent">
              {recent.map((l) => {
                const st = l.verdict === 'renamed' || l.verdict === 'swapped' ? statusOf(l) : null;
                return (
                  <li key={l.at}>
                    <span className="tr-recent-obj">{l.object}</span>
                    <span className="tr-recent-change">
                      {l.verdict === 'removed' ? (
                        <>removed “{l.part}”, which was not a part</>
                      ) : l.verdict === 'moved' ? (
                        <>re-traced the {l.part.toLowerCase()}</>
                      ) : l.verdict === 'swapped' ? (
                        <>
                          swapped {l.part.toLowerCase()} and {l.to?.toLowerCase()}
                        </>
                      ) : (
                        <>
                          {l.part} <Icon name="arrowRight" size={13} /> <strong>{l.to}</strong>
                        </>
                      )}
                    </span>
                    {st && (
                      <span className={`tr-status ${st}`}>
                        <Icon name={STATUS[st].icon} size={14} /> {STATUS[st].label}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <section className="tr-section" aria-labelledby="tr-checked-h">
          <h2 id="tr-checked-h">How your answers are checked</h2>
          <p className="tr-section-lede">Anyone can be wrong, you and I SEE included. This is how large labelling projects keep volunteers’ answers accurate, and it is how I SEE decides what to learn.</p>
          <ol className="tr-steps">
            <li>
              <h3>Your fix goes into your scan</h3>
              <p>It is your scan, so your answer corrects it straight away.</p>
            </li>
            <li>
              <h3>An independent second look</h3>
              <p>Meta’s AI looks at the part again, shown both names in a random order without knowing whose is whose, and picks the one that fits. If it disagrees, you see why and decide.</p>
            </li>
            <li>
              <h3>A check question each round</h3>
              <p>
                One question comes from an example whose answer is known. Your score shows how far your answers can be trusted: <strong className="num">{teach.goldSeen ? `${Math.round(trust * 100)}%` : 'not measured yet'}</strong>.
              </p>
            </li>
            <li>
              <h3>Only then does I SEE learn</h3>
              <p>A name you taught goes with your next scans when the second look agreed, or when you made the same fix on two photos and do well on check questions.</p>
            </li>
          </ol>
        </section>

        <section className="tr-section" aria-labelledby="tr-kit-h">
          <h2 id="tr-kit-h">Your lens kit</h2>
          <p className="tr-section-lede">
            One lens for each milestone. {teach.badges.filter((b) => BADGES.some((x) => x.id === b)).length} of {BADGES.length} collected.
          </p>
          <ul className="lens-kit">
            {BADGES.map((b) => {
              const have = teach.badges.includes(b.id);
              return (
                <li key={b.id} className={have ? 'have' : ''}>
                  <span className="lens" aria-hidden="true">
                    <span className="num">{have ? b.mark : ''}</span>
                  </span>
                  <strong>
                    {b.name}
                    <span className="sr-only">{have ? ', collected' : ', not yet'}</span>
                  </strong>
                  <span>{b.how}</span>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </div>
  );
}
