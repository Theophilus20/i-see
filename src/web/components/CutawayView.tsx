/**
 * The cutaway, drawn from the person's own photo. The drawing has no text in it: each part
 * was found in the drawing and outlined, and I SEE draws the labels itself, so they are
 * spelled exactly and point at the right part. Tap a label to see that part and what it does.
 * Three views: labelled, the plain drawing, and against the photo (a wipe slider).
 */
import { useEffect, useRef, useState } from 'react';
import { digestOf, type Inside as InsideData, type Profile, type Region } from '@shared/schema';
import { Plate } from './Plate';
import { Icon } from './Icon';
import { makeCutaway, userMessage } from '../lib/api';
import type { PassportEntry } from '../lib/passport';
import { useHealth } from '../lib/health';
import { useSettings } from '../lib/settings';
import { useObjectUrl } from '../hooks/useObjectUrl';

type Saved = NonNullable<PassportEntry['cutaway']>;
type View = 'labelled' | 'clean' | 'compare';

const blobToBase64 = (b: Blob) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).replace(/^data:[^,]+,/, ''));
    r.onerror = () => rej(new Error('read'));
    r.readAsDataURL(b);
  });
const b64ToBlob = (b64: string, type: string) => new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type });
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** One plain line under the drawing: what it shows. */
const insideLine = (kind: string | undefined) =>
  kind === 'living'
    ? 'Only the skeleton and organs, in the same pose as your photo.'
    : kind === 'natural'
      ? 'Only the inner structure, in the same shape as your photo.'
      : 'Only the inner parts, with the outer casing taken away.';

