import { useMemo, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { BASES, BASIS_INFO } from '@shared/epistemics';
import { formatNumber, runWhatIf } from '@shared/calc';
import type { Region, WhatIf } from '@shared/schema';
import { moka } from '@fixtures/samples/moka';
import { Icon } from '../components/Icon';
import { Glyph } from '../components/Evidence';
import { Plate } from '../components/Plate';
import { EXAMPLES, calloutsFor, doubtExample, type Callout, type Example } from '../lib/samples';
import { useRun } from '../lib/run';
import { useHealth } from '../lib/health';

/** A finished scan, shown big: the photo with every part named, and what I SEE found. */
function HeroScan({ ex, callouts, hot, setHot }: { ex: Example; callouts: Callout[]; hot: string | null; setHot: (id: string | null) => void }) {
  const names = ex.candidates.filter((c) => !c.out);
  const top = names[0]?.name ?? ex.title;
  const tally = (['observed', 'sourced', 'inferred', 'hypothesis'] as const).map((b) => [b, ex.pinned.filter((f) => f.basis === b).length] as const).filter(([, n]) => n > 0);
  const label = (r: Region) => r.label.charAt(0).toUpperCase() + r.label.slice(1);
  return (
    <div className="hero-scan">
      <div className="hs-frame">
        <Plate src={ex.photo} width={ex.width} height={ex.height} alt={`${ex.title}, with ${ex.regions.length} parts outlined and named.`} regions={ex.regions} active={hot ? [hot] : []} outlines="all" markers drawIn labelFor={label} onHover={setHot} />
        <span className="hs-corner tl" aria-hidden="true" />
        <span className="hs-corner tr" aria-hidden="true" />
        <span className="hs-corner bl" aria-hidden="true" />
        <span className="hs-corner br" aria-hidden="true" />
        <span className="hs-beam" aria-hidden="true" />
        <span className="hs-hud" aria-hidden="true">
          <span className="hs-live" /> Scan complete · {ex.regions.length} parts
        </span>
      </div>
      <div className="hs-panel">
        <div className="hs-id">
          <p className="hs-kicker">{ex.status === 'identified' ? 'Identified' : ex.status === 'candidates' ? 'Not settled yet' : 'Not identified'}</p>
          <p className="hs-title">{top}</p>
          <div className="hs-tally">
            {tally.map(([b, n]) => (
              <span key={b}>
                <Glyph basis={b} size={9} /> {n} {BASIS_INFO[b].label}
              </span>
            ))}
          </div>
        </div>
        <ul className="hs-claims">
          {callouts.map((c) => (
            <li key={c.region.id} className={hot === c.region.id ? 'on' : ''} onMouseEnter={() => setHot(c.region.id)} onMouseLeave={() => setHot(null)}>
              <span className="hs-claim-head">
                <Glyph basis={c.basis} size={10} /> {c.title}
              </span>
              <span className="hs-claim-text">{c.text}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function demoWhatIf(): WhatIf | null {
  const d = moka.extras.whatIf.find((w) => w.kind === 'calculation');
  if (!d) return null;
  return { id: 'demo', ...d } as WhatIf;
}

function WhatIfDemo() {
  const w = useMemo(demoWhatIf, []);
  const [power, setPower] = useState(1200);
  if (!w) return null;
  const r = runWhatIf(w, { P: power });
  const value = r.ok && r.result ? r.result.value : null;
  return (
    <div className="demo-calc">
      <div className="demo-result">
        <span className="num">{value == null ? '—' : formatNumber(value)}</span>
        <span>minutes to brew</span>
      </div>
      <label className="demo-slider" htmlFor="demo-power">
        <span>
          Burner power <strong className="num">{formatNumber(power, 4)} W</strong>
        </span>
        <input id="demo-power" type="range" min={400} max={3500} step={50} value={power} onChange={(e) => setPower(Number(e.target.value))} />
      </label>
      <p className="demo-foot">Worked out by I SEE’s own calculator, with every assumption on a slider and the units checked.</p>
    </div>
  );
}

export function Home() {
  const [, go] = useLocation();
  const startExample = useRun((s) => s.startExample);
  const health = useHealth((s) => s.state);
  const hero = EXAMPLES[0]!;
  const callouts = useMemo(() => calloutsFor(hero, 2), [hero]);
  const doubt = doubtExample();
  const [hot, setHot] = useState<string | null>(null);
  const open = (id: string) => {
    void startExample(id);
    go('/run');
  };
  const ledger = hero.pinned.filter((f) => f.basis !== 'unknown').slice(0, 4);

  return (
    <div className="home">
      <section className="hero surface-dark" aria-labelledby="hero-title">
        <div className="hero-inner wrap">
          <div className="hero-copy">
            <p className="hero-kicker">
              <span className="dot" /> Point · Outline · Explain
            </p>
            <h1 id="hero-title" className="hero-title">
              See anything.
              <br />
              Know what’s true about it.
            </h1>
            <p className="hero-lede">
              Take a photo of any object. I SEE outlines its parts, explains how it works, what it’s made of and how to look after it, and shows where every single claim comes from.
            </p>
            <div className="hero-actions">
              <Link href="/scan" className="btn btn-primary btn-lg">
                <Icon name="camera" /> Examine a photo
              </Link>
              <button type="button" className="btn btn-ghost btn-lg" onClick={() => open(hero.id)}>
                Watch an example
              </button>
            </div>
            <ul className="hero-facts">
              <li>
                <Icon name="check" size={16} /> Every claim graded
              </li>
              <li>
                <Icon name="check" size={16} /> Sources checked word for word
              </li>
              <li>
                <Icon name="check" size={16} /> Photos never stored
              </li>
            </ul>
            {health !== 'live' && health !== 'checking' ? <p className="hero-note">Try the examples now. Scanning your own photos switches on as soon as I SEE is online.</p> : null}
          </div>
          <div className="hero-visual">
            <HeroScan ex={hero} callouts={callouts} hot={hot} setHot={setHot} />
            <p className="hero-caption">{hero.kind === 'recorded' ? `Recorded example: ${hero.title}` : 'Sample run on a rendered photo'}</p>
          </div>
        </div>
      </section>

      <section className="steps wrap" aria-labelledby="steps-title">
        <header className="section-head">
          <p className="eyebrow">How it works</p>
          <h2 id="steps-title">From a photo to a profile you can check.</h2>
        </header>
        <ol className="step-cards">
          <li className="step">
            <div className="step-media viewfinder">
              <img src={hero.photo} alt="" />
              <span className="vf vf-tl" />
              <span className="vf vf-tr" />
              <span className="vf vf-bl" />
              <span className="vf vf-br" />
              <span className="step-hints">
                <span className="hint ok">
                  <Icon name="check" size={13} /> Sharp
                </span>
                <span className="hint ok">
                  <Icon name="check" size={13} /> Well lit
                </span>
              </span>
            </div>
            <h3>
              <span className="step-n">1</span> Point
            </h3>
            <p>Take a photo, or a few angles. The camera tells you if it’s blurred or too dark before anything is sent.</p>
          </li>
          <li className="step">
            <div className="step-media">
              <Plate src={hero.photo} width={hero.width} height={hero.height} alt="" regions={hero.regions} outlines="all" markers />
            </div>
            <h3>
              <span className="step-n">2</span> Outline
            </h3>
            <p>Every part is traced on your photo, so each sentence can point at the exact pixels it’s about.</p>
          </li>
          <li className="step">
            <div className="step-media step-ledger">
              <ul>
                {ledger.slice(0, 3).map((f) => (
                  <li key={f.text}>
                    <Glyph basis={f.basis} size={11} />
                    <span>
                      {f.text.length > 70 ? `${f.text.slice(0, 68)}…` : f.text}
                      <em>{BASIS_INFO[f.basis].label}</em>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <h3>
              <span className="step-n">3</span> Explain
            </h3>
            <p>What it is, how it works, what’s inside, its history and how to care for it, each claim marked with how it’s known.</p>
          </li>
        </ol>
      </section>

      <section className="bento wrap" aria-label="What you get">
        <article className="tile tile-evidence">
          <div>
            <p className="eyebrow">Evidence on every line</p>
            <h2>Seen, cited, reasoned or a guess. Always said.</h2>
            <p className="muted">Quotes are checked against the sources word for word. A claim that can’t be backed up is marked down, and the profile tells you why.</p>
          </div>
          <ul className="key-list">
            {BASES.map((b) => (
              <li key={b}>
                <Glyph basis={b} size={12} />
                <strong>{BASIS_INFO[b].label}</strong>
                <span>{BASIS_INFO[b].meaning}</span>
              </li>
            ))}
          </ul>
        </article>

        <article className="tile tile-private surface-dark">
          <Icon name="lock" size={28} />
          <h2>Private by design.</h2>
          <ul>
            <li>Location data is removed on your phone, before anything is sent.</li>
            <li>Nothing is sent until you agree to what will be sent.</li>
            <li>Our server keeps nothing. Your history stays in your browser.</li>
          </ul>
        </article>

        {doubt && (
          <article className="tile tile-doubt">
            <p className="eyebrow">When it isn’t sure</p>
            <h2>It shows the contest, then asks for the photo that settles it.</h2>
            <ol className="mini-tournament">
              {doubt.candidates.slice(0, 3).map((c) => (
                <li key={c.name} className={c.out ? 'out' : undefined}>
                  <span className="mt-name">{c.name}</span>
                  <span className="mt-bar" aria-hidden="true">
                    <span style={{ width: `${Math.max(2, c.likelihood * 100)}%` }} />
                  </span>
                  <span className="mt-val num">{c.out ? 'ruled out' : `${Math.round(c.likelihood * 100)}%`}</span>
                </li>
              ))}
            </ol>
            {doubt.nextShot && (
              <div className="next-shot-card">
                <Icon name="camera" size={18} />
                <p>{doubt.nextShot.instruction}</p>
              </div>
            )}
          </article>
        )}

        <article className="tile tile-whatif">
          <p className="eyebrow">What if</p>
          <h2>Change an assumption. Watch the answer move.</h2>
          <WhatIfDemo />
        </article>
      </section>

      <section className="examples wrap" aria-labelledby="ex-title">
        <header className="section-head">
          <p className="eyebrow">Examples</p>
          <h2 id="ex-title">Open one and look around.</h2>
        </header>
        <div className="example-grid">
          {EXAMPLES.slice(0, 6).map((ex) => (
            <button key={ex.id} type="button" className="example-card" onClick={() => open(ex.id)}>
              <span className="example-photo">
                <img src={ex.photo} alt="" loading="lazy" />
                <span className={`example-tag ${ex.kind}`}>{ex.kind === 'recorded' ? 'Recorded example' : 'Sample run'}</span>
              </span>
              <span className="example-meta">
                <span className="example-title">{ex.title}</span>
                <span className="muted">{ex.blurb}</span>
              </span>
              <span className="example-go">
                Open <Icon name="arrowRight" size={16} />
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="cta-band surface-dark">
        <div className="wrap cta-inner">
          <h2>Point it at something near you.</h2>
          <Link href="/scan" className="btn btn-primary btn-lg">
            <Icon name="camera" /> Examine a photo
          </Link>
        </div>
      </section>
    </div>
  );
}
