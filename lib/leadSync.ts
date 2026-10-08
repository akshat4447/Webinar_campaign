import { db } from '@/lib/db';
import { bulkCreateOrUpdateLeads, createEmptyList, addLeadsToStaticList, getLists, LeadSquaredError, takeSkippedCustomFields, type LeadField } from '@/lib/leadsquared';
import { isValidLsqSchemaName } from '@/lib/lsqPayload';

export interface LeadSyncResult {
  listId: string | null;
  leadsCreated: number;
  leadsUpdated: number;
  leadsFailed: number;
  error?: string;
  /** Custom LeadSquared fields that do not exist in the tenant and were skipped (create them for full data). */
  skippedFields?: string[];
}

/**
 * Builds the attribute list written to LeadSquared.
 *
 * `extraFieldsJson` holds columns the CSV supplied that have no first-class
 * column here. They're sent only when the operator has confirmed a
 * header→SchemaName mapping (stored under `_lsqMap`), so an unreviewed guess
 * never writes into a live CRM field.
 */
export function leadFieldsFor(
  c: {
    email: string | null;
    name: string;
    account: string;
    title: string;
    phone?: string | null;
    extraFieldsJson?: string | null;
    score?: number | null;
    seniority?: string | null;
    function?: string | null;
  },
  lsqFieldMappingTokens?: string | null
): LeadField[] {
  const base: LeadField[] = [
    { Attribute: 'EmailAddress', Value: c.email! },
    { Attribute: 'FirstName', Value: c.name.split(' ')[0] || c.name },
    { Attribute: 'LastName', Value: c.name.split(' ').slice(1).join(' ') },
    { Attribute: 'Company', Value: c.account },
    { Attribute: 'JobTitle', Value: c.title },
    ...(c.phone ? [{ Attribute: 'Phone', Value: c.phone }] : []),
  ];

  const taken = new Set(base.map((f) => f.Attribute));

  // If enriched fields exist, push them to standard or custom attributes if not already taken
  if (c.score !== null && c.score !== undefined && !taken.has('mx_Webinar_ICP_Score')) {
    taken.add('mx_Webinar_ICP_Score');
    base.push({ Attribute: 'mx_Webinar_ICP_Score', Value: String(c.score) });
  }
  if (c.seniority && !taken.has('mx_Seniority')) {
    taken.add('mx_Seniority');
    base.push({ Attribute: 'mx_Seniority', Value: c.seniority });
  }
  if (c.function && !taken.has('mx_Function')) {
    taken.add('mx_Function');
    base.push({ Attribute: 'mx_Function', Value: c.function });
  }

  // Check campaign-level field mappings (saved from Wizard Step 2)
  if (lsqFieldMappingTokens) {
    try {
      const mappings = JSON.parse(lsqFieldMappingTokens);
      if (Array.isArray(mappings)) {
        let extras: Record<string, unknown> = {};
        if (c.extraFieldsJson) {
          try {
            extras = JSON.parse(c.extraFieldsJson) as Record<string, unknown>;
          } catch {
            // ignore
          }
        }

        for (const m of mappings) {
          if (!m || typeof m !== 'object' || m.enabled === false) continue;
          const targetField = typeof m.lsqField === 'string' ? m.lsqField.trim() : '';
          // An operator-typed field name that is not a legal LeadSquared schema name must be
          // skipped here, not sent: it would be rejected and cost the contact its whole sync.
          if (!targetField || targetField.startsWith('(auto') || !isValidLsqSchemaName(targetField) || taken.has(targetField)) continue;

          // Resolve value from first-class contact fields or extras
          let resolvedVal: string | null = null;
          const cleanToken = (m.token || '').replace(/[{}]/g, '').trim().toLowerCase();
          const cleanId = (m.id || '').trim().toLowerCase();
          const cleanLabel = (m.label || '').trim().toLowerCase();

          if (cleanToken === 'firstname' || cleanId === 'firstname') {
            resolvedVal = c.name.split(' ')[0] || c.name;
          } else if (cleanToken === 'lastname' || cleanId === 'lastname') {
            resolvedVal = c.name.split(' ').slice(1).join(' ');
          } else if (cleanToken === 'company' || cleanId === 'company') {
            resolvedVal = c.account;
          } else if (cleanToken === 'title' || cleanId === 'title' || cleanToken === 'jobtitle') {
            resolvedVal = c.title;
          } else if (cleanToken === 'email' || cleanId === 'email') {
            resolvedVal = c.email;
          } else if (cleanToken === 'phone' || cleanId === 'phone') {
            resolvedVal = c.phone || null;
          } else if (cleanToken === 'score' || cleanId === 'score') {
            resolvedVal = c.score !== null && c.score !== undefined ? String(c.score) : null;
          } else if (cleanToken === 'seniority' || cleanId === 'seniority') {
            resolvedVal = c.seniority || null;
          } else if (cleanToken === 'function' || cleanId === 'function') {
            resolvedVal = c.function || null;
          } else {
            // Check in extras by label, token, or id
            for (const [k, v] of Object.entries(extras)) {
              const lowerK = k.toLowerCase().trim();
              if (lowerK === cleanLabel || lowerK === cleanToken || lowerK === cleanId) {
                if (v !== null && v !== undefined) resolvedVal = String(v).trim();
                break;
              }
            }
          }

          if (resolvedVal && resolvedVal.trim() && !taken.has(targetField)) {
            taken.add(targetField);
            base.push({ Attribute: targetField, Value: resolvedVal.trim() });
          }
        }
      }
    } catch {
      // malformed mapping token JSON must never block lead creation
    }
  }

  // Also support legacy _lsqMap in extraFieldsJson if present
  if (c.extraFieldsJson) {
    try {
      const parsed = JSON.parse(c.extraFieldsJson) as Record<string, unknown>;
      const map = parsed._lsqMap as Record<string, string> | undefined;
      if (map) {
        for (const [header, schemaName] of Object.entries(map)) {
          const value = parsed[header];
          if (typeof value !== 'string' || !value.trim() || !isValidLsqSchemaName(schemaName) || taken.has(schemaName)) continue;
          taken.add(schemaName);
          base.push({ Attribute: schemaName, Value: value.trim() });
        }
      }
    } catch {
      // ignore
    }
  }

  return base;
}

