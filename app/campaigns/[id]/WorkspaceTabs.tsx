'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { workspaceTabs } from '@/lib/demo-data';

export function WorkspaceTabs({ campaignId, completedTabs = {} }: { campaignId: string; completedTabs?: Record<string, boolean> }) {
  const pathname = usePathname();
  const active = pathname.split('/').pop();

  return (
    <div style={{ flexShrink: 0, background: '#fff', borderBottom: '1px solid var(--border-subtle)', padding: '0 36px', display: 'flex', gap: 22, overflowX: 'auto' }}>
      {workspaceTabs.map((tab) => {
        const isActive = tab.id === active;
        // Only a subset of tabs have an unambiguous "done" signal (see
        // CampaignLayout) — everything else just shows its ordinal, same as before.
        const isComplete = !isActive && completedTabs[tab.id];
        return (
          <Link
            key={tab.id}
            href={`/campaigns/${campaignId}/${tab.id}`}
            style={{
              padding: '13px 2px',
              fontSize: 'var(--fs-label-1)',
              fontWeight: 600,
              color: isActive ? 'var(--accent-500)' : 'var(--n60)',
              borderBottom: isActive ? '2px solid var(--accent-500)' : '2px solid transparent',
              whiteSpace: 'nowrap',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              textDecoration: 'none',
            }}
          >
            <span
              style={{
                width: 17,
                height: 17,
                borderRadius: '50%',
                background: isActive ? 'var(--accent-500)' : isComplete ? 'var(--success-500)' : 'var(--n20)',
                color: isActive || isComplete ? '#fff' : 'var(--n60)',
                fontSize: 'var(--fs-caption)',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              {isComplete ? '✓' : tab.n}
            </span>
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
