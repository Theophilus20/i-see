import { cleanSummary } from '@shared/assemble';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'wouter';
import { BASIS_INFO, CATEGORY_LABEL, SECTION_KEYS, SECTION_TITLE } from '@shared/epistemics';
import { formatNumber, runWhatIf } from '@shared/calc';
import { getEntry, type PassportEntry } from '../lib/passport';
import { Plate, regionNumber } from '../components/Plate';
import { Glyph } from '../components/Evidence';
import { Icon } from '../components/Icon';

/** A printable record of a profile, every claim with its grade and its source. */
export function Report() {
  const { id } = useParams<{ id: string }>();
  const [e, setE] = useState<PassportEntry | null | undefined>(undefined);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let u: string | null = null;
    void getEntry(id).then((x) => {
      setE(x);
      if (x?.images[0]) {
        u = URL.createObjectURL(x.images[0]);
        setUrl(u);
      }
    });
    return () => {
      if (u) URL.revokeObjectURL(u);
    };
  }, [id]);
  if (e === undefined) return <div className="wrap page-pad muted">Opening…</div>;
  if (!e) return <div className="wrap page-pad">Not found on this device.</div>;
  const p = e.profile;
  const src = new Map(p.sources.map((s) => [s.id, s]));
  const dims = p.views[0]!;
  return (
    <article className="report wrap page-pad">
      <div className="report-tools no-print">
        <Link href={`/p/${p.id}`} className="btn btn-quiet btn-sm">
          <Icon name="chevronLeft" size={16} /> Back
        </Link>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => window.print()}>
          <Icon name="printer" size={16} /> Print or save as PDF
        </button>
      </div>
      <header className="report-head">
        <p className="eyebrow">
          I SEE object report · {CATEGORY_LABEL[p.category]} · {new Date(p.createdAt).toLocaleDateString()}
          {p.trace.mode === 'sample' ? ' · Sample run' : p.trace.mode === 'recorded' ? ' · Recorded example' : ''}
        </p>
        <h1>{p.displayName}</h1>
        <p className="voice">{cleanSummary(p.summary)}</p>
      </header>
      {url && <Plate src={url} width={dims.width} height={dims.height} alt={p.displayName} regions={p.regions.filter((r) => r.view === 0)} outlines="all" markers />}
      {p.safety.length > 0 && (
        <section>
          <h2>Safety</h2>
          <ul>
            {p.safety.map((s) => (
              <li key={s.id}>
                <strong>{s.severity}:</strong> {s.text} {s.advice}
              </li>
            ))}
          </ul>
        </section>
      )}
      {SECTION_KEYS.map((k) => {
        const fs = p.findings.filter((f) => f.section === k);
        if (!fs.length) return null;
        return (
          <section key={k}>
            <h2>{SECTION_TITLE[k]}</h2>
            <ol className="report-findings">
              {fs.map((f) => (
                <li key={f.id}>
                  <span className="report-basis">
                    <Glyph basis={f.basis} size={10} /> {BASIS_INFO[f.basis].label}
                  </span>
                  <span>
                    {f.text}
                    {f.regionIds.length ? <span className="muted"> [part {f.regionIds.map(regionNumber).join(', ')}]</span> : null}
                    {f.sourceIds.map((s) => (src.get(s) ? <span key={s} className="muted"> [{src.get(s)!.publisher}]</span> : null))}
                    {f.verification.status === 'downgraded' ? <span className="muted"> (downgraded: {f.verification.notes[0]})</span> : null}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        );
      })}
      {p.whatIf.length > 0 && (
        <section>
          <h2>What if</h2>
          {p.whatIf.map((w) => {
            const r = runWhatIf(w);
            return (
              <p key={w.id}>
                <strong>{w.title}</strong> ({w.kind}){r.ok && r.result ? `: ${formatNumber(r.result.value)} ${r.result.unit}` : ''}. {w.summary}
              </p>
            );
          })}
        </section>
      )}
      <section>
        <h2>Sources</h2>
        <ol>
          {p.sources.map((s) => (
            <li key={s.id}>
              {s.title}, {s.publisher} (tier {s.tier}). {s.url} · retrieved {new Date(s.retrievedAt).toLocaleDateString()}
            </li>
          ))}
        </ol>
      </section>
      <footer className="report-foot small muted">
        Fact check: {p.trace.firewall.checked} facts checked, {p.trace.firewall.citationsVerified} of {p.trace.firewall.citationsClaimed} quotes matched their page word for word, {p.trace.firewall.downgraded} marked less certain, {p.trace.firewall.guarded} safety notes added.
      </footer>
    </article>
  );
}
