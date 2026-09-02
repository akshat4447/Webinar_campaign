import Link from 'next/link';

// Transitional scaffold for a route that exists in the new navigation but whose
// content arrives in a later checkpoint. It always names where the capability
// lives *today*, so nothing becomes unreachable mid-revamp.
//
// DELETE ME: every use of this component is removed by the checkpoint that
// builds the real page. If this file still exists at C13, something was missed.

export function Placeholder({
  checkpoint,
  summary,
  currentHome,
}: {
  /** The checkpoint that replaces this, e.g. "C4". */
  checkpoint: string;
  summary: string;
  /** Where the capability can be used right now, if anywhere. */
  currentHome?: { href: string; label: string };
}) {
  return (
    <div className="lsq-card" style={{ padding: '28px 24px', maxWidth: 620 }}>
      <div
        style={{
          display: 'inline-block',
          fontSize: 'var(--fs-label-2)',
          fontWeight: 'var(--fw-bold)',
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: 'var(--accent-700)',
          background: 'var(--accent-50)',
          padding: '3px 9px',
          borderRadius: 'var(--radius-xs)',
          marginBottom: 12,
        }}
      >
        Arrives in {checkpoint}
      </div>
      <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--n70)', lineHeight: 1.6 }}>{summary}</div>
      {currentHome && (
        <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--n60)', marginTop: 14 }}>
          Available now at{' '}
          <Link href={currentHome.href} style={{ fontWeight: 'var(--fw-semibold)' }}>
            {currentHome.label}
          </Link>
          .
        </div>
      )}
    </div>
  );
}
