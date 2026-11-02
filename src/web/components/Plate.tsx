/**
 * The plate: a photograph with its outlined regions.
 * Outlines are SVG paths in image pixels (from SAM 3.1 masks). Markers are real
 * buttons, so the regions can be reached by keyboard and are announced with a
 * plain-language position.
 */
import { forwardRef, useId, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import type { Basis } from '@shared/epistemics';
import { wholeObjectIds } from '@shared/whole';
import type { Region } from '@shared/schema';
import { describeLocation, describeSize } from '@shared/text';
import { BASIS_VAR, dashFor } from './Evidence';

export interface PlateProps {
  src: string;
  width: number;
  height: number;
  alt: string;
  regions: Region[];
  active?: string[];
  onSelect?: (id: string) => void;
  onHover?: (id: string | null) => void;
  basisFor?: (id: string) => Basis | undefined;
  outlines?: 'all' | 'active' | 'none';
  markers?: boolean;
  /** Animate outlines drawing in. */
  drawIn?: boolean;
  onPick?: (pt: { x: number; y: number }) => void;
  className?: string;
  caption?: string;
  /** Name each marker on the photo (a label pill with a leader line). */
  labelFor?: (r: Region) => string;
  /** Drawn over the image and under the outlines and labels (e.g. a comparison layer). */
  overlay?: ReactNode;
  /** Every part highlighted at once in its own colour (a soft fill and a crisp edge). */
  tint?: boolean;
  /** Fine white outlines (as on the home page), with each part's number in its own colour. */
  colourNumbers?: boolean;
  /**
   * What the object is: its own outline (the whole object) is then drawn with a dashed edge and
   * no name pin, since its name is the title and a pin would land on some part and read wrong.
   */
  object?: { displayName: string; category: string; subcategory?: string | null; candidates?: Array<{ name: string; likelihood?: number }>; summary?: string } | null;
}

/** Part colours: distinct from each other, readable on light and dark photos. */
export const PART_COLOURS = ['#ff6b6b', '#4dabf7', '#ffd43b', '#69db7c', '#da77f2', '#ff922b', '#38d9a9', '#f783ac', '#a9e34b', '#748ffc', '#ffa94d', '#66d9e8'];
export const partColour = (id: string) => PART_COLOURS[(Number(id.replace(/\D/g, '')) || 1) % PART_COLOURS.length]!;

export const regionNumber = (id: string): string => id.replace(/^r/, '');

export const Plate = forwardRef<HTMLDivElement, PlateProps>(function Plate(
  { src, width, height, alt, regions, active = [], onSelect, onHover, basisFor, outlines = 'all', markers = true, drawIn = false, onPick, className, caption, labelFor, overlay, tint = false, colourNumbers = false, object = null },
  ref,
) {
  const uid = useId().replace(/:/g, '');
  const activeSet = useMemo(() => new Set(active), [active]);
  const wholeIds = useMemo(() => (object ? wholeObjectIds(regions, object) : []), [regions, object]);
  const spot = activeSet.size > 0;
  const stroke = Math.max(2, Math.min(width, height) / 300);

  const handlePick = (e: MouseEvent<HTMLDivElement>) => {
    if (!onPick) return;
    const r = e.currentTarget.getBoundingClientRect();
    onPick({ x: ((e.clientX - r.left) / r.width) * width, y: ((e.clientY - r.top) / r.height) * height });
  };

  return (
    <figure className={`plate ${className ?? ''}`} ref={ref}>
      <div className="plate-frame" style={{ aspectRatio: `${width} / ${height}` }} onClick={onPick ? handlePick : undefined} data-pick={onPick ? 'true' : undefined}>
        <img src={src} alt={alt} width={width} height={height} draggable={false} />
        {overlay}
        <svg className="plate-svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <mask id={`spot-${uid}`}>
              <rect width={width} height={height} fill="white" />
              {regions
                .filter((r) => activeSet.has(r.id))
                .map((r) =>
                  r.path ? (
                    <path key={r.id} d={r.path} fill="black" fillRule="evenodd" />
                  ) : (
                    <circle key={r.id} cx={r.anchor.x} cy={r.anchor.y} r={Math.max(r.box.w, r.box.h) * 0.9} fill="black" />
                  ),
                )}
            </mask>
          </defs>
          <rect className={`plate-scrim ${spot ? 'on' : ''}`} width={width} height={height} mask={`url(#spot-${uid})`} />
          {tint &&
            [...regions]
              .filter((r) => r.path && r.kind !== 'box' && r.kind !== 'point')
              // The whole object's own outline only when it is chosen: the parts are the picture.
              .filter((r) => !(object && wholeIds.includes(r.id)) || activeSet.has(r.id))
              // Big parts underneath, small parts on top.
              .sort((a, b) => b.area - a.area)
              .map((r) => {
                const on = activeSet.has(r.id);
                const c = partColour(r.id);
                const whole = wholeIds.includes(r.id) || (!object && r.area > 0.25);
                // Calm by default (a light tint and a fine edge), so the photo stays readable;
                // the chosen part is shown strongly and the rest fade.
                return (
                  <g key={`t-${r.id}`} className={`plate-tint ${on ? 'on' : ''} ${spot && !on ? 'dim' : ''}`}>
                    <path d={r.path!} fillRule="evenodd" fill={whole ? 'none' : c} fillOpacity={on ? 0.4 : 0.13} stroke="rgb(0 0 0 / 0.5)" strokeWidth={stroke * (on ? 2.8 : 1.7)} strokeLinejoin="round" />
                    <path d={r.path!} fillRule="evenodd" fill="none" stroke={c} strokeWidth={stroke * (on ? 1.5 : 0.85)} strokeLinejoin="round" strokeDasharray={whole && !on ? `${stroke * 3} ${stroke * 2.5}` : undefined} />
                  </g>
                );
              })}
          {regions.map((r) => {
            const on = activeSet.has(r.id);
            if (tint) return null;
            if (outlines === 'none' || (outlines === 'active' && !on)) return null;
            // The whole object's own outline only when it is chosen: the parts are the picture.
            if (wholeIds.includes(r.id) && !on) return null;
            const basis = basisFor?.(r.id);
            const color = basis ? BASIS_VAR[basis] : 'var(--plate-line, #ffffff)';
            // A box is only a rough location: it gets a marker, not a rectangle drawn round it.
            if (r.kind === 'box') return null;
            if (r.kind === 'point' || !r.path) {
              return (
                <circle
                  key={r.id}
                  className={`plate-ring ${on ? 'on' : ''}`}
                  cx={r.anchor.x}
                  cy={r.anchor.y}
                  r={stroke * 7}
                  fill="none"
                  stroke={color}
                  strokeWidth={stroke}
                  strokeDasharray={`${stroke * 2} ${stroke * 2}`}
                />
              );
            }
            return (
              <g key={r.id} className={`plate-region ${on ? 'on' : ''} ${spot && !on ? 'dim' : ''}`}>
                <path d={r.path} fillRule="evenodd" className="halo" strokeWidth={stroke * 2.6} />
                <path
                  d={r.path}
                  fillRule="evenodd"
                  className={`edge ${drawIn ? 'draw' : ''}`}
                  pathLength={drawIn ? 1 : undefined}
                  stroke={color}
                  strokeWidth={on ? stroke * 1.4 : stroke}
                  strokeDasharray={drawIn ? undefined : basis ? dashFor(basis)?.split(' ').map((n) => Number(n) * stroke * 0.6).join(' ') : undefined}
                />
              </g>
            );
          })}
        </svg>
        {markers && labelFor ? (
          <PlateLabels
            regions={wholeIds.length ? regions.filter((r) => !wholeIds.includes(r.id) || activeSet.has(r.id)) : regions}
            width={width}
            height={height}
            active={activeSet}
            labelFor={labelFor}
            onSelect={onSelect}
            onHover={onHover}
            tint={tint || colourNumbers}
          />
        ) : (
          markers &&
          regions.map((r) => {
            const on = activeSet.has(r.id);
            const where = describeLocation(r.anchor.x, r.anchor.y, width, height);
            return (
              <button
                key={r.id}
                type="button"
                className={`plate-marker ${on ? 'on' : ''} ${r.kind === 'point' ? 'approx' : ''}`}
                style={{ left: `${(r.anchor.x / width) * 100}%`, top: `${(r.anchor.y / height) * 100}%` }}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect?.(r.id);
                }}
                onMouseEnter={() => onHover?.(r.id)}
                onMouseLeave={() => onHover?.(null)}
                onFocus={() => onHover?.(r.id)}
                onBlur={() => onHover?.(null)}
                aria-pressed={on}
                aria-label={`${regionNumber(r.id)}: ${r.label}, ${r.kind === 'point' ? 'approximate location' : `${describeSize(r.area)} area`} at ${where}`}
              >
                {regionNumber(r.id)}
              </button>
            );
          })
        )}
      </div>
      {caption ? <figcaption>{caption}</figcaption> : null}
    </figure>
  );
});

