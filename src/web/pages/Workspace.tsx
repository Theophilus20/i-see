import { cleanSummary } from '@shared/assemble';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { BASIS_INFO, CATEGORY_LABEL, type Basis } from '@shared/epistemics';
import { digestOf, type Finding, type Profile, type Region } from '@shared/schema';
import { Icon } from '../components/Icon';
import { Plate, regionNumber, partColour } from '../components/Plate';
import { BASIS_VAR, Glyph } from '../components/Evidence';
import { Ledger, tally } from '../components/Ledger';
import { NextShot, SecondOpinion, Tournament } from '../components/Identity';
import { WhatIfCard } from '../components/WhatIf';
import { Inside } from '../components/Inside';
import { ObjectGraph, Related, Timeline } from '../components/History';
import { Sources } from '../components/SourcesTrace';
import { Ask } from '../components/Ask';
import { ConfirmButton } from '../components/ConfirmButton';
import { deleteEntry, getEntry, putEntry, withNote, type PassportEntry } from '../lib/passport';
import { useSettings } from '../lib/settings';
import { segmentAt } from '../lib/api';
import { useHealth } from '../lib/health';
import { usePrior } from '../lib/prior';
import { describeLocation, normalizeForMatch } from '@shared/text';

const TABS = [
  { id: 'profile', label: 'Profile', icon: 'book' },
  { id: 'parts', label: 'Parts', icon: 'layers' },
  { id: 'history', label: 'History', icon: 'clock' },
  { id: 'whatif', label: 'What if', icon: 'flask' },
  { id: 'sources', label: 'Sources', icon: 'graph' },
  { id: 'ask', label: 'Ask', icon: 'chat' },
] as const;
type TabId = (typeof TABS)[number]['id'];

const RANK = (b: Basis) => BASIS_INFO[b].rank;

/** Draws a leader from a hovered finding to the part of the photo it is about. */
function Leader({ from, plate, region, basis, dims }: { from: HTMLElement | null; plate: HTMLElement | null; region: Region | null; basis: Basis; dims: { width: number; height: number } }) {
  const [d, setD] = useState<{ path: string; ax: number; ay: number } | null>(null);
  useLayoutEffect(() => {
    if (!from || !plate || !region || !from.isConnected || window.innerWidth < 1100) {
      setD(null);
      return;
    }
    let raf = 0;
    const update = () => {
      if (!from.isConnected) {
        setD(null);
        return;
      }
      const pf = plate.querySelector('.plate-frame')!.getBoundingClientRect();
      const fr = from.getBoundingClientRect();
      const ax = pf.left + (region.anchor.x / dims.width) * pf.width;
      const ay = pf.top + (region.anchor.y / dims.height) * pf.height;
      const sx = fr.left - 6;
      const sy = Math.max(fr.top + 18, Math.min(fr.bottom - 10, fr.top + 18));
      const mx = (ax + sx) / 2;
      setD({ path: `M${sx} ${sy} C ${mx} ${sy}, ${mx} ${ay}, ${ax} ${ay}`, ax, ay });
      raf = requestAnimationFrame(update);
    };
    update();
    return () => cancelAnimationFrame(raf);
  }, [from, plate, region, dims.width, dims.height]);
  if (!d) return null;
  return (
    <svg className="leader-overlay" aria-hidden="true">
      <path d={d.path} stroke="var(--bg)" strokeWidth={5} fill="none" opacity={0.85} />
      <path d={d.path} stroke={BASIS_VAR[basis]} strokeWidth={2} fill="none" strokeDasharray={BASIS_INFO[basis].dash || undefined} />
      <circle cx={d.ax} cy={d.ay} r={6} fill="var(--bg)" />
      <circle cx={d.ax} cy={d.ay} r={4} fill={BASIS_VAR[basis]} />
    </svg>
  );
}

