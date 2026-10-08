import { db } from '@/lib/db';
import { PartialActivityPushError, bulkCreateOrUpdateLeads, createActivityType, createOrUpdateLead, pushCustomActivities, type LeadField } from '@/lib/leadsquared';
import { claimOnce, idemKey, release } from '@/lib/idempotency';
import { awaitInflight, zoomRegistrantKey } from '@/lib/inflight';
import { formatLsqDateTime, isValidLsqSchemaName } from '@/lib/lsqPayload';
import { upsertAttentionItem } from '@/lib/attentionItems';
import { resolveIntegrationField } from '@/lib/integrationConfig';

const SETTING_KEY = 'lsq_webinar_activity_type_id';

async function getOrCreateActivityTypeId(): Promise<number> {
  const cached = await db.appSetting.findUnique({ where: { key: SETTING_KEY } });
  if (cached) return Number(cached.value);

  const id = await createActivityType('Webinar Engagement', [
    { schemaName: 'mx_Custom_1', displayName: 'Webinar' },
    { schemaName: 'mx_Custom_2', displayName: 'Stage' },
  ]);
  await db.appSetting.upsert({ where: { key: SETTING_KEY }, update: { value: String(id) }, create: { key: SETTING_KEY, value: String(id) } });
  return id;
}

export interface EngagementEntry {
  contactId: string;
  stage: 'Attended' | 'No-show' | 'Demo requested' | 'SDR follow-up';
}

/** "Priya Nair Sharma" -> { FirstName: 'Priya', LastName: 'Nair Sharma' } (LastName omitted when absent). */
function leadNameFields(name: string): LeadField[] {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const out: LeadField[] = [];
  if (parts[0]) out.push({ Attribute: 'FirstName', Value: parts[0] });
  if (parts.length > 1) out.push({ Attribute: 'LastName', Value: parts.slice(1).join(' ') });
  return out;
}

/**
 * Posts attendance-derived engagement activities to LeadSquared.
 *
 *  - Idempotent per (campaign, contact, stage): re-importing the same attendance
 *    (a manual re-import, a retried cron tick) never posts a duplicate activity.
 *  - Leads that do not exist in LeadSquared yet are created in ONE batch call
 *    (25 per request) instead of one request per contact.
 *  - If a later chunk fails after earlier ones landed, only the activities that
 *    did NOT land are released for retry.
 */
