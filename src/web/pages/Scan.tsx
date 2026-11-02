import { useEffect, useRef, useState, type DragEvent } from 'react';
import { useLocation } from 'wouter';
import { ROUTES, type Route as ScanRoute } from '@shared/schema';
import { Icon } from '../components/Icon';
import { Camera, hintsFor } from '../components/Camera';
import { Dialog } from '../components/Dialog';
import { acceptable, prepareImage, type PreparedImage } from '../lib/images';
import { useSettings, ROUTE_INFO } from '../lib/settings';
import { AVAILABILITY_TEXT, useHealth } from '../lib/health';
import { useRun } from '../lib/run';
import { SAMPLES } from '../lib/samples';
import { usePrior } from '../lib/prior';

const MAX_VIEWS = 4;
const VIEW_LABELS = ['Main view', 'Second angle', 'Close-up', 'Label or marking'];

export function Scan() {
  const [, go] = useLocation();
  const settings = useSettings();
  const health = useHealth();
  const startLive = useRun((s) => s.startLive);
  const startSample = useRun((s) => s.startSample);
  const [views, setViews] = useState<PreparedImage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState('');
  const [camera, setCamera] = useState(false);
  const [consent, setConsent] = useState(false);
  const [remember, setRemember] = useState(true);
  const [drag, setDrag] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const { prior, instruction, set: setPrior } = usePrior();

  useEffect(() => () => views.forEach((v) => URL.revokeObjectURL(v.url)), []); // eslint-disable-line react-hooks/exhaustive-deps

  const live = health.state === 'live';
  const routeOk = (r: ScanRoute) => !health.info || health.info.routes[r];

  const add = async (files: Iterable<Blob>) => {
    setError(null);
    setBusy(true);
    try {
      const next = [...views];
      for (const f of files) {
        if (next.length >= MAX_VIEWS) break;
        if (f instanceof File) {
          const why = acceptable(f);
          if (why) {
            setError(why);
            continue;
          }
        }
        next.push(await prepareImage(f, VIEW_LABELS[next.length] ?? null));
      }
      setViews(next);
    } catch {
      setError('That photo could not be read. Try another one.');
    } finally {
      setBusy(false);
    }
  };

  const remove = (i: number) => {
    URL.revokeObjectURL(views[i]!.url);
    setViews(views.filter((_, k) => k !== i));
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    void add(e.dataTransfer.files);
  };

  const [pending, setPending] = useState<PreparedImage[] | null>(null);
  const launch = (list: PreparedImage[]) => {
    void startLive(list, hint.trim() || null, prior);
    setPrior(null);
    go('/run');
  };
  const begin = (list: PreparedImage[] = views) => {
    if (!list.length) return;
    if (!settings.consentAt) {
      setPending(list);
      setConsent(true);
      return;
    }
    launch(list);
  };

  const confirmConsent = () => {
    const at = new Date().toISOString();
    if (remember) settings.set({ consentAt: at });
    setConsent(false);
    launch(pending ?? views);
  };

  /** From the camera: take the photo and go straight into the scan. */
  const scanFromCamera = async (b: Blob) => {
    setCamera(false);
    try {
      const img = await prepareImage(b, VIEW_LABELS[views.length] ?? null);
      const list = [...views, img].slice(0, MAX_VIEWS);
      setViews(list);
      if (live) begin(list);
    } catch {
      setError('That photo could not be read. Try again.');
    }
  };

  const totalKb = Math.round(views.reduce((a, v) => a + v.blob.size, 0) / 1024);

  return (
    <div className="scan wrap page-pad">
      <header className="scan-head">
        <p className="eyebrow">Examine</p>
        <h1>Show it from where you stand.</h1>
        <p className="muted">One clear photo is enough. For a more exact answer, add a second angle, or a close-up of any writing or maker’s mark.</p>
      </header>

      {prior && (
        <div className="notice follow-up" role="status">
          <Icon name="target" />
          <div>
            <p>
              <strong>Following up on {prior.displayName}.</strong> The new photo will be examined together with what is already known.
            </p>
            {instruction && <p className="voice">{instruction}</p>}
            <button type="button" className="link-btn" onClick={() => setPrior(null)}>
              Start fresh instead
            </button>
          </div>
        </div>
      )}

      {!live && (
        <div className="notice warn scan-offline" role="status">
          <Icon name="info" />
          <div>
            <p>
              <strong>{AVAILABILITY_TEXT[health.state].short}.</strong> {AVAILABILITY_TEXT[health.state].long} You can still prepare photos here, and try a sample run:
            </p>
            <div className="inline-actions">
              {SAMPLES.map((s) => (
                <button
                  key={s.spec.id}
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    void startSample(s.spec.id);
                    go('/run');
                  }}
                >
                  {s.spec.title}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="scan-grid">
        <section aria-label="Photos" className="scan-photos">
          {views.length === 0 ? (
            <div
              className={`dropzone ${drag ? 'drag' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={onDrop}
              // The whole area opens the file picker too (the buttons are the keyboard route).
              onClick={(e) => {
                if (!busy && !(e.target as HTMLElement).closest('button')) fileInput.current?.click();
              }}
            >
              <div className="dz-art" aria-hidden="true">
                <span className="dz-card back" />
                <span className="dz-card front">
                  <svg viewBox="0 0 48 36">
                    <circle cx="34" cy="11" r="4" />
                    <path d="M4 32 17 17l9 10 6-6 12 11z" />
                  </svg>
                </span>
                <span className="dz-badge">
                  <Icon name="plus" size={18} />
                </span>
              </div>
              <p className="dropzone-title">
                <span className="on-pointer">Drop a photo here</span>
                <span className="on-touch">Add a photo</span>
              </p>
              <p className="muted">JPEG, PNG or WebP. Location data is removed on this device before anything is sent.</p>
              <div className="inline-actions dropzone-actions">
                <button type="button" className="btn btn-primary" onClick={() => setCamera(true)} disabled={busy} hidden={__PREVIEW__}>
                  <Icon name="camera" /> Use the camera
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => fileInput.current?.click()} disabled={busy}>
                  <Icon name="upload" /> Choose a photo
                </button>
              </div>
            </div>
          ) : (
            <ol className="views">
              {views.map((v, i) => (
                <li key={v.url} className="view">
                  <img src={v.url} alt={`${v.upload.label ?? 'Photo'} you added`} width={v.upload.width} height={v.upload.height} />
                  <div className="view-meta">
                    <span className="view-label">{v.upload.label}</span>
                    <span className="view-hints">
                      {hintsFor(v.metrics).map((h) => (
                        <span key={h.text} className={`hint ${h.ok ? 'ok' : 'bad'}`}>
                          <Icon name={h.ok ? 'check' : 'alert'} size={13} /> {h.text}
                        </span>
                      ))}
                    </span>
                    <span className="muted num">
                      {v.upload.width} × {v.upload.height} · {Math.round(v.blob.size / 1024)} KB
                    </span>
                  </div>
                  <button type="button" className="icon-btn" onClick={() => remove(i)} aria-label={`Remove ${v.upload.label}`}>
                    <Icon name="trash" size={18} />
                  </button>
                </li>
              ))}
              {views.length < MAX_VIEWS && (
                <li className="view add">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setCamera(true)} hidden={__PREVIEW__}>
                    <Icon name="camera" size={16} /> Add {VIEW_LABELS[views.length]?.toLowerCase()}
                  </button>
                  <button type="button" className="btn btn-quiet btn-sm" onClick={() => fileInput.current?.click()}>
                    Choose a file
                  </button>
                </li>
              )}
            </ol>
          )}
          {views.some((v) => !v.quality.adequate) ? (
            <p className="notice warn" role="status">
              <Icon name="alert" /> {views.find((v) => !v.quality.adequate)!.quality.advice[0] ?? 'This photo may be too blurred or dark to identify reliably.'}
            </p>
          ) : (
            views.some((v) => v.quality.issues.some((i) => i.kind === 'small')) && (
              <p className="notice" role="status">
                <Icon name="alert" /> {views.find((v) => v.quality.issues.some((i) => i.kind === 'small'))!.quality.issues.find((i) => i.kind === 'small')!.note}{' '}
                {views.find((v) => v.quality.issues.some((i) => i.kind === 'small'))!.quality.advice.at(-1)}
              </p>
            )
          )}
          {error && (
            <p className="notice danger" role="alert">
              <Icon name="alert" /> {error}
            </p>
          )}
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) void add(e.target.files);
              e.target.value = '';
            }}
          />
        </section>

        <section aria-label="Options" className="scan-options">
          <label className="field">
            <span>What do you already know? (optional)</span>
            <textarea className="textarea" maxLength={300} value={hint} onChange={(e) => setHint(e.target.value)} placeholder="For example: found in my grandfather’s workshop; it came with a 1970s radio." />
          </label>

          <fieldset className="field route-field">
            <legend>
              <span>Where it is analysed</span>
            </legend>
            {ROUTES.map((r) => (
              <label key={r} className={`route-option ${settings.route === r ? 'on' : ''} ${routeOk(r) ? '' : 'off'}`}>
                <input type="radio" name="route" value={r} checked={settings.route === r} disabled={!routeOk(r)} onChange={() => settings.set({ route: r })} />
                <span className="route-name">{ROUTE_INFO[r].label}</span>
                <span className="route-detail">{routeOk(r) ? ROUTE_INFO[r].detail : 'Not available right now.'}</span>
              </label>
            ))}
          </fieldset>

          <div className="field">
            <span>Depth</span>
            <div className="segmented" role="group" aria-label="Depth">
              <button type="button" aria-pressed={settings.depth === 'quick'} onClick={() => settings.set({ depth: 'quick' })}>
                Quick look
              </button>
              <button type="button" aria-pressed={settings.depth === 'deep'} onClick={() => settings.set({ depth: 'deep' })}>
                Full profile
              </button>
            </div>
          </div>

          <button type="button" className="btn btn-primary btn-lg start-btn" disabled={!views.length || !live || busy} onClick={() => begin()}>
            Examine {views.length > 1 ? `${views.length} photos` : 'this'}
            <Icon name="arrowRight" />
          </button>
          {views.length > 0 && <p className="muted small">Sends {views.length} photo{views.length > 1 ? 's' : ''} ({totalKb} KB){hint.trim() ? ' and your note' : ''}. Nothing is stored on the server.</p>}
        </section>
      </div>

      {camera && (
        <Camera
          live={live}
          onClose={() => setCamera(false)}
          onScan={(b) => void scanFromCamera(b)}
          onAdd={(b) => {
            setCamera(false);
            void add([b]);
          }}
        />
      )}

      <Dialog open={consent} onClose={() => setConsent(false)} title="Before anything is sent">
        <ul className="consent-list">
          <li>
            <strong>
              {views.length} photo{views.length > 1 ? 's' : ''}
            </strong>{' '}
            ({totalKb} KB, location data already removed){hint.trim() ? ', and your note' : ''}.
          </li>
          <li>
            <strong>To:</strong> {ROUTE_INFO[settings.route].label}. {ROUTE_INFO[settings.route].detail}
          </li>
          <li>
            <strong>Model use of your data:</strong>{' '}
            {settings.privacyTier === 'private'
              ? 'Your photos are processed by a service that does not use them to train AI.'
              : 'You allowed your photos to be used to improve the AI. Change this in Settings.'}
          </li>
          <li>
            <strong>Also used for:</strong> the drawing of what is inside it (on the Parts tab), made from the same photo.
          </li>
          <li>
            <strong>Kept:</strong> the I SEE server holds the scan in memory only until it finishes. The profile is saved in this browser.
          </li>
          <li>Text in your photo is treated as data, never as instructions.</li>
        </ul>
        <label className="check">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Don’t ask again on this device
        </label>
        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={() => setConsent(false)}>
            Not now
          </button>
          <button type="button" className="btn btn-primary" onClick={confirmConsent}>
            Send and examine
          </button>
        </div>
      </Dialog>
    </div>
  );
}
