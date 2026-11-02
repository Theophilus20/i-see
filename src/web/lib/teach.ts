/**
 * Training I SEE: points, levels, streaks and badges for the Train game, and what this person
 * has taught (corrected part names), all kept in this browser only.
 *
 * What training really does, as the page says:
 *   1. Each answer fixes that part in the person's own Passport, straight away.
 *   2. Each correction gets an independent second look; with check questions (known answers),
 *      that decides which corrected names are trusted. Only trusted names are sent with later
 *      scans as hints, for the same kind of object (see `taught` on the scan request).
 *   3. Meta's models themselves only learn from scans if the person opts in to the contributor
 *      setting (Meta's contributor models are used to improve its products). The answers given
 *      in the game stay on this device.
 */
import { create } from 'zustand';

export type Verdict = 'right' | 'renamed' | 'removed' | 'moved' | 'swapped' | 'found' | 'missed' | 'disputed' | 'skipped';

export interface TeachLog {
  at: string;
  kind: string;
  object: string;
  part: string;
  verdict: Verdict;
  to?: string;
  /** The part's box in the photo (pixels): x, y, width, height. */
  box?: [number, number, number, number];
  photo?: string;
}

export interface TeachData {
  xp: number;
  rounds: number;
  answers: number;
  /** I SEE had it right. */
  agreed: number;
  /** Parts corrected (renamed, removed, re-outlined or swapped). */
  fixed: number;
  /** Mistakes caught: answers where I SEE was wrong and the person put it right. */
  caught: number;
  /** "Which one?" questions answered the way I SEE had it. */
  whichRight: number;
  /** "How to play" has been read. */
  introSeen: boolean;
  bestCombo: number;
  streak: { days: number; last: string | null };
  today: { day: string; count: number };
  badges: string[];
  taught: Taught[];
  /** Check questions (built-in examples whose answers are known): how many seen, how many right. */
  goldSeen: number;
  goldRight: number;
  /** Parts already reviewed (entry:region), so new rounds show new ones first. */
  reviewed: string[];
  log: TeachLog[];
}

/**
 * A correction the person made, and how far it has been checked:
 *   - verified: an independent second look agreed with them;
 *   - disputed: the second look disagreed, and they kept their answer;
 *   - pending: not checked yet (offline, or a practice example).
 * Only trusted corrections are used to teach I SEE (see taughtForScan).
 */
export interface Taught {
  kind: string;
  from: string;
  to: string;
  at: string;
  status: 'verified' | 'pending' | 'disputed';
  entryId?: string | null;
  regionId?: string | null;
}

export const DAILY_GOAL = 10;

/** How far this person's answers can be trusted, from the check questions (a smoothed rate). */
export function trustOf(d: { goldSeen: number; goldRight: number }): number {
  return (d.goldRight + 1) / (d.goldSeen + 2);
}

/**
 * Levels are the lines of an eye chart: each one I SEE can read, on your things, is sharper
 * than the last (20/200 at the top, 20/15 at the bottom).
 */
export const LEVELS: Array<{ at: number; name: string; acuity: string; letters: string }> = [
  { at: 0, name: 'Curious eye', acuity: '20/200', letters: 'E' },
  { at: 100, name: 'Keen eye', acuity: '20/100', letters: 'FP' },
  { at: 250, name: 'Sharp eye', acuity: '20/70', letters: 'TOZ' },
  { at: 500, name: 'Eagle eye', acuity: '20/50', letters: 'LPED' },
  { at: 900, name: 'Hawk eye', acuity: '20/40', letters: 'PECFD' },
  { at: 1500, name: 'Master curator', acuity: '20/30', letters: 'EDFCZP' },
  { at: 2400, name: 'Legend of I SEE', acuity: '20/20', letters: 'FELOPZD' },
  { at: 3600, name: 'Oracle', acuity: '20/15', letters: 'DEFPOTEC' },
];

export function levelOf(xp: number): { index: number; name: string; acuity: string; from: number; to: number | null; progress: number } {
  let i = 0;
  while (i + 1 < LEVELS.length && xp >= LEVELS[i + 1]!.at) i++;
  const from = LEVELS[i]!.at;
  const to = LEVELS[i + 1]?.at ?? null;
  return { index: i, name: LEVELS[i]!.name, acuity: LEVELS[i]!.acuity, from, to, progress: to ? (xp - from) / (to - from) : 1 };
}

