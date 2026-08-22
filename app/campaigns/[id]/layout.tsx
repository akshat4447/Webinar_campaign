import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Icon } from '@/components/ui/Icon';
import { db } from '@/lib/db';
import { WorkspaceTabs } from './WorkspaceTabs';
import { StageBadge } from './StageBadge';

export default async function CampaignLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const campaign = await db.campaign.findUnique({ where: { id } });
  if (!campaign) notFound();

  return (
    <>
      <header
        style={{
          flexShrink: 0,
          background: '#fff',
          borderBottom: '1px solid var(--border-subtle)',
          padding: '14px 36px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 24,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <Link href="/" style={{ fontSize: 12, color: 'var(--n60)', cursor: 'pointer', marginBottom: 3, display: 'flex', alignItems: 'center', gap: 4, textDecoration: 'none' }}>
            <Icon name="arrow-right" size={12} style={{ transform: 'rotate(180deg)', color: 'var(--n60)' }} />
            All webinars
          </Link>
          <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--n90)', letterSpacing: '-0.01em', overflowWrap: 'anywhere' }}>{campaign.name}</div>
        </div>
        <StageBadge />
      </header>

      <WorkspaceTabs campaignId={id} />

      {children}
    </>
  );
}
