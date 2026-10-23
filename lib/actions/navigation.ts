'use server';

import { requireOperatorSession } from '@/lib/operatorSession';
import { db } from '@/lib/db';
import { getResumeDrafts } from '@/lib/draftResume';

/** Refresh sidebar data without cancelling an in-progress route transition with router.refresh(). */
export async function getSidebarSummaryAction() {
  await requireOperatorSession();
  const [totalCount, liveCount, draftCount, completedCount, resume] = await Promise.all([
    db.campaign.count({ where: { archived: false } }),
    db.campaign.count({ where: { archived: false, status: 'live' } }),
    db.campaign.count({ where: { archived: false, status: 'draft' } }),
    db.campaign.count({ where: { archived: false, status: 'completed' } }),
    getResumeDrafts(),
  ]);
  return { totalCount, liveCount, draftCount, completedCount, resumeDraft: resume.latest, moreDrafts: resume.others };
}
