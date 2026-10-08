'use server';

import { db } from '@/lib/db';
import { revalidateCampaign } from '@/lib/revalidate';
import { z } from 'zod';

const campaignIdSchema = z.string().min(1);

/**
 * Manually marks a webinar as completed — this is what flips every
 * workspace tab from its live/editable view into the locked, read-only
 * "post-event" view (see lib/campaignLifecycle.ts's isCampaignCompleted,
 * which every one of those pages checks).
 *
 * Deliberately manual rather than date-triggered: an operator often still
 * needs to import the attendance report or run final outreach for days
 * after the webinar itself, and a silent auto-lock on scheduledAt passing
 * would cut that work off. This is that decision, made explicit.
 */
export async function markCampaignCompletedAction(campaignId: string) {
  const validCampaignId = campaignIdSchema.parse(campaignId);
  const campaign = await db.campaign.findUniqueOrThrow({
    where: { id: validCampaignId },
    select: { status: true, cadenceStatus: true },
  });
  if (campaign.status === 'completed') {
    return { ok: true as const };
  }

  // Stopping the cadence is the whole point, not a side effect. Marking a
  // webinar completed used to write `status` alone, but the send engine gates
  // purely on `cadenceStatus` (lib/cadence.ts's processDueSends, the cron
  // sweep, the in-process autotick) — so a "completed" campaign kept dispatching
  // queued sends on every tick while the UI told the operator everything was
  // locked AND hid the Control Center that would have let them stop it.
  const wasRunning = campaign.cadenceStatus === 'running' || campaign.cadenceStatus === 'paused';
  await db.campaign.update({
    where: { id: validCampaignId },
    data: { status: 'completed', ...(wasRunning ? { cadenceStatus: 'stopped' } : {}) },
  });

  // Queued-but-unsent rows would otherwise sit there looking pending forever,
  // and would fire the moment anyone restarted the cadence.
  const stranded = wasRunning
    ? await db.cadenceSend.updateMany({
        where: { campaignId: validCampaignId, status: { in: ['queued', 'processing'] } },
        data: { status: 'skipped', claimedAt: null, error: 'Webinar marked completed — send cancelled' },
      })
    : { count: 0 };

  await db.activityLogEntry.create({
    data: {
      campaignId: validCampaignId,
      text: `Webinar marked completed — messaging, audience and cadence are now locked to a read-only view${
        wasRunning ? `; cadence stopped${stranded.count ? ` and ${stranded.count} pending send(s) cancelled` : ''}` : ''
      }`,
      dot: 'var(--success-500)',
    },
  });
  revalidateCampaign(validCampaignId);
  return { ok: true as const, cadenceStopped: wasRunning, cancelledSends: stranded.count };
}

/**
 * Reverses markCampaignCompletedAction — for when it was marked by mistake,
 * or the operator needs to resume outreach (e.g. a rescheduled session).
 * Restores 'live' rather than 'draft': a completed campaign has always
 * already been launched, so 'draft' (never launched) would misrepresent it.
 *
 * Deliberately does NOT resume the cadence that marking-complete stopped.
 * Reopening usually happens days later, by which point every queued send is
 * long overdue — silently restarting would blast that whole backlog out at
 * once. The operator restarts the cadence explicitly from Control Center if
 * that's really what they want.
 */
export async function reopenCampaignAction(campaignId: string) {
  const validCampaignId = campaignIdSchema.parse(campaignId);
  await db.campaign.update({ where: { id: validCampaignId }, data: { status: 'live' } });
  await db.activityLogEntry.create({
    data: {
      campaignId: validCampaignId,
      text: 'Webinar reopened — no longer marked completed. The cadence stays stopped; restart it from Control Center if you need it running again.',
      dot: 'var(--warning-700)',
    },
  });
  revalidateCampaign(validCampaignId);
  return { ok: true as const };
}
