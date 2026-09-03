'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { workspaceTabs } from '@/lib/demo-data';

export function WorkspaceTabs({
  campaignId,
  completedTabs = {},
}: {
  campaignId: string;
  completedTabs?: Record<string, boolean>;
}) {
  const pathname = usePathname();
  const active = pathname.split('/').pop();

  return (
    <div
      style={{
        flexShrink: 0,
        background: 'var(--surface-card)',
        borderBottom: '1px solid var(--border-subtle)',
        padding: '0 36px',
        display: 'flex',
        gap: 2,
        overflowX: 'auto',
      }}
    >
      {workspaceTabs.map((tab) => {
        const isActive = tab.id === active;
        // Only some stages have an unambiguous "done" signal — see the layout.
        // A dot rather than a tick keeps the tab row quiet; the point is to
        // show progress at a glance, not to decorate every label.
        const isComplete = !isActive && completedTabs[tab.id];
        return (
          <Link
            key={tab.id}
            href={`/campaigns/${campaignId}/${tab.id}`}
            className="lsq-tab"
            data-active={isActive ? 'true' : 'false'}
            style={{
              padding: '10px 14px',
              fontSize: 'var(--fs-label-1)',
              fontWeight: 'var(--fw-bold)',
              color: isActive ? 'var(--accent-500)' : 'var(--n50)',
              borderBottom: `2px solid ${isActive ? 'var(--accent-500)' : 'transparent'}`,
              whiteSpace: 'nowrap',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              textDecoration: 'none',
            }}
          >
            {tab.label}
            {isComplete && (
              <span
                aria-label="complete"
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: 'var(--success-500)',
                  flexShrink: 0,
                }}
              />
            )}
          </Link>
        );
      })}
    </div>
  );
}
