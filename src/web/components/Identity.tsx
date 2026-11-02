import { useState } from 'react';
import type { Profile } from '@shared/schema';
import { CATEGORY_LABEL } from '@shared/epistemics';
import { Icon } from './Icon';

const CAPTURE_LABEL: Record<string, string> = {
  label: 'Photograph a label',
  angle: 'Another angle',
  detail: 'A close-up',
  measurement: 'A measurement',
  action: 'A simple check',
  context: 'Where it is used',
};

export function Tournament({ profile }: { profile: Profile }) {
  const [open, setOpen] = useState<string | null>(profile.identity.status === 'candidates' ? (profile.candidates[0]?.id ?? null) : null);
  return (
    <ol className="tournament">
      {profile.candidates.map((c, i) => (
        <li key={c.id} className={`cand ${c.eliminated ? 'out' : ''} ${c.id === profile.identity.topCandidateId ? 'lead' : ''}`}>
          <button type="button" className="cand-head" aria-expanded={open === c.id} onClick={() => setOpen(open === c.id ? null : c.id)}>
            <span className="cand-rank num">{c.eliminated ? '×' : i + 1}</span>
            <span className="cand-name">
              {c.name}
              <span className="cand-cat">{CATEGORY_LABEL[c.category]}</span>
            </span>
            <span className="cand-bar" aria-hidden="true">
              <span style={{ width: `${Math.max(2, c.likelihood * 100)}%` }} />
            </span>
            <span className="cand-val num">{c.eliminated ? 'ruled out' : `${Math.round(c.likelihood * 100)}%`}</span>
            <Icon name="chevronDown" size={16} />
          </button>
          {open === c.id && (
            <div className="cand-body">
              {c.eliminatedBy && (
                <p className="cand-out">
                  <strong>Ruled out:</strong> {c.eliminatedBy}
                </p>
              )}
              <div className="cand-cols">
                <div>
                  <h4>For</h4>
                  <ul>{c.evidenceFor.length ? c.evidenceFor.map((e) => <li key={e}>{e}</li>) : <li className="muted">Nothing specific.</li>}</ul>
                </div>
                <div>
                  <h4>Against</h4>
                  <ul>{c.evidenceAgainst.length ? c.evidenceAgainst.map((e) => <li key={e}>{e}</li>) : <li className="muted">Nothing seen against it.</li>}</ul>
                </div>
                <div>
                  <h4>Would confirm it</h4>
                  <ul>{c.missing.length ? c.missing.map((e) => <li key={e}>{e}</li>) : <li className="muted">—</li>}</ul>
                </div>
              </div>
            </div>
          )}
        </li>
      ))}
      <li className="tournament-note">Shares are rough estimates, not exact probabilities.</li>
    </ol>
  );
}

export function NextShot({ profile, onTake }: { profile: Profile; onTake: () => void }) {
  const n = profile.nextShot;
  if (!n) return null;
  const names = n.separates.map((id) => profile.candidates.find((c) => c.id === id)?.name).filter(Boolean);
  return (
    <section className="next-shot" aria-labelledby="ns-h">
      <p className="eyebrow" id="ns-h">
        The photo that would settle it · {CAPTURE_LABEL[n.capture] ?? n.capture}
      </p>
      <p className="next-shot-text voice">{n.instruction}</p>
      <p className="muted">{n.why}</p>
      {names.length > 1 && <p className="small muted">Separates: {names.join(' and ')}</p>}
      <button type="button" className="btn btn-primary" onClick={onTake}>
        <Icon name="camera" /> Take that photo
      </button>
    </section>
  );
}

export function SecondOpinion({ profile }: { profile: Profile }) {
  const s = profile.secondOpinion;
  if (!s) return null;
  const word = s.agreement === 'agrees' ? 'Agrees' : s.agreement === 'partly' ? 'Partly agrees' : 'Disagrees';
  return (
    <section className={`second-opinion so-${s.agreement}`} aria-labelledby="so-h">
      <div className="so-head">
        <p className="eyebrow" id="so-h">
          Second opinion
        </p>
        <span className={`so-badge so-${s.agreement}`}>
          <Icon name={s.agreement === 'agrees' ? 'check' : 'alert'} size={14} /> {word}
        </span>
      </div>
      <p>
        Its best guess: <strong>{s.topCandidate}</strong>
      </p>
      {s.disagreements.length > 0 && (
        <table className="so-table">
          <thead>
            <tr>
              <th scope="col">On</th>
              <th scope="col">This profile</th>
              <th scope="col">Second opinion</th>
            </tr>
          </thead>
          <tbody>
            {s.disagreements.map((d) => (
              <tr key={d.topic}>
                <th scope="row">{d.topic}</th>
                <td>{d.mine}</td>
                <td>{d.theirs}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {s.notes.length > 0 && <p className="small muted">{s.notes.join(' · ')}</p>}
    </section>
  );
}
