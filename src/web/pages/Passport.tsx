import { userMessage } from '../lib/api';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { deleteAll, download, exportPassport, importPassport, listEntries, type PassportEntry } from '../lib/passport';
import { Icon } from '../components/Icon';
import { ConfirmButton } from '../components/ConfirmButton';

function Thumb({ e }: { e: PassportEntry }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!e.images[0]) return;
    const u = URL.createObjectURL(e.images[0]);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [e]);
  return url ? <img src={url} alt="" /> : <div className="thumb-empty" />;
}

export function Passport() {
  const [items, setItems] = useState<PassportEntry[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const reload = () => void listEntries().then(setItems);
  useEffect(() => {
    reload();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="wrap page-pad passport">
      <header className="page-head">
        <div>
          <p className="eyebrow">Passport</p>
          <h1>Everything you have examined.</h1>
          <p className="muted">Kept in this browser only. Nothing here is on the I SEE server.</p>
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn-secondary btn-sm" hidden={__PREVIEW__} disabled={!items?.length} onClick={async () => download(await exportPassport(), `i-see-passport-${new Date().toISOString().slice(0, 10)}.json`)}>
            <Icon name="download" size={16} /> Export all
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => file.current?.click()}>
            <Icon name="upload" size={16} /> Import
          </button>
          <ConfirmButton
            disabled={!items?.length}
            confirmLabel="Click again to delete everything"
            onConfirm={async () => {
              await deleteAll();
              setMsg('Everything was deleted from this browser.');
              reload();
            }}
          >
            <Icon name="trash" size={16} /> Delete all
          </ConfirmButton>
          <input
            ref={file}
            type="file"
            accept="application/json"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              try {
                const r = await importPassport(f);
                setMsg(`Imported ${r.added} profile${r.added === 1 ? '' : 's'}${r.skipped ? `, skipped ${r.skipped}` : ''}.`);
                reload();
              } catch (err) {
                setMsg(userMessage(err, 'That file could not be imported.'));
              }
            }}
          />
        </div>
      </header>
      {msg && (
        <p className="notice" role="status">
          <Icon name="info" /> {msg}
        </p>
      )}
      {items === null ? (
        <p className="muted">Opening…</p>
      ) : items.length === 0 ? (
        <div className="empty">
          <p>Nothing yet. Every object you examine, including sample runs, is kept here.</p>
          <Link href="/scan" className="btn btn-primary">
            <Icon name="camera" /> Examine something
          </Link>
        </div>
      ) : (
        <ul className="contact-sheet">
          {items.map((e) => (
            <li key={e.id}>
              <Link href={`/p/${e.id}`} className="sheet-card">
                <Thumb e={e} />
                <span className="sheet-meta">
                  <span className="sheet-name">{e.profile.displayName}</span>
                  <span className="small muted">
                    {new Date(e.savedAt).toLocaleDateString()} · {e.profile.identity.status === 'identified' ? 'Identified' : e.profile.identity.status === 'candidates' ? 'Not certain yet' : 'Unidentified'}
                    {e.sample ? ' · Sample' : ''}
                  </span>
                  <span className="small muted">
                    {e.profile.findings.length} findings · {e.profile.sources.length} sources
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
