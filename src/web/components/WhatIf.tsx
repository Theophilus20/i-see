/**
 * The What-if Lab. Numbers come only from calc.ts: a checked calculation with its
 * assumptions on sliders, the working shown, a sweep across one assumption, and a
 * ranking of which assumptions move the answer most.
 */
import { useId, useMemo, useState, type PointerEvent } from 'react';
import { WHATIF_KIND_LABEL, type Profile, type WhatIf } from '@shared/schema';
import { formatNumber, formatQuantity, runWhatIf, sensitivity, sweepWhatIf } from '@shared/calc';
import { Icon } from './Icon';

const ORIGIN: Record<string, string> = { assumed: 'Assumed', measured: 'Measured', sourced: 'From a source' };

function niceTicks(lo: number, hi: number, count = 4): number[] {
  const span = hi - lo || Math.abs(hi) || 1;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) ?? step0;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Number(v.toPrecision(12)));
  return out;
}

function SweepChart({ w, values }: { w: WhatIf; values: Record<string, number> }) {
  const sweep = useMemo(() => sweepWhatIf(w, w.sweepKey, values), [w, values]);
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const titleId = useId();
  if (!sweep) return null;
  const a = w.assumptions.find((x) => x.key === sweep.key)!;
  const rs = w.steps.find((s) => s.key === sweep.resultKey)!;
  const W = 520;
  const H = 220;
  const m = { l: 52, r: 16, t: 14, b: 40 };
  const ymin = Math.min(0, ...sweep.y);
  const ymax = Math.max(...sweep.y) * 1.08 || 1;
  const xs = (v: number) => m.l + ((v - a.min) / (a.max - a.min)) * (W - m.l - m.r);
  const ys = (v: number) => H - m.b - ((v - ymin) / (ymax - ymin)) * (H - m.t - m.b);
  const d = sweep.x.map((x, i) => `${i ? 'L' : 'M'}${xs(x).toFixed(1)} ${ys(sweep.y[i]!).toFixed(1)}`).join(' ');
  const cur = values[sweep.key] ?? a.value;
  const curRun = runWhatIf(w, values);
  const curY = curRun.ok && curRun.result ? curRun.result.value : null;
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    sweep.x.forEach((x, i) => {
      if (Math.abs(xs(x) - px) < Math.abs(xs(sweep.x[best]!) - px)) best = i;
    });
    setHover(best);
  };
  const hx = hover != null ? sweep.x[hover]! : null;
  const hy = hover != null ? sweep.y[hover]! : null;
  return (
    <figure className="sweep">
      <figcaption id={titleId} className="sweep-title">
        {rs.label} as {a.label.toLowerCase()} changes
        <button type="button" className="link-btn" onClick={() => setTable(!table)}>
          {table ? 'Show chart' : 'Show as table'}
        </button>
      </figcaption>
      {table ? (
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">
                {a.label} ({a.unit || 'number'})
              </th>
              <th scope="col">
                {rs.label} ({rs.unit || 'number'})
              </th>
            </tr>
          </thead>
          <tbody>
            {sweep.x
              .filter((_, i) => i % 5 === 0 || i === sweep.x.length - 1)
              .map((x, k) => (
                <tr key={k}>
                  <td className="num">{formatNumber(x)}</td>
                  <td className="num">{formatNumber(sweep.y[sweep.x.indexOf(x)]!)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="sweep-svg" role="img" aria-labelledby={titleId} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
          {niceTicks(ymin, ymax).map((t) => (
            <g key={t}>
              <line x1={m.l} x2={W - m.r} y1={ys(t)} y2={ys(t)} className="grid" />
              <text x={m.l - 8} y={ys(t)} className="tick" textAnchor="end" dominantBaseline="middle">
                {formatNumber(t)}
              </text>
            </g>
          ))}
          {niceTicks(a.min, a.max, 5).map((t) => (
            <text key={t} x={xs(t)} y={H - m.b + 18} className="tick" textAnchor="middle">
              {formatNumber(t)}
            </text>
          ))}
          <text x={(m.l + W - m.r) / 2} y={H - 4} className="axis-label" textAnchor="middle">
            {a.label} ({a.unit || 'number'})
          </text>
          <text x={12} y={m.t + 2} className="axis-label" dominantBaseline="hanging">
            {rs.unit}
          </text>
          <path d={d} className="sweep-line" />
          {curY != null && (
            <g>
              <line x1={xs(cur)} x2={xs(cur)} y1={m.t} y2={H - m.b} className="cur-rule" />
              <circle cx={xs(cur)} cy={ys(curY)} r={5.5} className="cur-dot" />
            </g>
          )}
          {hx != null && hy != null && (
            <g className="hover" pointerEvents="none">
              <line x1={xs(hx)} x2={xs(hx)} y1={m.t} y2={H - m.b} className="cross" />
              <circle cx={xs(hx)} cy={ys(hy)} r={4.5} className="hover-dot" />
              <g transform={`translate(${Math.min(xs(hx) + 10, W - 150)} ${Math.max(m.t, ys(hy) - 44)})`}>
                <rect width={140} height={38} rx={6} className="tip" />
                <text x={10} y={15} className="tip-k">
                  {formatNumber(hx)} {a.unit}
                </text>
                <text x={10} y={30} className="tip-v">
                  {formatNumber(hy)} {rs.unit}
                </text>
              </g>
            </g>
          )}
          <rect x={m.l} y={m.t} width={W - m.l - m.r} height={H - m.t - m.b} fill="transparent" />
        </svg>
      )}
    </figure>
  );
}

function Sensitivity({ w, values }: { w: WhatIf; values: Record<string, number> }) {
  const s = useMemo(() => sensitivity(w, values), [w, values]);
  if (s.length < 2) return null;
  const max = Math.max(...s.map((x) => x.swing)) || 1;
  const rs = w.steps.find((x) => x.key === w.resultKey)!;
  return (
    <div className="sens">
      <p className="sens-title">What moves the answer most</p>
      <ol>
        {s.map((x) => (
          <li key={x.key}>
            <span className="sens-name">{x.label}</span>
            <span className="sens-bar" aria-hidden="true">
              <span style={{ width: `${Math.max(1.5, (x.swing / max) * 100)}%` }} />
            </span>
            <span className="sens-range num">
              {(() => {
                const lo = formatQuantity(Math.min(x.atMin, x.atMax), rs.unit);
                const hi = formatQuantity(Math.max(x.atMin, x.atMax), rs.unit);
                return lo.unit === hi.unit ? `${lo.num}–${hi.num} ${hi.unit}` : `${lo.num} ${lo.unit} – ${hi.num} ${hi.unit}`;
              })()}
            </span>
          </li>
        ))}
      </ol>
      <p className="small muted">Each bar: the answer across that assumption’s whole range, with the others as set.</p>
    </div>
  );
}

export function WhatIfCard({ w, profile }: { w: WhatIf; profile: Profile }) {
  const [values, setValues] = useState<Record<string, number>>({});
  const [working, setWorking] = useState(false);
  const run = useMemo(() => runWhatIf(w, values), [w, values]);
  const numeric = w.kind === 'calculation' && run.ok && run.result;
  const sources = w.sourceIds.map((id) => profile.sources.find((s) => s.id === id)).filter(Boolean);
  return (
    <article className={`whatif kind-${w.kind}`}>
      <header className="whatif-head">
        <span className={`kind-badge kind-${w.kind}`}>{WHATIF_KIND_LABEL[w.kind]}</span>
        <h3>{w.title}</h3>
        <p className="muted">{w.question}</p>
      </header>

      {numeric && run.ok && run.result ? (
        <div className="whatif-grid">
          <div className="whatif-result" aria-live="polite">
            {(() => {
              const q = formatQuantity(run.result.value, run.result.unit);
              return (
                <>
                  <span className={`result-num num ${q.num.length > 7 ? 'long' : ''}`}>{q.num}</span>
                  <span className="result-unit">{q.unit}</span>
                </>
              );
            })()}
            <span className="result-label">{run.result.label}</span>
          </div>
          <div className="assumptions">
            {w.assumptions.map((a) => {
              const v = values[a.key] ?? a.value;
              return (
                <label key={a.key} className="assumption">
                  <span className="a-top">
                    <span className="a-label">{a.label}</span>
                    <span className="a-val num">
                      {formatNumber(v, 4)} {a.unit}
                    </span>
                  </span>
                  <input type="range" min={a.min} max={a.max} step={a.step} value={v} onChange={(e) => setValues({ ...values, [a.key]: Number(e.target.value) })} />
                  <span className="a-foot">
                    <span className={`origin origin-${a.origin}`}>{ORIGIN[a.origin]}</span>
                    {a.note && <span className="muted">{a.note}</span>}
                  </span>
                </label>
              );
            })}
            {Object.keys(values).length > 0 && (
              <button type="button" className="link-btn" onClick={() => setValues({})}>
                <Icon name="undo" size={14} /> Reset to the starting values
              </button>
            )}
          </div>
        </div>
      ) : null}

      <p className="whatif-summary">{w.summary}</p>

      {numeric && <SweepChart w={w} values={values} />}
      {numeric && <Sensitivity w={w} values={values} />}

      {numeric && run.ok && (
        <div className="working">
          <button type="button" className="link-btn" aria-expanded={working} onClick={() => setWorking(!working)}>
            {working ? 'Hide' : 'Show'} the working <Icon name="chevronDown" size={14} />
          </button>
          {working && (
            <table className="data-table working-table">
              <thead>
                <tr>
                  <th scope="col">Step</th>
                  <th scope="col">Expression</th>
                  <th scope="col">Value</th>
                </tr>
              </thead>
              <tbody>
                {run.steps.map((s) => (
                  <tr key={s.key}>
                    <th scope="row">{s.label}</th>
                    <td>
                      <code>
                        {s.key} = {s.expr}
                      </code>
                    </td>
                    <td className="num">
                      {formatNumber(s.value, 4)} {s.unit}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {working && <p className="small muted">Evaluated by I SEE’s own calculator, which also checks that every step’s units are consistent. The AI wrote the steps; the numbers come from the calculator, not the AI.</p>}
        </div>
      )}

      {w.caveats.length > 0 && (
        <ul className="caveats">
          {w.caveats.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      )}
      {w.safety && (
        <p className="notice warn">
          <Icon name="alert" /> {w.safety}
        </p>
      )}
      {sources.length > 0 && (
        <p className="small muted">
          Background:{' '}
          {sources.map((s) => (
            <a key={s!.id} href={s!.url} target="_blank" rel="noopener noreferrer">
              {s!.title}
            </a>
          ))}
        </p>
      )}
    </article>
  );
}