export async function pushEngagementActivities(
  campaignId: string,
  entries: EngagementEntry[],
  revision?: string
): Promise<{ pushed: number; failed: number; skipped: number }> {
  if (entries.length === 0) return { pushed: 0, failed: 0, skipped: 0 };
  // findUnique + explicit check, not findUniqueOrThrow — this runs from the
  // automated attendance-import job (lib/attendance.ts) with no caller-side
  // try/catch, so a stale/deleted campaignId must not throw an uncaught
  // exception that silently kills that job; matches postWebinarRegistrationActivity's
  // own pattern below for the same reason.
  const campaign = await db.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) {
    // No valid campaign to attach an attention item to either — this can
    // only mean the campaign was deleted between the attendance import
    // starting and this step running.
    console.error(`[activityPush] pushEngagementActivities: campaign ${campaignId} no longer exists`);
    return { pushed: 0, failed: entries.length, skipped: 0 };
  }
  const activityTypeId = await getOrCreateActivityTypeId();

  const contacts = await db.contact.findMany({ where: { campaignId, id: { in: entries.map((e) => e.contactId) } } });
  const contactById = new Map(contacts.map((c) => [c.id, c]));

  let failed = 0;
  let skipped = 0;

  // 1. Claim each (contact, stage) once. Anything already claimed was posted before.
  const claimed: Array<{ entry: EngagementEntry; contact: (typeof contacts)[number]; key: string }> = [];
  for (const entry of entries) {
    const contact = contactById.get(entry.contactId);
    if (!contact || !contact.email) {
      failed++;
      continue;
    }
    const key = idemKey('lsq-engagement', campaignId, entry.contactId, entry.stage, ...(revision ? [revision] : []));
    if (!(await claimOnce(key))) {
      skipped++;
      continue;
    }
    claimed.push({ entry, contact, key });
  }
  if (claimed.length === 0) return { pushed: 0, failed, skipped };

  const releaseAll = async (items: typeof claimed) => {
    await Promise.all(items.map((c) => release(c.key).catch(() => undefined)));
  };

  // 2. Resolve LeadSquared lead ids — batch-create the missing ones.
  const needLead = claimed.filter((c) => !c.contact.lsqLeadId);
  const leadIdByContact = new Map<string, string>();
  for (const c of claimed) if (c.contact.lsqLeadId) leadIdByContact.set(c.contact.id, c.contact.lsqLeadId);

  if (needLead.length > 0) {
    try {
      const uniqueByEmail = new Map<string, (typeof claimed)[number]>();
      for (const c of needLead) uniqueByEmail.set(c.contact.email!.toLowerCase(), c);
      const batch = [...uniqueByEmail.values()];
      const results = await bulkCreateOrUpdateLeads(
        batch.map((c) => [
          { Attribute: 'EmailAddress', Value: c.contact.email! },
          ...leadNameFields(c.contact.name),
          ...(c.contact.account ? [{ Attribute: 'Company', Value: c.contact.account }] : []),
        ])
      );
      for (const r of results) {
        const target = batch[r.RowNumber];
        if (!target || r.ExceptionType || !r.LeadId) continue;
        const sameEmail = needLead.filter((c) => c.contact.email!.toLowerCase() === target.contact.email!.toLowerCase());
        for (const c of sameEmail) leadIdByContact.set(c.contact.id, r.LeadId);
        // Cache the id so later pushes skip the lookup. Best-effort: the push itself does not depend on it.
        await db.contact.updateMany({ where: { id: { in: sameEmail.map((c) => c.contact.id) } }, data: { lsqLeadId: r.LeadId } }).catch(() => undefined);
      }
    } catch (err) {
      console.error('[activityPush] batch lead upsert failed:', err instanceof Error ? err.message : err);
    }
  }

  const ready: typeof claimed = [];
  const unresolved: typeof claimed = [];
  for (const c of claimed) (leadIdByContact.has(c.contact.id) ? ready : unresolved).push(c);
  failed += unresolved.length;
  await releaseAll(unresolved);
  if (ready.length === 0) return { pushed: 0, failed, skipped };

  // 3. Push the activities.
  const activities = ready.map((c) => ({
    RelatedProspectId: leadIdByContact.get(c.contact.id)!,
    ActivityEvent: activityTypeId,
    ActivityNote: `${c.entry.stage} — ${campaign.name}`,
    Fields: [
      { SchemaName: 'mx_Custom_1', Value: campaign.name },
      { SchemaName: 'mx_Custom_2', Value: c.entry.stage },
    ],
  }));

  try {
    await pushCustomActivities(activities);
  } catch (err) {
    const landed = err instanceof PartialActivityPushError ? err.pushed : 0;
    const acceptedIndices=new Set(err instanceof PartialActivityPushError ? err.acceptedIndices ?? Array.from({length:landed},(_,i)=>i) : []);
    await releaseAll(ready.filter((_,index)=>!acceptedIndices.has(index)));
    failed += ready.length - landed;
    await upsertAttentionItem(campaignId, {
      icon: 'ErrorProperty1Outline',
      color: 'error',
      title: 'LeadSquared activity push failed',
      detail: String(err).slice(0, 600),
      actionsCsv: 'retry',
    });
    return { pushed: landed, failed, skipped };
  }

  return { pushed: ready.length, failed, skipped };
}

const REG_SETTING_KEY = 'lsq_webinar_reg_activity_type_id';

export async function getOrCreateRegistrationActivityTypeId(): Promise<number> {
  const cached = await db.appSetting.findUnique({ where: { key: REG_SETTING_KEY } });
  if (cached) return Number(cached.value);

  const id = await createActivityType('Webinar Registration', [
    { schemaName: 'mx_Custom_1', displayName: 'Webinar Name' },
    { schemaName: 'mx_Custom_2', displayName: 'Registration Source' },
    { schemaName: 'mx_Custom_3', displayName: 'Webinar Date' },
    { schemaName: 'mx_Custom_4', displayName: 'Zoom Join URL' },
    { schemaName: 'mx_Custom_5', displayName: 'Speaker' },
    { schemaName: 'mx_Custom_6', displayName: 'Registration Time' },
  ]);
  await db.appSetting.upsert({
    where: { key: REG_SETTING_KEY },
    update: { value: String(id) },
    create: { key: REG_SETTING_KEY, value: String(id) },
  });
  return id;
}

/**
 * Optional lead flag set once the contact holds a personal Zoom registration —
 * `mx_Zoom_Registered` in the spec. It must exist as a custom field in the
 * LeadSquared tenant (an admin creates it); we never assume it does, so it is
 * opt-in via LSQ_ZOOM_REGISTERED_FIELD and validated before use.
 */
function zoomRegisteredFlagField(): string | null {
  const name = process.env.LSQ_ZOOM_REGISTERED_FIELD?.trim();
  return name && isValidLsqSchemaName(name) ? name : null;
}

