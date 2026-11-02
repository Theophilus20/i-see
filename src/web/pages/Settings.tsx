import { useEffect, useState } from 'react';
import { ROUTES } from '@shared/schema';
import { useSettings, ROUTE_INFO, LANGUAGES, type Settings } from '../lib/settings';
import { deleteAll } from '../lib/passport';
import { useHealth } from '../lib/health';
import { cachedCount, clearTranslations, onTranslationState } from '../lib/i18n';
import { canSpeak, speak, voiceFor, voicesReady } from '../lib/speech';
import { ConfirmButton } from '../components/ConfirmButton';
import { Icon } from '../components/Icon';

const SAMPLE_SENTENCE: Record<string, string> = {
  en: 'This is how I SEE reads answers aloud.',
  fr: 'Voici comment I SEE lit les réponses à voix haute.',
  es: 'Así es como I SEE lee las respuestas en voz alta.',
  pt: 'É assim que o I SEE lê as respostas em voz alta.',
  de: 'So liest I SEE Antworten vor.',
  it: 'Ecco come I SEE legge ad alta voce le risposte.',
};

function Seg<K extends keyof Settings>({ k, options, label }: { k: K; options: Array<[Settings[K], string]>; label: string }) {
  const s = useSettings();
  return (
    <div className="setting">
      <span className="setting-label">{label}</span>
      <div className={`segmented ${options.some(([, t]) => t.length > 14) ? 'seg-long' : ''}`} role="group" aria-label={label}>
        {options.map(([v, t]) => (
          <button key={String(v)} type="button" aria-pressed={s[k] === v} onClick={() => s.set({ [k]: v } as Partial<Settings>)}>
            {t}
          </button>
        ))}
      </div>
    </div>
  );
}

const OnOff = <K extends keyof Settings>({ k, label }: { k: K; label: string }) => <Seg k={k} label={label} options={[[false as Settings[K], 'Off'], [true as Settings[K], 'On']]} />;

