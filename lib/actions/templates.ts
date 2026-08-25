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

// --- add / delete / hide -------------------------------------------------------

import { BUILT_IN_TEMPLATE_IDS } from '@/lib/demo-data';

const CHANNEL_DEFAULTS: Record<string, { hasSubject: boolean; body: string }> = {
  Email: { hasSubject: true, body: "Hi {{firstName}},\n\n{{topic}} is coming up and it's directly relevant to your work at {{company}}.\n\nDetails and join link: {{link}}" },
  LinkedIn: { hasSubject: false, body: 'Hi {{firstName}} — quick one about {{topic}} at {{company}}. Details: {{link}}' },
  SMS: { hasSubject: false, body: '{{topic}} — join link: {{link}}\nReply STOP to opt out.' },
  WhatsApp: { hasSubject: false, body: 'Hi {{firstName}}, a quick note about {{topic}}: {{link}}' },
};

/** Creates a brand-new custom template (+ matching enabled cadence step). */
export async function createCustomTemplateAction(
  campaignId: string,
  input: { label: string; channel: string }
): Promise<{ ok: boolean; key?: string; error?: string }> {
  const label = input.label.trim();
  if (!label) return { ok: false, error: 'Give the template a name first.' };
  const channel = Object.keys(CHANNEL_DEFAULTS).find((c) => c.toLowerCase() === input.channel.toLowerCase());
  if (!channel) return { ok: false, error: 'Pick one of: Email, LinkedIn, SMS, WhatsApp.' };

  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'step';
  const key = `custom-${slug}-${Date.now().toString(36).slice(-4)}`;
  const defaults = CHANNEL_DEFAULTS[channel];

  await db.template.create({
    data: { campaignId, key, label, channel, hasSubject: defaults.hasSubject, subject: defaults.hasSubject ? `{{topic}} — ${label}` : null, body: defaults.body },
  });
  await db.cadenceStep.create({
    data: {
      campaignId,
      key,
      group: channel === 'Email' || channel === 'LinkedIn' ? 'Pre-registration' : 'Reminders · registrants only',
      title: label,
      timing: offsetFor(channel),
      channel,
      desc: 'Custom step added from the Templates tab',
      toggleable: true,
      enabled: true,
      anchor: 'launch',
      offsetValue: 0,
      offsetUnit: 'days',
    },
  });

  revalidateCampaign(campaignId);
  return { ok: true, key };
}

function offsetFor(channel: string): string {
  return channel === 'SMS' ? 'T-1h' : channel === 'WhatsApp' ? 'On trigger' : '+0 days';
}

/** Deletes a CUSTOM template and everything tied to its key. Built-ins are protected. */
export async function deleteTemplateAction(campaignId: string, templateId: string): Promise<{ ok: boolean; error?: string }> {
  const row = await db.template.findUniqueOrThrow({ where: { id: templateId }, select: { key: true } });
  if ((BUILT_IN_TEMPLATE_IDS as string[]).includes(row.key)) {
    return { ok: false, error: 'Built-in steps can be hidden but not deleted.' };
  }
  await db.$transaction([
    db.template.delete({ where: { id: templateId } }),
    db.cadenceStep.deleteMany({ where: { campaignId, key: row.key } }),
    db.personalizedMessage.deleteMany({ where: { campaignId, stepKey: row.key } }),
    db.cadenceSend.deleteMany({ where: { campaignId, stepKey: row.key } }),
  ]);
  revalidateCampaign(campaignId);
  return { ok: true };
}

/** Hide/show a template — hides also disable the matching step so Schedule and sends follow. */
export async function toggleTemplateHiddenAction(campaignId: string, templateId: string, hidden: boolean) {
  const row = await db.template.findUniqueOrThrow({ where: { id: templateId }, select: { key: true } });
  await db.template.update({ where: { id: templateId }, data: { hidden } });
  if (hidden) {
    await db.cadenceStep.updateMany({ where: { campaignId, key: row.key }, data: { enabled: false } });
    // Queued-but-unsent rows for a now-hidden step are parked as skipped.
    await db.cadenceSend.updateMany({
      where: { campaignId, stepKey: row.key, status: 'queued' },
      data: { status: 'skipped', error: hidden ? 'Step hidden on the Templates tab' : null },
    });
  } else {
    await db.cadenceStep.updateMany({ where: { campaignId, key: row.key }, data: { enabled: true } });
  }
  revalidateCampaign(campaignId);
}
