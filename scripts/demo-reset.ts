/**
 * Resets the demo campaign back to "freshly imported" so the enrichment →
 * scoring → verification story can be run live again.
 *
 *   npm run demo:reset            # resets c2 (Patient Journeys at Scale)
 *   npm run demo:reset -- c3      # resets another campaign by id
 *
 * Keeps the imported contacts and re-seeds them from the demo CSV, then clears
 * everything downstream: enrichment, scores, approvals, personalized copy,
 * sends, logs, attention.
 */
import { readFile } from 'fs/promises';
import path from 'path';
import { db } from '../lib/db';
import { provisionCampaignDefaults } from '../lib/campaignDefaults';
import { classifyContact, pickCol } from '../lib/importHeuristics';

const campaignId = process.argv[2] ?? 'c2';

function parseCsv(text: string): string[][] {
  return text
    .split('\n')
    .map((line) => {
      const cells: string[] = [];
      let val = '';
      let q = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (q) {
          if (ch === '"') {
            if (line[i + 1] === '"') {
              val += '"';
              i++;
            } else q = false;
          } else val += ch;
        } else if (ch === '"') q = true;
        else if (ch === ',') {
          cells.push(val);
          val = '';
        } else val += ch;
      }
      cells.push(val);
      return cells;
    })
    .filter((r) => r.some((c) => c.trim() !== ''));
}

async function main() {
  const campaign = await db.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) throw new Error(`No campaign with id "${campaignId}".`);

  const csv = await readFile(path.join(process.cwd(), 'public/demo/webinar_target_accounts.csv'), 'utf-8');
  const rows = parseCsv(csv);
  const headersRaw = rows[0].map((h) => h.trim());
  const headers = headersRaw.map((h) => h.toLowerCase());
  const ci = {
    name: pickCol(headers, ['full name', 'name', 'contact']),
    email: pickCol(headers, ['email', 'e-mail']),
    account: pickCol(headers, ['company', 'account', 'organisation', 'organization']),
    title: pickCol(headers, ['title', 'designation', 'role', 'position']),
    vertical: pickCol(headers, ['vertical', 'industry', 'sector']),
    linkedin: pickCol(headers, ['linkedin', 'li url', 'profile']),
  };

  const contacts = rows.slice(1).map((r) => {
    const get = (i: number) => (i >= 0 ? String(r[i] ?? '').trim() : '');
    return classifyContact({
      name: get(ci.name) || 'Unnamed contact',
      email: get(ci.email),
      account: get(ci.account) || '—',
      title: get(ci.title) || '—',
      vertical: get(ci.vertical) || 'Unassigned',
      linkedinId: get(ci.linkedin),
    });
  });

  // Clear everything downstream of import. PersonalizedMessage also cascades
  // from Contact, but it is dropped explicitly so the intent is visible here.
  await db.personalizedMessage.deleteMany({ where: { campaignId } });
  await db.cadenceSend.deleteMany({ where: { campaignId } });
  await db.contact.deleteMany({ where: { campaignId } });
  await db.activityLogEntry.deleteMany({ where: { campaignId } });
  await db.attentionItem.deleteMany({ where: { campaignId } });
  await db.template.deleteMany({ where: { campaignId } });
  await db.cadenceStep.deleteMany({ where: { campaignId } });

  await db.campaign.update({
    where: { id: campaignId },
    data: { cadenceStatus: 'not_started', status: 'draft', simulatedNow: null, attendanceImportedAt: null, scoringThreshold: 70 },
  });

  await provisionCampaignDefaults(campaignId);

  await db.contact.createMany({
    data: contacts.map((c) => ({
      campaignId,
      name: c.name,
      email: c.email || null,
      account: c.account,
      vertical: c.vertical,
      title: c.title,
      function: c.function,
      seniority: c.seniority,
      linkedinId: c.linkedinId || null,
      missingInfo: c.missingInfo,
      source: c.source,
    })),
  });

  await db.activityLogEntry.createMany({
    data: [
      { campaignId, text: `Read webinar_target_accounts.csv — ${headersRaw.length} columns, ${contacts.length} data rows`, dot: 'var(--success-500)' },
      { campaignId, text: `${contacts.filter((c) => c.missingInfo).length} contacts have no usable email — enrichment will fill these`, dot: 'var(--warning-700)' },
    ],
  });

  const missing = contacts.filter((c) => c.missingInfo).length;
  console.log(`Reset "${campaign.name}" (${campaignId}) to freshly-imported:`);
  console.log(`  ${contacts.length} contacts · ${missing} missing an email · nothing enriched, scored, or sent`);
  console.log('  Ready to demo: Setup → enrichment → Scoring → approve → Templates → Personalize → Schedule');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
