// Deep-audit DB snapshot: journey completeness across every campaign.
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());
import { db } from '../lib/db';

async function main() {
  const campaigns = await db.campaign.findMany({ select: { id: true, name: true, status: true, cadenceStatus: true, scheduledAt: true, linkedinEventStatus: true, registrationLink: true, zoomLink: true, description: true } });
  console.log(`=== ${campaigns.length} campaigns ===`);
  for (const c of campaigns) {
    const [steps, templates, contacts, pendingAttention] = await Promise.all([
      db.cadenceStep.findMany({ where: { campaignId: c.id }, select: { key: true, channel: true, enabled: true, isRoadmap: true } }),
      db.template.findMany({ where: { campaignId: c.id }, select: { key: true } }),
      db.contact.findMany({ where: { campaignId: c.id }, select: { id: true, phone: true, whatsappOptIn: true, approved: true, score: true } }),
      db.attentionItem.count({ where: { campaignId: c.id, resolvedAt: null } }),
    ]);
    const stepKeys = new Set(steps.map((s) => s.key));
    const templateKeys = new Set(templates.map((t) => t.key));
    const missingTemplates = [...stepKeys].filter((k) => !templateKeys.has(k));
    const roadmapLeft = steps.filter((s) => s.isRoadmap).map((s) => s.key);
    const chWa = steps.find((s) => s.key === 'whatsapp');
    const chSms = steps.find((s) => s.key === 'sms');
    const noPhone = contacts.filter((x) => !x.phone).length;
    const waNoOptIn = contacts.filter((x) => !x.whatsappOptIn).length;
    console.log(JSON.stringify({
      id: c.id, name: c.name.slice(0, 30), status: c.status, cadence: c.cadenceStatus,
      scheduledAt: !!c.scheduledAt, zoom: !!c.zoomLink, desc: !!c.description, regLink: !!c.registrationLink,
      liEvent: c.linkedinEventStatus ?? '-',
      steps: steps.length, roadmapLeft, waEnabled: chWa?.enabled ?? false, smsEnabled: chSms?.enabled ?? false,
      missingTemplates,
      contacts: { total: contacts.length, approved: contacts.filter((x) => x.approved).length, scored: contacts.filter((x) => x.score !== null).length, withPhone: contacts.length - noPhone, waOptIn: contacts.length - waNoOptIn },
      openAttentionItems: pendingAttention,
    }));
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());