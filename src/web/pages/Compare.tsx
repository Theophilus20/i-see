import { useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import { BASIS_INFO, CATEGORY_LABEL, type Basis } from '@shared/epistemics';
import { digestOf, type Profile } from '@shared/schema';
import type { CompareOutput } from '@shared/model-io';
import { listEntries, type PassportEntry } from '../lib/passport';
import { compare, userMessage } from '../lib/api';
import { useHealth } from '../lib/health';
import { useSettings } from '../lib/settings';
import { tally } from '../components/Ledger';
import { BasisTag, Glyph } from '../components/Evidence';
import { Icon } from '../components/Icon';

function Photo({ e }: { e: PassportEntry | undefined }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!e?.images[0]) return setUrl(null);
    const u = URL.createObjectURL(e.images[0]);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [e]);
  return url ? <img className="cmp-photo" src={url} alt={e?.profile.displayName ?? ''} /> : <div className="cmp-photo" />;
}

const STATUS_WORD = { identified: 'Identified', candidates: 'Not certain yet', unknown: 'Not identified' } as const;
const textsIn = (p: Profile, section: string) => p.findings.filter((f) => f.section === section).map((f) => f.text);

export function Compare() {
  const health = useHealth((s) => s.state);
  const settings = useSettings();
  const [items, setItems] = useState<PassportEntry[]>([]);
  const q = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
  const [a, setA] = useState<string>(q.get('a') ?? '');
  const [b, setB] = useState<string>('');
  const [ai, setAi] = useState<{ status: 'idle' | 'busy' | 'done' | 'error'; out?: CompareOutput; model?: string; error?: string }>({ status: 'idle' });
  useEffect(() => {
    void listEntries().then((l) => {
      setItems(l);
      setA((x) => x || l[0]?.id || '');
      setB((x) => x || l.find((e) => e.id !== (q.get('a') ?? l[0]?.id))?.id || '');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const ea = items.find((e) => e.id === a);
  const eb = items.find((e) => e.id === b);
  const rows = useMemo(() => {
    if (!ea || !eb) return [];
    const pa = ea.profile;
    const pb = eb.profile;
    const ta = tally(pa.findings);
    const tb = tally(pb.findings);
    const ev = (t: Record<Basis, number>) => (['observed', 'sourced', 'inferred', 'hypothesis', 'unknown'] as Basis[]).filter((x) => t[x]).map((x) => `${t[x]} ${BASIS_INFO[x].label.toLowerCase()}`).join(', ');
    return [
      ['Kind', CATEGORY_LABEL[pa.category], CATEGORY_LABEL[pb.category]],
      ['Identity', STATUS_WORD[pa.identity.status], STATUS_WORD[pb.identity.status]],
      ['Made of', textsIn(pa, 'materials')[0] ?? '—', textsIn(pb, 'materials')[0] ?? '—'],
      ['What it is for', textsIn(pa, 'function')[0] ?? '—', textsIn(pb, 'function')[0] ?? '—'],
      ['Parts listed', String(pa.components.length), String(pb.components.length)],
      ['Safety notes', String(pa.safety.length), String(pb.safety.length)],
      ['Evidence', ev(ta), ev(tb)],
      ['Sources', String(pa.sources.length), String(pb.sources.length)],
    ];
  }, [ea, eb]);
  const live = health === 'live' && ea?.profile.trace.mode === 'live' && eb?.profile.trace.mode === 'live';

  return (
    <div className="wrap page-pad compare">
      <header className="page-head">
        <div>
          <p className="eyebrow">Compare</p>
          <h1>Two objects, side by side.</h1>
          <p className="muted">The table uses only what each profile already says. I SEE can add a written comparison, graded like everything else.</p>
        </div>
      </header>
      {items.length < 2 ? (
        <div className="empty">
          <p>You need at least two profiles in your Passport to compare them.</p>
          <Link href="/" className="btn btn-secondary">
            Run the samples
          </Link>
        </div>
      ) : (
        <>
          <div className="cmp-pick">
            {[
              [a, setA],
              [b, setB],
            ].map(([v, set], i) => (
              <label key={i} className="field">
                <span>{i === 0 ? 'First' : 'Second'}</span>
                <select className="select" value={v as string} onChange={(e) => (set as (s: string) => void)(e.target.value)}>
                  {items.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.profile.displayName}
                      {e.sample ? ' (sample)' : ''}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          {ea && eb && (
            <table className="data-table cmp-table">
              <thead>
                <tr>
                  <th scope="col">
                    <span className="sr-only">Aspect</span>
                  </th>
                  <th scope="col">
                    <Photo e={ea} />
                    <Link href={`/p/${ea.id}`}>{ea.profile.displayName}</Link>
                  </th>
                  <th scope="col">
                    <Photo e={eb} />
                    <Link href={`/p/${eb.id}`}>{eb.profile.displayName}</Link>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map(([k, x, y]) => (
                  <tr key={k}>
                    <th scope="row">{k}</th>
                    <td>{x}</td>
                    <td>{y}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <section className="cmp-ai">
            <button
              type="button"
              className="btn btn-primary"
              disabled={!live || ai.status === 'busy' || a === b}
              onClick={async () => {
                setAi({ status: 'busy' });
                try {
                  const r = await compare(digestOf(ea!.profile), digestOf(eb!.profile), { language: settings.language, privacyTier: settings.privacyTier });
                  setAi({ status: 'done', out: r.output, model: r.model });
                } catch (e) {
                  setAi({ status: 'error', error: userMessage(e, 'The comparison could not be made. Please try again.') });
                }
              }}
            >
              <Icon name="compare" /> {ai.status === 'busy' ? 'Comparing…' : 'Write a comparison'}
            </button>
            {!live && <p className="small muted">Written comparisons need a live connection and two live profiles.</p>}
            {ai.status === 'error' && <p className="notice danger">{ai.error}</p>}
            {ai.out && (
              <div className="cmp-out">
                <p className="voice cmp-headline">{ai.out.headline}</p>
                <ul className="segments">
                  {ai.out.differences.map((d) => (
                    <li key={d.aspect} className={`segment basis-${d.basis}`}>
                      <strong>{d.aspect}.</strong> {d.a} / {d.b}. <span className="muted">{d.matters}</span>
                      <span className="seg-meta">
                        <BasisTag basis={d.basis} />
                      </span>
                    </li>
                  ))}
                </ul>
                {ai.out.advice && <p>{ai.out.advice}</p>}
                <p className="small muted mono">
                  <Glyph basis="inferred" size={10} /> Reasoned comparison. Check the cited findings above before relying on it.
                </p>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
