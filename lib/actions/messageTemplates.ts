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

/** True for `baseName` itself or `"baseName (Variant N)"` — never a plain
 *  prefix match, which also hits unrelated names that merely start with the
 *  same text (e.g. "Welcome" vs "Welcome Extended"). */
function isNameOrVariantOf(name: string, baseName: string): boolean {
  if (name === baseName) return true;
  const escaped = baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped} \\(Variant \\d+\\)$`).test(name);
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
    // A new email template starts as a draft and becomes `ready` on the first
    // save with a subject and body (see saveMessageTemplateAction). It used to
    // be created `ready` and empty, i.e. instantly "published" to the shared library.
    status: 'draft',
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
  const nextSubject = draft.subject !== undefined ? draft.subject : existing.subject;
  const nextBody = draft.body !== undefined ? draft.body : existing.body;
  const promoteDraftEmail =
    existing.channel === 'email' && existing.status === 'draft' && !!nextSubject?.trim() && !!nextBody.trim();
  await db.messageTemplate.update({
    where: { id },
    data: {
      ...draft,
      ...(promoteDraftEmail ? { status: 'ready' } : {}),
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
      // Lineage root (not `o.id` itself, so duplicating a duplicate still
      // traces back one stable id instead of chaining) — lets a later
      // "Copy into campaigns" re-detect this exact copy without matching on
      // `name`, which collides easily (every new template starts as
      // "Untitled email" etc).
      forkedFromId: o.forkedFromId ?? o.id,
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
  const { getTemplateUsageCounts } = await import('@/lib/messageTemplates');
  const t = await db.messageTemplate.findUniqueOrThrow({ where: { id }, select: { id: true, key: true, campaignId: true } });

  // Counting only `cadenceStep.templateId === id` misses every step that
  // relies on this row through the key-fallback chain (resolveStepTemplate) —
  // which is most of them, since a step's templateId is usually left null.
  // Deleting a library default that steps are silently depending on would
  // otherwise be allowed with zero warning and break their sends.
  const usage = await getTemplateUsageCounts([t]);
  const inUse = usage[t.id] ?? 0;
  if (inUse > 0) {
    const isLibraryDefault = !t.campaignId && !!t.key;
    return {
      ok: false,
      error: isLibraryDefault
        ? `This is the library default for "${t.key}" — ${inUse} cadence step${inUse === 1 ? '' : 's'} across campaigns fall back to it with no template of their own. Point them at another template first.`
        : `In use by ${inUse} cadence step${inUse === 1 ? '' : 's'}. Point them at another template first.`,
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

export type ConflictStrategy = 'skip' | 'overwrite' | 'variant';

export interface CampaignTemplateTargetInfo {
  campaignId: string;
  name: string;
  vertical: string;
  date: string;
  hasCustomCopy: boolean;
  existingTemplateName?: string;
  stepLinked: boolean;
  missingZoom: boolean;
  missingSpeaker: boolean;
}

/** Get status of all active campaigns with respect to a template's step key. */
export async function getTemplateCampaignStatusAction(templateId: string): Promise<CampaignTemplateTargetInfo[]> {
  const t = await db.messageTemplate.findUniqueOrThrow({ where: { id: templateId } });
  const campaigns = await db.campaign.findMany({
    where: { archived: false },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      vertical: true,
      date: true,
      zoomLink: true,
      speakerName: true,
    },
  });

  const results: CampaignTemplateTargetInfo[] = [];

  for (const c of campaigns) {
    let hasCustomCopy = false;
    let existingTemplateName: string | undefined;
    let stepLinked = false;

    if (t.key) {
      const existing = await db.messageTemplate.findFirst({
        where: { campaignId: c.id, key: t.key },
        select: { id: true, name: true },
      });
      if (existing) {
        hasCustomCopy = true;
        existingTemplateName = existing.name;
      }

      const step = await db.cadenceStep.findFirst({
        where: { campaignId: c.id, key: t.key },
        select: { templateId: true },
      });
      if (step) {
        stepLinked = step.templateId === (existing?.id ?? t.id);
      }
    }

    results.push({
      campaignId: c.id,
      name: c.name,
      vertical: c.vertical,
      date: c.date,
      hasCustomCopy,
      existingTemplateName,
      stepLinked,
      missingZoom: !c.zoomLink,
      missingSpeaker: !c.speakerName,
    });
  }

  return results;
}

export interface CopyMultipleCampaignsParams {
  templateId: string;
  campaignIds: string[];
  conflictStrategy?: ConflictStrategy;
  autoLinkSteps?: boolean;
}

export interface CopyMultipleCampaignsResult {
  ok: boolean;
  copiedCount: number;
  skippedCount: number;
  overwrittenCount: number;
  variantCount: number;
  errors: string[];
}

/** Copy a template into multiple campaigns with collision fallback strategies. */
export async function copyTemplateIntoMultipleCampaignsAction({
  templateId,
  campaignIds,
  conflictStrategy = 'skip',
  autoLinkSteps = true,
}: CopyMultipleCampaignsParams): Promise<CopyMultipleCampaignsResult> {
  const o = await db.messageTemplate.findUniqueOrThrow({ where: { id: templateId } });

  let copiedCount = 0;
  let skippedCount = 0;
  let overwrittenCount = 0;
  let variantCount = 0;
  const errors: string[] = [];

  // Lineage root for a keyless template: not `o.id` itself when `o` is
  // already a fork, so a re-copy of a copy still resolves to the one root.
  const lineageId = o.forkedFromId ?? o.id;

  for (const cid of campaignIds) {
    try {
      // A library template with no cadence-step key has no natural identity to
      // match against on re-copy. `name` is not it — every new template starts
      // from the same fixed starter name (e.g. "Untitled email") until
      // renamed, so name matching can hit an unrelated same-named template
      // instead of "the" prior copy of this one. `forkedFromId` lineage is
      // stable across renames and doesn't collide.
      const existing = o.key
        ? await db.messageTemplate.findFirst({ where: { campaignId: cid, key: o.key } })
        : await db.messageTemplate.findFirst({ where: { campaignId: cid, key: null, forkedFromId: lineageId } });

      if (existing) {
        if (conflictStrategy === 'skip') {
          skippedCount++;
          continue;
        } else if (conflictStrategy === 'overwrite') {
          await db.messageTemplate.update({
            where: { id: existing.id },
            data: {
              name: o.name,
              subject: o.subject,
              body: o.body,
              hasSubject: o.hasSubject,
              category: o.category,
              language: o.language,
              footer: o.footer,
              buttons: o.buttons,
              dltTemplateId: o.dltTemplateId,
              senderId: o.senderId,
              status: o.status,
            },
          });
          if (autoLinkSteps && o.key) {
            await db.cadenceStep.updateMany({
              where: { campaignId: cid, key: o.key },
              data: { templateId: existing.id },
            });
          }
          overwrittenCount++;
        } else if (conflictStrategy === 'variant') {
          // Exact "name" or "name (Variant N)" only — a plain `startsWith`
          // count also matched unrelated templates whose name merely starts
          // with the same text (e.g. "Welcome" vs "Welcome Extended"),
          // inflating the number this picks.
          const candidates = await db.messageTemplate.findMany({
            where: { campaignId: cid, name: { startsWith: o.name } },
            select: { name: true },
          });
          const countVariants = candidates.filter((c) => isNameOrVariantOf(c.name, o.name)).length;
          const copy = await db.messageTemplate.create({
            data: {
              campaignId: cid,
              channel: o.channel,
              key: null,
              forkedFromId: lineageId,
              name: `${o.name} (Variant ${countVariants + 1})`,
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
          if (autoLinkSteps && o.key) {
            await db.cadenceStep.updateMany({
              where: { campaignId: cid, key: o.key },
              data: { templateId: copy.id },
            });
          }
          variantCount++;
        }
      } else {
        const copy = await db.messageTemplate.create({
          data: {
            campaignId: cid,
            channel: o.channel,
            key: o.key,
            forkedFromId: o.key ? null : lineageId,
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
        if (autoLinkSteps && o.key) {
          await db.cadenceStep.updateMany({
            where: { campaignId: cid, key: o.key },
            data: { templateId: copy.id },
          });
        }
        copiedCount++;
      }
    } catch (err) {
      errors.push(`Campaign ${cid}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  refresh();
  return {
    ok: errors.length === 0 || copiedCount + overwrittenCount + variantCount > 0,
    copiedCount,
    skippedCount,
    overwrittenCount,
    variantCount,
    errors,
  };
}

