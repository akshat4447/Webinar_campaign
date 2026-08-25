/**
 * Upgrades the two former "roadmap" channel entries (whatsapp / sms) into real,
 * enabled cadence steps on EVERY campaign, and creates their Template rows.
 *
 * provisionCampaignDefaults alone isn't enough here: its upsert uses
 * `update: {}`, and existing campaigns already carry those two CadenceStep rows
 * as disabled roadmap placeholders — the create-side defaults would never apply.
 * So this script explicitly rewrites those two rows from STEP_DEFAULTS + the
 * demo-data definitions, then lets provision fill in the missing templates.
 *
 *   npm run backfill:channels
 */
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());
import { db } from '../lib/db';
import { provisionCampaignDefaults } from '../lib/campaignDefaults';
import { cadenceStepsData } from '../lib/demo-data';
import { STEP_DEFAULTS } from '../lib/stepSchedule';

const CHANNEL_KEYS = ['whatsapp', 'sms'] as const;

async function main() {
  const campaigns = await db.campaign.findMany({ select: { id: true } });
  for (const c of campaigns) {
    await provisionCampaignDefaults(c.id); // creates the two new Template rows

    for (const key of CHANNEL_KEYS) {
      const def = cadenceStepsData.find((s) => s.id === key);
      if (!def) continue;
      await db.cadenceStep.update({
        where: { campaignId_key: { campaignId: c.id, key } },
        data: {
          group: def.group,
          title: def.title,
          timing: def.timing,
          channel: def.channel,
          desc: def.desc,
          toggleable: true,
          enabled: true,
          isRoadmap: false,
          ...(STEP_DEFAULTS[key] ?? {}),
        },
      });
    }
  }
  console.log(`Channel backfill done — whatsapp/sms are now live steps on ${campaigns.length} campaign(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());