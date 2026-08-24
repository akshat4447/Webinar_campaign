import { db } from '@/lib/db';
import { bulkCreateOrUpdateLeads, createEmptyList, addLeadsToStaticList, getLists, LeadSquaredError, type LeadField } from '@/lib/leadsquared';

export interface LeadSyncResult {
  listId: string | null;
  leadsCreated: number;
  leadsUpdated: number;
  leadsFailed: number;
  error?: string;
}

function leadFieldsFor(c: { email: string | null; name: string; account: string; title: string }): LeadField[] {
  return [
    { Attribute: 'EmailAddress', Value: c.email! },
    { Attribute: 'FirstName', Value: c.name.split(' ')[0] || c.name },
    { Attribute: 'LastName', Value: c.name.split(' ').slice(1).join(' ') },
    { Attribute: 'Company', Value: c.account },
    { Attribute: 'JobTitle', Value: c.title },
  ];
}

// LSQ rejects AddLeadsToStaticList with this when a leadId in the payload
// doesn't correspond to a real, current lead — exactly what a stale, locally-
// cached lsqLeadId produces (see the "self-heal" pass below for why that
// happens and how it's repaired).
const STALE_LEAD_ERROR = /Records not associated with List/i;

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
      const results = await bulkCreateOrUpdateLeads(toCreate.map(leadFieldsFor));
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

    let synced = await db.contact.findMany({ where: { campaignId, lsqLeadId: { not: null }, email: { not: null } } });
    let leadIds = synced.map((c) => c.lsqLeadId).filter((id): id is string => !!id);

    if (leadIds.length > 0) {
      try {
        await addLeadsToStaticList(listId, leadIds);
      } catch (err) {
        // A locally-stored lsqLeadId can go stale — the record it pointed to was
        // deleted or purged on the LSQ side (trial-account cleanup, manual
        // dedup, GDPR delete) independent of anything this app did, so the id
        // this app has cached is no longer a real lead. LSQ correctly refuses
        // to add a non-existent lead to a list. Since Lead.CreateOrUpdate is
        // keyed on email (not on our stored id) and upserts, re-running it for
        // every already-"synced" contact gets back a valid current id — for an
        // untouched lead that's the same id as before; for a stale one it's a
        // freshly (re)created lead. One retry, not an infinite loop.
        if (err instanceof LeadSquaredError && STALE_LEAD_ERROR.test(String(err.body))) {
          const refreshed = await bulkCreateOrUpdateLeads(synced.map(leadFieldsFor));
          const succeeded = refreshed.filter((r) => r.LeadId);
          await db.$transaction(succeeded.map((r) => db.contact.update({ where: { id: synced[r.RowNumber].id }, data: { lsqLeadId: r.LeadId } })));
          synced = await db.contact.findMany({ where: { campaignId, lsqLeadId: { not: null }, email: { not: null } } });
          leadIds = synced.map((c) => c.lsqLeadId).filter((id): id is string => !!id);
          await addLeadsToStaticList(listId, leadIds);
          rowErrors.unshift(`${succeeded.length} stale LeadSquared record(s) were re-created after their ids went stale`);
        } else {
          throw err;
        }
      }
    }

    return { listId, leadsCreated, leadsUpdated, leadsFailed, error: rowErrors.length > 0 ? rowErrors.slice(0, 3).join('; ') : undefined };
  } catch (err) {
    return { listId: campaign.lsqListId, leadsCreated, leadsUpdated, leadsFailed: toCreate.length - leadsCreated - leadsUpdated, error: String(err) };
  }
}
