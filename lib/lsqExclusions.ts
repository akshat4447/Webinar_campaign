import { db } from '@/lib/db';
import { getLeadsInList } from '@/lib/leadsquared';
/** Longest exclusion list that is read in full. The snapshot is refreshed while sends are being dispatched, so this is bounded by time (about 50 calls). */
export const LSQ_EXCLUSION_LIST_LIMIT = 25_000;
/** Complete snapshots expire after five minutes. A failed refresh blocks dispatch. */
export async function refreshLsqExclusions(campaignId: string, force = false) {
  const campaign = await db.campaign.findUniqueOrThrow({ where: { id: campaignId }, select: { lsqExclusionListIds: true, lsqSuppressionListId: true } });
  const suppressionListId = campaign.lsqSuppressionListId || null;
  const ids: string[] = campaign.lsqExclusionListIds ? JSON.parse(campaign.lsqExclusionListIds) : [];
  if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string')) throw new Error('Invalid LeadSquared exclusion list configuration.');
  const key = `exclusion.snapshot.${campaignId}`;
  const stored = await db.appSetting.findUnique({ where: { key } });
  const previous = stored ? JSON.parse(stored.value) as { ids: string[]; syncedAt: number; count: number; suppressionListId?: string | null } : null;
  if (!force && previous && JSON.stringify(previous.ids) === JSON.stringify(ids) && (previous.suppressionListId ?? null) === suppressionListId && Date.now() - previous.syncedAt < 300_000) return previous.count;
  const emails = new Set<string>(), leadIds = new Set<string>();
  for (const id of ids) {
    // One more than the limit is read so a list that is exactly at the limit is accepted and a longer one is caught.
    const leads = await getLeadsInList(id, 500, LSQ_EXCLUSION_LIST_LIMIT + 1);
    if (leads.length > LSQ_EXCLUSION_LIST_LIMIT) throw new Error(`Exclusion list exceeds the ${LSQ_EXCLUSION_LIST_LIMIT.toLocaleString()}-member limit. Split it into smaller lists.`);
    for (const lead of leads) { if (lead.EmailAddress?.trim()) emails.add(lead.EmailAddress.trim().toLowerCase()); if (lead.ProspectID) leadIds.add(lead.ProspectID); }
  }
  // The attached suppression list is where registrants are added, so who is on it already when a send is about to go out has been
  // suppressed in LeadSquared: they are held back here too (until they register). Kept apart from the exclusion lists above, which
  // block everyone including registrants, because Studio itself puts its own registrants on this list.
  const suppressedEmails = new Set<string>(), suppressedLeadIds = new Set<string>();
  if (suppressionListId) {
    const leads = await getLeadsInList(suppressionListId, 500, LSQ_EXCLUSION_LIST_LIMIT + 1);
    if (leads.length > LSQ_EXCLUSION_LIST_LIMIT) throw new Error(`Suppression list exceeds the ${LSQ_EXCLUSION_LIST_LIMIT.toLocaleString()}-member limit. Split it into smaller lists.`);
    for (const lead of leads) { if (lead.EmailAddress?.trim()) suppressedEmails.add(lead.EmailAddress.trim().toLowerCase()); if (lead.ProspectID) suppressedLeadIds.add(lead.ProspectID); }
  }
  await db.$transaction(async tx => {
    await tx.campaignSuppression.deleteMany({ where: { campaignId, source: 'lsq_exclusion' } });
    if (emails.size) await tx.campaignSuppression.createMany({ data: [...emails].map(email => ({ campaignId, email, reason: 'external_list', source: 'lsq_exclusion' })), skipDuplicates: true });
    const value = JSON.stringify({ ids, syncedAt: Date.now(), count: emails.size, leadIds: [...leadIds], suppressionListId, suppressedEmails: [...suppressedEmails], suppressedLeadIds: [...suppressedLeadIds] });
    await tx.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
  });
  return emails.size;
}

/** Who is on the webinar's attached suppression list as of the last refresh (empty when none is attached or nothing was read yet). */
export async function loadSuppressionListMembers(campaignId: string): Promise<{ emails: Set<string>; leadIds: Set<string> }> {
  const row = await db.appSetting.findUnique({ where: { key: `exclusion.snapshot.${campaignId}` } });
  if (!row) return { emails: new Set(), leadIds: new Set() };
  try {
    const parsed = JSON.parse(row.value) as { suppressedEmails?: string[]; suppressedLeadIds?: string[] };
    return { emails: new Set(parsed.suppressedEmails ?? []), leadIds: new Set(parsed.suppressedLeadIds ?? []) };
  } catch {
    return { emails: new Set(), leadIds: new Set() };
  }
}

/** True for someone on the suppression list who has not registered: they are not sent anything. A registrant stays reachable. */
export function isHeldBySuppressionList(members: { emails: Set<string>; leadIds: Set<string> }, contact: { email?: string | null; lsqLeadId?: string | null; registeredAt?: Date | null }): boolean {
  if (contact.registeredAt) return false;
  if (contact.lsqLeadId && members.leadIds.has(contact.lsqLeadId)) return true;
  const email = contact.email?.trim().toLowerCase();
  return Boolean(email && members.emails.has(email));
}
