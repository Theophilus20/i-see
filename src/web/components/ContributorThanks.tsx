/**
 * A thank-you when someone switches on "Help improve Meta's models", wherever they do it (the
 * Train page or Settings). It says plainly what they have agreed to, why it matters, and how to
 * switch it off, and recognises what they have already done in Train, by number.
 */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { useSettings } from '../lib/settings';
import { useTeach } from '../lib/teach';
import { Icon } from './Icon';

const SHOW_FOR = 15_000;

export function ContributorThanks() {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(0);
  const caught = useTeach((s) => s.caught);
  const agreed = useTeach((s) => s.agreed);
  const timer = useRef<number | null>(null);
  const held = useRef(false);
  const card = useRef<HTMLElement>(null);

  const close = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    setOpen(false);
  };
  const arm = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      if (!held.current) setOpen(false);
    }, SHOW_FOR);
  };

  useEffect(
    () =>
      useSettings.subscribe((s, prev) => {
        if (prev.privacyTier !== 'contributor' && s.privacyTier === 'contributor') {
          setKey((k) => k + 1);
          setOpen(true);
          arm();
        }
        if (s.privacyTier !== 'contributor') close();
      }),
    [],
  );
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  useEffect(() => () => (timer.current ? window.clearTimeout(timer.current) : undefined), []);

  if (!open) return null;
  const done = caught + agreed;
  return (
    <section
      key={key}
      ref={card}
      className="thanks"
      role="status"
      aria-live="polite"
      aria-labelledby="thanks-title"
      // It stays while it is being read or used.
      onMouseEnter={() => (held.current = true)}
      onMouseLeave={() => {
        held.current = false;
        arm();
      }}
      onFocus={() => (held.current = true)}
      onBlur={(e) => {
        if (card.current?.contains(e.relatedTarget as Node)) return;
        held.current = false;
        arm();
      }}
    >
      <div className="thanks-mark" aria-hidden="true">
        <span className="thanks-ring" />
        <span className="thanks-ring two" />
        <span className="thanks-heart">
          <Icon name="heart" size={22} />
        </span>
      </div>
      <div className="thanks-body">
        <h2 id="thanks-title">Thank you for helping improve Meta’s models</h2>
        <p>Every photo you scan from now on can help Meta’s AI recognise things more accurately, for you and for everyone who uses it.</p>
        <p className={`thanks-you ${done > 0 ? '' : 'generic'}`}>
          {done > 0 ? (
            <>
              You have already caught <strong className="num">{caught}</strong> mistake{caught === 1 ? '' : 's'} and confirmed <strong className="num">{agreed}</strong> part{agreed === 1 ? '' : 's'} in Train. That care is exactly what makes AI better.
            </>
          ) : (
            <>Small things add up: each scan is one more real example of how things look.</>
          )}
        </p>
        <p className="thanks-small">You can switch this off at any time in Settings or on the Train page.</p>
        <div className="thanks-actions">
          <Link href="/scan" className="btn btn-primary btn-sm" onClick={close}>
            <Icon name="camera" size={16} /> Scan something
          </Link>
          <button type="button" className="btn btn-quiet btn-sm" onClick={close}>
            Close
          </button>
        </div>
      </div>
      <button type="button" className="thanks-x" aria-label="Close" onClick={close}>
        <Icon name="close" size={16} />
      </button>
    </section>
  );
}
