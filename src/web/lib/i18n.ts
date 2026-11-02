/**
 * The interface in the person's language.
 *
 * Interface text is written in English. When another language is chosen, the visible text
 * on the page is translated by Muse Spark through the I SEE server, in small batches, and
 * kept in this browser so each phrase is translated once. It works on whatever is on
 * screen (including text that appears later), so every page is covered without a
 * hand-made translation file per language. Text inside an element marked
 * translate="no" (the brand, numbers, code) is left alone.
 */
import { translateTexts } from './api';

const RTL = new Set(['ar', 'fa', 'ur', 'he', 'ps']);
const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'CODE', 'PRE', 'TEXTAREA', 'INPUT', 'SVG', 'CANVAS']);
const ATTRS = ['placeholder', 'aria-label', 'title'] as const;
const BATCH = 60;

type Cache = Record<string, string>;

let language = 'en';
let enabled = false;
let online = false;
let cache: Cache = {};
const originals = new WeakMap<Text, string>();
const attrOriginals = new WeakMap<Element, Record<string, string>>();
const pending = new Set<string>();
const inflight = new Set<string>();
let timer = 0;
let observer: MutationObserver | null = null;
let writing = false;
let failures = 0;
const listeners = new Set<(s: { busy: boolean; error: string | null }) => void>();

const key = (lang: string) => `isee.i18n.${lang}`;
function loadCache(lang: string): Cache {
  try {
    return JSON.parse(localStorage.getItem(key(lang)) ?? '{}') as Cache;
  } catch {
    return {};
  }
}
function saveCache() {
  try {
    localStorage.setItem(key(language), JSON.stringify(cache));
  } catch {
    /* storage full: translations last for this visit */
  }
}
function notify(error: string | null = null) {
  for (const l of listeners) l({ busy: pending.size + inflight.size > 0, error });
}
export function onTranslationState(fn: (s: { busy: boolean; error: string | null }) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Worth translating: has letters, not just numbers, symbols or a single brand word. */
const translatable = (t: string) => t.length > 1 && t.length <= 400 && /\p{L}{2,}/u.test(t) && t !== 'I SEE';

function skipped(el: Element | null): boolean {
  for (let e = el; e; e = e.parentElement) {
    if (SKIP.has(e.tagName)) return true;
    if (e.getAttribute('translate') === 'no' || e.classList.contains('notranslate')) return true;
  }
  return false;
}

function applyText(node: Text) {
  const original = originals.get(node) ?? node.nodeValue ?? '';
  const trimmed = original.trim();
  if (!translatable(trimmed)) return;
  if (!originals.has(node)) originals.set(node, original);
  const t = enabled ? cache[trimmed] : undefined;
  if (t === undefined) {
    if (enabled && !inflight.has(trimmed)) pending.add(trimmed);
    return;
  }
  const lead = original.match(/^\s*/)![0];
  const tail = original.match(/\s*$/)![0];
  const next = `${lead}${t}${tail}`;
  if (node.nodeValue !== next) node.nodeValue = next;
}

function applyAttrs(el: Element) {
  for (const a of ATTRS) {
    const v = el.getAttribute(a);
    if (v == null) continue;
    const saved = attrOriginals.get(el) ?? {};
    const original = saved[a] ?? v;
    const trimmed = original.trim();
    if (!translatable(trimmed)) continue;
    saved[a] = original;
    attrOriginals.set(el, saved);
    const t = enabled ? cache[trimmed] : undefined;
    if (t === undefined) {
      if (enabled && !inflight.has(trimmed)) pending.add(trimmed);
      continue;
    }
    if (v !== t) el.setAttribute(a, t);
  }
}

function walk(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) {
    if (!skipped((root as Text).parentElement)) applyText(root as Text);
    return;
  }
  if (!(root instanceof Element) || skipped(root)) return;
  applyAttrs(root);
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: (n) => (n instanceof Element && skipped(n) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) applyText(n as Text);
    else applyAttrs(n as Element);
  }
}

