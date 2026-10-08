import { db } from '@/lib/db';
import { getLeadsInList } from '@/lib/leadsquared';
/** Complete snapshots expire after five minutes. A failed refresh blocks dispatch. */
export async function refreshLsqExclusions(campaignId: string, force = false) {
  const campaign = await db.campaign.findUniqueOrThrow({ where: { id: campaignId }, select: { lsqExclusionListIds: true } });
  const ids: string[] = campaign.lsqExclusionListIds ? JSON.parse(campaign.lsqExclusionListIds) : [];
  if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string')) throw new Error('Invalid LeadSquared exclusion list configuration.');
  const key = `exclusion.snapshot.${campaignId}`;
  const stored = await db.appSetting.findUnique({ where: { key } });
  const previous = stored ? JSON.parse(stored.value) as { ids: string[]; syncedAt: number; count: number } : null;
  if (!force && previous && JSON.stringify(previous.ids) === JSON.stringify(ids) && Date.now() - previous.syncedAt < 300_000) return previous.count;
  const emails = new Set<string>(), leadIds = new Set<string>();
  for (const id of ids) {
    const leads = await getLeadsInList(id, 200, 10_000);
    if (leads.length >= 10_000) throw new Error('Exclusion list exceeds the verified 10,000-member limit. Split it into smaller lists.');
    for (const lead of leads) { if (lead.EmailAddress?.trim()) emails.add(lead.EmailAddress.trim().toLowerCase()); if (lead.ProspectID) leadIds.add(lead.ProspectID); }
  }
  await db.$transaction(async tx => {
    await tx.campaignSuppression.deleteMany({ where: { campaignId, source: 'lsq_exclusion' } });
    if (emails.size) await tx.campaignSuppression.createMany({ data: [...emails].map(email => ({ campaignId, email, reason: 'external_list', source: 'lsq_exclusion' })), skipDuplicates: true });
    const value = JSON.stringify({ ids, syncedAt: Date.now(), count: emails.size, leadIds: [...leadIds] });
    await tx.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
  });
  return emails.size;
}