export function SettingsPage() {
  const s = useSettings();
  const health = useHealth();
  const online = health.state === 'live';
  const [translating, setTranslating] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  const [voiceOk, setVoiceOk] = useState<boolean | null>(null);
  const [, refresh] = useState(0);
  const langName = LANGUAGES.find(([c]) => c === s.language)?.[2] ?? s.language;
  const routeOk = (r: Settings['route']) => !health.info || health.info.routes[r];
  const voiceInput = !!health.info?.features.voice;

  useEffect(() => {
    const off = onTranslationState(setTranslating);
    return () => {
      off();
    };
  }, []);
  useEffect(() => {
    let alive = true;
    void voicesReady().then(() => alive && setVoiceOk(!!voiceFor(s.language)));
    return () => {
      alive = false;
    };
  }, [s.language]);

  return (
    <div className="wrap page-pad settings">
      <header className="page-head">
        <div>
          <p className="eyebrow">Settings</p>
          <h1>Your choices, kept on this device.</h1>
        </div>
      </header>

      <section className="settings-group" aria-labelledby="lang-h">
        <h2 id="lang-h">Language</h2>
        <label className="setting">
          <span className="setting-label">Language</span>
          <select className="select" value={s.language} onChange={(e) => s.set({ language: e.target.value })} translate="no">
            {LANGUAGES.map(([v, native, english]) => (
              <option key={v} value={v}>
                {native === english ? native : `${native} · ${english}`}
              </option>
            ))}
          </select>
        </label>
        <p className="setting-help">Profiles, answers and the inside view are written in this language by the AI. Scan again to get an older profile in a new language.</p>
        {s.language !== 'en' && (
          <>
            <OnOff k="translateUi" label="Translate the interface too" />
            <p className="setting-help">
              {s.translateUi
                ? online
                  ? translating.busy
                    ? `Translating the screens into ${langName}…`
                    : translating.error
                      ? 'Some text could not be translated just now; it stays in English and will be tried again.'
                      : `Menus and buttons are translated into ${langName} as you use them, and remembered on this device (${cachedCount(s.language)} phrases so far).`
                  : `Interface translation needs I SEE to be online. Phrases already translated (${cachedCount(s.language)}) are still shown.`
                : 'Menus and buttons stay in English.'}
            </p>
            {s.translateUi && cachedCount(s.language) > 0 && (
              <div className="setting">
                <span className="setting-label">Saved translations</span>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    clearTranslations(s.language);
                    refresh((n) => n + 1);
                    window.location.reload();
                  }}
                >
                  Translate again from scratch
                </button>
              </div>
            )}
          </>
        )}
        <div className="setting">
          <span className="setting-label">Asking by voice</span>
          <span>{voiceInput ? `On: spoken questions are written out by Muse Voice Transcribe, listening for ${langName}.` : 'Available when I SEE is online.'}</span>
        </div>
        <OnOff k="readAloud" label="Read answers aloud" />
        <div className="setting">
          <span className="setting-label">Reading voice</span>
          <span>
            {!canSpeak()
              ? 'This browser cannot read aloud.'
              : voiceOk === null
                ? 'Checking this device…'
                : voiceOk
                  ? `This device has a ${langName} voice.`
                  : `This device has no ${langName} voice installed, so a default voice is used. You can add one in your device's language or speech settings.`}
          </span>
          {canSpeak() && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => speak(SAMPLE_SENTENCE[s.language] ?? SAMPLE_SENTENCE.en!, SAMPLE_SENTENCE[s.language] ? s.language : 'en')}>
              <Icon name="speaker" size={15} /> Test
            </button>
          )}
        </div>
      </section>

      <section className="settings-group" aria-labelledby="an-h">
        <h2 id="an-h">Analysis</h2>
        <label className="setting">
          <span className="setting-label">Default mode</span>
          <select className="select" value={s.route} onChange={(e) => s.set({ route: e.target.value as Settings['route'] })}>
            {ROUTES.map((r) => (
              <option key={r} value={r} disabled={!routeOk(r)}>
                {ROUTE_INFO[r].label}
                {routeOk(r) ? '' : ' (not available)'}
              </option>
            ))}
          </select>
        </label>
        <p className="setting-help">{routeOk(s.route) ? ROUTE_INFO[s.route].detail : 'This mode is not available right now; Standard will be used.'}</p>
        <Seg k="depth" label="How detailed" options={[['quick', 'Quick look'], ['deep', 'Full profile']]} />
        <Seg k="privacyTier" label="Use of my photos" options={[['private', 'Never used for AI training'], ['contributor', 'May be used to improve the AI']]} />
        <p className="setting-help">By default, your photos and questions are processed with a service that does not use them to improve its AI.</p>
      </section>

      <section className="settings-group" aria-labelledby="cam-h">
        <h2 id="cam-h">Camera</h2>
        <OnOff k="liveRecognition" label="Recognise things live" />
        <p className="setting-help">While the camera is open, a small low-resolution frame is sent every few seconds to name what you point at. Nothing is stored.</p>
        <OnOff k="autoScan" label="Scan by itself when locked on" />

      </section>

      <section className="settings-group" aria-labelledby="ac-h">
        <h2 id="ac-h">Reading and access</h2>
        <Seg k="theme" label="Appearance" options={[['system', 'Match device'], ['light', 'Light'], ['dark', 'Dark']]} />
        <Seg k="textSize" label="Text size" options={[['normal', 'Standard'], ['large', 'Large']]} />
        <Seg k="contrast" label="Contrast" options={[['normal', 'Standard'], ['bold', 'Bold']]} />
        <Seg k="motion" label="Motion" options={[['system', 'Match device'], ['reduce', 'Reduce']]} />
      </section>

      <section className="settings-group" aria-labelledby="pr-h">
        <h2 id="pr-h">Privacy</h2>
        <div className="setting">
          <span className="setting-label">Permission to send photos</span>
          <span>{s.consentAt ? `Given ${new Date(s.consentAt).toLocaleString(s.language)}` : 'Asked before each live scan'}</span>
          {s.consentAt && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => s.set({ consentAt: null })}>
              Ask me every time
            </button>
          )}
        </div>
        <div className="setting">
          <span className="setting-label">Stored data</span>
          <ConfirmButton
            className="btn btn-secondary btn-sm"
            confirmLabel="Click again to delete everything"
            onConfirm={async () => {
              await deleteAll();
              s.reset();
            }}
          >
            Delete everything on this device
          </ConfirmButton>
        </div>
      </section>
    </div>
  );
}