/** Our own edits also reach the observer; drop them so they are not mistaken for new text. */
const forgetOwnEdits = () => void observer?.takeRecords();

function writeAll() {
  writing = true;
  try {
    walk(document.body);
  } finally {
    forgetOwnEdits();
    writing = false;
  }
  schedule();
}

function schedule() {
  if (!enabled || !online || !pending.size || timer) return;
  timer = window.setTimeout(flush, 250);
}

async function flush() {
  timer = 0;
  if (!enabled || !online) return;
  const lang = language;
  const batch = [...pending].slice(0, BATCH);
  batch.forEach((t) => {
    pending.delete(t);
    inflight.add(t);
  });
  notify();
  try {
    const r = await translateTexts(batch, lang);
    if (lang !== language) return;
    batch.forEach((t, i) => {
      const out = r.translations[i];
      if (typeof out === 'string' && out.trim()) cache[t] = out.trim();
    });
    saveCache();
    failures = 0;
    notify();
  } catch (e) {
    failures++;
    notify(e instanceof Error ? e.message : 'Translation failed.');
    // Back off; leave the English text in place.
    if (failures < 4) batch.forEach((t) => pending.add(t));
  } finally {
    batch.forEach((t) => inflight.delete(t));
  }
  writeAll();
  if (pending.size && failures < 4) {
    window.clearTimeout(timer);
    timer = window.setTimeout(flush, failures ? 4000 * failures : 50);
  }
}

function restoreAll() {
  writing = true;
  try {
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if (n.nodeType === Node.TEXT_NODE) {
        const o = originals.get(n as Text);
        if (o !== undefined && n.nodeValue !== o) n.nodeValue = o;
      } else {
        const saved = attrOriginals.get(n as Element);
        if (saved) for (const [a, v] of Object.entries(saved)) (n as Element).setAttribute(a, v);
      }
    }
  } finally {
    forgetOwnEdits();
    writing = false;
  }
}

/** Turn interface translation on or off, for a language. `isOnline`: whether new phrases can be fetched. */
export function setInterfaceLanguage(lang: string, on: boolean, isOnline: boolean) {
  const base = lang.split('-')[0]!.toLowerCase();
  document.documentElement.lang = lang;
  document.documentElement.dir = on && RTL.has(base) ? 'rtl' : 'ltr';
  online = isOnline;
  const want = on && base !== 'en';
  if (lang !== language) {
    language = lang;
    cache = loadCache(lang);
    pending.clear();
    failures = 0;
  }
  if (!want) {
    enabled = false;
    observer?.disconnect();
    observer = null;
    restoreAll();
    notify();
    return;
  }
  enabled = true;
  if (!observer) {
    observer = new MutationObserver((records) => {
      if (writing) return;
      writing = true;
      try {
        for (const r of records) {
          if (r.type === 'characterData') {
            const n = r.target as Text;
            // React wrote new text into a node we translated: that is the new original.
            originals.set(n, n.nodeValue ?? '');
            if (!skipped(n.parentElement)) applyText(n);
          } else if (r.type === 'attributes' && r.target instanceof Element && ATTRS.includes(r.attributeName as (typeof ATTRS)[number])) {
            const saved = attrOriginals.get(r.target) ?? {};
            saved[r.attributeName!] = r.target.getAttribute(r.attributeName!) ?? '';
            attrOriginals.set(r.target, saved);
            applyAttrs(r.target);
          } else r.addedNodes.forEach((n) => walk(n));
        }
      } finally {
        forgetOwnEdits();
        writing = false;
      }
      schedule();
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRS] });
  }
  writeAll();
}

/** How many phrases are already translated for a language on this device. */
export function cachedCount(lang: string): number {
  return Object.keys(loadCache(lang)).length;
}

export function clearTranslations(lang: string) {
  try {
    localStorage.removeItem(key(lang));
  } catch {
    /* nothing stored */
  }
  if (lang === language) cache = {};
}
