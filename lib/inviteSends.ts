import { db } from '@/lib/db';
import { INVITE_STEP_KEYS } from '@/lib/cadenceStepKinds';
import { isOutreachStep } from '@/lib/stepTrigger';

/**
 * The `where` that picks out invite sends: the built-in invite steps everywhere, plus each campaign's own outreach steps (an email
 * step the operator added to the invitation sequence, say), judged by `isOutreachStep` exactly as the Overview's channel table
 * judges them. Without the second part a webinar whose only invite was a custom step showed "Invites sent: 0" on the dashboard and
 * its card while its Overview counted the same people as invited.
 *
 * Callers count distinct contacts, so a nudge or final call reaching the same people never inflates the figure.
 */
export async function inviteSendWhere(campaignIds?: string[]) {
  const steps = await db.cadenceStep.findMany({
    where: { key: { notIn: INVITE_STEP_KEYS }, ...(campaignIds ? { campaignId: { in: campaignIds } } : {}) },
    select: { campaignId: true, key: true, group: true, trigger: true },
  });
  const extraKeys = new Map<string, string[]>();
  for (const step of steps) {
    if (isOutreachStep(step)) extraKeys.set(step.campaignId, [...(extraKeys.get(step.campaignId) ?? []), step.key]);
  }
  return {
    OR: [
      { stepKey: { in: INVITE_STEP_KEYS } },
      ...[...extraKeys].map(([campaignId, keys]) => ({ campaignId, stepKey: { in: keys } })),
    ],
  };
}
