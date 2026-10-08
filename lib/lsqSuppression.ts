import { db } from './db';
import {
  getLists,
  createEmptyList,
  addLeadsToStaticList,
  type LsqList,
  bulkCreateOrUpdateLeads,
} from './leadsquared';
import { leadFieldsFor } from './leadSync';
import { revalidateCampaign } from './revalidate';
import { claimOnce, findClaimed, idemKey } from './idempotency';

/** Ledger key marking "this registrant has been added to the campaign's suppression list". */
export const suppressionSyncKey = (campaignId: string, contactId: string) => idemKey('lsq-suppression', campaignId, contactId);

export interface LsqStaticListItem {
  id: string;
  name: string;
  memberCount: number;
}

export interface LsqSuppressionConfig {
  ok: boolean;
  lists: LsqStaticListItem[];
  suppressionListId: string | null;
  suppressionListName?: string;
  exclusionListIds: string[];
  registeredCount: number;
  syncedToSuppressionCount: number;
  error?: string;
}

/**
 * Fetch static lists from the LeadSquared tenant alongside the campaign's current
 * suppression and exclusion list configurations.
 */
export async function getLeadSquaredSuppressionConfig(campaignId: string): Promise<LsqSuppressionConfig> {
  try {
    const campaign = await db.campaign.findUnique({
      where: { id: campaignId },
      select: {
        id: true,
        lsqSuppressionListId: true,
        lsqExclusionListIds: true,
      },
    });

    if (!campaign) {
      return {
        ok: false,
        lists: [],
        suppressionListId: null,
        exclusionListIds: [],
        registeredCount: 0,
        syncedToSuppressionCount: 0,
        error: 'Campaign not found',
      };
    }

    let listsError: string | undefined;
    const [allLists, registeredCount, syncedCount] = await Promise.all([
      getLists().catch((err) => {
        listsError = err instanceof Error ? err.message : String(err);
        console.error('[lsqSuppression] Failed to fetch lists from LeadSquared:', err);
        return [] as LsqList[];
      }),
      db.contact.count({ where: { campaignId, registeredAt: { not: null } } }),
      db.contact.count({
        where: {
          campaignId,
          registeredAt: { not: null },
          lsqLeadId: { not: null },
        },
      }),
    ]);

    const staticLists: LsqStaticListItem[] = (allLists || [])
      .filter((l) => /static/i.test(String(l.ListType)))
      .sort((a, b) => {
        // If one is the currently selected list, put it at top
        if (campaign.lsqSuppressionListId) {
          if (a.ListId === campaign.lsqSuppressionListId) return -1;
          if (b.ListId === campaign.lsqSuppressionListId) return 1;
        }
        return (b.MemberCount ?? 0) - (a.MemberCount ?? 0);
      })
      .map((l) => ({
        id: l.ListId,
        name: l.ListName,
        memberCount: l.MemberCount ?? 0,
      }));

    let exclusionListIds: string[] = [];
    if (campaign.lsqExclusionListIds) {
      try {
        const parsed = JSON.parse(campaign.lsqExclusionListIds);
        if (Array.isArray(parsed)) exclusionListIds = parsed;
      } catch {
        exclusionListIds = campaign.lsqExclusionListIds.split(',').map((s) => s.trim()).filter(Boolean);
      }
    }

    const currentSuppressionList = staticLists.find((l) => l.id === campaign.lsqSuppressionListId);

    return {
      ok: true,
      lists: staticLists,
      suppressionListId: campaign.lsqSuppressionListId,
      suppressionListName: currentSuppressionList?.name,
      exclusionListIds,
      registeredCount,
      syncedToSuppressionCount: syncedCount,
      error: listsError,
    };
  } catch (err) {
    return {
      ok: false,
      lists: [],
      suppressionListId: null,
      exclusionListIds: [],
      registeredCount: 0,
      syncedToSuppressionCount: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Creates a brand-new Static List inside the LeadSquared tenant and attaches it
 * as the campaign's registrant suppression list.
 */
export async function createAndAttachLsqSuppressionList(
  campaignId: string,
  listName: string,
  description?: string
): Promise<{ ok: boolean; listId?: string; listName?: string; reused?: boolean; error?: string }> {
  try {
    const campaign = await db.campaign.findUnique({
      where: { id: campaignId },
      select: { id: true, name: true, lsqFieldMappingTokens: true },
    });
    if (!campaign) throw new Error('Campaign not found');

    const rawName = listName.trim() || `[Webinar] ${campaign.name} - Registrants`;
    const finalDesc = description?.trim() || `Registrants suppression list for webinar "${campaign.name}" created by Webinar Campaign Agent`;

    let finalName = rawName;
    let listId: string | null = null;
    let reused = false;

    // Pre-check: check if this list already exists in LeadSquared tenant
    try {
      const existingLists = await getLists();
      const match = existingLists.find(
        (l) => l.ListName.trim().toLowerCase() === rawName.toLowerCase()
      );
      if (match) {
        listId = match.ListId;
        finalName = match.ListName;
        reused = true;
        console.log(`[lsqSuppression] Found existing LeadSquared list "${match.ListName}" (${match.ListId}). Attaching.`);
      }
    } catch {
      // Proceed to direct creation
    }

    if (!listId) {
      try {
        listId = await createEmptyList(finalName, finalDesc);
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const isDuplicate =
          errMsg.includes('MXDuplicateEntryException') ||
          errMsg.includes('already exists') ||
          (typeof err === 'object' &&
            err !== null &&
            'body' in err &&
            JSON.stringify((err as { body?: unknown }).body).includes('MXDuplicateEntryException'));

        if (isDuplicate) {
          console.warn(`[lsqSuppression] List name "${finalName}" already exists in system. Resolving existing list...`);
          const existingLists = await getLists().catch(() => []);
          const match = existingLists.find(
            (l) => l.ListName.trim().toLowerCase() === rawName.toLowerCase()
          );

          if (match) {
            listId = match.ListId;
            finalName = match.ListName;
            reused = true;
          } else {
            // Append current date to ensure uniqueness
            const nowSuffix = new Date().toISOString().slice(0, 10);
            const suffixedName = `${rawName} (${nowSuffix})`;
            try {
              listId = await createEmptyList(suffixedName, finalDesc);
              finalName = suffixedName;
            } catch {
              throw new Error(
                `A list named "${rawName}" already exists in your LeadSquared tenant. Please select it from the dropdown or provide a different name.`
              );
            }
          }
        } else {
          throw err;
        }
      }
    }

    if (!listId) throw new Error('Failed to resolve or create list in LeadSquared');

    // 2. Attach to campaign
    await db.campaign.update({
      where: { id: campaignId },
      data: { lsqSuppressionListId: listId },
    });

    // 3. Immediately backfill any contacts already marked registered
    const registeredContacts = await db.contact.findMany({
      where: { campaignId, registeredAt: { not: null } },
    });

    const leadIdsToAdd: string[] = [];
    const missingLeads = registeredContacts.filter((c) => !c.lsqLeadId && c.email);

    if (missingLeads.length > 0) {
      try {
        const payload = missingLeads.map((c) => leadFieldsFor(c, campaign.lsqFieldMappingTokens));
        const results = await bulkCreateOrUpdateLeads(payload);
        for (const r of results) {
          if (r.LeadId) {
            const contactId = missingLeads[r.RowNumber]?.id;
            if (contactId) {
              await db.contact.update({ where: { id: contactId }, data: { lsqLeadId: r.LeadId } });
              leadIdsToAdd.push(r.LeadId);
            }
          }
        }
      } catch (err) {
        console.error('Failed to create missing leads in LeadSquared during list setup:', err);
      }
    }

    for (const c of registeredContacts) {
      if (c.lsqLeadId && !leadIdsToAdd.includes(c.lsqLeadId)) {
        leadIdsToAdd.push(c.lsqLeadId);
      }
    }

    if (leadIdsToAdd.length > 0) {
      try {
        await addLeadsToStaticList(listId, leadIdsToAdd);
      } catch (err) {
        console.error('Could not backfill existing registrants to newly created list:', err);
      }
    }

    await db.activityLogEntry.create({
      data: {
        campaignId,
        text: reused
          ? `Attached existing LeadSquared suppression list "${finalName}" (${leadIdsToAdd.length} registrant(s) attached)`
          : `Created LeadSquared suppression list "${finalName}" (${leadIdsToAdd.length} registrant(s) attached)`,
        dot: 'var(--success-500)',
      },
    });

    revalidateCampaign(campaignId);
    return { ok: true, listId, listName: finalName, reused };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Configure which existing LeadSquared list acts as the registrant suppression list,
 * and which other LeadSquared lists are attached as exclusion filters.
 */
export async function updateCampaignSuppressionLists(
  campaignId: string,
  suppressionListId: string | null,
  exclusionListIds: string[] = []
): Promise<{ ok: boolean; syncedCount?: number; error?: string }> {
  try {
    const campaign = await db.campaign.findUnique({
      where: { id: campaignId },
      select: { id: true, name: true, lsqFieldMappingTokens: true },
    });
    if (!campaign) throw new Error('Campaign not found');

    const cleanExclusions = Array.isArray(exclusionListIds) ? exclusionListIds.filter(Boolean) : [];

    await db.campaign.update({
      where: { id: campaignId },
      data: {
        lsqSuppressionListId: suppressionListId || null,
        lsqExclusionListIds: JSON.stringify(cleanExclusions),
      },
    });

    // If a registrant suppression list was selected, push all current registrants into it
    let syncedCount = 0;
    if (suppressionListId) {
      const registrants = await db.contact.findMany({
        where: { campaignId, registeredAt: { not: null } },
      });

      const leadIds: string[] = [];
      const needsSync = registrants.filter((c) => !c.lsqLeadId && c.email);
      if (needsSync.length > 0) {
        try {
          const payload = needsSync.map((c) => leadFieldsFor(c, campaign.lsqFieldMappingTokens));
          const results = await bulkCreateOrUpdateLeads(payload);
          for (const r of results) {
            if (r.LeadId) {
              const contactId = needsSync[r.RowNumber]?.id;
              if (contactId) {
                await db.contact.update({ where: { id: contactId }, data: { lsqLeadId: r.LeadId } });
                leadIds.push(r.LeadId);
              }
            }
          }
        } catch (err) {
          console.error('Error creating leads for LSQ suppression sync:', err);
        }
      }

      for (const c of registrants) {
        if (c.lsqLeadId && !leadIds.includes(c.lsqLeadId)) {
          leadIds.push(c.lsqLeadId);
        }
      }

      if (leadIds.length > 0) {
        await addLeadsToStaticList(suppressionListId, leadIds);
        syncedCount = leadIds.length;
      }
    }

    await db.activityLogEntry.create({
      data: {
        campaignId,
        text: suppressionListId
          ? `Updated LeadSquared suppression settings: attached list (${syncedCount} registrants synced), ${cleanExclusions.length} exclusion list(s)`
          : `Updated LeadSquared suppression settings: detached list, ${cleanExclusions.length} exclusion list(s)`,
        dot: 'var(--accent-500)',
      },
    });

    revalidateCampaign(campaignId);
    return { ok: true, syncedCount };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Pushes a newly registered contact into the campaign's designated LeadSquared
 * suppression list. Called automatically whenever a contact registers.
 */
export async function syncContactToLsqSuppressionList(campaignId: string, contactId: string): Promise<boolean> {
  try {
    const campaign = await db.campaign.findUnique({
      where: { id: campaignId },
      select: { lsqSuppressionListId: true, lsqFieldMappingTokens: true },
    });

    if (!campaign?.lsqSuppressionListId) {
      return false;
    }

    const contact = await db.contact.findUnique({
      where: { id: contactId },
    });

    if (!contact || !contact.email) {
      return false;
    }

    // Already added (marker written after the last success) — nothing to do. The marker is
    // advisory: if the ledger is unavailable we just proceed, since list adds are idempotent.
    const doneKey = suppressionSyncKey(campaignId, contactId);
    try {
      if ((await findClaimed([doneKey])).has(doneKey)) return true;
    } catch {
      /* fail open */
    }

    let leadId = contact.lsqLeadId;

    // If contact has no LeadSquared ID yet, create/upsert it now
    if (!leadId) {
      const payload = [leadFieldsFor(contact, campaign.lsqFieldMappingTokens)];
      const results = await bulkCreateOrUpdateLeads(payload);
      if (results[0]?.LeadId) {
        leadId = results[0].LeadId;
        await db.contact.update({
          where: { id: contactId },
          data: { lsqLeadId: leadId },
        });
      }
    }

    if (!leadId) {
      console.warn(`[lsqSuppression] Could not resolve LSQ LeadId for contact ${contact.id}`);
      return false;
    }

    // Add lead to the static list
    await addLeadsToStaticList(campaign.lsqSuppressionListId, [leadId]);
    await claimOnce(doneKey).catch(() => undefined); // record success so the reconcile sweep skips it

    await db.activityLogEntry.create({
      data: {
        campaignId,
        text: `Synced ${contact.name} to LeadSquared suppression list`,
        dot: 'var(--success-500)',
      },
    });

    return true;
  } catch (err) {
    console.error(`[lsqSuppression] Failed to sync contact ${contactId} to suppression list:`, err);
    return false;
  }
}
