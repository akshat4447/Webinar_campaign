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
export async function resetScheduleAction(campaignId: string) {
  const steps = await db.cadenceStep.findMany({ where: { campaignId } });
  await db.$transaction(
    steps
      .filter((s) => STEP_DEFAULTS[s.key])
      .map((s) => db.cadenceStep.update({ where: { id: s.id }, data: STEP_DEFAULTS[s.key] }))
  );
  await db.activityLogEntry.create({ data: { campaignId, text: 'Cadence timings reset to defaults', dot: 'var(--accent-500)' } });
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
