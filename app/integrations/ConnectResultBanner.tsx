'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

// The OAuth callbacks (Zoom, LinkedIn) redirect back here with the outcome in
// the query string — there was nowhere on this page that ever read it, so a
// connection could genuinely succeed (or fail with a specific reason) and the
// operator would see the page reload with no visible change at all. Captured
// into local state on mount so the banner survives the URL cleanup below.
export function ConnectResultBanner({ connected, detail }: { connected?: string; detail?: string }) {
  const router = useRouter();
  // Lazy init: captures the redirect's outcome from this component's first
  // render only, so it survives the URL cleanup below (which drops the query
  // params and would otherwise erase the very state showing them).
  const [shown, setShown] = useState<{ ok: boolean; detail: string } | null>(() =>
    connected ? { ok: connected === 'ok', detail: detail || (connected === 'ok' ? 'Connected.' : 'Connection failed.') } : null
  );

  useEffect(() => {
    if (!connected) return;
    router.replace('/integrations', { scroll: false });
  }, [connected, router]);

  if (!shown) return null;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        background: shown.ok ? 'var(--success-100)' : 'var(--danger-100)',
        color: shown.ok ? 'var(--success-700)' : 'var(--danger-700)',
        borderRadius: 'var(--radius-lg)',
        padding: '12px 16px',
        marginBottom: 20,
        fontSize: 'var(--fs-label-1)',
        fontWeight: 600,
        lineHeight: 1.5,
      }}
    >
      <span style={{ flex: 1, overflowWrap: 'anywhere' }}>{shown.ok ? '✓ ' : '✕ '}{shown.detail}</span>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => setShown(null)}
        style={{
          border: 'none',
          background: 'transparent',
          color: 'inherit',
          cursor: 'pointer',
          fontSize: 'var(--fs-label-1)',
          fontWeight: 700,
          lineHeight: 1,
          padding: 2,
          flexShrink: 0,
        }}
      >
        ×
      </button>
    </div>
  );
}
