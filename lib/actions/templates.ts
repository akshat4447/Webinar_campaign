'use server';

import { db } from '@/lib/db';
import { rewriteTemplate } from '@/lib/claude';
import { revalidateCampaign } from '@/lib/revalidate';

export async function saveTemplateAction(templateId: string, subject: string | null, body: string) {
  const now = new Date();
  await db.template.update({
    where: { id: templateId },
    data: { subject, body, savedSubject: subject, savedBody: body, savedAt: now },
  });
  return { savedAt: now.toISOString() };
}

export async function rewriteTemplateAction(templateId: string) {
  const template = await db.template.findUniqueOrThrow({ where: { id: templateId }, include: { campaign: true } });
  try {
    const result = await rewriteTemplate({
      campaignName: template.campaign.name,
      channel: template.channel,
      hasSubject: template.hasSubject,
      subject: template.subject,
      body: template.body,
    });
    if (!result) return { ok: false as const, error: 'Claude returned no parsable rewrite.' };
    return { ok: true as const, subject: result.subject, body: result.body };
  } catch (err) {
    return { ok: false as const, error: String(err) };
  }
}

export async function duplicateTemplateAction(campaignId: string, templateId: string) {
  const original = await db.template.findUniqueOrThrow({ where: { id: templateId } });
  const copy = await db.template.create({
    data: {
      campaignId,
      key: `${original.key}-copy-${Date.now()}`,
      label: `${original.label} (copy)`,
      channel: original.channel,
      hasSubject: original.hasSubject,
      subject: original.subject,
      body: original.body,
    },
  });
  revalidateCampaign(campaignId);
  return copy.id;
}
