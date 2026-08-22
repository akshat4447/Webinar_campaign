import { db } from '@/lib/db';
import { bulkCreateOrUpdateLeads, createEmptyList, addLeadsToStaticList, getLists, type LeadField } from '@/lib/leadsquared';

export interface LeadSyncResult {
  listId: string | null;
  leadsCreated: number;
  leadsUpdated: number;
  leadsFailed: number;
  error?: string;
}

// Pushes every contact with an email (that doesn't already have an lsqLeadId)
// to LeadSquared as a real Lead, then adds every synced contact's lead to a
// single static list for this campaign — creating that list on first use.
export async function syncContactsToLeadSquared(campaignId: string): Promise<LeadSyncResult> {
  const campaign = await db.campaign.findUniqueOrThrow({ where: { id: campaignId } });
  const contacts = await db.contact.findMany({ where: { campaignId, email: { not: null } } });
  const toCreate = contacts.filter((c) => !c.lsqLeadId);

  if (contacts.length === 0) return { listId: campaign.lsqListId, leadsCreated: 0, leadsUpdated: 0, leadsFailed: 0 };

  let leadsCreated = 0;
  let leadsUpdated = 0;
  let leadsFailed = 0;
  const rowErrors: string[] = [];
  try {
    if (toCreate.length > 0) {
      const leadFields: LeadField[][] = toCreate.map((c) => [
        { Attribute: 'EmailAddress', Value: c.email! },
        { Attribute: 'FirstName', Value: c.name.split(' ')[0] || c.name },
        { Attribute: 'LastName', Value: c.name.split(' ').slice(1).join(' ') },
        { Attribute: 'Company', Value: c.account },
        { Attribute: 'JobTitle', Value: c.title },
      ]);
      const results = await bulkCreateOrUpdateLeads(leadFields);
      // Per-row failures come back inline (empty LeadId + an ExceptionType),
      // not as a thrown error — only write lsqLeadId for rows that actually got one.
      const succeeded = results.filter((r) => r.LeadId);
      await db.$transaction(succeeded.map((r) => db.contact.update({ where: { id: toCreate[r.RowNumber].id }, data: { lsqLeadId: r.LeadId } })));
      leadsCreated = results.filter((r) => r.LeadCreated).length;
      leadsUpdated = results.filter((r) => r.LeadUpdated).length;
      leadsFailed = results.length - succeeded.length;
      for (const r of results) {
        if (!r.LeadId && r.ErrorMessage) rowErrors.push(`${toCreate[r.RowNumber].name}: ${r.ExceptionType ?? ''} ${r.ErrorMessage}`.trim());
      }
    }

    let listId = campaign.lsqListId;
    if (!listId) {
      const listName = `${campaign.name} — Webinar Campaign Agent`;
      // Self-heal: a prior run may have created the list in LSQ but failed
      // before saving its id locally (e.g. a transient DB error) — reuse it
      // by name instead of colliding on LSQ's duplicate-name rejection.
      const existing = (await getLists()).find((l) => l.ListName === listName);
      listId = existing?.ListId ?? (await createEmptyList(listName, `Auto-created by Webinar Campaign Agent for campaign ${campaign.id}`));
      await db.campaign.update({ where: { id: campaignId }, data: { lsqListId: listId } });
    }

    const synced = await db.contact.findMany({ where: { campaignId, lsqLeadId: { not: null } }, select: { lsqLeadId: true } });
    const leadIds = synced.map((c) => c.lsqLeadId).filter((id): id is string => !!id);
    if (leadIds.length > 0) await addLeadsToStaticList(listId, leadIds);

    return { listId, leadsCreated, leadsUpdated, leadsFailed, error: rowErrors.length > 0 ? rowErrors.slice(0, 3).join('; ') : undefined };
  } catch (err) {
    return { listId: campaign.lsqListId, leadsCreated, leadsUpdated, leadsFailed: toCreate.length - leadsCreated - leadsUpdated, error: String(err) };
  }
}
