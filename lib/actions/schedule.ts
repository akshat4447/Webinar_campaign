'use server';

import { db } from '@/lib/db';
import { launchCadence, processDueSends, restartCadence } from '@/lib/cadence';
import { sendModeLabel } from '@/lib/sendGuard';
import { resolveStepDate, offsetLabel, ANCHOR_LABEL, STEP_DEFAULTS } from '@/lib/stepSchedule';
import { revalidateCampaign } from '@/lib/revalidate';
import { z } from 'zod';

const campaignIdSchema = z.string().min(1);
const stepKeySchema = z.string().min(1);
const stepIdSchema = z.string().min(1);

export async function toggleCadenceStepAction(campaignId: string, stepKey: string, enabled: boolean) {
  const validCampaignId = campaignIdSchema.parse(campaignId);
  const validStepKey = stepKeySchema.parse(stepKey);
  await db.cadenceStep.update({ where: { campaignId_key: { campaignId: validCampaignId, key: validStepKey } }, data: { enabled: !!enabled } });
  revalidateCampaign(validCampaignId);
}

/**
 * Re-times a single step. Already-queued sends for that step are re-dated too, so
 * changing the schedule after launch actually moves the pending sends rather than
 * only changing what the UI claims.
 */
const VALID_OFFSET_UNITS = new Set(['days', 'hours']);
const VALID_ANCHORS = new Set(['launch', 'webinar', 'event']);

export async function updateStepScheduleAction(
  campaignId: string,
  stepKey: string,
  patch: { offsetValue?: number; offsetUnit?: string; anchor?: string }
) {
  const validCampaignId = campaignIdSchema.parse(campaignId);
  const validStepKey = stepKeySchema.parse(stepKey);
  // resolveStepDate/offsetLabel switch on exact anchor/unit strings — an
  // unrecognized value wouldn't error, it would just silently fall through to
  // their default branch and misdate the step. Reject anything outside the
  // known set instead of writing it.
  if (patch.offsetUnit !== undefined && !VALID_OFFSET_UNITS.has(patch.offsetUnit)) {
    return { ok: false as const, error: `Invalid offset unit "${patch.offsetUnit}".` };
  }
  if (patch.anchor !== undefined && !VALID_ANCHORS.has(patch.anchor)) {
    return { ok: false as const, error: `Invalid anchor "${patch.anchor}".` };
  }
  if (patch.offsetValue !== undefined && !Number.isFinite(patch.offsetValue)) {
    return { ok: false as const, error: 'Offset must be a number.' };
  }

  const step = await db.cadenceStep.update({ where: { campaignId_key: { campaignId: validCampaignId, key: validStepKey } }, data: patch });
  const campaign = await db.campaign.findUniqueOrThrow({ where: { id: validCampaignId } });

  const launchAt = campaign.simulatedNow ?? new Date();
  const dueAt = resolveStepDate(step, { launchAt, webinarAt: campaign.scheduledAt });
  if (dueAt) {
    await db.cadenceSend.updateMany({ where: { campaignId: validCampaignId, stepKey: validStepKey, status: 'queued' }, data: { dueAt } });
  }

  await db.activityLogEntry.create({
    data: {
      campaignId: validCampaignId,
      text: `Re-timed "${step.title}" to ${offsetLabel(step)} ${ANCHOR_LABEL[step.anchor] ?? ''}`.trim(),
      dot: 'var(--accent-500)',
    },
  });

  revalidateCampaign(validCampaignId);
  return { ok: true as const, resolvedAt: dueAt?.toISOString() ?? null };
}

/** Puts every step back to the shipped default timing. */
/**
 * Back to the shipped cadence: built-in timings restored, built-in steps
 * un-removed, and steps the operator invented deleted outright.
 *
 * Invented steps are deleted rather than soft-removed because there is no
 * default to fall back to — leaving them soft-removed would mean "reset"
 * quietly kept rows that reset is supposed to have undone.
 */
export async function resetScheduleAction(campaignId: string) {
  const validCampaignId = campaignIdSchema.parse(campaignId);
  const steps = await db.cadenceStep.findMany({ where: { campaignId: validCampaignId } });
  const builtIns = steps.filter((s) => STEP_DEFAULTS[s.key]);
  const invented = steps.filter((s) => s.createdByUser);

  await db.$transaction([
    ...builtIns.map((s) =>
      db.cadenceStep.update({ where: { id: s.id }, data: { ...STEP_DEFAULTS[s.key], removedAt: null } })
    ),
    ...invented.map((s) => db.cadenceStep.delete({ where: { id: s.id } })),
  ]);

  await db.activityLogEntry.create({
    data: {
      campaignId: validCampaignId,
      text: `Cadence reset to defaults — ${builtIns.length} step(s) restored${invented.length ? `, ${invented.length} added step(s) removed` : ''}`,
      dot: 'var(--accent-500)',
    },
  });
  revalidateCampaign(validCampaignId);
}

