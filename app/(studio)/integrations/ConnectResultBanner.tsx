'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/ui/Icon';

// The OAuth callbacks (Zoom, LinkedIn) redirect back here with the outcome in
// the query string — there was nowhere on this page that ever read it, so a
// connection could genuinely succeed (or fail with a specific reason) and the
// operator would see the page reload with no visible change at all. Captured
// into local state on mount so the banner survives the URL cleanup below.
export function ConnectResultBanner({ connected, detail }: { connected?: string; detail?: string }) {
  const router = useRouter();
  // Captured from the props on first render so it survives the URL cleanup below.
  const [shown, setShown] = useState<{ ok: boolean; detail: string } | null>(() =>
    connected
      ? {
          ok: connected === 'ok',
          detail: detail || (connected === 'ok' ? 'Connected.' : 'Connection failed.'),
        }
      : null,
  );

  useEffect(() => {
    if (connected) router.replace('/integrations', { scroll: false });
  }, [connected, router]);

  if (!shown) return null;

  return (
    <div
      suppressHydrationWarning
      className={`lsq-banner lsq-banner--${shown.ok ? 'success' : 'error'}`}
      role={shown.ok ? 'status' : 'alert'}
    >
      <span className="lsq-banner__icon" aria-hidden="true">
        <Icon name={shown.ok ? 'check-circle' : 'x-circle'} size={16} />
      </span>
      <div className="lsq-int-banner-text">
        <p className="lsq-banner__title">{shown.ok ? 'Connection Complete' : 'Connection Failed'}</p>
        <p suppressHydrationWarning className="lsq-banner__body">{shown.detail}</p>
      </div>
      <button type="button" className="lsq-icon-btn" aria-label="Dismiss" onClick={() => setShown(null)}>
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}
