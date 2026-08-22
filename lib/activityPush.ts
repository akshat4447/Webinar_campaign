import { db } from '@/lib/db';
import { createActivityType, createOrUpdateLead, pushCustomActivities } from '@/lib/leadsquared';
import { upsertAttentionItem } from '@/lib/attentionItems';

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
  stage: 'Attended' | 'No-show' | 'Demo requested';
}

export async function pushEngagementActivities(campaignId: string, entries: EngagementEntry[]): Promise<{ pushed: number; failed: number }> {
  if (entries.length === 0) return { pushed: 0, failed: 0 };
  const campaign = await db.campaign.findUniqueOrThrow({ where: { id: campaignId } });
  const activityTypeId = await getOrCreateActivityTypeId();

  const contacts = await db.contact.findMany({ where: { id: { in: entries.map((e) => e.contactId) } } });
  const contactById = new Map(contacts.map((c) => [c.id, c]));

  const activities = [];
  let failed = 0;
  for (const entry of entries) {
    const contact = contactById.get(entry.contactId);
    if (!contact || !contact.email) {
      failed++;
      continue;
    }
    let leadId = contact.lsqLeadId;
    if (!leadId) {
      try {
        const result = await createOrUpdateLead([
          { Attribute: 'EmailAddress', Value: contact.email },
          { Attribute: 'FirstName', Value: contact.name.split(' ')[0] || contact.name },
          { Attribute: 'Company', Value: contact.account },
        ]);
        leadId = result.Message.Id;
        await db.contact.update({ where: { id: contact.id }, data: { lsqLeadId: leadId } });
      } catch {
        failed++;
        continue;
      }
    }
    activities.push({
      RelatedProspectId: leadId,
      ActivityEvent: activityTypeId,
      ActivityNote: `${entry.stage} — ${campaign.name}`,
      Fields: [
        { SchemaName: 'mx_Custom_1', Value: campaign.name },
        { SchemaName: 'mx_Custom_2', Value: entry.stage },
      ],
    });
  }

  if (activities.length > 0) {
    try {
      await pushCustomActivities(activities);
    } catch (err) {
      await upsertAttentionItem(campaignId, {
        icon: 'ErrorProperty1Outline',
        color: 'error',
        title: 'LeadSquared activity push failed',
        detail: String(err).slice(0, 300),
        actionsCsv: 'retry',
      });
      return { pushed: 0, failed: entries.length };
    }
  }

  return { pushed: activities.length, failed };
}
