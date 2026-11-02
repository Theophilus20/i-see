/**
 * The visual grammar of evidence. Basis is never shown by colour alone: each has a
 * glyph, a line pattern (on the plate) and a word.
 */
import { BASIS_INFO, BASIS_CONFIDENCE_CAP, STRENGTH_LABEL, strengthFor, type Basis } from '@shared/epistemics';

export const BASIS_VAR: Record<Basis, string> = {
  observed: 'var(--seen)',
  sourced: 'var(--cited)',
  inferred: 'var(--reasoned)',
  hypothesis: 'var(--guess)',
  unknown: 'var(--unknown)',
  user: 'var(--yours)',
};

export const BASIS_TINT: Record<Basis, string> = {
  observed: 'var(--seen-tint)',
  sourced: 'var(--cited-tint)',
  inferred: 'var(--reasoned-tint)',
  hypothesis: 'var(--reasoned-tint)',
  unknown: 'var(--unknown-tint)',
  user: 'var(--surface)',
};

export function Glyph({ basis, size = 12 }: { basis: Basis; size?: number }) {
  const c = BASIS_VAR[basis];
  const r = size / 2;
  const common = { width: size, height: size, viewBox: `0 0 ${size} ${size}`, 'aria-hidden': true as const, style: { flex: 'none' } };
  switch (BASIS_INFO[basis].glyph) {
    case 'disc':
      return (
        <svg {...common}>
          <circle cx={r} cy={r} r={r - 0.5} fill={c} />
        </svg>
      );
    case 'diamond':
      return (
        <svg {...common}>
          <path d={`M${r} 0.6 L${size - 0.6} ${r} L${r} ${size - 0.6} L0.6 ${r} Z`} fill={c} />
        </svg>
      );
    case 'half':
      return (
        <svg {...common}>
          <circle cx={r} cy={r} r={r - 1} fill="none" stroke={c} strokeWidth={1.5} />
          <path d={`M${r} 1 A${r - 1} ${r - 1} 0 0 0 ${r} ${size - 1} Z`} fill={c} />
        </svg>
      );
    case 'ring':
      return (
        <svg {...common}>
          <circle cx={r} cy={r} r={r - 1.2} fill="none" stroke={c} strokeWidth={1.5} strokeDasharray="1.6 1.9" />
        </svg>
      );
    case 'void':
      return (
        <svg {...common}>
          <circle cx={r} cy={r} r={r - 1} fill="none" stroke={c} strokeWidth={1.2} />
          <path d={`M${size * 0.28} ${size * 0.72} L${size * 0.72} ${size * 0.28}`} stroke={c} strokeWidth={1.2} />
        </svg>
      );
    case 'pen':
    default:
      return (
        <svg {...common}>
          <path d={`M${size * 0.2} ${size * 0.8} L${size * 0.25} ${size * 0.58} L${size * 0.68} ${size * 0.15} L${size * 0.85} ${size * 0.32} L${size * 0.42} ${size * 0.75} Z`} fill={c} />
        </svg>
      );
  }
}

export function BasisTag({ basis, compact = false }: { basis: Basis; compact?: boolean }) {
  const info = BASIS_INFO[basis];
  return (
    <span className="basis-tag" title={compact ? `${info.label}: ${info.meaning}` : info.meaning}>
      <Glyph basis={basis} />
      <span className={compact ? 'sr-only' : undefined}>{info.label}</span>
    </span>
  );
}

/** Confidence as a short rule with the cap for its basis marked, plus a word. */
export function Strength({ basis, confidence }: { basis: Basis; confidence: number | null }) {
  const s = strengthFor(basis, confidence);
  if (s == null || confidence == null) return null;
  const cap = BASIS_CONFIDENCE_CAP[basis] ?? 1;
  return (
    <span className="strength" title={`${STRENGTH_LABEL[s]}. An estimate, not an exact probability, and capped for “${BASIS_INFO[basis].label}” evidence.`}>
      <span className="strength-bar" aria-hidden="true">
        <span style={{ width: `${confidence * 100}%`, background: BASIS_VAR[basis] }} />
        <i style={{ left: `${cap * 100}%` }} />
      </span>
      <span>{STRENGTH_LABEL[s]}</span>
    </span>
  );
}

/** Line pattern for a basis, used for mask outlines and leader lines. */
export function dashFor(basis: Basis): string | undefined {
  return BASIS_INFO[basis].dash || undefined;
}