/** Copy a library template into one campaign so it can diverge safely. */
export async function copyIntoCampaignAction(
  id: string,
  campaignId: string
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const o = await db.messageTemplate.findUniqueOrThrow({ where: { id } });
  if (o.campaignId) return { ok: false, error: 'Already a campaign copy.' };

  // See copyTemplateIntoMultipleCampaignsAction for why keyless matching uses
  // lineage (`forkedFromId`) rather than `name`, which collides easily.
  const lineageId = o.forkedFromId ?? o.id;
  const existing = o.key
    ? await db.messageTemplate.findFirst({ where: { campaignId, key: o.key } })
    : await db.messageTemplate.findFirst({ where: { campaignId, key: null, forkedFromId: lineageId } });

  if (existing) {
    return { ok: false, error: 'This campaign already has its own copy. Use multi-copy to overwrite or create a variant.' };
  }

  const copy = await db.messageTemplate.create({
    data: {
      campaignId,
      channel: o.channel,
      key: o.key,
      forkedFromId: o.key ? null : lineageId,
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

  if (o.key) {
    await db.cadenceStep.updateMany({
      where: { campaignId, key: o.key },
      data: { templateId: copy.id },
    });
  }

  refresh();
  return { ok: true, id: copy.id };
}

/** SMS segment maths for the editor's live counter. */
export async function smsSegmentInfoAction(body: string) {
  const check = checkSmsBody(body);
  // gsm7 false means UCS-2, which drops the per-segment budget from 160 to 70.
  return { segments: check.segments, encoding: check.gsm7 ? 'GSM-7' : 'UCS-2', issues: check.issues };
}

/**
 * Ensures a cadence step has a campaign-specific MessageTemplate (forking from library default if needed).
 */
export async function forkTemplateForStepAction(campaignId: string, stepKey: string) {
  const { resolveStepTemplate } = await import('@/lib/messageTemplates');
  const { revalidateCampaign } = await import('@/lib/revalidate');
  const campaign = await db.campaign.findUniqueOrThrow({ where: { id: campaignId } });
  const step = await db.cadenceStep.findUnique({
    where: { campaignId_key: { campaignId, key: stepKey } },
  });
  if (!step) return { ok: false as const, error: `Step "${stepKey}" not found.` };

  // If already pointing to a campaign-specific template
  if (step.templateId) {
    const existing = await db.messageTemplate.findUnique({ where: { id: step.templateId } });
    if (existing && existing.campaignId === campaignId) {
      return { ok: true as const, templateId: existing.id };
    }
  }

  // Check if a campaign override already exists for this key
  const override = await db.messageTemplate.findFirst({
    where: { campaignId, key: stepKey },
  });
  if (override) {
    await db.cadenceStep.update({
      where: { id: step.id },
      data: { templateId: override.id },
    });
    return { ok: true as const, templateId: override.id };
  }

  // Otherwise, resolve the current template (library or legacy)
  const resolved = await resolveStepTemplate(campaignId, stepKey);
  const baseName = resolved ? resolved.label : `${step.title}`;
  const baseSubject = resolved?.hasSubject ? resolved.subject : null;
  const baseBody = resolved ? resolved.body : `Hi {{firstName}},\n\nJoin us for {{topic}}.\n\nLink: {{link}}`;
  const channel = resolved ? resolved.channel : step.channel.toLowerCase();

  const forked = await db.messageTemplate.create({
    data: {
      campaignId,
      key: stepKey,
      name: `${baseName} (${campaign.name})`,
      channel,
      hasSubject: resolved?.hasSubject ?? true,
      subject: baseSubject,
      body: baseBody,
      status: channel === 'linkedin' ? 'assisted' : 'ready',
    },
  });

  await db.cadenceStep.update({
    where: { id: step.id },
    data: { templateId: forked.id },
  });

  refresh();
  revalidateCampaign(campaignId);
  return { ok: true as const, templateId: forked.id };
}

/**
 * Updates the base template for a cadence step directly from the Messaging tab or Cadence tab.
 * Automatically forks to a campaign-owned template if currently using library default.
 */
export async function updateStepBaseTemplateAction(
  campaignId: string,
  stepKey: string,
  draft: { subject?: string | null; body: string }
) {
  const forkRes = await forkTemplateForStepAction(campaignId, stepKey);
  if (!forkRes.ok) return forkRes;

  const { revalidateCampaign } = await import('@/lib/revalidate');
  const now = new Date();
  await db.messageTemplate.update({
    where: { id: forkRes.templateId },
    data: {
      ...(draft.subject !== undefined ? { subject: draft.subject } : {}),
      body: draft.body,
      savedSubject: draft.subject !== undefined ? draft.subject : undefined,
      savedBody: draft.body,
      savedAt: now,
    },
  });

  refresh();
  revalidateCampaign(campaignId);
  return { ok: true as const, templateId: forkRes.templateId, savedAt: now.toISOString() };
}
