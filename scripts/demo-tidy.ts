/**
 * Removes demo debris that accumulates while testing, so the landing page shows
 * only the real campaigns.
 *
 *   npm run demo:tidy            # report what would change, delete nothing
 *   npm run demo:tidy -- --apply # actually apply it
 *
 * What it targets:
 *  - campaigns still called "Untitled webinar N" (created by the New webinar
 *    button while clicking around, never given a name)
 *  - a "live" status on a campaign with nothing approved and no successful send,
 *    which reads as a broken campaign on the landing page
 *  - failed/queued CadenceSend rows left behind by send debugging
 */
import { db } from '../lib/db';

const apply = process.argv.includes('--apply');

async function main() {
  const untitled = await db.campaign.findMany({
    where: { name: { startsWith: 'Untitled webinar' } },
    select: { id: true, name: true, status: true },
  });

  const live = await db.campaign.findMany({ where: { status: 'live' }, select: { id: true, name: true } });
  const misleading: { id: string; name: string }[] = [];
  for (const c of live) {
    if (untitled.some((u) => u.id === c.id)) continue; // already being removed
    const [approved, sent] = await Promise.all([
      db.contact.count({ where: { campaignId: c.id, approved: true } }),
      db.cadenceSend.count({ where: { campaignId: c.id, status: 'sent' } }),
    ]);
    if (approved === 0 && sent === 0) misleading.push(c);
  }

  const debris = await db.cadenceSend.count({ where: { status: { in: ['failed', 'queued'] } } });

  console.log(`Untitled campaigns to delete: ${untitled.length}`);
  for (const c of untitled) console.log(`  - ${c.name} (${c.id}, ${c.status})`);
  console.log(`Campaigns marked live with nothing approved or sent: ${misleading.length}`);
  for (const c of misleading) console.log(`  - ${c.name} (${c.id}) -> draft`);
  console.log(`Failed/queued sends to clear: ${debris}`);

  if (!apply) {
    console.log('\nDry run — nothing changed. Re-run with:  npm run demo:tidy -- --apply');
    return;
  }

  // Contacts, templates, sends, logs, attention items and personalized copy all
  // cascade from Campaign, so deleting the campaign is enough.
  const removed = await db.campaign.deleteMany({ where: { id: { in: untitled.map((c) => c.id) } } });
  const demoted = await db.campaign.updateMany({ where: { id: { in: misleading.map((c) => c.id) } }, data: { status: 'draft' } });
  const cleared = await db.cadenceSend.deleteMany({ where: { status: { in: ['failed', 'queued'] } } });

  console.log(`\nDeleted ${removed.count} campaign(s), demoted ${demoted.count} to draft, cleared ${cleared.count} send row(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
