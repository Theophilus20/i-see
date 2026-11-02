/** Timeline with uncertainty, related objects, and the object graph. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, type SimulationLinkDatum, type SimulationNodeDatum } from 'd3-force';
import type { Profile } from '@shared/schema';
import { cleanDisplayName } from '@shared/assemble';
import { BasisTag } from './Evidence';
import { prefersReducedMotion } from '../lib/settings';

const STRAND: Record<'maker' | 'kind' | 'item', string> = {
  item: 'This item',
  maker: 'The maker',
  kind: 'This kind of object',
};

export function Timeline({ profile }: { profile: Profile }) {
  const events = profile.timeline;
  if (!events.length) return <p className="muted">No dated history was found for this object.</p>;
  const fmap = new Map(profile.findings.map((f) => [f.id, f]));
  const smap = new Map(profile.sources.map((s) => [s.id, s]));
  const fmt = (y: number) => (y < 0 ? `${-y} BCE` : String(y));
  const strands = (['item', 'maker', 'kind'] as const).map((k) => [k, events.filter((e) => (e.strand ?? 'kind') === k).sort((a, b) => a.from - b.from)] as const).filter(([, list]) => list.length);
  return (
    <div className="timeline">
      {strands.map(([k, list]) => {
        const lo = Math.min(...list.map((e) => e.from));
        const hi = Math.max(...list.map((e) => e.to ?? e.from), new Date().getFullYear());
        const span = Math.max(1, hi - lo);
        const pos = (y: number) => ((y - lo) / span) * 100;
        return (
          <section key={k} className="tl-strand" aria-label={STRAND[k]}>
            {strands.length > 1 && <h4 className="tl-strand-title">{STRAND[k]}</h4>}
            <div className="tl-axis" aria-hidden="true">
              <span style={{ left: '0%' }}>{fmt(lo)}</span>
              <span style={{ left: '100%' }}>{fmt(hi)}</span>
              {list.map((e) => (
                <i key={e.id} className={e.approx ? 'approx' : ''} style={{ left: `${pos(e.from)}%`, width: e.to ? `${pos(e.to) - pos(e.from)}%` : undefined }} />
              ))}
            </div>
            <ol className="tl-list">
              {list.map((e) => {
                const f = fmap.get(e.findingId);
                const src = f?.sourceIds.map((id) => smap.get(id)).find(Boolean);
                return (
                  <li key={e.id}>
                    <span className="tl-year num">
                      {e.approx ? 'c. ' : ''}
                      {fmt(e.from)}
                      {e.to ? `–${fmt(e.to)}` : ''}
                    </span>
                    <div>
                      <p className="tl-label">{e.label}</p>
                      {e.detail && <p className="muted small">{e.detail}</p>}
                      <p className="tl-meta">
                        {f && <BasisTag basis={f.basis} />}
                        {src && (
                          <a href={src.url} target="_blank" rel="noreferrer" className="tl-src">
                            {src.publisher}: {src.title}
                          </a>
                        )}
                        {e.approx && <span className="small muted">approximate: no source gives this date</span>}
                      </p>
                      {f?.quote && f.verification.status === 'verified' && <blockquote className="tl-quote">“{f.quote}”</blockquote>}
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}
    </div>
  );
}

interface GNode extends SimulationNodeDatum {
  id: string;
  label: string;
  kind: 'object' | 'part' | 'related' | 'source';
}

/** One short name for a node: no hedges, no second or scientific name ("Brown rat, Rattus norvegicus" → "Brown rat"). */
const nodeName = (s: string) => {
  const one = cleanDisplayName(s).split(/,\s+|\s+[–—]\s+|\s+\/\s+/)[0]!.trim();
  return (one.split(/\s+(?:with|wearing|holding|on)\s+/i)[0] ?? one).trim() || s;
};

/** Up to two lines of about `max` characters, broken between words. */
const wrapLabel = (s: string, max = 20): string[] => {
  const words = s.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (!cur) cur = w;
    else if ((cur + ' ' + w).length <= max) cur += ' ' + w;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length <= 2) return lines;
  const second = lines.slice(1).join(' ');
  return [lines[0]!, second.length > max + 2 ? `${second.slice(0, max).trimEnd()}…` : second];
};

