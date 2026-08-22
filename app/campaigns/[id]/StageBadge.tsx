'use client';

import { usePathname } from 'next/navigation';
import { Badge } from '@/components/ui/Badge';
import { stageBadges } from '@/lib/demo-data';

export function StageBadge() {
  const pathname = usePathname();
  const active = pathname.split('/').pop() ?? 'setup';
  const badge = stageBadges[active] ?? stageBadges.setup;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
      <span style={{ fontSize: 11.5, color: 'var(--n60)' }}>Campaign status</span>
      <Badge color={badge.color} text={badge.text} dot />
    </div>
  );
}
