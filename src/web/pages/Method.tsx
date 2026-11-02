import { Link } from 'wouter';
import { BASES, BASIS_CONFIDENCE_CAP, BASIS_INFO, SOURCE_TIERS } from '@shared/epistemics';
import { ROUTES } from '@shared/schema';
import { STAGE_LABEL } from '@shared/orchestrator';
import { ALLOWED_FUNCTIONS } from '@shared/calc';
import { Glyph } from '../components/Evidence';
import { ROUTE_INFO } from '../lib/settings';

const STAGES: Array<[keyof typeof STAGE_LABEL, string, string]> = [
  ['intake', 'On your device', 'Decodes the photo with the camera’s orientation, scales it to at most 2048 px and re-encodes it as JPEG. That removes EXIF data, including GPS location.'],
  ['quality', 'On your device', 'Measures blur (variance of the Laplacian), brightness and blown highlights, so the camera can say “hold still” before anything is sent.'],
  ['identify', 'AI vision', 'Describes what is visible before naming anything, reads markings verbatim, proposes up to five candidate identities with evidence for and against, and names the visible parts worth outlining.'],
  ['segment', 'Outlining', 'Outlines every instance of each named part. Claims point at these outlines. If outlining is unavailable, rough pins are shown as dashed rings, labelled approximate.'],
  ['retrieve', 'Reference sources', 'Looks the candidates up: encyclopedias, museum collections, product-safety recall databases, species and product databases, repair guides, and web search with citations. Failures are reported, never hidden.'],
  ['compose', 'AI writing', 'Writes the profile in two parallel calls, grading every sentence and quoting sources word for word.'],
  ['reconcile', 'I SEE’s own checks', 'The firewall. Checks each quote against the retrieved text, removes references to regions or sources that do not exist, caps confidence by basis, requires authoritative sources for safety claims, replaces unsafe assurances, and checks every calculation’s units.'],
  ['resolve', 'AI reasoning', 'Runs only when the evidence is split. Re-weighs the candidates from text alone and chooses the single most informative next photo or check.'],
];

const LIMITS = [
  'It cannot tell from a photo whether a plant, mushroom, food, pill or chemical is safe. It will say so, every time.',
  'It cannot confirm authenticity, age, value or condition without a source that says so.',
  'Model confidence is not a calibrated probability. Strength words and capped bars are used instead of percentages.',
  'The inside drawing shows only what is inside (for a living thing its skeleton and organs, for a machine its inner parts with the casing taken away), drawn in your photo’s pose and checked against it. It shows what is typically inside this kind of object; the part cards are the checked information.',
  'Sources can be wrong. A verified quote proves the source said it, not that it is true; tiers show how much weight each deserves.',
  'Sample runs replay prepared results. They show how the app behaves; they are not evidence about any real object. Recorded examples are real analyses, replayed.',
];

export function Method() {
  return (
    <div className="wrap page-pad method">
      <header className="page-head">
        <div>
          <p className="eyebrow">How it works</p>
          <h1>What happens to a photo, and why you can check every sentence.</h1>
        </div>
      </header>

      <section aria-labelledby="pipe-h" className="method-section">
        <h2 id="pipe-h">The pipeline</h2>
        <ol className="method-stages">
          {STAGES.map(([id, who, what], i) => (
            <li key={id}>
              <span className="ms-num num">{i + 1}</span>
              <div>
                <p className="ms-title">
                  {STAGE_LABEL[id]} <span className="ms-who">{who}</span>
                </p>
                <p className="muted">{what}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="ev-h" className="method-section">
        <h2 id="ev-h">The evidence policy</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Grade</th>
              <th scope="col">Promise</th>
              <th scope="col">Strength can reach</th>
            </tr>
          </thead>
          <tbody>
            {BASES.map((b) => (
              <tr key={b}>
                <th scope="row">
                  <span className="basis-tag">
                    <Glyph basis={b} /> {BASIS_INFO[b].label}
                  </span>
                </th>
                <td>{BASIS_INFO[b].meaning}</td>
                <td>{BASIS_CONFIDENCE_CAP[b] == null ? 'Not rated' : BASIS_CONFIDENCE_CAP[b]! >= 0.8 ? 'Strong' : 'Moderate at most'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <ul className="method-list">
          <li>A claim is “Cited” only if its quote is found, word for word (ignoring case and punctuation), in the text that was actually retrieved. Otherwise it becomes “Reasoned” or “Guess”, and the profile says why.</li>
          <li>Safety claims about hazardous objects need a tier 1 to 3 source to stay “Cited”. Source tiers: {Object.entries(SOURCE_TIERS).map(([k, v]) => `${k} ${v.toLowerCase()}`).join('; ')}.</li>
          <li>Live values (recalls, availability) must appear in a retrieved source, and carry a date to check again.</li>
          <li>What-if numbers come from I SEE’s own calculator: plain arithmetic and {ALLOWED_FUNCTIONS.length} functions, no code execution, and a dimensional check on every step. A calculation that fails the check loses its numbers and is shown as a hypothesis.</li>
          <li>Text in a photo, a source or your note is treated as data. Instructions hidden in it are ignored.</li>
        </ul>
      </section>

      <section aria-labelledby="privacy" id="privacy" className="method-section">
        <h2 id="privacy-h">Privacy: what goes where</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Route</th>
              <th scope="col">Where your photo goes</th>
            </tr>
          </thead>
          <tbody>
            {ROUTES.map((r) => (
              <tr key={r}>
                <th scope="row">{ROUTE_INFO[r].label}</th>
                <td>{ROUTE_INFO[r].detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <ul className="method-list">
          <li>Nothing is sent until you start a scan and agree to what will be sent.</li>
          <li>By default your photos are processed by a service that does not use them to train AI. You can change this in Settings.</li>
          <li>The server keeps a scan in memory until it finishes and for at most ten minutes, and never writes photos to disk. Logs never contain images or keys.</li>
          <li>Profiles live in this browser (IndexedDB). Download a copy on the Passport page; delete everything in Settings.</li>
          <li>The cutaway is drawn from your photo, which is sent once more for it. Web searches and the weighing of doubts use words only, never the photo.</li>
        </ul>
        <p>
          The full details are on the <Link href="/privacy">Privacy</Link> page.
        </p>
      </section>

      <section aria-labelledby="limits-h" className="method-section">
        <h2 id="limits-h">What it cannot do</h2>
        <ul className="method-list">
          {LIMITS.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </section>

    </div>
  );
}
