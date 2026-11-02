/**
 * Live camera. Frames are measured on the device a few times a second. When I SEE is
 * online and the person has allowed it, a small low-resolution frame is sent every few
 * seconds to name what is in view; once the same thing holds steady and sharp, the
 * camera locks on and starts the full scan by itself (or on a tap of the shutter).
 */
import { useEffect, useRef, useState } from 'react';
import { QUALITY_THRESHOLDS, type PixelMetrics } from '@shared/quality';
import { measureSource } from '../lib/images';
import { glance } from '../lib/api';
import { useSettings } from '../lib/settings';
import { Icon } from './Icon';

export function hintsFor(m: PixelMetrics | null): Array<{ ok: boolean; text: string }> {
  if (!m) return [];
  return [
    m.sharpness < QUALITY_THRESHOLDS.blurry ? { ok: false, text: 'Hold still' } : { ok: true, text: 'Sharp' },
    m.brightness < QUALITY_THRESHOLDS.dark ? { ok: false, text: 'More light' } : m.brightness > QUALITY_THRESHOLDS.bright || m.clipped > QUALITY_THRESHOLDS.clipped ? { ok: false, text: 'Too much glare' } : { ok: true, text: 'Well lit' },
  ];
}

const GLANCE_EVERY = 2200;
const LOCK_MS = 1600;
const LOCK_CONFIDENCE = 0.55;

type Seen = { label: string; confidence: number; hint: string | null; at: number };

async function frameAsUpload(v: HTMLVideoElement, max = 512) {
  const k = Math.min(1, max / Math.max(v.videoWidth, v.videoHeight));
  const c = document.createElement('canvas');
  c.width = Math.max(16, Math.round(v.videoWidth * k));
  c.height = Math.max(16, Math.round(v.videoHeight * k));
  c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height);
  const url = c.toDataURL('image/jpeg', 0.72);
  return { mime: 'image/jpeg', base64: url.slice(url.indexOf(',') + 1), width: c.width, height: c.height, label: null };
}

