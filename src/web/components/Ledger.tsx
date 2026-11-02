/**
 * The claim ledger: every finding with its basis, strength, the regions it points
 * at, the sources it cites, and what the firewall did to it.
 */
import { useState } from 'react';
import { BASES, BASIS_INFO, SECTION_KEYS, SECTION_TITLE, type Basis, type SectionKey } from '@shared/epistemics';
import type { Finding, Profile, Source } from '@shared/schema';
import { BasisTag, Glyph, Strength } from './Evidence';
import { Icon } from './Icon';
import { regionNumber } from './Plate';

const VERIFY_TEXT: Record<Finding['verification']['status'], string> = {
  verified: 'Quote found on the page, word for word',
  tool_cited: 'From a web search; the exact words were not re-checked',
  pinned: 'Marked on your photo',
  unpinned: 'Seen in the photo, but not marked on it',
  downgraded: 'Marked less certain after checking',
  guarded: 'Replaced with a safety note',
  not_applicable: '',
  unverified: 'Not checked',
};

export function FindingCard({
  f,
  sources,
  onRegion,
  onHover,
  hot,
  index,
}: {
  f: Finding;
  sources: Map<string, Source>;
  onRegion: (id: string) => void;
  onHover: (f: Finding | null, el: HTMLElement | null) => void;
  hot: boolean;
  index?: number;
}) {
  const [open, setOpen] = useState(false);
  const cited = f.sourceIds.map((id) => sources.get(id)).filter((s): s is Source => !!s);
  const notable = ['downgraded', 'guarded', 'verified', 'tool_cited'].includes(f.verification.status) || f.disputed || f.flags.includes('needs_authoritative_source');
  return (
    <li
      className={`finding basis-${f.basis} ${hot ? 'hot' : ''} ${f.verification.status === 'guarded' ? 'guarded' : ''}`}
      data-finding={f.id}
      onMouseEnter={(e) => onHover(f, e.currentTarget)}
      onMouseLeave={() => onHover(null, null)}
      onFocus={(e) => onHover(f, e.currentTarget)}
      onBlur={() => onHover(null, null)}
    >
      <div className="finding-rail" aria-hidden="true">
        <Glyph basis={f.basis} size={13} />
      </div>
      <div className="finding-body">
        <p className="finding-text">
          {index != null ? <span className="sr-only">Finding {index}. </span> : null}
          {f.text}
        </p>
        <div className="finding-meta">
          <BasisTag basis={f.basis} />
          <Strength basis={f.basis} confidence={f.confidence} />
          {f.regionIds.map((id) => (
            <button key={id} type="button" className="region-chip" onClick={() => onRegion(id)} aria-label={`Show region ${regionNumber(id)} on the photo`}>
              {regionNumber(id)}
            </button>
          ))}
          {cited.map((s) => (
            <a key={s.id} className="source-chip" href={s.url} target="_blank" rel="noopener noreferrer" title={s.title}>
              {s.publisher}
              <Icon name="external" size={12} />
            </a>
          ))}
          {f.disputed && <span className="flag flag-dispute">Disputed</span>}
          {f.flags.includes('needs_authoritative_source') && <span className="flag flag-warn">Needs an authoritative source</span>}
          {f.verification.status === 'guarded' && <span className="flag flag-warn">Safety rule</span>}
          {f.recheckAfter && <span className="flag">Recheck after {new Date(f.recheckAfter).toLocaleDateString()}</span>}
          {(notable || f.quote || f.verification.notes.length > 0) && (
            <button type="button" className="how-btn" aria-expanded={open} onClick={() => setOpen(!open)}>
              How we know <Icon name="chevronDown" size={14} />
            </button>
          )}
        </div>
        {open && (
          <div className="finding-proof">
            {f.quote && cited[0] && (
              <figure className="proof-quote">
                <blockquote>“{f.quote}”</blockquote>
                <figcaption>
                  <a href={cited[0].url} target="_blank" rel="noopener noreferrer">
                    {cited[0].title}
                  </a>{' '}
                  · {cited[0].publisher} · tier {cited[0].tier}
                </figcaption>
              </figure>
            )}
            {VERIFY_TEXT[f.verification.status] && (
              <p className="proof-status">
                <Icon name={f.verification.status === 'verified' || f.verification.status === 'pinned' ? 'check' : 'info'} size={15} /> {VERIFY_TEXT[f.verification.status]}
              </p>
            )}
            {f.verification.notes.length > 0 && (
              <ul className="proof-notes">
                {f.verification.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            )}
            <p className="proof-upgrade">
              <strong>{BASIS_INFO[f.basis].label}:</strong> {BASIS_INFO[f.basis].meaning} {BASIS_INFO[f.basis].upgrade}
            </p>
          </div>
        )}
      </div>
    </li>
  );
}

export function BasisFilter({ counts, hidden, toggle }: { counts: Record<Basis, number>; hidden: Set<Basis>; toggle: (b: Basis) => void }) {
  return (
    <div className="basis-filter" role="group" aria-label="Show findings by evidence">
      {BASES.filter((b) => counts[b] > 0).map((b) => (
        <button key={b} type="button" aria-pressed={!hidden.has(b)} onClick={() => toggle(b)} title={BASIS_INFO[b].meaning}>
          <Glyph basis={b} size={11} />
          {BASIS_INFO[b].label}
          <span className="num">{counts[b]}</span>
        </button>
      ))}
    </div>
  );
}

export function tally(findings: Finding[]): Record<Basis, number> {
  const out = Object.fromEntries(BASES.map((b) => [b, 0])) as Record<Basis, number>;
  for (const f of findings) out[f.basis]++;
  return out;
}

export const PROFILE_SECTIONS: SectionKey[] = SECTION_KEYS.filter((k) => !['history', 'related', 'live'].includes(k));

export function Ledger({
  profile,
  sections = PROFILE_SECTIONS,
  onRegion,
  onHover,
  hotId,
}: {
  profile: Profile;
  sections?: SectionKey[];
  onRegion: (id: string) => void;
  onHover: (f: Finding | null, el: HTMLElement | null) => void;
  hotId: string | null;
}) {
  const [hidden, setHidden] = useState<Set<Basis>>(new Set());
  const sources = new Map(profile.sources.map((s) => [s.id, s]));
  const pool = profile.findings.filter((f) => sections.includes(f.section));
  const counts = tally(pool);
  const toggle = (b: Basis) => {
    const n = new Set(hidden);
    if (n.has(b)) n.delete(b);
    else n.add(b);
    setHidden(n);
  };
  let i = 0;
  return (
    <div className="ledger">
      <BasisFilter counts={counts} hidden={hidden} toggle={toggle} />
      {sections.map((sec) => {
        const items = pool.filter((f) => f.section === sec && !hidden.has(f.basis));
        if (!items.length) return null;
        return (
          <section key={sec} className="ledger-section" aria-labelledby={`sec-${sec}`}>
            <h3 id={`sec-${sec}`} className="ledger-title">
              {SECTION_TITLE[sec]}
            </h3>
            <ul className="findings">
              {items.map((f) => (
                <FindingCard key={f.id} f={f} sources={sources} onRegion={onRegion} onHover={onHover} hot={hotId === f.id} index={++i} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
