import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Link, useLocation } from 'wouter';
import { STAGE_IDS } from '@shared/schema';
import { Icon } from '../components/Icon';
import { Plate } from '../components/Plate';
import { Dialog } from '../components/Dialog';
import { useRun, type StageView } from '../lib/run';
import { ROUTE_INFO, useSettings } from '../lib/settings';

const STAGE_HELP: Record<string, string> = {
  intake: 'Your photo is prepared on this device and its location data is removed.',
  quality: 'Making sure it is sharp and well lit.',
  identify: 'Working out what it is and reading any writing on it.',
  segment: 'Marking each part on your photo.',
  retrieve: 'Reading trusted pages about it.',
  compose: 'What it is, how it works and where it comes from.',
  reconcile: 'Making sure every fact matches the page it came from.',
  resolve: 'If it could be more than one thing, deciding which.',
};

function StageRow({ s }: { s: StageView }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (s.status !== 'running') return;
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, [s.status]);
  const elapsed = s.status === 'running' && s.startedAt ? (now - s.startedAt) / 1000 : s.ms != null ? s.ms / 1000 : null;
  return (
    <li className={`stage stage-${s.status}`}>
      <span className="stage-icon" aria-hidden="true">
        {s.status === 'done' ? <Icon name="check" size={16} /> : s.status === 'error' ? <Icon name="alert" size={16} /> : s.status === 'skip' ? <span className="dash" /> : <span className="dot" />}
      </span>
      <div className="stage-main">
        <div className="stage-line">
          <span className="stage-label">{s.label}</span>
          {elapsed != null && <span className="stage-time num">{elapsed < 10 ? elapsed.toFixed(1) : Math.round(elapsed)} s</span>}
        </div>
        <p className="stage-sub">
          <span>{s.note ?? STAGE_HELP[s.id]}</span>
        </p>
      </div>
    </li>
  );
}