export async function postWebinarRegistrationActivity(
  campaignId: string,
  contactId: string,
  source: string = 'one_click'
): Promise<{ ok: boolean; activityId?: number; skipped?: boolean; duplicate?: boolean; error?: string }> {
  let claimKey: string | null = null;
  try {
    const [campaign, loadedContact] = await Promise.all([
      db.campaign.findUnique({
        where: { id: campaignId },
        include: { speakers: { orderBy: [{ order: 'asc' }, { id: 'asc' }] } },
      }),
      db.contact.findUnique({ where: { id: contactId } }),
    ]);

    if (!campaign || !loadedContact) return { ok: false, error: 'Campaign or contact not found' };

    // Check if LeadSquared is configured
    const accessKey = (await resolveIntegrationField('lsq', 'accessKey')) || (await db.appSetting.findUnique({ where: { key: 'lsq_access_key' } }))?.value || process.env.LEADSQUARED_ACCESS_KEY;
    const secretKey = (await resolveIntegrationField('lsq', 'secretKey')) || (await db.appSetting.findUnique({ where: { key: 'lsq_secret_key' } }))?.value || process.env.LEADSQUARED_SECRET_KEY;
    if (!accessKey || !secretKey) {
      return { ok: true, skipped: true };
    }

    // One registration activity per (campaign, contact), ever — webhook
    // redeliveries and reconcile retries must not post it twice.
    claimKey = idemKey('lsq-registration', campaignId, contactId);
    if (!(await claimOnce(claimKey))) {
      claimKey = null;
      return { ok: true, skipped: true, duplicate: true };
    }

    // The Zoom registrant sync runs alongside this; wait for it (bounded) so the
    // activity records the contact's PERSONAL join link, not the generic one.
    await awaitInflight(zoomRegistrantKey(contactId));
    const contact = (await db.contact.findUnique({ where: { id: contactId } })) ?? loadedContact;

    const flagField = zoomRegisteredFlagField();
    const zoomRegistered = Boolean(contact.zoomJoinUrl || contact.zoomRegistrantId);

    let leadId = contact.lsqLeadId;
    if (!leadId || (flagField && zoomRegistered)) {
      if (!contact.email) throw new Error('Missing contact email for LeadSquared sync');
      let result;
      try {
        result = await createOrUpdateLead([
          { Attribute: 'EmailAddress', Value: contact.email },
          ...leadNameFields(contact.name),
          { Attribute: 'Company', Value: contact.account },
          ...(contact.phone ? [{ Attribute: 'Phone', Value: contact.phone }] : []),
          ...(flagField && zoomRegistered ? [{ Attribute: flagField, Value: 'true' }] : []),
        ]);
      } catch (err) {
        throw new Error(`Lead create/update failed: ${String(err)}`);
      }
      leadId = result.Message.Id;
      if (leadId !== contact.lsqLeadId) await db.contact.update({ where: { id: contact.id }, data: { lsqLeadId: leadId } });
    }

    const activityTypeId = await getOrCreateRegistrationActivityTypeId();
    const speakerText = campaign.speakers?.length
      ? campaign.speakers.map((s) => s.name).join(', ')
      : (campaign.speakerName || 'TBD');

    await pushCustomActivities([
      {
        RelatedProspectId: leadId,
        ActivityEvent: activityTypeId,
        ActivityNote: `Registered for "${campaign.name}" via ${source}`,
        Fields: [
          { SchemaName: 'mx_Custom_1', Value: campaign.name },
          { SchemaName: 'mx_Custom_2', Value: source },
          { SchemaName: 'mx_Custom_3', Value: campaign.date || (campaign.scheduledAt ? campaign.scheduledAt.toISOString() : 'TBD') },
          { SchemaName: 'mx_Custom_4', Value: contact.zoomJoinUrl || campaign.zoomLink || campaign.registrationLink || '' },
          { SchemaName: 'mx_Custom_5', Value: speakerText },
          // Registration time in LeadSquared's own date-time format.
          { SchemaName: 'mx_Custom_6', Value: formatLsqDateTime(new Date()) },
        ],
      },
    ]);

    await db.activityLogEntry.create({
      data: {
        campaignId,
        text: `LeadSquared activity posted: "${contact.name}" registered (${source})`,
        dot: 'var(--success-500)',
      },
    });

    return { ok: true, activityId: activityTypeId };
  } catch (err) {
    // The activity did not land: give the claim back so a retry (the reconcile
    // sweep, or the next delivery) is allowed to post it.
    if (claimKey) await release(claimKey).catch(() => undefined);
    console.error('LeadSquared registration activity push error:', err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
