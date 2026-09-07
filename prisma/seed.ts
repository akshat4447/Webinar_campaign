// Plain `dotenv/config` only reads `.env`, never `.env.local` — real secrets
// (including DATABASE_URL when overridden locally) live in `.env.local`, so
// this needs Next's own loader, same as every other standalone script here.
import '../lib/loadEnv';

import { db } from '../lib/db';
import {
  campaigns as demoCampaigns,
  contactsDemo,
  activityLog,
  cadenceStepsData,
  templatesData,
  needsAttention,
} from '../lib/demo-data';
import { defaultTriggerFor } from '../lib/stepTrigger';
import { STEP_DEFAULTS } from '../lib/stepSchedule';
import { normalizeChannel, DEFAULT_ENABLED_CHANNELS } from '../lib/channels';

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
        scheduledAt: c.id === 'c1' ? new Date('2026-08-28T09:30:00.000Z') : null,
      },
    });
  }

  const primary = demoCampaigns[0].id; // c1 — the "live" campaign, seeded with full detail

  // Seed shared MessageTemplate library so steps can resolve templates
  for (const t of templatesData) {
    const ch = t.channel.toLowerCase();
    const channel = ch.includes('whatsapp') ? 'whatsapp' : ch.includes('sms') ? 'sms' : ch.includes('linkedin') ? 'linkedin' : 'email';
    const existingLib = await db.messageTemplate.findFirst({ where: { campaignId: null, key: t.id } });
    if (!existingLib) {
      await db.messageTemplate.create({
        data: {
          campaignId: null,
          key: t.id,
          name: t.label,
          channel,
          hasSubject: t.hasSubject,
          subject: t.subject,
          body: t.body,
          status: channel === 'linkedin' ? 'assisted' : 'ready',
        },
      });
    }
  }

  const existingContacts = await db.contact.count({ where: { campaignId: primary } });
  if (existingContacts === 0) {
    let idx = 1;
    for (const c of contactsDemo) {
      const emailDomain = c.account.toLowerCase().replace(/[^a-z0-9]/g, '') || 'company';
      const cleanName = c.name.toLowerCase().replace(/\s+/g, '.');
      await db.contact.create({
        data: {
          campaignId: primary,
          name: c.name,
          email: `${cleanName}@${emailDomain}.com`,
          phone: `+9198765432${String(idx).padStart(2, '0')}`,
          whatsappOptIn: true,
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
      idx++;
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
    const libraryTpl = await db.messageTemplate.findFirst({
      where: { key: s.id, campaignId: null },
      select: { id: true },
    });
    await db.cadenceStep.upsert({
      where: { campaignId_key: { campaignId: primary, key: s.id } },
      update: {
        templateId: libraryTpl?.id ?? undefined,
      },
      create: {
        campaignId: primary,
        key: s.id,
        group: s.group,
        title: s.title,
        timing: s.timing,
        channel: s.channel,
        desc: s.desc,
        toggleable: s.toggleable,
        enabled: s.toggleable && DEFAULT_ENABLED_CHANNELS.has(normalizeChannel(s.channel)),
        isRoadmap: !!s.isRoadmap,
        trigger: defaultTriggerFor(s.id),
        templateId: libraryTpl?.id ?? null,
        ...(STEP_DEFAULTS[s.id] ?? {}),
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
