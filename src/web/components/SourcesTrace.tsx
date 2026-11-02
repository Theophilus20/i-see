import { SOURCE_TIERS } from '@shared/epistemics';
import type { Profile } from '@shared/schema';
import { citationPrecision } from '@shared/firewall';
import { LIVE_EQUIVALENT } from '@fixtures/samples/tasks';
import { Icon } from './Icon';
import { ROUTE_INFO } from '../lib/settings';

export function Sources({ profile }: { profile: Profile }) {
  if (!profile.sources.length) return <p className="muted">No sources were retrieved. Every claim here rests on the photo or on reasoning, and is graded that way.</p>;
  return (
    <ol className="sources">
      {profile.sources.map((s) => {
        const citing = profile.findings.filter((f) => f.sourceIds.includes(s.id));
        const verified = citing.filter((f) => f.verification.status === 'verified').length;
        return (
          <li key={s.id} className="source">
            <div className="source-head">
              <a href={s.url} target="_blank" rel="noopener noreferrer" className="source-title">
                {s.title} <Icon name="external" size={14} />
              </a>
              <span className="tier" title={SOURCE_TIERS[s.tier as 1 | 2 | 3 | 4 | 5]}>
                Tier {s.tier} · {SOURCE_TIERS[s.tier as 1 | 2 | 3 | 4 | 5]}
              </span>
            </div>
            <p className="small muted">
              {s.publisher}
              {s.publishedAt ? ` · published ${s.publishedAt}` : ''} · retrieved {new Date(s.retrievedAt).toLocaleDateString()}
              {s.license ? ` · ${s.license}` : ''}
              {s.kind === 'search' ? ' · found by web search' : ''}
              {s.kind === 'sample' ? ' · excerpt stored with the sample' : ''}
            </p>
            {s.note && <p className="small">{s.note}</p>}
            <details>
              <summary>
                Retrieved text ({s.snippet.length.toLocaleString()} characters) · cited by {citing.length} finding{citing.length === 1 ? '' : 's'}, {verified} quote{verified === 1 ? '' : 's'} found in it
              </summary>
              <p className="snippet">{s.snippet}</p>
            </details>
          </li>
        );
      })}
    </ol>
  );
}

export function Trace({ profile }: { profile: Profile }) {
  const t = profile.trace;
  const fw = t.firewall;
  const sample = t.mode === 'sample';
  return (
    <div className="trace">
      <dl className="trace-facts">
        <div>
          <dt>Run</dt>
          <dd>{sample ? 'Sample run: no model was called' : 'Live'}</dd>
        </div>
        <div>
          <dt>Route</dt>
          <dd>{ROUTE_INFO[t.route].label}</dd>
        </div>
        <div>
          <dt>Started</dt>
          <dd>{new Date(t.startedAt).toLocaleString()}</dd>
        </div>
        <div>
          <dt>Cost</dt>
          <dd>{t.costUsd == null ? (sample ? 'None' : 'Not reported') : `$${t.costUsd.toFixed(4)}`}</dd>
        </div>
      </dl>

      <h3 className="ledger-title">Steps</h3>
      <table className="data-table trace-table">
        <thead>
          <tr>
            <th scope="col">Step</th>
            <th scope="col">Done by</th>
            <th scope="col">Time</th>
            <th scope="col">What happened</th>
          </tr>
        </thead>
        <tbody>
          {t.stages.map((s, i) => (
            <tr key={i} className={`st-${s.status}`}>
              <th scope="row">{s.label}</th>
              <td className="mono">{sample ? (s.model ? `Sample (live: ${LIVE_EQUIVALENT[s.id] ?? '—'})` : 'I SEE') : s.model && s.provider !== 'I SEE' ? 'AI' : 'I SEE'}</td>
              <td className="num">{s.ms != null ? `${(s.ms / 1000).toFixed(1)} s` : '—'}</td>
              <td>
                {s.status !== 'done' ? <strong>{s.status === 'skipped' ? 'Skipped. ' : 'Did not finish. '}</strong> : null}
                {s.note}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 className="ledger-title">How the facts were checked</h3>
      <div className="fw-stats">
        <div>
          <span className="num">{fw.checked}</span>facts checked
        </div>
        <div>
          <span className="num">
            {fw.citationsVerified}/{fw.citationsClaimed}
          </span>
          quotes matched their page word for word
        </div>
        <div>
          <span className="num">{fw.downgraded}</span>marked less certain
        </div>
        <div>
          <span className="num">{fw.guarded}</span>safety notes added
        </div>
        <div>
          <span className="num">{fw.dropped}</span>left out or combined
        </div>
      </div>
      <p className="small muted">Quotes that matched their page: {Math.round(citationPrecision(fw) * 100)}%.</p>
      {fw.notes.length > 0 && (
        <details className="fw-details">
          <summary>Details of each check</summary>
          <ul className="fw-notes">
            {fw.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </details>
      )}

    </div>
  );
}
