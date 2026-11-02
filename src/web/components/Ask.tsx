/**
 * Ask about the object. Answers come back in claim-sized segments, each graded like
 * a finding. Voice questions go through Muse Voice Transcribe, primed with the names
 * of the parts on screen so "gasket" is not heard as "basket".
 */
import { useEffect, useRef, useState } from 'react';
import { digestOf, type Profile, type Source } from '@shared/schema';
import type { AskOutput } from '@shared/model-io';
import { sampleTasks } from '@fixtures/samples/tasks';
import { ask, transcribe, userMessage } from '../lib/api';
import { speak } from '../lib/speech';
import { useHealth } from '../lib/health';
import { useSettings } from '../lib/settings';
import { sampleForProfile } from '../lib/samples';
import { startRecording, type Recorder } from '../lib/wav';
import { BasisTag } from './Evidence';
import { Icon } from './Icon';
import { regionNumber } from './Plate';

interface Turn {
  q: string;
  a: AskOutput | null;
  sources: Source[];
  error?: string;
  model?: string;
}



export function Ask({ profile, view, regionId, onRegion }: { profile: Profile; view: { blob: Blob | null; width: number; height: number } | null; regionId: string | null; onRegion: (id: string) => void }) {
  const health = useHealth((s) => s.state);
  const settings = useSettings();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [rec, setRec] = useState<Recorder | null>(null);
  const [level, setLevel] = useState(0);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [withPhoto, setWithPhoto] = useState(true);
  const endRef = useRef<HTMLDivElement>(null);
  const sample = profile.trace.mode === 'sample';
  const spec = sampleForProfile(profile)?.spec;
  const live = health === 'live' && !sample;
  const suggestions = spec ? spec.questions.map((x) => x.q) : profile.openQuestions.length ? ['What is it made of?', 'How does it work?', 'How should I look after it?'] : ['How does it work?', 'Is it safe to use?', 'What is it worth knowing about it?'];

  useEffect(() => {
    if (!rec) return;
    const t = setInterval(() => setLevel(rec.level()), 80);
    return () => clearInterval(t);
  }, [rec]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [turns.length]);

  const submit = async (question: string) => {
    const text = question.trim();
    if (!text || busy) return;
    setQ('');
    setBusy(true);
    const history = turns.flatMap((t) => [
      { role: 'user' as const, text: t.q },
      { role: 'assistant' as const, text: (t.a?.segments ?? []).map((s) => s.text).join(' ').slice(0, 1500) },
    ]);
    setTurns((t) => [...t, { q: text, a: null, sources: [] }]);
    try {
      let out: AskOutput;
      let sources: Source[] = [];
      let model = 'Sample run';
      if (live) {
        let viewPayload = null;
        if (withPhoto && view?.blob) {
          const b64 = await new Promise<string>((res) => {
            const r = new FileReader();
            r.onload = () => res(String(r.result).replace(/^data:[^,]+,/, ''));
            r.readAsDataURL(view.blob!);
          });
          viewPayload = { mime: 'image/jpeg' as const, base64: b64, width: view.width, height: view.height, label: null };
        }
        const res = await ask({
          digest: digestOf(profile),
          question: text,
          history: history.slice(-12),
          regionId,
          view: viewPayload,
          route: settings.route,
          language: settings.language,
          privacyTier: settings.privacyTier,
          consent: { sendImages: true, acknowledgedAt: settings.consentAt ?? new Date().toISOString() },
        });
        out = res.output;
        sources = res.sources;
        model = res.model;
      } else if (spec) {
        const r = await sampleTasks(spec, [], { speed: 1 }).ask({ digest: digestOf(profile), question: text, history, regionId, view: null, sources: [] }, { language: 'en', privacyTier: 'private', route: 'hosted', runId: 'ask' });
        out = r.value;
      } else {
        out = { segments: [{ text: 'Questions about your own photos work when I SEE is online. For this one, try one of the suggested questions.', basis: 'unknown', confidence: null, regionIds: [], sourceIds: [], quote: null }], followUps: [], needsEvidence: null, refused: null };
      }
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, a: out, sources, model } : x)));
      if (settings.readAloud) speak(out.segments.map((s) => s.text).join(' '), settings.language);
    } catch (e) {
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, error: userMessage(e, 'No answer this time. Please try again.') } : x)));
    } finally {
      setBusy(false);
    }
  };

  const toggleVoice = async () => {
    setVoiceError(null);
    if (rec) {
      setRec(null);
      try {
        const wav = await rec.stop();
        setBusy(true);
        const keywords = [...profile.components.map((c) => c.name), ...profile.regions.map((r) => r.label), profile.displayName];
        const r = await transcribe(wav, keywords, settings.language);
        setBusy(false);
        if (r.transcript.trim()) void submit(r.transcript);
        else setVoiceError('Nothing was heard. Try again a little closer to the microphone.');
      } catch (e) {
        setBusy(false);
        setVoiceError(userMessage(e, 'Your recording could not be turned into text. Try again, or type the question.'));
      }
      return;
    }
    try {
      setRec(await startRecording());
    } catch {
      setVoiceError('The microphone could not be opened. Check the browser’s permission.');
    }
  };

  const allSources = new Map([...profile.sources, ...turns.flatMap((t) => t.sources)].map((s) => [s.id, s]));

  return (
    <div className="ask">
      {turns.length === 0 && (
        <div className="ask-intro">
          <p className="muted">Ask anything about this object. Answers are graded sentence by sentence, like the profile.{sample ? ' In a sample run, only the suggested questions have prepared answers.' : ''}</p>
        </div>
      )}
      <ol className="turns" aria-live="polite">
        {turns.map((t, i) => (
          <li key={i} className="turn">
            <p className="turn-q">{t.q}</p>
            {t.error ? (
              <p className="notice danger">{t.error}</p>
            ) : !t.a ? (
              <p className="turn-wait muted">Thinking…</p>
            ) : (
              <div className="turn-a">
                {t.a.refused && (
                  <p className="notice warn">
                    <Icon name="shield" /> {t.a.refused.reason}
                  </p>
                )}
                <ul className="segments">
                  {t.a.segments.map((s, k) => (
                    <li key={k} className={`segment basis-${s.basis}`}>
                      <span>{s.text}</span>
                      <span className="seg-meta">
                        <BasisTag basis={s.basis} />
                        {s.regionIds.map((r) => (
                          <button key={r} type="button" className="region-chip" onClick={() => onRegion(r)} aria-label={`Show region ${regionNumber(r)}`}>
                            {regionNumber(r)}
                          </button>
                        ))}
                        {s.sourceIds
                          .map((id) => allSources.get(id))
                          .filter(Boolean)
                          .map((src) => (
                            <a key={src!.id} className="source-chip" href={src!.url} target="_blank" rel="noopener noreferrer">
                              {src!.publisher}
                            </a>
                          ))}
                      </span>
                    </li>
                  ))}
                </ul>
                {t.a.needsEvidence && (
                  <p className="needs">
                    <Icon name="camera" size={16} /> {t.a.needsEvidence.instruction}
                  </p>
                )}
                <div className="turn-foot">
                  <button type="button" className="link-btn" onClick={() => speak(t.a!.segments.map((s) => s.text).join(' '), settings.language)}>
                    <Icon name="speaker" size={15} /> Read aloud
                  </button>
                  
                </div>
              </div>
            )}
          </li>
        ))}
      </ol>
      <div ref={endRef} />
      <div className="suggest">
        {(turns.at(-1)?.a?.followUps.length ? turns.at(-1)!.a!.followUps : suggestions).slice(0, 4).map((s) => (
          <button key={s} type="button" className="chip-btn" onClick={() => void submit(s)} disabled={busy}>
            {s}
          </button>
        ))}
      </div>
      <form
        className="ask-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(q);
        }}
      >
        <label className="sr-only" htmlFor="ask-input">
          Your question
        </label>
        <input id="ask-input" className="input" value={q} onChange={(e) => setQ(e.target.value)} maxLength={600} placeholder={regionId ? `Ask about part ${regionNumber(regionId)}…` : 'Ask a question…'} disabled={busy || !!rec} />
        <button type="button" className={`icon-btn mic ${rec ? 'rec' : ''}`} onClick={toggleVoice} disabled={!live || (busy && !rec)} aria-label={rec ? 'Stop recording' : 'Ask by voice'} title={live ? 'Ask by voice' : 'Voice needs a live connection'} style={rec ? { boxShadow: `0 0 0 ${2 + level * 10}px color-mix(in srgb, var(--danger) 30%, transparent)` } : undefined}>
          <Icon name={rec ? 'stop' : 'mic'} />
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy || !q.trim()}>
          Ask
        </button>
      </form>
      <div className="ask-options">
        {live && (
          <label className="check small">
            <input type="checkbox" checked={withPhoto} onChange={(e) => setWithPhoto(e.target.checked)} /> Include the photo with questions
          </label>
        )}
        {voiceError && <p className="notice danger small">{voiceError}</p>}
      </div>
    </div>
  );
}