export function CutawayView({
  profile,
  inside,
  insideSettled,
  photoBlob,
  saved,
  legacy,
  recordedUrl,
  recordedData,
  onSave,
}: {
  profile: Profile;
  inside: InsideData | null;
  /** The inside view is known (or could not be made), so the part list is final. */
  insideSettled: boolean;
  photoBlob: Blob | null;
  saved: Saved | null;
  legacy: Blob | null;
  recordedUrl: string | null;
  /** Labels and check for a recorded example's drawing. */
  recordedData: { width: number; height: number; regions: Region[]; review: Saved['review']; labels?: Saved['labels'] } | null;
  onSave: (c: Saved) => Promise<void>;
}) {
  const health = useHealth((s) => s.state);
  const settings = useSettings();
  const online = health === 'live';
  const sample = profile.trace.mode === 'sample';
  const imageUrl = useObjectUrl(saved?.image ?? null);
  const cleanUrl = useObjectUrl(saved?.clean ?? null);
  const legacyUrl = useObjectUrl(saved ? null : legacy);
  const photoUrl = useObjectUrl(photoBlob);
  const [state, setState] = useState<{ status: 'idle' | 'busy' | 'error'; error: string | null; started: number }>({ status: 'idle', error: null, started: 0 });
  const [, tick] = useState(0);
  const [view, setView] = useState<View>('labelled');
  const [wipe, setWipe] = useState(50);
  const [hover, setHover] = useState<string | null>(null);
  const started = useRef<string | null>(null);
  const shape = profile.views[0]!;
  // Only inner parts: the outside parts in the photo are never labelled on the inside drawing.
  const parts = inside ? inside.groups.flatMap((g) => g.parts.map((p) => p.name)) : [];
  const info = (name: string) => inside?.groups.flatMap((g) => g.parts).find((p) => p.name.toLowerCase() === name.toLowerCase()) ?? null;

  useEffect(() => {
    if (state.status !== 'busy') return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [state.status]);

  /** `asked`: the person pressed the button, which says the photo is sent for this. */
  const draw = async (asked = false) => {
    started.current = profile.id;
    setState({ status: 'busy', error: null, started: Date.now() });
    try {
      const consentAt = settings.consentAt ?? (asked ? new Date().toISOString() : null);
      const photo = photoBlob && consentAt ? { mime: 'image/jpeg', base64: await blobToBase64(photoBlob), width: shape.width, height: shape.height, label: null as null } : null;
      const r = await makeCutaway({
        digest: digestOf(profile),
        inside: inside ? { kind: inside.kind, brief: inside.brief, parts: parts.slice(0, 16) } : null,
        view: photo,
        consent: photo ? { sendImages: true, acknowledgedAt: consentAt! } : null,
        privacyTier: settings.privacyTier,
        language: settings.language,
      });
      await onSave({
        image: b64ToBlob(r.image.base64, r.image.mime),
        width: r.image.width,
        height: r.image.height,
        clean: r.clean ? b64ToBlob(r.clean.base64, r.clean.mime) : null,
        regions: r.regions,
        review: r.review,
        labels: r.labels,
        createdAt: new Date().toISOString(),
        style: 'inside-only',
      });
      setView('labelled');
      setState({ status: 'idle', error: null, started: 0 });
    } catch (e) {
      const code = (e as { code?: string }).code ?? '';
      setState({ status: 'error', error: code === 'unsupported' ? 'Cutaway drawings are not available right now.' : userMessage(e, 'The cutaway could not be drawn this time.'), started: 0 });
    }
  };

  // Draw it once, automatically, when the person has already agreed to send this photo.
  useEffect(() => {
    if (saved || sample || !online || !insideSettled || !photoBlob || !settings.consentAt || started.current === profile.id) return;
    if (legacy || recordedUrl) return; // an older drawing exists: redraw only when asked
    void draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved, sample, online, insideSettled, photoBlob, settings.consentAt, profile.id]);

  if (state.status === 'busy') {
    const s = Math.round((Date.now() - state.started) / 1000);
    const steps = [
      [0, 'Drawing what is inside, in the same pose as your photo'],
      [45, 'Checking every part is in its right place'],
      [75, 'Correcting anything that did not match'],
      [130, 'Finding each part in the drawing'],
      [160, 'Checking every label points at its part'],
    ] as const;
    const at = steps.filter(([t]) => s >= t).length - 1;
    return (
      <div className="cutaway cutaway-empty busy" role="status">
        <span className="cutaway-scan" aria-hidden="true" />
        <ol className="cutaway-steps">
          {steps.map(([, label], i) => (
            <li key={label} className={i < at ? 'done' : i === at ? 'now' : ''}>
              {label}
            </li>
          ))}
        </ol>
        <p className="cutaway-sub num">
          {Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')} · usually two to three minutes.
        </p>
      </div>
    );
  }

  // A labelled, checked drawing (new), or a recorded example's.
  if ((saved && imageUrl) || (!saved && recordedUrl && recordedData)) {
    const labelledUrl = saved ? imageUrl! : recordedUrl!;
    const cleanSrc = saved ? cleanUrl : null;
    const labels = (saved ? saved.labels : recordedData?.labels) ?? null;
    const regions = saved ? saved.regions : recordedData!.regions;
    const showView: View = !cleanSrc && view !== 'labelled' ? 'labelled' : view;
    const located = regions.length ? [...new Set(regions.map((r) => cap(r.label)))] : [];
    const notDrawn = labels ? labels.expected.filter((p) => !located.some((l) => l.toLowerCase() === p.toLowerCase())) : [];
    const activeIds = hover ? regions.filter((r) => cap(r.label) === hover).map((r) => r.id) : [];
    const hoverInfo = hover ? info(hover) : null;
    const W = saved?.width ?? recordedData!.width;
    const H = saved?.height ?? recordedData!.height;
    // Drawings made by older versions have their labels painted in; they are shown as they are.
    const older = !regions.length && !!labels;
    // Drawn before drawings showed only the inside (with skin or casing): offer the new one.
    const covered = !!saved && saved.style !== 'inside-only';
    return (
      <figure className="cutaway cutaway-labelled">
        {covered && online && !sample && (
          <div className="notice cutaway-upgrade">
            <p>This drawing still shows the outside. Draw it again to see only what is inside: {inside?.kind === 'living' ? 'the skeleton and organs, with no skin or fur' : 'the inner parts, with the casing taken away'}.</p>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void draw(true)}>
              <Icon name="image" size={15} /> Show only the inside
            </button>
          </div>
        )}
        {cleanSrc && (
          <div className="segmented cutaway-views" role="tablist" aria-label="Cutaway view">
            <button type="button" role="tab" aria-selected={showView === 'labelled'} onClick={() => setView('labelled')}>
              Labelled
            </button>
            <button type="button" role="tab" aria-selected={showView === 'clean'} onClick={() => setView('clean')}>
              Plain drawing
            </button>
            {photoUrl && (
              <button type="button" role="tab" aria-selected={showView === 'compare'} onClick={() => setView('compare')}>
                Against your photo
              </button>
            )}
          </div>
        )}
        {showView === 'labelled' &&
          (regions.length ? (
            <Plate
              src={labelledUrl}
              width={W}
              height={H}
              alt={`Cutaway of this ${profile.displayName}, with ${located.length} parts labelled.`}
              regions={regions}
              active={activeIds}
              outlines="active"
              markers
              labelFor={(r) => cap(r.label)}
              onSelect={(id) => {
                const r = regions.find((x) => x.id === id);
                if (r) setHover((h) => (h === cap(r.label) ? null : cap(r.label)));
              }}
              className="cutaway-plate"
            />
          ) : (
            <div className="cutaway-img">
              <img src={labelledUrl} alt={`Cutaway of this ${profile.displayName}, showing ${(labels?.expected ?? parts).join(', ')}.`} />
            </div>
          ))}
        {showView === 'clean' && cleanSrc && (
          <div className="cutaway-img">
            <img src={cleanSrc} alt={`Cutaway of this ${profile.displayName}, without labels.`} />
          </div>
        )}
        {showView === 'compare' && cleanSrc && photoUrl && (
          <>
            <div className="cutaway-compare" style={{ aspectRatio: `${shape.width} / ${shape.height}` }}>
              <img src={cleanSrc} alt={`Cutaway of this ${profile.displayName}.`} />
              <img className="cutaway-photo" src={photoUrl} alt="" style={{ clipPath: `inset(0 0 0 ${wipe}%)` }} draggable={false} />
              <span className="cutaway-divider" style={{ left: `${wipe}%` }} aria-hidden="true" />
            </div>
            <label className="explode-slider cutaway-wipe">
              <span>Cutaway</span>
              <input type="range" min={0} max={100} value={wipe} onChange={(e) => setWipe(Number(e.target.value))} aria-label="Slide between the cutaway and your photo" />
              <span>Photo</span>
            </label>
          </>
        )}

        <figcaption>
          {located.length > 0 && (
            <ul className="cutaway-legend" aria-label="Parts in the drawing">
              {located.map((p) => (
                <li key={p} className={hover === p ? 'on' : ''}>
                  <button type="button" aria-pressed={hover === p} onClick={() => setHover((h) => (h === p ? null : p))}>
                    {p}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {hover && (
            <div className="cutaway-hover" role="status">
              <strong>{hover}</strong>
              {hoverInfo ? ` — ${hoverInfo.what} ${hoverInfo.how}` : ''}
            </div>
          )}
          {regions.length > 0 && <p className="small muted">Tap a name to see where it is and what it does.</p>}
          {notDrawn.length > 0 && <p className="small muted">Not shown in this drawing: {notDrawn.join(', ')}. You can read about them in the part cards below.</p>}
          {older && <p className="small muted">This drawing was made by an earlier version, with its labels painted in. Draw it again to get labels that I SEE places and checks itself.</p>}
          {!regions.length && !older && <p className="small muted">The parts could not be marked on this drawing this time. Draw it again to try once more.</p>}
          <p className="small muted">{insideLine(inside?.kind)}</p>
          {online && !sample && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void draw(true)}>
              <Icon name="undo" size={15} /> Draw it again
            </button>
          )}
        </figcaption>
      </figure>
    );
  }

  const oldUrl = legacyUrl ?? recordedUrl;
  return (
    <div className="cutaway cutaway-empty">
      {oldUrl && <img className="cutaway-old" src={oldUrl} alt={`An earlier cutaway drawing of a typical ${profile.displayName}.`} />}
      <p className={state.error ? '' : 'muted'}>
        {state.error ??
          (sample
            ? 'Cutaway drawings are made from photos you scan yourself, so they match your object.'
            : !online
              ? 'The cutaway is drawn when I SEE is online.'
              : oldUrl
                ? 'This drawing was made before I SEE could match your photo and label it. Draw it again to get one in the same pose as your object, with every part found and labelled.'
                : !settings.consentAt
                  ? 'The inside is drawn from your photo, in the same pose, so it matches your object. Your photo is sent once more for this and not stored.'
                  : 'Getting ready to draw…')}
      </p>
      {online && !sample && (
        <button type="button" className="btn btn-primary" onClick={() => void draw(true)}>
          <Icon name="image" size={16} /> {oldUrl || state.error ? 'Draw it again from my photo' : 'Draw it from my photo'}
        </button>
      )}
    </div>
  );
}

export type { Saved as SavedCutaway, Region };
