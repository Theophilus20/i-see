import { create } from 'zustand';
import type { Route } from '@shared/schema';

export interface Settings {
  route: Route;
  depth: 'quick' | 'deep';
  language: string;
  privacyTier: 'private' | 'contributor';
  theme: 'system' | 'light' | 'dark';
  textSize: 'normal' | 'large';
  contrast: 'normal' | 'bold';
  motion: 'system' | 'reduce';
  /** Read answers aloud with the device's speech voice. */
  readAloud: boolean;
  /** The person has seen and accepted what a live scan sends, for this device. */
  consentAt: string | null;
  /** Show the interface itself in the chosen language (translated by Muse Spark, kept on this device). */
  translateUi: boolean;
  /** The camera names what it sees while open (sends a small frame every few seconds). */
  liveRecognition: boolean;
  /** Start the scan by itself when the camera has locked on. */
  autoScan: boolean;
}

const DEFAULTS: Settings = {
  route: 'hosted',
  depth: 'deep',
  language: 'en',
  privacyTier: 'private',
  theme: 'system',
  textSize: 'normal',
  contrast: 'normal',
  motion: 'system',
  readAloud: false,
  consentAt: null,
  translateUi: true,
  liveRecognition: true,
  autoScan: true,
};

const KEY = 'isee.settings.v1';

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return DEFAULTS;
  }
}

function save(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode or blocked storage: settings last for this visit only */
  }
}

export function applyToDocument(s: Settings) {
  const el = document.documentElement;
  if (s.theme === 'system') el.removeAttribute('data-theme');
  else el.setAttribute('data-theme', s.theme);
  el.setAttribute('data-type', s.textSize);
  el.setAttribute('data-contrast', s.contrast);
  if (s.motion === 'reduce') el.setAttribute('data-motion', 'reduce');
  else el.removeAttribute('data-motion');
}

interface SettingsStore extends Settings {
  set: (patch: Partial<Settings>) => void;
  reset: () => void;
}

export const useSettings = create<SettingsStore>((set, get) => ({
  ...load(),
  set: (patch) => {
    set(patch);
    const { set: _s, reset: _r, ...rest } = get();
    save(rest);
    applyToDocument(rest);
  },
  reset: () => {
    set(DEFAULTS);
    save(DEFAULTS);
    applyToDocument(DEFAULTS);
  },
}));

export function prefersReducedMotion(): boolean {
  const s = useSettings.getState();
  if (s.motion === 'reduce') return true;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export const ROUTE_INFO: Record<Route, { label: string; short: string; detail: string }> = {
  hosted: {
    label: 'Standard',
    short: 'Standard',
    detail: 'The full analysis: every part outlined, sources found and checked, doubts weighed. Photos are processed securely and not stored.',
  },
  private: {
    label: 'Private',
    short: 'Private',
    detail: 'Runs on a separate private server. Parts are marked with approximate pins instead of exact outlines.',
  },
  consensus: {
    label: 'Second opinion',
    short: 'Second opinion',
    detail: 'The standard analysis plus an independent second look. Where the two disagree, you will see it.',
  },
  'local-first': {
    label: 'On my own computer',
    short: 'On my computer',
    detail: 'A first look runs on your own machine. If it is unsure, I SEE asks before sending anything further.',
  },
};

/** Languages offered. Profiles, answers and (when switched on) the interface use it. */
export const LANGUAGES: Array<[string, string, string]> = [
  ['en', 'English', 'English'],
  ['fr', 'Français', 'French'],
  ['es', 'Español', 'Spanish'],
  ['pt', 'Português', 'Portuguese'],
  ['de', 'Deutsch', 'German'],
  ['it', 'Italiano', 'Italian'],
  ['nl', 'Nederlands', 'Dutch'],
  ['pl', 'Polski', 'Polish'],
  ['tr', 'Türkçe', 'Turkish'],
  ['ru', 'Русский', 'Russian'],
  ['uk', 'Українська', 'Ukrainian'],
  ['ar', 'العربية', 'Arabic'],
  ['fa', 'فارسی', 'Persian'],
  ['ur', 'اردو', 'Urdu'],
  ['hi', 'हिन्दी', 'Hindi'],
  ['bn', 'বাংলা', 'Bengali'],
  ['id', 'Bahasa Indonesia', 'Indonesian'],
  ['vi', 'Tiếng Việt', 'Vietnamese'],
  ['th', 'ไทย', 'Thai'],
  ['tl', 'Tagalog', 'Tagalog'],
  ['zh', '中文', 'Chinese'],
  ['ja', '日本語', 'Japanese'],
  ['ko', '한국어', 'Korean'],
  ['sw', 'Kiswahili', 'Swahili'],
  ['am', 'አማርኛ', 'Amharic'],
  ['yo', 'Yorùbá', 'Yoruba'],
  ['ha', 'Hausa', 'Hausa'],
  ['ig', 'Igbo', 'Igbo'],
  ['zu', 'isiZulu', 'Zulu'],
];