export function Workspace() {
  const params = useParams<{ id: string; tab?: string }>();
  const [, go] = useLocation();
  const health = useHealth((s) => s.state);
  const setPrior = usePrior((s) => s.set);
  const [entry, setEntry] = useState<PassportEntry | null | undefined>(undefined);
  const [photo, setPhoto] = useState<string | null>(null);
  const [view, setView] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [hoverRegion, setHoverRegion] = useState<string | null>(null);
  const [hot, setHot] = useState<{ f: Finding; el: HTMLElement } | null>(null);
  const [note, setNote] = useState('');
  const [picking, setPicking] = useState<'idle' | 'busy' | 'error' | 'background'>('idle');
  const plateRef = useRef<HTMLDivElement>(null);
  const tab = (TABS.find((t) => t.id === params.tab)?.id ?? 'profile') as TabId;
  useEffect(() => {
    setHot(null);
  }, [tab, params.id]);

  useEffect(() => {
    let url: string | null = null;
    void getEntry(params.id).then((e) => {
      setEntry(e);
      if (e?.images[0]) {
        url = URL.createObjectURL(e.images[0]);
        setPhoto(url);
      }
    });
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [params.id]);

  const profile = entry?.profile ?? null;

  const regionBasis = useMemo(() => {
    const m = new Map<string, Basis>();
    for (const f of profile?.findings ?? []) {
      for (const r of f.regionIds) {
        const cur = m.get(r);
        if (!cur || RANK(f.basis) < RANK(cur)) m.set(r, f.basis);
      }
    }
    return m;
  }, [profile]);

  const onHover = useCallback((f: Finding | null, el: HTMLElement | null) => setHot(f && el ? { f, el } : null), []);

  /** Saves a change on top of the latest stored entry, so slow parallel saves never undo each other. */
  const patch = async (change: Partial<PassportEntry>) => {
    if (!entry) return;
    const latest = (await getEntry(entry.id)) ?? entry;
    const next = { ...latest, ...change };
    await putEntry(next);
    setEntry(next);
  };
  const save = (p: Profile) => patch({ profile: p });

  if (entry === undefined) return <div className="wrap page-pad muted">Opening…</div>;
  if (!entry || !profile) {
    return (
      <div className="wrap page-pad">
        <h1>That profile is not on this device.</h1>
        <p className="muted">
          Profiles are kept in the browser that made them. <Link href="/passport">Open your Passport</Link>.
        </p>
      </div>
    );
  }

  const dims = profile.views[view] ?? profile.views[0]!;
  const regions = profile.regions.filter((r) => r.view === view);
  const active = hot ? hot.f.regionIds : selected ? [selected] : hoverRegion ? [hoverRegion] : [];
  const counts = tally(profile.findings);
  const fw = profile.trace.firewall;
  const toolCited = profile.findings.filter((f) => f.verification.status === 'tool_cited').length;
  const sample = profile.trace.mode === 'sample';
  const safetyTop = profile.safety.filter((s) => s.severity === 'warning' || s.severity === 'danger');
  const status = profile.identity.status;
  const selectRegion = (id: string) => {
    setSelected((s) => (s === id ? null : id));
    if (window.innerWidth < 1100) plateRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const canPick = health === 'live' && !sample && !!entry.images[view];
  const labelFor = (r: Region) => {
    // The outline's own label was checked against the image; it wins over names written later.
    const name = r.label || profile.components.find((c) => c.regionId === r.id)?.name || '';
    return name.charAt(0).toUpperCase() + name.slice(1);
  };

  /** Removes a wrong outline; findings and parts simply stop pointing at it. */
  const removeOutline = async (id: string) => {
    setSelected(null);
    await save({
      ...profile,
      regions: profile.regions.filter((r) => r.id !== id),
      findings: profile.findings.map((f) => (f.regionIds.includes(id) ? { ...f, regionIds: f.regionIds.filter((x) => x !== id) } : f)),
      components: profile.components.map((c) => (c.regionId === id ? { ...c, regionId: null } : c)),
    });
  };

  /** The part already marked at a point: inside its outline, or right on its dot. The whole object does not count. */
  const regionAt = (pt: { x: number; y: number }): Region | null => {
    const near = Math.max(dims.width, dims.height) * 0.035;
    const objectName = normalizeForMatch(profile.displayName);
    const isWhole = (r: Region) => r.area > 0.3 || normalizeForMatch(r.label) === objectName;
    const onDot = regions.find((r) => Math.hypot(r.anchor.x - pt.x, r.anchor.y - pt.y) < near);
    if (onDot) return onDot;
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = document.createElement('canvas').getContext('2d');
    } catch {
      ctx = null;
    }
    const inside = regions
      .filter((r) => !isWhole(r) && r.path && (ctx ? ctx.isPointInPath(new Path2D(r.path), pt.x, pt.y, 'evenodd') : pt.x >= r.box.x && pt.x <= r.box.x + r.box.w && pt.y >= r.box.y && pt.y <= r.box.y + r.box.h))
      .sort((a, b) => a.area - b.area);
    return inside[0] ?? null;
  };

  const pick = async (pt: { x: number; y: number }) => {
    if (!canPick || picking === 'busy') return;
    // Tapping a part that is already marked selects it; it never adds a second number.
    const existing = regionAt(pt);
    if (existing) {
      setPicking('idle');
      setSelected(existing.id);
      return;
    }
    setPicking('busy');
    try {
      const blob = entry.images[view]!;
      const b64 = await new Promise<string>((res) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result).replace(/^data:[^,]+,/, ''));
        r.readAsDataURL(blob);
      });
      const out = await segmentAt({ view: { mime: 'image/jpeg', base64: b64, width: dims.width, height: dims.height, label: null }, viewIndex: view, concept: null, points: [{ x: pt.x, y: pt.y, label: 'positive' }], box: null, object: profile.displayName, language: useSettings.getState().language });
      const start = profile.regions.length;
      // One outline per tap; a huge or unnamed outline is the background, not a part.
      const best = out.regions[0];
      const unnamed = !best || /^your selection$/i.test(best.label.trim());
      if (!best || best.label === 'background' || best.area > 0.45 || (unnamed && best.area > 0.2)) {
        setPicking('background');
        return;
      }
      // The same part found again (same name, or nearly the same place): select it instead of adding a copy.
      const iou = (a: Region['box'], b: Region['box']) => {
        const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
        const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
        const inter = ix * iy;
        return inter / (a.w * a.h + b.w * b.h - inter || 1);
      };
      const same = profile.regions.find(
        (r) => r.view === view && ((!unnamed && normalizeForMatch(r.label) === normalizeForMatch(best.label)) || iou(r.box, best.box) > 0.6),
      );
      if (same) {
        setSelected(same.id);
        setPicking('idle');
        return;
      }
      const added = [{ ...best, id: `r${Math.max(start, ...profile.regions.map((r) => Number(r.id.replace(/\D/g, '')) || 0)) + 1}`, label: unnamed ? `Part at ${describeLocation(pt.x, pt.y, dims.width, dims.height)}` : best.label, source: 'user' as const }];
      if (added.length) {
        await save({ ...profile, regions: [...profile.regions, ...added].slice(0, 60) });
        setSelected(added[0]!.id);
      }
      setPicking('idle');
    } catch {
      setPicking('error');
    }
  };

  const panel = (() => {
    switch (tab) {
      case 'parts':
        return (
          <Inside
            profile={profile}
            photoBlob={entry.images[0] ?? null}
            illustration={entry.illustration ?? null}
            cutaway={entry.cutaway ?? null}
            onRegion={selectRegion}
            onSaveProfile={save}
            onSaveCutaway={(c) => patch({ cutaway: c })}
          />
        );
      case 'history':
        return (
          <div className="stack-lg">
            <section>
              <h3 className="ledger-title">Timeline</h3>
              <Timeline profile={profile} />
            </section>
            <Ledger profile={profile} sections={['history']} onRegion={selectRegion} onHover={onHover} hotId={hot?.f.id ?? null} />
            {profile.related.length > 0 && (
              <section>
                <h3 className="ledger-title">Related things</h3>
                <Related profile={profile} />
              </section>
            )}
            <section>
              <h3 className="ledger-title">Object graph</h3>
              <ObjectGraph profile={profile} />
            </section>
          </div>
        );
      case 'whatif':
        return profile.whatIf.length ? (
          <div className="stack-lg">
            {profile.whatIf.map((w) => (
              <WhatIfCard key={w.id} w={w} profile={profile} />
            ))}
          </div>
        ) : (
          <p className="muted">No what-if questions for this object.</p>
        );
      case 'sources':
        return <Sources profile={profile} />;
      case 'ask':
        return <Ask profile={profile} view={entry.images[view] ? { blob: entry.images[view]!, width: dims.width, height: dims.height } : null} regionId={selected} onRegion={selectRegion} />;
      default:
        return (
          <div className="stack-lg">
            {safetyTop.length > 0 && (
              <section className="safety-strip" aria-label="Safety">
                {safetyTop.map((s) => (
                  <p key={s.id} className={`safety safety-${s.severity}`}>
                    <Icon name="alert" />
                    <span>
                      <strong>{s.severity === 'danger' ? 'Danger' : 'Warning'}.</strong> {s.text}
                      {s.advice ? ` ${s.advice}` : ''}
                      {s.professionalReview ? <em className="pro"> Ask a qualified professional.</em> : null}
                    </span>
                  </p>
                ))}
              </section>
            )}
            {status === 'identified' && profile.candidates.length > 1 && (
              <details className="also">
                <summary>
                  Also considered: {profile.candidates.slice(1).map((c) => c.name).join(', ')}
                </summary>
                <Tournament profile={profile} />
              </details>
            )}
            {status !== 'identified' && (
              <section aria-labelledby="ident-h" className="identity-block">
                <h3 id="ident-h" className="ledger-title">
                  {status === 'candidates' ? 'Not settled yet' : 'Could not identify it'}
                </h3>
                <Tournament profile={profile} />
                <NextShot
                  profile={profile}
                  onTake={() => {
                    setPrior(digestOf(profile), profile.nextShot?.instruction ?? null);
                    go('/scan');
                  }}
                />
              </section>
            )}
            <SecondOpinion profile={profile} />
            {profile.conflicts.length > 0 && (
              <section className="conflicts" aria-labelledby="conf-h">
                <h3 id="conf-h" className="ledger-title">
                  Where the evidence disagrees
                </h3>
                {profile.conflicts.map((c) => (
                  <p key={c.id} className="conflict">
                    <Icon name="compare" size={18} /> {c.description}
                  </p>
                ))}
              </section>
            )}
            <Ledger profile={profile} onRegion={selectRegion} onHover={onHover} hotId={hot?.f.id ?? null} />
            {profile.textRead.length > 0 && (
              <section>
                <h3 className="ledger-title">Markings read from the photo</h3>
                <ul className="markings">
                  {profile.textRead.map((t, i) => (
                    <li key={i}>
                      <span className="mono">“{t.text}”</span>
                      {t.location && <span className="muted small"> · {t.location}</span>}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {profile.openQuestions.length > 0 && (
              <section>
                <h3 className="ledger-title">Open questions</h3>
                <ul className="open-qs">
                  {profile.openQuestions.map((q) => (
                    <li key={q}>{q}</li>
                  ))}
                </ul>
              </section>
            )}
            <form
              className="note-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (!note.trim()) return;
                void save(withNote(profile, note.trim(), new Date().toISOString()));
                setNote('');
              }}
            >
              <label className="field">
                <span>Add what you know (shown as “Yours”, never graded)</span>
                <textarea className="textarea" value={note} onChange={(e) => setNote(e.target.value)} maxLength={700} placeholder="Where it came from, who used it, what it is called in your family…" />
              </label>
              <button type="submit" className="btn btn-secondary btn-sm" disabled={!note.trim()}>
                <Icon name="pen" size={16} /> Add note
              </button>
            </form>
          </div>
        );
    }
  })();

  return (
    <div className="ws">
      <header className="ws-head wrap">
        <div className="ws-tags">
          <span className="eyebrow">{CATEGORY_LABEL[profile.category]}</span>
          <span className={`status-chip st-${status}`}>{status === 'identified' ? 'Identified' : status === 'candidates' ? 'Not certain yet' : 'Unidentified'}</span>
          {sample && <span className="status-chip st-sample">Sample run</span>}
          {profile.trace.mode === 'recorded' && <span className="status-chip st-sample">Recorded example · {new Date(profile.trace.startedAt).toLocaleDateString()}</span>}
        </div>
        <h1 className="ws-title">{profile.displayName}</h1>
        <p className="ws-summary voice">{cleanSummary(profile.summary)}</p>
        <div className="ws-meta">
          <span className="ws-tally" aria-label="Findings by evidence">
            {(['observed', 'sourced', 'inferred', 'hypothesis', 'unknown', 'user'] as Basis[])
              .filter((b) => counts[b])
              .map((b) => (
                <span key={b} title={BASIS_INFO[b].meaning}>
                  <Glyph basis={b} size={11} /> <span className="num">{counts[b]}</span> {BASIS_INFO[b].label}
                </span>
              ))}
          </span>
          <span className="ws-fw">
            <Icon name="shield" size={16} /> {fw.citationsVerified} of {fw.citationsClaimed} quotes match their page word for word
            {toolCited ? ` · ${toolCited} backed by a web search only` : ''}
            {fw.downgraded ? ` · ${fw.downgraded} marked less certain` : ''}
            {fw.guarded ? ` · ${fw.guarded} safety rule${fw.guarded > 1 ? 's' : ''}` : ''}
          </span>
          <span className="ws-actions no-print">
            <Link href={`/p/${profile.id}/report`} className="btn btn-quiet btn-sm" hidden={__PREVIEW__}>
              <Icon name="printer" size={16} /> Report
            </Link>
            <Link href={`/compare?a=${profile.id}`} className="btn btn-quiet btn-sm">
              <Icon name="compare" size={16} /> Compare
            </Link>
            <ConfirmButton
              confirmLabel="Click again to delete"
              onConfirm={async () => {
                await deleteEntry(profile.id);
                go('/passport');
              }}
            >
              <Icon name="trash" size={16} /> Delete
            </ConfirmButton>
          </span>
        </div>
      </header>

      <div className="ws-body wrap">
        <aside className="ws-plate" ref={plateRef} aria-label="Photo">
          {photo ? (
            <Plate
              src={photo}
              width={dims.width}
              height={dims.height}
              alt={`Photo of ${profile.displayName}. ${regions.length} parts outlined.`}
              regions={regions}
              active={active}
              onSelect={selectRegion}
              onHover={setHoverRegion}
              outlines="all"
              colourNumbers
              object={profile}
              onPick={canPick ? pick : undefined}
              labelFor={labelFor}
            />
          ) : (
            <div className="plate-missing">The photo is not stored for this profile.</div>
          )}
          <div className="plate-tools">
            {profile.views.length > 1 && (
              <div className="segmented" role="tablist" aria-label="Views">
                {profile.views.map((v, i) => (
                  <button key={i} type="button" role="tab" aria-selected={view === i} onClick={() => setView(i)}>
                    {v.label ?? `View ${i + 1}`}
                  </button>
                ))}
              </div>
            )}
            <p className="small muted">
              {canPick
                ? picking === 'busy'
                  ? 'Outlining…'
                  : picking === 'error'
                    ? 'That could not be outlined. Try another spot.'
                    : picking === 'background'
                      ? 'That spot is the background. Tap on the object itself.'
                    : 'Tap a name to focus on its part, or tap anything else in the photo to add it.'
                : regions.some((r) => r.kind === 'point')
                  ? 'Dashed rings are approximate locations: outlining was not available.'
                  : 'Numbers match the chips beside each finding.'}
            </p>
            {selected && profile.regions.some((r) => r.id === selected) && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => void removeOutline(selected)}>
                <Icon name="trash" size={15} /> Remove this outline
              </button>
            )}
          </div>
          <ol className="region-list">
            {regions.map((r) => {
              const b = regionBasis.get(r.id);
              return (
                <li key={r.id}>
                  <button type="button" className={`region-row ${active.includes(r.id) ? 'on' : ''}`} onClick={() => selectRegion(r.id)} onMouseEnter={() => setHoverRegion(r.id)} onMouseLeave={() => setHoverRegion(null)}>
                    <span className="region-num num" style={{ background: partColour(r.id), color: '#14181c' }}>
                      {regionNumber(r.id)}
                    </span>
                    <span className="region-label">{labelFor(r)}</span>
                    {b && <Glyph basis={b} size={11} />}
                    {r.kind === 'point' && <span className="small muted">approx.</span>}
                  </button>
                </li>
              );
            })}
          </ol>
          {selected && (
            <p className="small selected-note">
              Part {regionNumber(selected)} selected.{' '}
              <Link href={`/p/${profile.id}/ask`}>Ask about it</Link> ·{' '}
              <button type="button" className="link-btn" onClick={() => setSelected(null)}>
                Clear
              </button>
            </p>
          )}
        </aside>

        <section className="ws-main">
          <nav className="tabs no-print" aria-label="Profile sections">
            {TABS.map((t) => (
              <Link key={t.id} href={`/p/${profile.id}${t.id === 'profile' ? '' : `/${t.id}`}`} className={`tab ${tab === t.id ? 'on' : ''}`} aria-current={tab === t.id ? 'page' : undefined}>
                <Icon name={t.icon} size={16} />
                {t.label}
                {t.id === 'whatif' && profile.whatIf.length ? <span className="tab-count num">{profile.whatIf.length}</span> : null}
                {t.id === 'sources' && profile.sources.length ? <span className="tab-count num">{profile.sources.length}</span> : null}
              </Link>
            ))}
          </nav>
          <div className="panel">{panel}</div>
        </section>
      </div>
      {hot && hot.f.regionIds[0] && (
        <Leader from={hot.el} plate={plateRef.current} region={regions.find((r) => r.id === hot.f.regionIds[0]) ?? null} basis={hot.f.basis} dims={dims} />
      )}
    </div>
  );
}
