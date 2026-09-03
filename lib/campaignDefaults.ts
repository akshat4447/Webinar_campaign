import { db } from '@/lib/db';
import { templatesData, cadenceStepsData } from '@/lib/demo-data';
import { STEP_DEFAULTS } from '@/lib/stepSchedule';
import { defaultTriggerFor } from '@/lib/stepTrigger';

// Every campaign needs a baseline Templates + CadenceSteps set to have anything
// to show on the Templates/Schedule tabs — idempotent via the schema's
// @@unique([campaignId, key]) so calling this on an already-provisioned
// campaign is a harmless no-op.
export async function provisionCampaignDefaults(campaignId: string) {
  await Promise.all([
    ...templatesData.map((t) =>
      db.template.upsert({
        where: { campaignId_key: { campaignId, key: t.id } },
        update: {},
        create: { campaignId, key: t.id, label: t.label, channel: t.channel, hasSubject: t.hasSubject, subject: t.subject, body: t.body },
      })
    ),
    ...cadenceStepsData.map((s) =>
      db.cadenceStep.upsert({
        where: { campaignId_key: { campaignId, key: s.id } },
        update: {},
        create: {
          campaignId,
          key: s.id,
          group: s.group,
          title: s.title,
          timing: s.timing,
          channel: s.channel,
          desc: s.desc,
          toggleable: s.toggleable,
          enabled: s.toggleable,
          isRoadmap: !!s.isRoadmap,
          trigger: defaultTriggerFor(s.id),
          ...(STEP_DEFAULTS[s.id] ?? {}),
        },
      })
    ),
  ]);
}
