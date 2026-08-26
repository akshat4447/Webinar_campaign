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

  // Every tab used to render identically regardless of progress — a brand-new
  // campaign with zero contacts looked exactly as "ready" as one about to launch,
  // and nothing signalled which stages were actually done. These are best-effort,
  // unambiguous completion signals per stage (not every stage has one — templates,
  // personalize, and control center don't have a single clear "done" condition,
  // so they're left unmarked rather than guessed at).
  const [contactCount, scoredCount] = await Promise.all([
    db.contact.count({ where: { campaignId: id } }),
    db.contact.count({ where: { campaignId: id, score: { not: null } } }),
  ]);
  const completedTabs: Record<string, boolean> = {
    setup: contactCount > 0,
    scoring: scoredCount > 0,
    schedule: campaign.cadenceStatus !== 'not_started',
    dashboard: !!campaign.attendanceImportedAt,
  };

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
          <Link href="/" style={{ fontSize: 'var(--fs-label-1)', color: 'var(--n60)', cursor: 'pointer', marginBottom: 3, display: 'flex', alignItems: 'center', gap: 4, textDecoration: 'none' }}>
            <Icon name="arrow-right" size={12} style={{ transform: 'rotate(180deg)', color: 'var(--n60)' }} />
            All webinars
          </Link>
          <div style={{ fontSize: 'var(--fs-heading-4)', fontWeight: 700, color: 'var(--n90)', letterSpacing: '-0.01em', overflowWrap: 'anywhere' }}>{campaign.name}</div>
        </div>
        <StageBadge />
      </header>

      <WorkspaceTabs campaignId={id} completedTabs={completedTabs} />

      {children}
    </>
  );
}