export function ObjectGraph({ profile }: { profile: Profile }) {
  const { nodes, links } = useMemo(() => {
    const nodes: GNode[] = [{ id: 'o', label: nodeName(profile.displayName), kind: 'object' }];
    const links: Array<SimulationLinkDatum<GNode> & { kind: string }> = [];
    for (const c of profile.components.slice(0, 14)) {
      nodes.push({ id: c.id, label: nodeName(c.name), kind: 'part' });
      links.push({ source: c.parentId ?? 'o', target: c.id, kind: 'part' });
    }
    for (const r of profile.related.slice(0, 8)) {
      nodes.push({ id: r.id, label: nodeName(r.name), kind: 'related' });
      links.push({ source: 'o', target: r.id, kind: 'related' });
    }
    // One node per publisher (several Wikipedia pages are one "Wikipedia · 3 pages" node),
    // linked to what it supports: a related object it is cited for, or the object itself.
    const findingById = new Map(profile.findings.map((f) => [f.id, f]));
    const byPublisher = new Map<string, { label: string; ids: Set<string>; urls: Set<string> }>();
    for (const s of profile.sources) {
      const key = (s.publisher || s.title).trim().toLowerCase();
      const g = byPublisher.get(key) ?? { label: s.publisher || s.title, ids: new Set<string>(), urls: new Set<string>() };
      g.ids.add(s.id);
      g.urls.add(s.url);
      byPublisher.set(key, g);
    }
    [...byPublisher.values()].slice(0, 8).forEach((g, i) => {
      const id = `src-${i}`;
      const pages = g.urls.size;
      nodes.push({ id, label: pages > 1 ? `${g.label} · ${pages} pages` : g.label, kind: 'source' });
      const targets = new Set<string>();
      for (const r of profile.related.slice(0, 8)) {
        const f = r.findingId ? findingById.get(r.findingId) : undefined;
        if (f && f.sourceIds.some((x) => g.ids.has(x))) targets.add(r.id);
      }
      if (!targets.size) targets.add('o');
      targets.forEach((t) => links.push({ source: t, target: id, kind: 'source' }));
    });
    return { nodes, links };
  }, [profile]);
  const [, setTick] = useState(0);
  const W = 640;
  const H = 400;
  const sim = useRef<ReturnType<typeof forceSimulation<GNode>> | null>(null);
  useEffect(() => {
    const s = forceSimulation(nodes)
      .force('link', forceLink<GNode, SimulationLinkDatum<GNode>>(links).id((d) => d.id).distance((l) => ((l as unknown as { kind: string }).kind === 'part' ? 70 : 120)))
      .force('charge', forceManyBody().strength(-260))
      .force('center', forceCenter(W / 2, H / 2))
      .force('collide', forceCollide(42));
    sim.current = s;
    if (prefersReducedMotion()) {
      s.stop();
      for (let i = 0; i < 300; i++) s.tick();
      setTick(1);
    } else s.on('tick', () => setTick((t) => t + 1));
    return () => {
      s.stop();
    };
  }, [nodes, links]);
  const clampX = (x = 0) => Math.max(24, Math.min(W - 24, x));
  const clampY = (y = 0) => Math.max(44, Math.min(H - 16, y));
  return (
    <figure className="graph">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Object graph: ${profile.displayName} linked to ${profile.components.length} parts, ${profile.related.length} related objects and ${profile.sources.length} sources.`}>
        {links.map((l, i) => {
          const s = l.source as GNode;
          const t = l.target as GNode;
          return <line key={i} x1={clampX(s.x)} y1={clampY(s.y)} x2={clampX(t.x)} y2={clampY(t.y)} className={`g-link g-${(l as { kind: string }).kind}`} />;
        })}
        {nodes.map((n) => {
          const x = clampX(n.x);
          const y = clampY(n.y);
          const lines = wrapLabel(n.label, n.kind === 'object' ? 24 : 20);
          // Keep the whole label inside the picture: shift it sideways near the edges.
          const width = Math.max(...lines.map((l) => l.length)) * (n.kind === 'object' ? 7.4 : 6.6);
          const dx = Math.max(6 + width / 2, Math.min(W - 6 - width / 2, x)) - x;
          const lineH = n.kind === 'object' ? 15 : 13;
          const top = (n.kind === 'object' ? -18 : -11) - (lines.length - 1) * lineH;
          return (
            <g key={n.id} transform={`translate(${x} ${y})`} className={`g-node g-${n.kind}`}>
              <title>{n.label}</title>
              <circle r={n.kind === 'object' ? 12 : n.kind === 'part' ? 6 : 7} />
              <text x={dx} y={top} textAnchor="middle">
                {lines.map((l, i) => (
                  <tspan key={i} x={dx} dy={i ? lineH : 0}>
                    {l}
                  </tspan>
                ))}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="graph-key">
        <span>
          <i className="k-part" /> Parts
        </span>
        <span>
          <i className="k-related" /> Related objects
        </span>
        <span>
          <i className="k-source" /> Sources
        </span>
      </figcaption>
    </figure>
  );
}

export function Related({ profile }: { profile: Profile }) {
  if (!profile.related.length) return null;
  const fmap = new Map(profile.findings.map((f) => [f.id, f]));
  return (
    <ul className="related">
      {profile.related.map((r) => (
        <li key={r.id}>
          <span className="rel-name">{r.name}</span>
          <span className="muted">{r.relation}</span>
          {r.findingId && fmap.get(r.findingId) && <BasisTag basis={fmap.get(r.findingId)!.basis} compact />}
        </li>
      ))}
    </ul>
  );
}
