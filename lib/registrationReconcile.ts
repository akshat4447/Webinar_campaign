import { db } from '@/lib/db';
import { Prisma } from '@/lib/generated/prisma/client';
import { processRegistrationJobs } from '@/lib/registrationJobs';
export type ReconcileSummary = Awaited<ReturnType<typeof processRegistrationJobs>>;

/** Backfills missing jobs, then drains only unfinished jobs, without a lookback cutoff. */
export async function reconcileRecentRegistrations(opts: { now?: Date; limit?: number; budgetMs?: number } = {}): Promise<ReconcileSummary> {
  await db.$transaction(async tx => {
    const contacts = await tx.contact.findMany({ where: {
      registeredAt: { not: null }, email: { not: null },
      OR: [
        { zoomJoinUrl: null, campaign: { zoomMeetingId: { not: null } }, registrationJobs: { none: { kind: 'zoom' } } },
        { OR: [{ registrationSource: null }, { registrationSource: { not: 'leadsquared' } }], registrationJobs: { none: { kind: 'lsq' } } },
        { campaign: { lsqSuppressionListId: { not: null } }, registrationJobs: { none: { kind: 'suppression' } } },
      ],
    }, include: { campaign: { select: { zoomMeetingId: true, lsqSuppressionListId: true } }, registrationJobs: { select: { kind: true } } }, orderBy: { registeredAt: 'asc' }, take: opts.limit ?? 50 });
    if (!contacts.length) return;
    // Match registration/deletion lock order: parent campaigns, then contacts.
    // Rows deleted between discovery and locking are excluded before enqueueing.
    const campaigns = await tx.$queryRaw<Array<{id:string}>>`SELECT id FROM "Campaign" WHERE id IN (${Prisma.join([...new Set(contacts.map(c=>c.campaignId))])}) ORDER BY id FOR KEY SHARE`;
    if (!campaigns.length) return;
    const live = await tx.$queryRaw<Array<{id:string}>>`SELECT id FROM "Contact" WHERE id IN (${Prisma.join(contacts.map(c=>c.id))}) AND "campaignId" IN (${Prisma.join(campaigns.map(c=>c.id))}) ORDER BY id FOR KEY SHARE`;
    const liveIds = new Set(live.map(c=>c.id));
    const jobs = contacts.filter(c=>liveIds.has(c.id)).flatMap(c => {
      const kinds = new Set(c.registrationJobs.map(j => j.kind));
      return [
        ...(c.campaign.zoomMeetingId && !c.zoomJoinUrl && !kinds.has('zoom') ? ['zoom'] : []),
        ...(c.registrationSource !== 'leadsquared' && !kinds.has('lsq') ? ['lsq'] : []),
        ...(c.campaign.lsqSuppressionListId && !kinds.has('suppression') ? ['suppression'] : []),
      ].map(kind => ({ campaignId: c.campaignId, contactId: c.id, kind }));
    });
    if (jobs.length) await tx.registrationJob.createMany({ data: jobs, skipDuplicates: true });
  }, {timeout:15_000});
  return processRegistrationJobs(opts);
}
