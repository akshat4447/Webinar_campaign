'use server';

import { db } from '@/lib/db';
import { launchCadence, processDueSends, restartCadence } from '@/lib/cadence';
import { sendModeLabel } from '@/lib/sendGuard';
import { resolveStepDate, offsetLabel, ANCHOR_LABEL, STEP_DEFAULTS, FREQUENCY_PRESETS } from '@/lib/stepSchedule';
import { revalidateCampaign } from '@/lib/revalidate';

export async function updateScheduleConfigAction(campaignId: string, data: { scheduleWindow?: string; frequency?: string; dailyLimit?: number }) {
  // dailyLimit is a real send throttle now (see processDueSends) — reject
  // nonsensical values here instead of letting the DB hold e.g. a negative limit.
  if (data.dailyLimit !== undefined && (!Number.isFinite(data.dailyLimit) || data.dailyLimit < 0)) {
    return { ok: false as const, error: 'Daily send limit must be zero or a positive number.' };
  }

  await db.campaign.update({ where: { id: campaignId }, data });

  // Picking a preset used to only change the descriptive "gap label" text below
  // the selector — the nudge/final-call steps themselves never moved. Now the
  // preset actually rewrites their offsets, same code path as editing a step
  // by hand on the Schedule tab (including re-dating any sends already queued).
  if (data.frequency && FREQUENCY_PRESETS[data.frequency]) {
    const preset = FREQUENCY_PRESETS[data.frequency];
    await updateStepScheduleAction(campaignId, 'nudge', { offsetValue: preset.nudge });
    await updateStepScheduleAction(campaignId, 'final', { offsetValue: preset.final });
  }

  revalidateCampaign(campaignId);
  return { ok: true as const };
}

export async function toggleCadenceStepAction(campaignId: string, stepKey: string, enabled: boolean) {
  await db.cadenceStep.update({ where: { campaignId_key: { campaignId, key: stepKey } }, data: { enabled } });
  revalidateCampaign(campaignId);
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

  const step = await db.cadenceStep.update({ where: { campaignId_key: { campaignId, key: stepKey } }, data: patch });
  const campaign = await db.campaign.findUniqueOrThrow({ where: { id: campaignId } });

  const launchAt = campaign.simulatedNow ?? new Date();
  const dueAt = resolveStepDate(step, { launchAt, webinarAt: campaign.scheduledAt });
  if (dueAt) {
    await db.cadenceSend.updateMany({ where: { campaignId, stepKey, status: 'queued' }, data: { dueAt } });
  }

  await db.activityLogEntry.create({
    data: {
      campaignId,
      text: `Re-timed "${step.title}" to ${offsetLabel(step)} ${ANCHOR_LABEL[step.anchor] ?? ''}`.trim(),
      dot: 'var(--accent-500)',
    },
  });

  revalidateCampaign(campaignId);
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
  const steps = await db.cadenceStep.findMany({ where: { campaignId } });
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
      campaignId,
      text: `Cadence reset to defaults — ${builtIns.length} step(s) restored${invented.length ? `, ${invented.length} added step(s) removed` : ''}`,
      dot: 'var(--accent-500)',
    },
  });
  revalidateCampaign(campaignId);
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
  const label = CHANNEL_LABEL[channel] ?? 'Email';
  const key = `custom-${channel}-${Date.now().toString(36)}`;

  // A registrants-only group means the audience arrives by registration; a
  // post-webinar group is decided by the attendance import. Getting this wrong
  // would queue the step to the whole approved audience at launch.
  const trigger = group.toLowerCase().includes('registrant')
    ? 'registration'
    : group.toLowerCase().includes('post-webinar')
      ? 'attendance'
      : 'launch';
  const anchor = trigger === 'launch' ? 'launch' : 'webinar';

  const step = await db.cadenceStep.create({
    data: {
      campaignId,
      key,
      group,
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
      templateId: (await db.messageTemplate.findFirst({ where: { campaignId: null, channel }, select: { id: true } }))?.id ?? null,
    },
  });

  await db.activityLogEntry.create({
    data: { campaignId, text: `Added a ${label} step to “${group}”`, dot: 'var(--accent-500)' },
  });
  revalidateCampaign(campaignId);
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
  const step = await db.cadenceStep.findUniqueOrThrow({ where: { id: stepId } });

  const cancelled = await db.cadenceSend.updateMany({
    where: { campaignId, stepKey: step.key, status: 'queued' },
    data: { status: 'skipped', error: 'Step removed from the cadence planner' },
  });

  if (step.createdByUser) {
    await db.cadenceStep.delete({ where: { id: stepId } });
  } else {
    await db.cadenceStep.update({ where: { id: stepId }, data: { removedAt: new Date(), enabled: false } });
  }

  await db.activityLogEntry.create({
    data: {
      campaignId,
      text: `Removed “${step.title}” from the cadence${cancelled.count ? ` — ${cancelled.count} queued send(s) cancelled` : ''}`,
      dot: 'var(--warning-700)',
    },
  });
  revalidateCampaign(campaignId);
  return { cancelled: cancelled.count };
}

/** Point a step at a specific message from the library. */
export async function setStepTemplateAction(campaignId: string, stepId: string, templateId: string | null) {
  await db.cadenceStep.update({ where: { id: stepId }, data: { templateId } });
  revalidateCampaign(campaignId);
}

export async function launchCadenceAction(campaignId: string) {
  const result = await launchCadence(campaignId);
  // Fire anything already due (e.g. the Day-0 invite) immediately after launch.
  const processed = await processDueSends(campaignId);
  revalidateCampaign(campaignId);
  return { ...result, ...processed, sendMode: sendModeLabel() };
}

/**
 * Resets a stopped cadence back to `not_started` so Schedule can show the
 * Launch button again — previously a stopped campaign had no path back to
 * sending at all short of manually editing the database. This does not
 * un-stop the abandoned run (see restartCadence's comment); it starts a new one.
 */
export async function restartCadenceAction(campaignId: string) {
  const result = await restartCadence(campaignId);
  revalidateCampaign(campaignId);
  return result;
}
