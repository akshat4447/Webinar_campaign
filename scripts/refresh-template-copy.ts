/**
 * Pushes the improved default template copy out to every campaign — WITHOUT
 * touching rows a human has edited. The rule is simple and safe:
 *
 *   a Template row whose savedBody is null has never been saved over, so its
 *   subject/body are still whatever provisionCampaignDefaults seeded. Those
 *   get refreshed to the new defaults. Any row with a savedBody belongs to a
 *   human decision and is left exactly as-is.
 *
 *   npm run refresh:templates
 */
import '../lib/loadEnv';
import { db } from '../lib/db';
import { templatesData } from '../lib/demo-data';

async function main() {
  const campaigns = await db.campaign.findMany({ select: { id: true } });
  let updated = 0;
  let skippedEdited = 0;

  for (const c of campaigns) {
    for (const def of templatesData) {
      const row = await db.template.findUnique({
        where: { campaignId_key: { campaignId: c.id, key: def.id } },
        select: { id: true, savedBody: true, subject: true, body: true },
      });
      if (!row) continue;
      if (row.savedBody !== null) {
        skippedEdited++;
        continue;
      }
      const nextSubject = def.hasSubject ? def.subject ?? null : null;
      if (row.subject === nextSubject && row.body === def.body) continue; // already current
      await db.template.update({
        where: { id: row.id },
        data: { subject: nextSubject, body: def.body },
      });
      updated++;
    }
  }

  console.log(`Template copy refreshed on ${campaigns.length} campaign(s): ${updated} row(s) updated, ${skippedEdited} left untouched (human-edited).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());