// LSQ rejects AddLeadsToStaticList with this when a leadId in the payload
// doesn't correspond to a real, current lead — exactly what a stale, locally-
// cached lsqLeadId produces (see the "self-heal" pass below for why that
// happens and how it's repaired).
const STALE_LEAD_ERROR = /Records not associated with List/i;

export interface LeadSyncOptions {
  /**
   * Whether to auto-create a static list in LeadSquared if campaign.lsqListId is not set.
   * Defaults to false (Option 2: strict opt-in, never create lists autonomously).
   */
  createList?: boolean;
}

// Pushes every contact with an email (that doesn't already have an lsqLeadId)
// to LeadSquared as a real Lead, then optionally adds synced leads to a static
// list if a list ID is bound to the campaign or createList is explicitly enabled.
export async function syncContactsToLeadSquared(campaignId: string, options?: LeadSyncOptions): Promise<LeadSyncResult> {
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
      const results = await bulkCreateOrUpdateLeads(toCreate.map((c) => leadFieldsFor(c, campaign.lsqFieldMappingTokens)));
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
    if (!listId && options?.createList === true) {
      const listName = `${campaign.name} — Webinar Campaign Agent`;
      // Self-heal: a prior run may have created the list in LSQ but failed
      // before saving its id locally (e.g. a transient DB error) — reuse it
      // by name instead of colliding on LSQ's duplicate-name rejection.
      const existing = (await getLists()).find((l) => l.ListName === listName);
      listId = existing?.ListId ?? (await createEmptyList(listName, `Auto-created by Webinar Campaign Agent for campaign ${campaign.id}`));
      await db.campaign.update({ where: { id: campaignId }, data: { lsqListId: listId } });
    }

    if (listId) {
      // Dynamic lists in LeadSquared are query-driven and reject AddLeadsToStaticList.
      let isStatic = true;
      try {
        const allLists = await getLists();
        if (Array.isArray(allLists)) {
          const targetList = allLists.find((l) => l?.ListId === listId);
          if (targetList && /dynamic/i.test(targetList.ListType)) {
            isStatic = false;
          }
        }
      } catch {
        // Fall back to static if list retrieval fails
      }

      if (isStatic) {
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
            const refreshed = await bulkCreateOrUpdateLeads(synced.map((c) => leadFieldsFor(c, campaign.lsqFieldMappingTokens)));
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
    }
    }

    const skippedFields = takeSkippedCustomFields();
    if (skippedFields.length > 0) {
      await db.activityLogEntry
        .create({ data: { campaignId, text: `LeadSquared fields not found in this tenant were skipped: ${skippedFields.join(', ')}. Create them in LeadSquared to sync that data.`, dot: 'var(--accent-500)' } })
        .catch(() => undefined);
    }
    return { listId: listId ?? null, leadsCreated, leadsUpdated, leadsFailed, error: rowErrors.length > 0 ? rowErrors.slice(0, 3).join('; ') : undefined, skippedFields: skippedFields.length ? skippedFields : undefined };
  } catch (err) {
    return { listId: campaign.lsqListId ?? null, leadsCreated, leadsUpdated, leadsFailed: toCreate.length - leadsCreated - leadsUpdated, error: String(err) };
  }
}

