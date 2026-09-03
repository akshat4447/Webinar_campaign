'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { rewriteTemplate } from '@/lib/claude';
import { checkSmsBody } from '@/lib/channels';

// Server actions for the shared template library. Per-campaign overrides go
// through the same actions — an override is just a MessageTemplate with a
// campaignId, so nothing here needs to know which it is editing.

function refresh() {
  try {
    revalidatePath('/templates');
    revalidatePath('/', 'layout');
  } catch {
    /* not in a request context */
  }
}

/** Fields the editor can write. Everything else is derived or lifecycle-owned. */
export interface TemplateDraft {
  name?: string;
  subject?: string | null;
  body?: string;
  category?: string | null;
  language?: string | null;
  footer?: string | null;
  buttons?: string | null;
  dltTemplateId?: string | null;
  senderId?: string | null;
}

const STARTERS: Record<string, { name: string; body: string; hasSubject: boolean; status: string; extra: Record<string, unknown> }> = {
  email: {
    name: 'Untitled email',
    body: '',
    hasSubject: true,
    status: 'ready',
    extra: {},
  },
  whatsapp: {
    // Meta requires snake_case names, so the starter models the constraint
    // rather than leaving the operator to discover it on rejection.
    name: 'untitled_template',
    body: '',
    hasSubject: false,
    status: 'draft',
    extra: { category: 'Marketing', language: 'en', footer: 'Reply STOP to opt out' },
  },
  sms: {
    name: 'Untitled SMS',
    body: 'Reply STOP to opt out.',
    hasSubject: false,
    status: 'draft',
    extra: { senderId: '' },
  },
  linkedin: {
    name: 'Untitled note',
    body: '',
    hasSubject: false,
    // Nothing is sent by API, so there is no approval to wait for.
    status: 'assisted',
    extra: {},
  },
};

export async function createMessageTemplateAction(channel: string, campaignId?: string) {
  const starter = STARTERS[channel] ?? STARTERS.email;
  const created = await db.messageTemplate.create({
    data: {
      channel,
      campaignId: campaignId ?? null,
      name: starter.name,
      body: starter.body,
      hasSubject: starter.hasSubject,
      status: starter.status,
      ...starter.extra,
    },
  });
  refresh();
  return created.id;
}

export async function saveMessageTemplateAction(id: string, draft: TemplateDraft) {
  const now = new Date();
  const existing = await db.messageTemplate.findUniqueOrThrow({ where: { id } });

  // savedSubject/savedBody are the revert point, not a mirror of the current
  // value — they record the last deliberate save so "revert" has somewhere to
  // go back to.
  await db.messageTemplate.update({
    where: { id },
    data: {
      ...draft,
      savedSubject: draft.subject !== undefined ? draft.subject : existing.subject,
      savedBody: draft.body !== undefined ? draft.body : existing.body,
      savedAt: now,
    },
  });
  refresh();
  return { savedAt: now.toISOString() };
}

export async function revertMessageTemplateAction(id: string) {
  const t = await db.messageTemplate.findUniqueOrThrow({ where: { id } });
  if (!t.savedAt) return { ok: false as const, error: 'Nothing saved to revert to yet.' };
  await db.messageTemplate.update({
    where: { id },
    data: { subject: t.savedSubject, body: t.savedBody ?? t.body },
  });
  refresh();
  return { ok: true as const, subject: t.savedSubject, body: t.savedBody ?? t.body };
}

export async function duplicateMessageTemplateAction(id: string) {
  const o = await db.messageTemplate.findUniqueOrThrow({ where: { id } });
  const copy = await db.messageTemplate.create({
    data: {
      campaignId: o.campaignId,
      channel: o.channel,
      // `key` is intentionally NOT copied: it is unique per campaign, and a
      // duplicate is a new message, not a second default for the same step.
      key: null,
      name: `${o.name} (copy)`,
      hasSubject: o.hasSubject,
      subject: o.subject,
      body: o.body,
      category: o.category,
      language: o.language,
      footer: o.footer,
      buttons: o.buttons,
      dltTemplateId: o.dltTemplateId,
      senderId: o.senderId,
      // A copy has not been approved, whatever the original's state.
      status: o.channel === 'linkedin' ? 'assisted' : o.channel === 'email' ? 'ready' : 'draft',
    },
  });
  refresh();
  return copy.id;
}

