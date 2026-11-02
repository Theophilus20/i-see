import { Link } from 'wouter';
import { ROUTES } from '@shared/schema';
import { ROUTE_INFO } from '../lib/settings';

/** Privacy: what is sent, where it goes, what is kept, and how to remove it. Plain and complete. */
export function Privacy() {
  return (
    <div className="wrap page-pad method privacy">
      <header className="page-head">
        <div>
          <p className="eyebrow">Privacy</p>
          <h1>Your photos, and where they go.</h1>
        </div>
      </header>

      <section aria-labelledby="pv-sent" className="method-section">
        <h2 id="pv-sent">What is sent, and when</h2>
        <ul className="method-list">
          <li>Nothing leaves your device until you start a scan and agree to send the photo.</li>
          <li>Before anything is sent, your photo is resized and saved again on your device. This removes the hidden details cameras add, including the location where it was taken.</li>
          <li>To examine a photo, it is sent to the I SEE server and on to the AI models that look at it, find its parts and write the profile.</li>
          <li>The cutaway drawing is made from your photo, so it matches your object. Your photo is sent once more for this.</li>
          <li>When I SEE looks things up on the web, it searches with words only, such as the object's name. Your photo is never sent to a search.</li>
          <li>If “Recognise things live” is on, a small, low-resolution frame is sent every few seconds while the camera is open, to name what you point at. Nothing from it is kept.</li>
          <li>When you ask a question by voice, the recording is sent to be turned into text. When the interface is shown in another language, its on-screen text is sent to be translated.</li>
        </ul>
      </section>

      <section aria-labelledby="pv-where" className="method-section">
        <h2 id="pv-where">Where it is analysed</h2>
        <p>You choose this in Settings or before each scan.</p>
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Choice</th>
              <th scope="col">What happens</th>
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
      </section>

      <section aria-labelledby="pv-kept" className="method-section">
        <h2 id="pv-kept">What is kept</h2>
        <ul className="method-list">
          <li>The server holds a scan in memory only while it runs, and for at most ten minutes. It never saves photos to disk, and its logs never contain images.</li>
          <li>By default, your photos and questions are processed by a service that does not use them to train AI. You can change this under “Use of my photos” in Settings.</li>
          <li>Your Passport (your profiles, photos and drawings) is stored only in this browser, on this device. It is not uploaded anywhere.</li>
          <li>
            Your training on the <Link href="/train">Train</Link> page (points, answers and the names you teach) is kept in this browser too. When you correct a part, the photo is sent once more so that part gets an independent second look; nothing is kept on the server. Names that are confirmed are sent with your later scans, as words only, so I SEE can use them. Your answers themselves are never sent to Meta.
          </li>
          <li>There are no accounts, no adverts and no tracking.</li>
        </ul>
      </section>

      <section aria-labelledby="pv-control" className="method-section">
        <h2 id="pv-control">Your choices</h2>
        <ul className="method-list">
          <li>
            Download a copy of everything from the <Link href="/passport">Passport</Link> page.
          </li>
          <li>
            Delete everything on this device in <Link href="/settings">Settings</Link>. It cannot be undone.
          </li>
          <li>
            Turn live camera recognition on or off, and choose where photos are analysed, in <Link href="/settings">Settings</Link>.
          </li>
        </ul>
      </section>
    </div>
  );
}