/** Badges, shown as lenses from an optician's trial-lens kit. */
export const BADGES: Array<{ id: string; name: string; how: string; mark: string }> = [
  { id: 'first', name: 'First look', how: 'Answer your first question.', mark: '+0.25' },
  { id: 'catch1', name: 'First catch', how: 'Catch a mistake I SEE made, and put it right.', mark: '+0.50' },
  { id: 'hunter', name: 'Mistake hunter', how: 'Catch ten mistakes.', mark: '+1.00' },
  { id: 'teacher', name: 'Teacher', how: 'Teach I SEE five names that a second look confirms.', mark: '+1.50' },
  { id: 'trusted', name: 'Trusted eye', how: 'Get five check questions right.', mark: '+1.75' },
  { id: 'sharp', name: 'Steady hand', how: 'Fix an outline by tapping or drawing the real part.', mark: '+2.00' },
  { id: 'sharpeyed', name: 'Sharp-eyed', how: 'Answer five “Which one?” questions right.', mark: '+2.50' },
  { id: 'onfire', name: 'In focus', how: 'Five answers in a row without a skip.', mark: '+3.00' },
  { id: 'streak3', name: 'Three days running', how: 'Train on three days in a row.', mark: '+3.50' },
  { id: 'century', name: 'Century', how: 'Answer 100 questions.', mark: '+4.00' },
];

const KEY = 'isee.train.v1';
const today = () => new Date().toISOString().slice(0, 10);
const EMPTY: TeachData = { xp: 0, rounds: 0, answers: 0, agreed: 0, fixed: 0, caught: 0, whichRight: 0, introSeen: false, goldSeen: 0, goldRight: 0, bestCombo: 0, streak: { days: 0, last: null }, today: { day: today(), count: 0 }, badges: [], taught: [], reviewed: [], log: [] };

function load(): TeachData {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as Partial<TeachData>) } : EMPTY;
  } catch {
    return EMPTY;
  }
}
function save(d: TeachData) {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    /* storage blocked: progress lasts for this visit */
  }
}