/**
 * Named markers: a dot on the part, a leader line, and a pill with the part's number
 * and name. Pills are laid out after measuring, so they do not sit on top of each other.
 */
function PlateLabels({
  regions,
  width,
  height,
  active,
  labelFor,
  onSelect,
  onHover,
  tint = false,
}: {
  regions: Region[];
  width: number;
  height: number;
  active: Set<string>;
  labelFor: (r: Region) => string;
  onSelect?: (id: string) => void;
  onHover?: (id: string | null) => void;
  tint?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<{ w: number; h: number; pos: Record<string, { x: number; y: number; w: number; h: number; ax: number; ay: number; left: boolean }> } | null>(null);
  const [compact, setCompact] = useState(false);

  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const run = () => {
      const W = el.clientWidth;
      const H = el.clientHeight;
      if (!W || !H) return;
      const small = W < 520;
      setCompact(small);
      const pills = [...el.querySelectorAll<HTMLElement>('.plate-pill')];
      const size = new Map(pills.map((p) => [p.dataset.id!, { w: p.offsetWidth, h: p.offsetHeight }]));
      // Boundary labelling (as in reference-book diagrams): the names sit in a column down each
      // side, not on top of the object, each joined to its part by a straight leader. Within a
      // column the names keep the top-to-bottom order of their parts, so leaders do not cross.
      const pos: Record<string, { x: number; y: number; w: number; h: number; ax: number; ay: number; left: boolean }> = {};
      const margin = 8;
      const gap = 4;
      const items = regions.map((r) => ({ r, ax: (r.anchor.x / width) * W, ay: (r.anchor.y / height) * H, sz: size.get(r.id) ?? { w: 90, h: 26 } }));
      const rowH = Math.max(22, ...items.map((i) => i.sz.h));
      const perSide = Math.max(1, Math.floor((H - 2 * margin + gap) / (rowH + gap)));
      const left = items.filter((i) => i.ax < W / 2);
      const right = items.filter((i) => i.ax >= W / 2);
      // Balance the columns: move the parts nearest the middle across.
      while (left.length > Math.max(right.length + 2, 0) || left.length > perSide) {
        if (right.length >= perSide) break;
        left.sort((a, b) => a.ax - b.ax);
        right.push(left.pop()!);
      }
      while (right.length > left.length + 2 || right.length > perSide) {
        if (left.length >= perSide) break;
        right.sort((a, b) => b.ax - a.ax);
        left.push(right.pop()!);
      }
      const place = (col: typeof items, onLeft: boolean) => {
        col.sort((a, b) => a.ay - b.ay);
        const ys = col.map((i) => i.ay - i.sz.h / 2);
        for (let k = 0; k < col.length; k++) ys[k] = Math.max(ys[k]!, k ? ys[k - 1]! + col[k - 1]!.sz.h + gap : margin);
        for (let k = col.length - 1; k >= 0; k--) ys[k] = Math.min(ys[k]!, k < col.length - 1 ? ys[k + 1]! - col[k]!.sz.h - gap : H - margin - col[k]!.sz.h);
        col.forEach((i, k) => {
          const y = Math.max(margin / 2, ys[k]!);
          pos[i.r.id] = { x: onLeft ? margin : W - margin - i.sz.w, y, w: i.sz.w, h: i.sz.h, ax: i.ax, ay: i.ay, left: onLeft };
        });
      };
      place(left, true);
      place(right, false);
      setLayout({ w: W, h: H, pos });
    };
    run();
    const ro = new ResizeObserver(run);
    ro.observe(el);
    return () => ro.disconnect();
  }, [regions, width, height, labelFor]);

  const spot = active.size > 0;
  return (
    <div className={`plate-labels ${compact ? 'compact' : ''}`} ref={host}>
      {layout && (
        <svg className="plate-leaders" width={layout.w} height={layout.h} aria-hidden="true">
          {regions.map((r) => {
            const p = layout.pos[r.id];
            if (!p) return null;
            const on = active.has(r.id);
            if (compact && !on) return null;
            const tx = p.left ? p.x + p.w : p.x;
            const ty = p.y + p.h / 2;
            return (
              <g key={r.id} className={`leader ${on ? 'on' : ''} ${spot && !on ? 'dim' : ''}`}>
                <line x1={p.ax} y1={p.ay} x2={tx} y2={ty} />
                <circle cx={p.ax} cy={p.ay} r={on ? 5 : 4} />
              </g>
            );
          })}
        </svg>
      )}
      {regions.map((r) => {
        const on = active.has(r.id);
        const p = layout?.pos[r.id];
        const where = describeLocation(r.anchor.x, r.anchor.y, width, height);
        const name = labelFor(r);
        const style = compact && !on
          ? { left: `${(r.anchor.x / width) * 100}%`, top: `${(r.anchor.y / height) * 100}%` }
          : p
            ? { left: `${p.x}px`, top: `${p.y}px` }
            : { left: `${(r.anchor.x / width) * 100}%`, top: `${(r.anchor.y / height) * 100}%`, visibility: 'hidden' as const };
        return (
          <button
            key={r.id}
            data-id={r.id}
            type="button"
            className={`plate-pill ${on ? 'on' : ''} ${spot && !on ? 'dim' : ''} ${compact && !on ? 'dot' : ''} ${r.kind === 'point' ? 'approx' : ''}`}
            style={style}
            onClick={(e) => {
              e.stopPropagation();
              onSelect?.(r.id);
            }}
            onMouseEnter={() => onHover?.(r.id)}
            onMouseLeave={() => onHover?.(null)}
            onFocus={() => onHover?.(r.id)}
            onBlur={() => onHover?.(null)}
            aria-pressed={on}
            aria-label={`${regionNumber(r.id)}: ${name}, ${r.kind === 'point' ? 'approximate location' : `${describeSize(r.area)} area`} at ${where}`}
          >
            <b className="num" style={tint ? { background: partColour(r.id), color: '#14181c' } : undefined}>
              {regionNumber(r.id)}
            </b>
            <span className="plate-pill-name">{name}</span>
          </button>
        );
      })}
    </div>
  );
}
