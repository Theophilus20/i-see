/**
 * How it works inside: every part on its own card (what it does, how it works), the
 * groups the parts belong to, the flows that run through them, a labelled cutaway drawn
 * from the photo. Every card carries its evidence grade.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { CutawayView, type SavedCutaway } from './CutawayView';
import { digestOf, type Component, type Finding, type Inside as InsideData, type Profile, type Region } from '@shared/schema';
import type { Hazard } from '@shared/epistemics';
import { assembleInside } from '@shared/inside';
import { Icon, type IconName } from './Icon';
import { BasisTag } from './Evidence';
import { regionNumber } from './Plate';
import { explainInside, userMessage } from '../lib/api';
import { useHealth } from '../lib/health';
import { useSettings } from '../lib/settings';
import { recordedForProfile, sampleForProfile } from '../lib/samples';

const KIND: Record<InsideData['kind'], { title: string; groups: string; flows: string; icon: IconName }> = {
  living: {
    title: 'How it lives',
    groups: 'Body systems and parts',
    flows: 'How it works in real life',
    icon: 'eye',
  },
  machine: {
    title: 'How it works',
    groups: 'Parts and what they do',
    flows: 'How it works, step by step',
    icon: 'settings',
  },
  natural: {
    title: 'What it is made of',
    groups: 'Layers and materials',
    flows: 'How it formed',
    icon: 'layers',
  },
  structure: {
    title: 'How it is built',
    groups: 'Parts and what they carry',
    flows: 'How it holds together',
    icon: 'layers',
  },
  other: {
    title: 'How it works',
    groups: 'Parts and what they do',
    flows: 'How it works, step by step',
    icon: 'settings',
  },
};

const hazardsOf = (p: Profile) => [...new Set(p.safety.map((s) => s.hazard))] as Hazard[];

/** The inside view for a profile: saved, prepared (samples), or null if it still has to be made. */
function useInsideData(profile: Profile): InsideData | null {
  return useMemo(() => {
    if (profile.inside) return profile.inside;
    const sample = sampleForProfile(profile);
    if (sample?.spec.inside) {
      return assembleInside({
        draft: sample.spec.inside,
        regions: profile.regions,
        sources: profile.sources,
        category: profile.category,
        hazards: hazardsOf(profile),
        now: profile.createdAt,
      });
    }
    return null;
  }, [profile]);
}

// ---------------------------------------------------------------------------

function PartCard({
  part,
  finding,
  profile,
  n,
  hot,
  setHot,
  onRegion,
}: {
  part: InsideData['groups'][number]['parts'][number];
  finding: Finding | undefined;
  profile: Profile;
  n: number;
  hot: boolean;
  setHot: (id: string | null) => void;
  onRegion: (id: string) => void;
}) {
  const src = finding?.sourceIds.map((id) => profile.sources.find((s) => s.id === id)).find(Boolean);
  return (
    <article
      className={`ipart ${part.visible ? 'seen' : 'hidden'} ${hot ? 'hot' : ''}`}
      onMouseEnter={() => setHot(part.regionId ?? part.name)}
      onMouseLeave={() => setHot(null)}
      onFocus={() => setHot(part.regionId ?? part.name)}
      onBlur={() => setHot(null)}
    >
      <header className="ipart-head">
        <span className={`ipart-num ${part.visible ? '' : 'inside'}`} aria-hidden="true">
          {part.visible && part.regionId ? regionNumber(part.regionId) : n}
        </span>
        <h5>{part.name}</h5>
        {finding && <BasisTag basis={finding.basis} compact />}
      </header>
      <dl className="ipart-body">
        <div>
          <dt>What it does</dt>
          <dd>{part.what}</dd>
        </div>
        <div>
          <dt>How it works</dt>
          <dd>{part.how}</dd>
        </div>
      </dl>
      <footer className="ipart-foot">
        {part.visible && part.regionId ? (
          <button type="button" className="ipart-link" onClick={() => onRegion(part.regionId!)}>
            <Icon name="target" size={14} /> Show on photo
          </button>
        ) : (
          <span className="ipart-hidden">
            <Icon name="eyeOff" size={14} /> Inside, not visible in the photo
          </span>
        )}
        {src && (
          <a className="ipart-src" href={src.url} target="_blank" rel="noreferrer">
            {src.publisher || src.title}
            <Icon name="external" size={12} />
          </a>
        )}
      </footer>
    </article>
  );
}