export function Darkroom() {
  const run = useRun();
  const route = useSettings((s) => s.route);
  const [, go] = useLocation();
  const sample = run.mode === 'sample';
  const stages = STAGE_IDS.map((id) => run.stages[id]);
  const current = stages.find((s) => s.status === 'running');
  const doneCount = stages.filter((s) => s.status === 'done' || s.status === 'skip').length;

  useEffect(() => {
    if (run.status === 'done' && run.profile) {
      const t = setTimeout(() => go(`/p/${run.profile!.id}`), 1400);
      return () => clearTimeout(t);
    }
  }, [run.status, run.profile, go]);

  const dims = run.dims[0];
  const active = useMemo(() => run.regions.map((r) => r.id), [run.regions]);

  if (run.status === 'idle' || !dims) {
    return (
      <div className="wrap page-pad darkroom-empty">
        <h1>Nothing is being examined.</h1>
        <p className="muted">
          <Link href="/scan">Add a photo</Link> or start a sample from the <Link href="/">front page</Link>.
        </p>
      </div>
    );
  }

  const top = run.candidates.filter((c) => !c.eliminated).slice(0, 4);

  return (
    <div className="darkroom wrap">
      <div className="darkroom-head">
        <div>
          <p className="eyebrow">{run.mode === 'sample' ? 'Sample run' : run.mode === 'recorded' ? 'Recorded example' : `Examining · ${ROUTE_INFO[route].label}`}</p>
          <h1 className="darkroom-title" aria-live="polite">
            {run.status === 'done' ? 'Done. Opening the profile.' : run.status === 'error' || run.status === 'cancelled' ? (run.error?.message ?? 'Stopped.') : current ? `${current.label}…` : 'Starting…'}
          </h1>
        </div>
        <div className="darkroom-actions">
          {run.status === 'running' && (
            <button type="button" className="btn btn-secondary" onClick={run.cancel}>
              Stop
            </button>
          )}
          {run.status === 'done' && run.profile && (
            <Link href={`/p/${run.profile.id}`} className="btn btn-primary">
              Open the profile <Icon name="arrowRight" size={18} />
            </Link>
          )}
          {(run.status === 'error' || run.status === 'cancelled') && (
            <>
              {run.sampleId ? (
                <button type="button" className="btn btn-primary" onClick={() => void run.startSample(run.sampleId!)}>
                  Run again
                </button>
              ) : (
                <Link href="/scan" className="btn btn-primary">
                  Back to photos
                </Link>
              )}
            </>
          )}
        </div>
      </div>

      {sample && (
        <p className="sample-banner">
          <Icon name="info" size={16} /> A prepared walkthrough: each step replays a written result, and the checking step is real. Nothing is sent anywhere.
        </p>
      )}
      {run.mode === 'recorded' && (
        <p className="sample-banner">
          <Icon name="info" size={16} /> A real analysis of this photo, recorded earlier and replayed here. Nothing is sent anywhere.
        </p>
      )}

      <div className="darkroom-grid">
        <div className="darkroom-plate">
          <div
            className={`scan-hud ${run.status === 'running' ? 'scanning' : ''} ${run.status === 'done' ? 'complete' : ''} ${run.regions.length ? 'has-regions' : ''}`}
            style={{ '--ar': dims.width / Math.max(1, dims.height) } as CSSProperties}
          >
            <Plate
              src={run.photoUrls[0]!}
              width={dims.width}
              height={dims.height}
              alt="The photo being examined."
              regions={run.regions}
              active={[]}
              outlines="all"
              markers={run.regions.length > 0}
              drawIn
              colourNumbers
              object={top[0] ? { displayName: top[0].name, category: top[0].category ?? 'other', candidates: top } : null}
              labelFor={(r) => r.label.charAt(0).toUpperCase() + r.label.slice(1)}
            />
            <div className="scan-fx" aria-hidden="true">
              <span className="sfx-grid" />
              <span className="sfx-beam" />
              <span className="sfx-corner tl" />
              <span className="sfx-corner tr" />
              <span className="sfx-corner bl" />
              <span className="sfx-corner br" />
              <span className="sfx-tele top">
                <span className="sfx-dot" />
                {run.status === 'done' ? 'Analysis complete' : run.status === 'running' ? (current ? current.label : 'Starting') : run.status === 'error' ? 'Stopped' : 'Paused'}
                <span className="sfx-sep" />
                <span className="num">
                  {String(doneCount).padStart(2, '0')}/{String(stages.length).padStart(2, '0')}
                </span>
              </span>
              <span className="sfx-tele bottom">
                <span>
                  PARTS <b className="num">{String(run.regions.length).padStart(2, '0')}</b>
                </span>
                <span>
                  PAGES <b className="num">{String(run.sources.length).padStart(2, '0')}</b>
                </span>
                {top[0] && (
                  <span className="sfx-guess">
                    {top[0].name} <b className="num">{Math.round(top[0].likelihood * 100)}%</b>
                  </span>
                )}
              </span>
              <span className="sfx-progress">
                <i style={{ width: `${(doneCount / stages.length) * 100}%` }} />
              </span>
            </div>
          </div>
          <div className="darkroom-under">
            <section aria-labelledby="cands-h" className="cands">
              <h2 id="cands-h" className="eyebrow">
                What it might be
              </h2>
              {top.length === 0 ? (
                <p className="muted small">Looking at your photo…</p>
              ) : (
                <ol>
                  {top.map((c, i) => (
                    <li key={c.id}>
                      <span className="c-rank num">{i + 1}</span>
                      <span className="c-name">{c.name}</span>
                      <span className="c-bar" aria-hidden="true">
                        <span style={{ width: `${Math.max(2, c.likelihood * 100)}%` }} />
                      </span>
                      <span className="c-val num">{Math.round(c.likelihood * 100)}%</span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
            <section aria-label="Counts" className="counts">
              <div>
                <span className="count num">{run.regions.length}</span>
                <span className="muted small">parts marked</span>
              </div>
              <div>
                <span className="count num">{run.sources.length}</span>
                <span className="muted small">pages found</span>
              </div>
              <div>
                <span className="count num">
                  {doneCount}/{stages.length}
                </span>
                <span className="muted small">steps done</span>
              </div>
            </section>
          </div>
        </div>

        <ol className="stages" aria-label="Progress">
          {stages.map((s) => (
            <StageRow key={s.id} s={s} />
          ))}
        </ol>
      </div>

      <Dialog open={!!run.escalation} onClose={() => run.answerEscalation(false)} title="Send it for a closer look?">
        {run.escalation && (
          <>
            <p>{run.escalation.reason}</p>
            <ul className="consent-list">
              <li>
                <strong>Would be sent:</strong> {run.escalation.preview.text} ({Math.round(run.escalation.preview.bytes / 1024)} KB)
              </li>
              <li>
                <strong>To:</strong> a more thorough analysis
              </li>
            </ul>
            <div className="dialog-actions">
              <button type="button" className="btn btn-secondary" onClick={() => run.answerEscalation(false)}>
                Keep it local
              </button>
              <button type="button" className="btn btn-primary" onClick={() => run.answerEscalation(true)}>
                Send
              </button>
            </div>
          </>
        )}
      </Dialog>
    </div>
  );
}
