import { db } from '../lib/db';
import {
  campaigns as demoCampaigns,
  contactsDemo,
  activityLog,
  cadenceStepsData,
  templatesData,
  needsAttention,
} from '../lib/demo-data';

/** A per-campaign registration slug, so every webinar links to its own landing page. */
function registrationSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .split('-')
    .slice(0, 3)
    .join('-');
  return `lsq.co/w/${slug}-2026`;
}

async function main() {
  for (const c of demoCampaigns) {
    await db.campaign.upsert({
      where: { id: c.id },
      update: {},
      create: {
        id: c.id,
        name: c.name,
        vertical: c.vertical,
        date: c.date,
        status: c.status,
        invites: c.invites,
        registrations: c.registrations,
        attendance: c.attendance,
        demoRequests: c.demoRequests,
        registrationLink: registrationSlug(c.name),
      },
    });
  }

  const primary = demoCampaigns[0].id; // c1 — the "live" campaign, seeded with full detail

  const existingContacts = await db.contact.count({ where: { campaignId: primary } });
  if (existingContacts === 0) {
    for (const c of contactsDemo) {
      await db.contact.create({
        data: {
          campaignId: primary,
          name: c.name,
          account: c.account,
          vertical: c.vertical,
          title: c.title,
          function: c.function,
          seniority: c.seniority,
          score: c.score,
          explanation: c.explanation,
          source: c.source,
          missingInfo: c.missingInfo,
          approved: c.score >= 70,
        },
      });
    }
  }

  for (const t of templatesData) {
    await db.template.upsert({
      where: { campaignId_key: { campaignId: primary, key: t.id } },
      update: {},
      create: {
        campaignId: primary,
        key: t.id,
        label: t.label,
        channel: t.channel,
        hasSubject: t.hasSubject,
        subject: t.subject,
        body: t.body,
      },
    });
  }

  for (const s of cadenceStepsData) {
    await db.cadenceStep.upsert({
      where: { campaignId_key: { campaignId: primary, key: s.id } },
      update: {},
      create: {
        campaignId: primary,
        key: s.id,
        group: s.group,
        title: s.title,
        timing: s.timing,
        channel: s.channel,
        desc: s.desc,
        toggleable: s.toggleable,
        enabled: s.toggleable,
        isRoadmap: !!s.isRoadmap,
      },
    });
  }

  const existingLog = await db.activityLogEntry.count({ where: { campaignId: primary } });
  if (existingLog === 0) {
    for (const log of activityLog) {
      await db.activityLogEntry.create({ data: { campaignId: primary, text: log.text, dot: log.dot } });
    }
  }

  const existingAttention = await db.attentionItem.count({ where: { campaignId: primary } });
  if (existingAttention === 0) {
    for (const na of needsAttention) {
      await db.attentionItem.create({
        data: {
          campaignId: primary,
          icon: na.icon,
          color: na.color,
          title: na.title,
          detail: na.detail,
          actionsCsv: na.actions.join(','),
        },
      });
    }
  }

  console.log('Seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
