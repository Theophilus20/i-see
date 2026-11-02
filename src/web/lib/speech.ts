/**
 * Reading aloud with the device's own voices, in the chosen language.
 * (The Meta Model API offers speech-to-text, Muse Voice Transcribe; speaking back uses the
 * voices built into the browser, so nothing more is sent anywhere.)
 */

function voices(): SpeechSynthesisVoice[] {
  try {
    return window.speechSynthesis?.getVoices() ?? [];
  } catch {
    return [];
  }
}

/** The best installed voice for a language, or null if the device has none. */
export function voiceFor(language: string): SpeechSynthesisVoice | null {
  const lang = language.toLowerCase();
  const base = lang.split('-')[0]!;
  const all = voices();
  return all.find((v) => v.lang.toLowerCase() === lang) ?? all.find((v) => v.lang.toLowerCase().startsWith(`${base}-`) || v.lang.toLowerCase() === base) ?? null;
}

export function canSpeak(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

export function speak(text: string, language = 'en'): boolean {
  if (!canSpeak() || !text.trim()) return false;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = language;
    const v = voiceFor(language);
    if (v) u.voice = v;
    u.rate = 1;
    window.speechSynthesis.speak(u);
    return true;
  } catch {
    return false;
  }
}

export function stopSpeaking() {
  try {
    window.speechSynthesis?.cancel();
  } catch {
    /* nothing to stop */
  }
}

/** Voices load asynchronously in some browsers; resolves once they are known. */
export function voicesReady(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((res) => {
    const now = voices();
    if (now.length || !canSpeak()) return res(now);
    const done = () => res(voices());
    window.speechSynthesis.addEventListener?.('voiceschanged', done, { once: true });
    setTimeout(done, 1500);
  });
}