const dayBefore = (d: string) => {
  const t = new Date(`${d}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() - 1);
  return t.toISOString().slice(0, 10);
};

interface TeachStore extends TeachData {
  /** Records one answer; returns the badges it unlocked. */
  answer: (a: { xp: number; verdict: Verdict; combo: number; key: string | null; which?: boolean; log: Omit<TeachLog, 'at' | 'verdict'> }) => string[];
  seeIntro: () => void;
  /** Remembers a corrected name for this kind of object, with how far it has been checked. */
  teach: (kind: string, from: string, to: string, status: Taught['status'], ref?: { entryId: string | null; regionId: string | null }) => string[];
  /** A later second look settled a correction. */
  settle: (at: string, status: Taught['status']) => string[];
  /** A check question was answered. */
  gold: (right: boolean) => string[];
  /** A finished round; returns the badges it unlocked. */
  finishRound: (skips: number) => string[];
  reset: () => void;
}

export const useTeach = create<TeachStore>((set, get) => {
  const commit = (patch: Partial<TeachData>) => {
    set(patch);
    const { answer: _a, teach: _t, finishRound: _f, reset: _r, seeIntro: _i, settle: _s, gold: _g, ...data } = { ...get() };
    save(data);
  };
  const unlock = (ids: string[]) => {
    const have = new Set(get().badges);
    const fresh = ids.filter((id) => !have.has(id));
    if (fresh.length) commit({ badges: [...get().badges, ...fresh] });
    return fresh;
  };
  return {
    ...load(),
    seeIntro: () => commit({ introSeen: true }),
    answer: ({ xp, verdict, combo, key, which, log }) => {
      const s = get();
      const d = today();
      const count = s.today.day === d ? s.today.count + 1 : 1;
      const streak = s.streak.last === d ? s.streak : { days: s.streak.last === dayBefore(d) ? s.streak.days + 1 : 1, last: d };
      const fixedNow = verdict === 'renamed' || verdict === 'removed' || verdict === 'moved' || verdict === 'swapped';
      commit({
        xp: s.xp + xp,
        answers: s.answers + (verdict === 'skipped' ? 0 : 1),
        agreed: s.agreed + (verdict === 'right' || verdict === 'found' ? 1 : 0),
        fixed: s.fixed + (fixedNow ? 1 : 0),
        caught: s.caught + (fixedNow ? 1 : 0),
        whichRight: s.whichRight + (which && verdict === 'found' ? 1 : 0),
        bestCombo: Math.max(s.bestCombo, combo),
        today: { day: d, count: count },
        streak,
        reviewed: key ? [...s.reviewed.filter((k) => k !== key), key].slice(-2000) : s.reviewed,
        log: [...s.log, { ...log, at: new Date().toISOString(), verdict }].slice(-1000),
      });
      const g = get();
      return unlock([
        ...(g.answers >= 1 ? ['first'] : []),
        ...(fixedNow ? ['catch1'] : []),
        ...(g.caught >= 10 ? ['hunter'] : []),
        ...(g.whichRight >= 5 ? ['sharpeyed'] : []),
        ...(verdict === 'moved' ? ['sharp'] : []),
        ...(combo >= 5 ? ['onfire'] : []),
        ...(g.streak.days >= 3 ? ['streak3'] : []),
        ...(g.answers >= 100 ? ['century'] : []),
      ]);
    },
    teach: (kind, from, to, status, ref) => {
      const s = get();
      const same = (t: Taught) => t.kind === kind && t.from.toLowerCase() === from.toLowerCase() && (t.entryId ?? null) === (ref?.entryId ?? null) && (t.regionId ?? null) === (ref?.regionId ?? null);
      const entry: Taught = { kind, from, to, at: new Date().toISOString(), status, entryId: ref?.entryId ?? null, regionId: ref?.regionId ?? null };
      commit({ taught: [...s.taught.filter((t) => !same(t)), entry].slice(-300) });
      return unlock(get().taught.filter((t) => t.status === 'verified').length >= 5 ? ['teacher'] : []);
    },
    settle: (at, status) => {
      commit({ taught: get().taught.map((t) => (t.at === at ? { ...t, status } : t)) });
      return unlock(get().taught.filter((t) => t.status === 'verified').length >= 5 ? ['teacher'] : []);
    },
    gold: (right) => {
      const s = get();
      commit({ goldSeen: s.goldSeen + 1, goldRight: s.goldRight + (right ? 1 : 0) });
      return unlock(get().goldRight >= 5 ? ['trusted'] : []);
    },
    finishRound: (_skips) => {
      commit({ rounds: get().rounds + 1 });
      return [];
    },
    reset: () => commit({ ...EMPTY, introSeen: true, today: { day: today(), count: 0 } }),
  };
});

/**
 * The names taught, as sent with a scan. A correction teaches I SEE only when it can be trusted,
 * as in crowdsourced labelling, where one person's answer is never taken alone:
 *   - an independent second look agreed with it; or
 *   - the person made the same correction on two or more different photos, and they do well on
 *     the check questions (agreement across answers, weighted by a known accuracy).
 * Everything else still fixes the person's own scan, but does not change what I SEE does next.
 */
export function taughtForScan(d: Pick<TeachData, 'taught' | 'goldSeen' | 'goldRight'> = useTeach.getState()): Array<{ kind: string; from: string; to: string }> {
  const trusted = trustOf(d) >= 0.7;
  const groups = new Map<string, Taught[]>();
  for (const t of d.taught) {
    const k = `${t.kind}|${t.from.toLowerCase()}|${t.to.toLowerCase()}`;
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  const out: Array<{ kind: string; from: string; to: string }> = [];
  for (const g of groups.values()) {
    const photos = new Set(g.map((t) => t.entryId ?? t.at)).size;
    if (g.some((t) => t.status === 'verified') || (trusted && photos >= 2)) out.push({ kind: g[0]!.kind, from: g[0]!.from, to: g[0]!.to });
  }
  return out.slice(-60);
}
