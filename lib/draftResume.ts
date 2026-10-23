import { db } from '@/lib/db';
import { RECENT_DRAFT_WINDOW_MS } from '@/lib/wizardDraft';

// Drafts worth offering a way back to: recently touched, not archived. Drafts created before the wizard
// tracked activity have no draftTouchedAt, so their last update stands in for it.

export interface ResumeDraft {
  id: string;
  name: string;
  wizardStep: number;
}

export async function getResumeDrafts(now: Date = new Date()): Promise<{ latest: ResumeDraft | null; others: number }> {
  const cutoff = new Date(now.getTime() - RECENT_DRAFT_WINDOW_MS);
  const where = {
    archived: false,
    status: 'draft',
    OR: [{ draftTouchedAt: { gte: cutoff } }, { draftTouchedAt: null, updatedAt: { gte: cutoff } }],
  };
  const [latest, total] = await Promise.all([
    db.campaign.findFirst({
      where,
      orderBy: [{ draftTouchedAt: { sort: 'desc', nulls: 'last' } }, { updatedAt: 'desc' }],
      select: { id: true, name: true, wizardStep: true },
    }),
    db.campaign.count({ where }),
  ]);
  return { latest, others: Math.max(0, total - (latest ? 1 : 0)) };
}
