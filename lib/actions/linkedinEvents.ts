'use server';

// Server actions for the LinkedIn Event feature — thin boundaries over
// lib/linkedin/*, matching how every other action file wraps its lib module.
import { db } from '@/lib/db';
import { revalidateCampaign } from '@/lib/revalidate';
import { publishWebinarToLinkedIn, cancelLinkedInEvent } from '@/lib/linkedin/publishWebinar';
import type { PublishOutcome } from '@/lib/linkedin/publishWebinar';
import { processPendingLinkedinRegistrations } from '@/lib/linkedin/ingest';

export async function publishToLinkedInAction(campaignId: string): Promise<PublishOutcome> {
  return publishWebinarToLinkedIn(campaignId);
}

export async function cancelLinkedInEventAction(campaignId: string): Promise<PublishOutcome> {
  return cancelLinkedInEvent(campaignId);
}

/** The human invite step — UI-only on LinkedIn's side, tracked here. */
export async function markLinkedinInvitedAction(campaignId: string, invited: boolean): Promise<void> {
  await db.campaign.update({
    where: { id: campaignId },
    data: { linkedinInvitedAt: invited ? new Date() : null },
  });
  if (invited) {
    await db.activityLogEntry.create({
      data: { campaignId, text: 'Marked “Invite connections” as done on the LinkedIn Event page', dot: 'var(--success-500)' },
    });
  }
  await revalidateCampaign(campaignId);
}

/** Manual drain of the registration queue (Control Center button + retries). */
export async function processLinkedInQueueAction(campaignId?: string): Promise<{ processed: number; failed: number; skipped: number }> {
  const result = await processPendingLinkedinRegistrations(50, campaignId);
  await revalidateCampaign(campaignId ?? '');
  return result;
}