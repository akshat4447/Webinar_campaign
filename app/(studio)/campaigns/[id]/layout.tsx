import { CampaignJobs } from '@/components/jobs/CampaignJobs';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { Prisma } from '@/lib/generated/prisma/client';
import { getCachedCampaign } from '@/lib/campaignCache';
import { WorkspaceTabs } from './WorkspaceTabs';
import { StageBadge } from './StageBadge';
import { GuardedBackLink } from './GuardedBackLink';
import { getServerNow } from '@/lib/actions/clock';
import { isWrapUpOverdue } from '@/lib/campaignLifecycle';
import { formatLsqDateTime } from '@/lib/dateFormat';
import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';

export default async function CampaignLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // Request-memoized (lib/campaignCache.ts) so this fetch is shared with the
  // Results tab and lib/postEvent.ts rather than repeated — but this layout
  // is the one place that turns a missing campaign into a proper 404 (every
  // tab underneath assumes that guarantee already holds), so a "not found"
  // failure is translated back into the same notFound() this used before.
  let campaign;
  try {
    campaign = await getCachedCampaign(id);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') notFound();
    throw err;
  }

  // Every tab used to render identically regardless of progress — a brand-new
  // campaign with zero contacts looked exactly as "ready" as one about to launch,
  // and nothing signalled which stages were actually done. These are best-effort,
  // unambiguous completion signals per stage (not every stage has one — templates,
  // personalize, and control center don't have a single clear "done" condition,
  // so they're left unmarked rather than guessed at).
  const [scoredCount, approvedCount] = await Promise.all([
    db.contact.count({ where: { campaignId: id, score: { not: null } } }),
    db.contact.count({ where: { campaignId: id, approved: true } }),
  ]);
  const completedTabs: Record<string, boolean> = {
    overview: true,
    audience: scoredCount > 0,
    messaging: approvedCount > 0,
    cadence: campaign.cadenceStatus !== 'not_started',
    results: campaign.cadenceStatus === 'running' || !!campaign.attendanceImportedAt,
  };

  return (
    <>
      <header className="lsq-res-shell">
        <div className="lsq-res-shell__text">
          <GuardedBackLink />
          <p className="lsq-res-shell__name">{campaign.name}</p>
        </div>
        <StageBadge status={campaign.status} cadenceStatus={campaign.cadenceStatus} />
      </header>

      <WorkspaceTabs campaignId={id} completedTabs={completedTabs} />

      {isWrapUpOverdue(campaign, await getServerNow()) && (
        <div className="lsq-banner lsq-banner--warning lsq-res-overdue" role="status">
          <span className="lsq-banner__icon"><Icon name="warning" size={16} /></span>
          <div>
            <p className="lsq-banner__title">Webinar Date Has Passed</p>
            <p className="lsq-banner__body">
              This webinar was scheduled for {campaign.scheduledAt ? formatLsqDateTime(campaign.scheduledAt) : 'an earlier date'} but is still open. Import attendance and mark it completed to stop reminders and lock the workspace.
            </p>
            <div className="lsq-banner__actions">
              <Link href={`/campaigns/${id}/results`} className="lsq-btn lsq-btn--sm lsq-btn--secondary">Go to Results</Link>
            </div>
          </div>
        </div>
      )}

      <CampaignJobs campaignId={id} />
      {children}
    </>
  );
}