export async function deleteMessageTemplateAction(id: string): Promise<{ ok: boolean; error?: string }> {
  const inUse = await db.cadenceStep.count({ where: { templateId: id } });
  if (inUse > 0) {
    // Deleting would leave those steps resolving to the library default with no
    // warning, which is a silent content change. Refuse and say why.
    return {
      ok: false,
      error: `In use by ${inUse} cadence step${inUse === 1 ? '' : 's'}. Point them at another template first.`,
    };
  }
  await db.messageTemplate.delete({ where: { id } });
  refresh();
  return { ok: true };
}

export async function toggleMessageTemplateHiddenAction(id: string, hidden: boolean) {
  await db.messageTemplate.update({ where: { id }, data: { hidden } });
  refresh();
  return { hidden };
}

/** WhatsApp only: Meta reviews the template before it can be used. */
export async function submitForApprovalAction(id: string) {
  const t = await db.messageTemplate.findUniqueOrThrow({ where: { id } });
  if (t.channel !== 'whatsapp') return { ok: false as const, error: 'Only WhatsApp templates need approval.' };
  if (!t.body.trim()) return { ok: false as const, error: 'Add a message body before submitting.' };
  await db.messageTemplate.update({ where: { id }, data: { status: 'pending' } });
  refresh();
  return { ok: true as const };
}

export async function rewriteMessageTemplateAction(id: string) {
  const t = await db.messageTemplate.findUniqueOrThrow({ where: { id } });
  try {
    const result = await rewriteTemplate({
      campaignName: t.name,
      channel: t.channel,
      hasSubject: t.hasSubject,
      subject: t.subject,
      body: t.body,
    });
    if (!result) return { ok: false as const, error: 'Claude returned no parsable rewrite.' };
    return { ok: true as const, subject: result.subject, body: result.body };
  } catch (err) {
    return { ok: false as const, error: String(err) };
  }
}

/** Copy a library template into one campaign so it can diverge safely. */
export async function copyIntoCampaignAction(id: string, campaignId: string) {
  const o = await db.messageTemplate.findUniqueOrThrow({ where: { id } });
  if (o.campaignId) return { ok: false as const, error: 'Already a campaign copy.' };
  const existing = o.key
    ? await db.messageTemplate.findFirst({ where: { campaignId, key: o.key } })
    : null;
  if (existing) return { ok: false as const, error: 'This campaign already has its own copy.' };

  const copy = await db.messageTemplate.create({
    data: {
      campaignId,
      channel: o.channel,
      key: o.key,
      name: o.name,
      hasSubject: o.hasSubject,
      subject: o.subject,
      body: o.body,
      category: o.category,
      language: o.language,
      footer: o.footer,
      buttons: o.buttons,
      dltTemplateId: o.dltTemplateId,
      senderId: o.senderId,
      status: o.status,
    },
  });
  // Repoint that campaign's steps at their own copy.
  if (o.key) {
    await db.cadenceStep.updateMany({ where: { campaignId, key: o.key }, data: { templateId: copy.id } });
  }
  refresh();
  return { ok: true as const, id: copy.id };
}

/** SMS segment maths for the editor's live counter. */
export async function smsSegmentInfoAction(body: string) {
  const check = checkSmsBody(body);
  // gsm7 false means UCS-2, which drops the per-segment budget from 160 to 70.
  return { segments: check.segments, encoding: check.gsm7 ? 'GSM-7' : 'UCS-2', issues: check.issues };
}