const CHANNEL_LABEL: Record<string, string> = {
  email: 'Email',
  sms: 'SMS',
  whatsapp: 'WhatsApp',
  linkedin: 'LinkedIn (assisted)',
};

/**
 * Add a step the operator invented.
 *
 * The key is generated and unique — it is what CadenceSend rows reference, so
 * it must never collide with a built-in or with a previously removed step of
 * the same name.
 */
export async function addCadenceStepAction(campaignId: string, group: string, channel: string) {
  const validCampaignId = campaignIdSchema.parse(campaignId);
  const validGroup = z.string().min(1).parse(group);
  const validChannel = z.string().min(1).parse(channel);
  const label = CHANNEL_LABEL[validChannel] ?? 'Email';
  const key = `custom-${validChannel}-${Date.now().toString(36)}`;

  // A registrants-only group means the audience arrives by registration; a
  // post-webinar group is decided by the attendance import. Getting this wrong
  // would queue the step to the whole approved audience at launch.
  const trigger = validGroup.toLowerCase().includes('registrant')
    ? 'registration'
    : validGroup.toLowerCase().includes('post-webinar')
      ? 'attendance'
      : 'launch';
  const anchor = trigger === 'launch' ? 'launch' : 'webinar';

  const step = await db.cadenceStep.create({
    data: {
      campaignId: validCampaignId,
      key,
      group: validGroup,
      title: `New ${label} step`,
      timing: '+2 days',
      channel: label,
      desc: 'Added in the cadence planner.',
      toggleable: true,
      enabled: true,
      createdByUser: true,
      trigger,
      anchor,
      offsetValue: 2,
      offsetUnit: 'days',
      // Default to the library message for this channel so a new step is
      // sendable immediately rather than failing on missing copy.
      templateId: (await db.messageTemplate.findFirst({ where: { campaignId: null, channel: validChannel }, select: { id: true } }))?.id ?? null,
    },
  });

  await db.activityLogEntry.create({
    data: { campaignId: validCampaignId, text: `Added a ${label} step to “${validGroup}”`, dot: 'var(--accent-500)' },
  });
  revalidateCampaign(validCampaignId);
  return step.id;
}

/**
 * Remove a step from the planner.
 *
 * Built-ins are soft-removed so reset can bring them back and so their unique
 * key stays taken. Invented steps are deleted, since nothing would restore
 * them. Queued sends are cancelled either way — leaving them would send a
 * message from a step the operator believes they deleted.
 */
export async function removeCadenceStepAction(campaignId: string, stepId: string) {
  const validCampaignId = campaignIdSchema.parse(campaignId);
  const validStepId = stepIdSchema.parse(stepId);
  const step = await db.cadenceStep.findUniqueOrThrow({ where: { id: validStepId } });

  const cancelled = await db.cadenceSend.updateMany({
    where: { campaignId: validCampaignId, stepKey: step.key, status: 'queued' },
    data: { status: 'skipped', error: 'Step removed from the cadence planner' },
  });

  if (step.createdByUser) {
    await db.cadenceStep.delete({ where: { id: validStepId } });
  } else {
    await db.cadenceStep.update({ where: { id: validStepId }, data: { removedAt: new Date(), enabled: false } });
  }

  await db.activityLogEntry.create({
    data: {
      campaignId: validCampaignId,
      text: `Removed “${step.title}” from the cadence${cancelled.count ? ` — ${cancelled.count} queued send(s) cancelled` : ''}`,
      dot: 'var(--warning-700)',
    },
  });
  revalidateCampaign(validCampaignId);
  return { cancelled: cancelled.count };
}

/** Point a step at a specific message from the library. */
export async function setStepTemplateAction(campaignId: string, stepId: string, templateId: string | null) {
  const validCampaignId = campaignIdSchema.parse(campaignId);
  const validStepId = stepIdSchema.parse(stepId);
  const validTemplateId = templateId ? z.string().min(1).parse(templateId) : null;
  await db.cadenceStep.update({ where: { id: validStepId }, data: { templateId: validTemplateId } });
  revalidateCampaign(validCampaignId);
}

export async function launchCadenceAction(campaignId: string) {
  const validCampaignId = campaignIdSchema.parse(campaignId);
  const result = await launchCadence(validCampaignId);
  // Fire anything already due (e.g. the Day-0 invite) immediately after launch.
  const processed = await processDueSends(validCampaignId);
  revalidateCampaign(validCampaignId);
  return { ...result, ...processed, sendMode: sendModeLabel() };
}

/**
 * Resets a stopped cadence back to `not_started` so Schedule can show the
 * Launch button again — previously a stopped campaign had no path back to
 * sending at all short of manually editing the database. This does not
 * un-stop the abandoned run (see restartCadence's comment); it starts a new one.
 */
export async function restartCadenceAction(campaignId: string) {
  const validCampaignId = campaignIdSchema.parse(campaignId);
  const result = await restartCadence(validCampaignId);
  revalidateCampaign(validCampaignId);
  return result;
}
