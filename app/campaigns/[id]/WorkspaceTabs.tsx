'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { workspaceTabs } from '@/lib/demo-data';

export function WorkspaceTabs({ campaignId }: { campaignId: string }) {
  const pathname = usePathname();
  const active = pathname.split('/').pop();

  return (
    <div style={{ flexShrink: 0, background: '#fff', borderBottom: '1px solid var(--border-subtle)', padding: '0 36px', display: 'flex', gap: 22, overflowX: 'auto' }}>
      {workspaceTabs.map((tab) => {
        const isActive = tab.id === active;
        return (
          <Link
            key={tab.id}
            href={`/campaigns/${campaignId}/${tab.id}`}
            style={{
              padding: '13px 2px',
              fontSize: 13,
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
                background: isActive ? 'var(--accent-500)' : 'var(--n20)',
                color: isActive ? '#fff' : 'var(--n60)',
                fontSize: 10,
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              {tab.n}
            </span>
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
