import { useEffect, useState, type ReactNode } from 'react';

/**
 * A destructive action that asks inside the page: the first click arms it, the second
 * confirms. (Browser confirm() dialogs are unavailable in some embeds.)
 */
export function ConfirmButton({ onConfirm, children, confirmLabel, className = 'btn btn-quiet btn-sm', disabled }: { onConfirm: () => void | Promise<void>; children: ReactNode; confirmLabel: string; className?: string; disabled?: boolean }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      type="button"
      className={`${className} ${armed ? 'armed' : ''}`}
      disabled={disabled}
      aria-live="polite"
      onClick={() => {
        if (!armed) return setArmed(true);
        setArmed(false);
        void onConfirm();
      }}
    >
      {armed ? confirmLabel : children}
    </button>
  );
}
