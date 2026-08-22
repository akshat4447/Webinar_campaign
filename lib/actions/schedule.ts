'use server';

import { db } from '@/lib/db';
import { launchCadence, processDueSends } from '@/lib/cadence';
import { sendModeLabel } from '@/lib/sendGuard';
import { resolveStepDate, offsetLabel, ANCHOR_LABEL, STEP_DEFAULTS } from '@/lib/stepSchedule';
import { revalidateCampaign } from '@/lib/revalidate';

export async function updateScheduleConfigAction(campaignId: string, data: { scheduleWindow?: string; frequency?: string; dailyLimit?: number }) {
  await db.campaign.update({ where: { id: campaignId }, data });
  revalidateCampaign(campaignId);
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
export async function updateStepScheduleAction(
  campaignId: string,
  stepKey: string,
  patch: { offsetValue?: number; offsetUnit?: string; anchor?: string }
) {
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