export function Camera({ live, onScan, onAdd, onClose }: { live: boolean; onScan: (blob: Blob) => void; onAdd: (blob: Blob) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const settings = useSettings();
  const [error, setError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<PixelMetrics | null>(null);
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const [ready, setReady] = useState(false);
  const [seen, setSeen] = useState<Seen | null>(null);
  const [looking, setLooking] = useState(false);
  /** Live recognition calls that failed in a row: after a few, the camera says so instead of waiting. */
  const [misses, setMisses] = useState(0);
  const [auto, setAuto] = useState(settings.autoScan);
  const [allowLive, setAllowLive] = useState<boolean>(!!settings.consentAt);
  const [askLive, setAskLive] = useState(live && !settings.consentAt && settings.liveRecognition);
  const [lockStart, setLockStart] = useState<number | null>(null);
  const [captured, setCaptured] = useState<string | null>(null);
  const [frames, setFrames] = useState(0);
  const metricsRef = useRef<PixelMetrics | null>(null);
  /** The last few sharpness readings: a hand-held camera flickers, so steadiness is judged over ~1.5 s. */
  const recent = useRef<number[]>([]);
  const capturing = useRef(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer = 0;
    let cancelled = false;
    setReady(false);
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 2560 }, height: { ideal: 1920 } }, audio: false });
        if (cancelled) return;
        const v = video.current!;
        v.srcObject = stream;
        await v.play();
        setReady(true);
        timer = window.setInterval(() => {
          if (!v.videoWidth) return;
          const m = measureSource(v, v.videoWidth, v.videoHeight);
          metricsRef.current = m;
          recent.current = [...recent.current.slice(-4), m.sharpness];
          setMetrics(m);
          setFrames((f) => f + 1);
        }, 300);
      } catch {
        setError('The camera could not be opened. Allow camera access for this site in your browser, or choose a photo instead.');
      }
    })();
    return () => {
      cancelled = true;
      clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [facing]);

  const sharp = !!metrics && metrics.sharpness >= QUALITY_THRESHOLDS.blurry;
  const lit = !!metrics && metrics.brightness >= QUALITY_THRESHOLDS.dark && metrics.brightness <= QUALITY_THRESHOLDS.bright;
  const recognising = live && allowLive && ready && settings.liveRecognition;

  // Name what is in view every few seconds, only while the frame is sharp enough to be worth it.
  useEffect(() => {
    if (!recognising || captured) return;
    let stop = false;
    let abort: AbortController | null = null;
    const tick = async () => {
      const v = video.current;
      const m = metricsRef.current;
      if (stop || !v?.videoWidth || !m || m.sharpness < QUALITY_THRESHOLDS.blurry * 0.5) return;
      setLooking(true);
      abort = new AbortController();
      try {
        const r = await glance(await frameAsUpload(v), { privacyTier: settings.privacyTier, language: settings.language, consent: { sendImages: true, acknowledgedAt: settings.consentAt ?? new Date().toISOString() } }, abort.signal);
        if (stop) return;
        setMisses(0);
        setSeen((prev) => {
          if (!r.label) return null;
          const same = prev && prev.label.toLowerCase() === r.label.toLowerCase();
          return { label: r.label, confidence: same ? Math.max(r.confidence, (prev.confidence + r.confidence) / 2) : r.confidence, hint: r.hint, at: Date.now() };
        });
      } catch {
        // Recognition is a nicety: keep the camera going, and after a few failures say so.
        if (!stop && !abort?.signal.aborted) setMisses((n) => n + 1);
      } finally {
        if (!stop) setLooking(false);
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), GLANCE_EVERY);
    return () => {
      stop = true;
      abort?.abort();
      clearInterval(id);
    };
  }, [recognising, captured, settings.privacyTier, settings.consentAt]);

  const grab = (then: (b: Blob) => void) => {
    const v = video.current;
    if (!v?.videoWidth || capturing.current) return;
    capturing.current = true;
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d')!.drawImage(v, 0, 0);
    setCaptured(c.toDataURL('image/jpeg', 0.6));
    const fromFrame = () =>
      new Promise<Blob | null>((resolve) => c.toBlob(resolve, 'image/jpeg', 0.95));
    // A full-resolution still from the camera itself where the browser allows it (much sharper
    // than a frame of the video preview); otherwise the video frame.
    const still = async (): Promise<Blob | null> => {
      const track = (v.srcObject as MediaStream | null)?.getVideoTracks()[0];
      const IC = (window as unknown as { ImageCapture?: new (t: MediaStreamTrack) => { takePhoto: () => Promise<Blob> } }).ImageCapture;
      if (IC && track && track.readyState === 'live') {
        try {
          const b = await Promise.race([new IC(track).takePhoto(), new Promise<null>((r) => window.setTimeout(() => r(null), 2500))]);
          if (b && b.size > 0) return b;
        } catch {
          /* fall back to the video frame */
        }
      }
      return fromFrame();
    };
    void still().then((b) => {
      if (!b) {
        capturing.current = false;
        setCaptured(null);
        return;
      }
      // Let the lock-on flash play before the darkroom takes over.
      window.setTimeout(() => then(b), 650);
    });
  };
  const scanNow = () => (live ? grab(onScan) : grab(onAdd));

  // Lock on: the same object, confidently named, sharp and lit, held for a moment.
  const steady = recent.current.length > 0 && Math.max(...recent.current) >= QUALITY_THRESHOLDS.blurry * 0.6;
  const lockable = auto && recognising && !!seen && seen.confidence >= LOCK_CONFIDENCE && steady && lit && !captured;
  const lockLabel = useRef<string | null>(null);
  useEffect(() => {
    if (!lockable) {
      lockLabel.current = null;
      setLockStart(null);
      return;
    }
    if (lockLabel.current !== seen!.label) {
      lockLabel.current = seen!.label;
      setLockStart(Date.now());
    }
  }, [lockable, seen?.label, frames]);
  useEffect(() => {
    if (lockStart == null) return;
    const id = window.setTimeout(() => grab(onScan), LOCK_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lockStart]);

  const allow = () => {
    settings.set({ consentAt: new Date().toISOString() });
    setAllowLive(true);
    setAskLive(false);
  };

  const hints = hintsFor(metrics);
  const sharpPct = metrics ? Math.min(100, Math.round((metrics.sharpness / (QUALITY_THRESHOLDS.blurry * 2.2)) * 100)) : 0;
  const lightPct = metrics ? Math.round(metrics.brightness * 100) : 0;
  const status = captured ? 'Locked on' : lockStart ? 'Locking on' : seen && recognising ? 'Recognised' : recognising ? (looking ? 'Analysing' : 'Searching') : 'Ready';
  const reticleState = captured ? 'locked' : lockStart ? 'locking' : seen && recognising ? 'found' : 'search';

  return (
    <div className="camera scifi" role="dialog" aria-modal="true" aria-label="Camera">
      {error ? (
        <div className="camera-error">
          <p>{error}</p>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      ) : (
        <>
          <video ref={video} playsInline muted aria-label="Camera preview" />
          {captured && <img className="camera-freeze" src={captured} alt="" />}
          <div className="hud" aria-hidden="true">
            <div className="hud-grid" />
            <div className="hud-vignette" />
            {!captured && <div className="hud-beam" />}
            <div className={`reticle ${reticleState}`} style={{ ['--lock' as string]: `${LOCK_MS}ms` }}>
              <i className="rc tl" />
              <i className="rc tr" />
              <i className="rc bl" />
              <i className="rc br" />
              <i className="rc-cross" />
              <svg className="rc-ring" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="46" pathLength="1" />
              </svg>
              {seen && recognising && (
                <span className="rc-label">
                  <b>{seen.label}</b>
                  <span className="num">{Math.round(seen.confidence * 100)}%</span>
                </span>
              )}
            </div>
            <div className="hud-side left">
              <span>FOCUS</span>
              <span className="hud-meter">
                <i style={{ height: `${sharpPct}%` }} className={sharp ? 'ok' : 'bad'} />
              </span>
              <span className="num">{sharpPct}</span>
            </div>
            <div className="hud-side right">
              <span>LIGHT</span>
              <span className="hud-meter">
                <i style={{ height: `${lightPct}%` }} className={lit ? 'ok' : 'bad'} />
              </span>
              <span className="num">{lightPct}</span>
            </div>
            {captured && <div className="hud-flash" />}
          </div>

          <div className="camera-top">
            <span className={`hud-status ${reticleState}`}>
              <span className="hud-dot" />
              {status}
            </span>
            <div className="camera-hints" aria-live="polite">
              {hints.map((h) => (
                <span key={h.text} className={`hint ${h.ok ? 'ok' : 'bad'}`}>
                  <Icon name={h.ok ? 'check' : 'alert'} size={14} /> {h.text}
                </span>
              ))}
            </div>
          </div>

          <p className="camera-caption" aria-live="polite">
            {captured
              ? 'Got it. Starting the scan…'
              : !live
                ? 'Live recognition works when I SEE is online. You can still take photos.'
                : !allowLive
                  ? 'Tap the button to take the photo and start the scan.'
                  : misses >= 3 && !seen
                    ? 'Live recognition is not working right now. Tap the button to take the photo and scan it.'
                    : seen
                    ? lockStart
                      ? `Hold steady: scanning the ${seen.label.toLowerCase()}…`
                      : (seen.hint ?? (auto ? 'Hold steady to scan it automatically.' : 'Tap the button to scan it.'))
                    : 'Point at an object and hold still.'}
          </p>

          {askLive && (
            <div className="camera-ask" role="alertdialog" aria-label="Live recognition">
              <p>
                <strong>Recognise things live?</strong> While the camera is open, a small, low-resolution frame is sent every few seconds to name what you are pointing at. Nothing is stored.
              </p>
              <div className="camera-ask-actions">
                <button type="button" className="btn btn-quiet" onClick={() => setAskLive(false)}>
                  Not now
                </button>
                <button type="button" className="btn btn-primary" onClick={allow}>
                  Allow
                </button>
              </div>
            </div>
          )}

          <div className="camera-bar">
            <button type="button" className="btn btn-quiet" onClick={onClose}>
              Cancel
            </button>
            <div className="camera-center">
              <button type="button" className={`shutter ${live ? 'scan' : ''}`} onClick={scanNow} disabled={!ready || !!captured} aria-label={live ? 'Scan now' : 'Take photo'}>
                <Icon name={live ? 'scan' : 'camera'} size={26} />
              </button>
              <span className="shutter-label">{live ? 'Scan now' : 'Take photo'}</span>
            </div>
            <div className="camera-side">
              {live && recognising && (
                <button type="button" className={`btn btn-quiet auto-toggle ${auto ? 'on' : ''}`} aria-pressed={auto} onClick={() => setAuto((a) => !a)}>
                  <Icon name="bolt" size={16} /> Auto
                </button>
              )}
              {live && (
                <button type="button" className="btn btn-quiet" onClick={() => grab(onAdd)} disabled={!ready || !!captured} title="Keep this photo and add another angle before scanning">
                  <Icon name="plus" size={16} /> Add angle
                </button>
              )}
              <button type="button" className="btn btn-quiet" onClick={() => setFacing((f) => (f === 'environment' ? 'user' : 'environment'))}>
                Flip
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
