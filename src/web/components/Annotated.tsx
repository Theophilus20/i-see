/**
 * A photo with annotation cards placed beside it and leader lines drawn from each
 * card to the part it describes. Positions are measured, so the lines meet the
 * right pixels at any size.
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { BASIS_INFO } from '@shared/epistemics';
import type { Callout } from '../lib/samples';
import { BASIS_VAR, Glyph } from './Evidence';

interface Placed {
  c: Callout;
  side: 'left' | 'right';
  cardY: number;
  ax: number;
  ay: number;
  ex: number;
}

export function Annotated({ children, photoSelector, callouts, width, height, hot, setHot }: { children: ReactNode; photoSelector: string; callouts: Callout[]; width: number; height: number; hot: string | null; setHot: (id: string | null) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = useState<Placed[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      const photo = el.querySelector(photoSelector);
      if (!photo) return;
      const b = el.getBoundingClientRect();
      const p = photo.getBoundingClientRect();
      setSize({ w: b.width, h: b.height });
      const items = callouts.map((c) => {
        const ax = p.left - b.left + (c.region.anchor.x / width) * p.width;
        const ay = p.top - b.top + (c.region.anchor.y / height) * p.height;
        const side: 'left' | 'right' = c.region.anchor.x / width < 0.5 ? 'left' : 'right';
        return { c, side, ax, ay, cardY: ay, ex: side === 'left' ? 186 : b.width - 186 };
      });
      // Keep cards on each side from overlapping.
      for (const side of ['left', 'right'] as const) {
        const col = items.filter((i) => i.side === side).sort((a, b2) => a.ay - b2.ay);
        let floor = 70;
        for (const it of col) {
          it.cardY = Math.max(it.ay, floor);
          floor = it.cardY + 132;
        }
        const overflow = (col.at(-1)?.cardY ?? 0) - (b.height - 60);
        if (overflow > 0) for (const it of col) it.cardY -= overflow;
      }
      setPlaced(items);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    const img = el.querySelector('img');
    img?.addEventListener('load', measure);
    return () => {
      ro.disconnect();
      img?.removeEventListener('load', measure);
    };
  }, [callouts, photoSelector, width, height]);

  return (
    <div className="annotated" ref={box}>
      {children}
      <svg className="annotated-lines" width={size.w} height={size.h} aria-hidden="true">
        {placed.map((p) => {
          const d = `M${p.ax} ${p.ay} C ${(p.ax + p.ex) / 2} ${p.ay}, ${(p.ax + p.ex) / 2} ${p.cardY}, ${p.ex} ${p.cardY}`;
          return (
            <g key={p.c.region.id} className={`a-line ${hot === p.c.region.id ? 'on' : ''}`}>
              <path d={d} stroke="rgb(255 255 255 / 0.85)" strokeWidth={4} fill="none" />
              <path d={d} stroke={BASIS_VAR[p.c.basis]} strokeWidth={2} fill="none" strokeDasharray={BASIS_INFO[p.c.basis].dash || undefined} />
              <circle cx={p.ax} cy={p.ay} r={6} fill="#fff" />
              <circle cx={p.ax} cy={p.ay} r={3.8} fill={BASIS_VAR[p.c.basis]} />
            </g>
          );
        })}
      </svg>
      {placed.map((p) => (
        <button
          key={p.c.region.id}
          type="button"
          className={`a-card a-${p.side}`}
          style={{ top: p.cardY }}
          onMouseEnter={() => setHot(p.c.region.id)}
          onMouseLeave={() => setHot(null)}
          onFocus={() => setHot(p.c.region.id)}
          onBlur={() => setHot(null)}
        >
          <span className="a-title">{p.c.title}</span>
          <span className="a-text">{p.c.text}</span>
          <span className="a-basis">
            <Glyph basis={p.c.basis} size={10} /> {BASIS_INFO[p.c.basis].label}
          </span>
        </button>
      ))}
    </div>
  );
}