function Flow({ flow, finding, index }: { flow: InsideData['flows'][number]; finding: Finding | undefined; index: number }) {
  return (
    <section className="iflow" aria-labelledby={`flow-${flow.id}`}>
      <header className="iflow-head">
        <h5 id={`flow-${flow.id}`}>
          <span className="iflow-idx num">{String(index + 1).padStart(2, '0')}</span>
          {flow.title}
        </h5>
        {finding && <BasisTag basis={finding.basis} />}
      </header>
      <p className="iflow-sum">{flow.summary}</p>
      <ol className="iflow-steps" style={{ ['--n' as string]: flow.steps.length }}>
        {flow.steps.map((s, i) => (
          <li key={i} style={{ ['--i' as string]: i }}>
            <span className="iflow-dot num" aria-hidden="true">
              {i + 1}
            </span>
            <strong>{s.label}</strong>
            <span>{s.detail}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function PartsList({ comps, onRegion }: { comps: Component[]; onRegion: (id: string) => void }) {
  return (
    <ul className="parts-tree">
      {comps.map((c) => (
        <li key={c.id} className={`part ${c.visible ? 'seen' : 'hidden'}`}>
          <span className="part-name">{c.name}</span>
          <span className="part-role">{c.role}</span>
          <span className="part-where">
            {c.visible && c.regionId ? (
              <button type="button" className="region-chip" onClick={() => onRegion(c.regionId!)} aria-label={`Show ${c.name} on the photo`}>
                {regionNumber(c.regionId)}
              </button>
            ) : (
              <span className="hidden-tag">Not in the photo</span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------

export interface InsideProps {
  profile: Profile;
  photoBlob: Blob | null;
  illustration: Blob | null;
  cutaway: SavedCutaway | null;
  onRegion: (id: string) => void;
  onSaveProfile: (p: Profile) => Promise<void>;
  onSaveCutaway: (c: SavedCutaway) => Promise<void>;
}

export function Inside({ profile, photoBlob, illustration, cutaway, onRegion, onSaveProfile, onSaveCutaway }: InsideProps) {
  const health = useHealth((s) => s.state);
  const settings = useSettings();
  const inside = useInsideData(profile);
  const sample = profile.trace.mode === 'sample';
  const recorded = recordedForProfile(profile);
  const [hot, setHot] = useState<string | null>(null);
  const [state, setState] = useState<{ inside: 'idle' | 'busy' | 'error'; error: string | null }>({ inside: 'idle', error: null });
  const started = useRef<{ inside?: string }>({});
  const online = health === 'live';

  // Work out the inside view for live profiles that do not have one yet.
  const makeInside = async () => {
    started.current.inside = profile.id;
    setState((s) => ({ ...s, inside: 'busy', error: null }));
    try {
      const r = await explainInside({
        digest: digestOf(profile),
        regions: profile.regions.map((x) => ({ ...x, path: null })),
        sources: profile.sources,
        hazards: hazardsOf(profile),
        route: settings.route,
        language: settings.language,
        privacyTier: settings.privacyTier,
      });
      // The pages looked up for the inside join the profile's sources, so their citations resolve.
      const known = new Set(profile.sources.map((x) => x.id));
      await onSaveProfile({ ...profile, inside: r.inside, sources: [...profile.sources, ...r.sources.filter((x) => !known.has(x.id))] });
      setState((s) => ({ ...s, inside: 'idle' }));
    } catch (e) {
      const code = (e as { code?: string }).code ?? '';
      const general = ['offline', 'interrupted', 'rate_limited', 'busy', 'provider_paused', 'unconfigured'].includes(code);
      setState((s) => ({
        ...s,
        inside: 'error',
        error: general ? userMessage(e) : 'How it works inside could not be worked out this time. Please try again.',
      }));
    }
  };
  useEffect(() => {
    if (inside || sample || !online || started.current.inside === profile.id) return;
    void makeInside();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inside, sample, online, profile.id]);

  const insideSettled = !!inside || state.inside === 'error';

  const findingById = useMemo(() => new Map((inside?.findings ?? []).map((f) => [f.id, f])), [inside]);
  const kind = KIND[inside?.kind ?? 'other'];
  let n = 0;

  return (
    <div className="inside">
      <header className="inside-head">
        <p className="eyebrow">
          <Icon name={kind.icon} size={14} /> {kind.title}
        </p>
        <h3>{profile.displayName}</h3>
        {inside ? <p className="inside-intro">{inside.intro}</p> : null}
      </header>

      <div className="inside-stage">
        <CutawayView
          profile={profile}
          inside={inside}
          insideSettled={insideSettled}
          photoBlob={photoBlob}
          saved={cutaway}
          legacy={illustration}
          recordedUrl={recorded?.cutaway ?? null}
          recordedData={recorded?.cutawayData ?? null}
          onSave={onSaveCutaway}
        />
      </div>

      {inside ? (
        <>
          <section aria-labelledby="groups-h" className="inside-groups">
            <h4 id="groups-h" className="ledger-title">
              {kind.groups}
            </h4>
            {inside.groups.map((g) => (
              <section key={g.id} className="igroup" aria-label={g.name}>
                <header className="igroup-head">
                  <h5>{g.name}</h5>
                  <p>{g.role}</p>
                </header>
                <div className="ipart-grid">
                  {g.parts.map((p) => {
                    n += 1;
                    return <PartCard key={p.id} part={p} finding={findingById.get(p.findingId)} profile={profile} n={n} hot={hot === (p.regionId ?? p.name)} setHot={setHot} onRegion={onRegion} />;
                  })}
                </div>
              </section>
            ))}
          </section>
          {inside.flows.length > 0 && (
            <section aria-labelledby="flows-h" className="inside-flows">
              <h4 id="flows-h" className="ledger-title">
                {kind.flows}
              </h4>
              {inside.flows.map((f, i) => (
                <Flow key={f.id} flow={f} finding={findingById.get(f.findingId)} index={i} />
              ))}
            </section>
          )}
          <p className="small muted inside-note">
            <Icon name="info" size={14} /> Parts marked “inside” cannot be seen in the photo. What is said about them comes from cited sources or from reasoning about this kind of object, and each card shows which.
          </p>
        </>
      ) : state.inside === 'busy' ? (
        <div className="inside-loading" role="status">
          <span className="cutaway-scan" aria-hidden="true" />
          <p>Looking up what is really inside and how each part works…</p>
          <p className="cutaway-sub">This can take a minute or two: the inside is researched and every part is checked against its sources.</p>
        </div>
      ) : (
        <section aria-labelledby="parts-h">
          {state.inside === 'error' ? (
            <div className="notice">
              <p>{state.error}</p>
              <button type="button" className="btn btn-secondary" onClick={() => void makeInside()}>
                Try again
              </button>
            </div>
          ) : !online && !sample ? (
            <p className="notice">The full inside view is made when I SEE is online. Here are the parts found so far.</p>
          ) : null}
          <h4 id="parts-h" className="ledger-title">
            Parts
          </h4>
          {profile.components.length ? <PartsList comps={profile.components} onRegion={onRegion} /> : <p className="muted">No parts were listed for this object.</p>}
        </section>
      )}
    </div>
  );
}
