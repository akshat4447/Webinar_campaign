'use server';

import { requireOperatorSession } from '@/lib/operatorSession';

// Attendance also imports automatically from lib/zoomAutosync.ts once a
// webinar has ended, but these manual/UI-triggered actions still exist
// alongside it — a CSV import and an on-demand Zoom sync for when the
// automatic pass hasn't run yet or needs a manual nudge.

export async function pushAccountsForSdrAction(
  campaignId: string,
  contactIds: string[]
): Promise<({ ok: true } & Awaited<ReturnType<typeof import('@/lib/activityPush').pushEngagementActivities>>) | { ok: false; error: string }> {
  await requireOperatorSession();
  const { pushEngagementActivities } = await import('@/lib/activityPush');
  const { revalidateCampaign } = await import('@/lib/revalidate');
  const { plainError } = await import('@/lib/plainError');
  try {
    const result = await pushEngagementActivities(
      campaignId,
      contactIds.map((contactId) => ({ contactId, stage: 'SDR follow-up' as const }))
    );
    revalidateCampaign(campaignId);
    return { ok: true, ...result };
  } catch (err) {
    // Returned, not thrown: production replaces a thrown server error's message with a code nobody can read.
    return { ok: false, error: plainError(err, 'Could not push the accounts to LeadSquared.') };
  }
}

export async function generatePostEventDebriefAction(campaignId: string) {
  await requireOperatorSession();
  const { getPostEventDebrief } = await import('@/lib/postEvent');
  return getPostEventDebrief(campaignId);
}

export async function syncZoomAttendanceAction(campaignId: string) {
  await requireOperatorSession();
  const { importAttendanceFromZoom } = await import('@/lib/attendance');
  const { revalidateCampaign } = await import('@/lib/revalidate');
  const result = await importAttendanceFromZoom(campaignId);
  revalidateCampaign(campaignId);
  return result;
}

export async function importAttendanceListAction(
  campaignId: string,
  attendees: { email: string; watchMinutes?: number }[]
) {
  await requireOperatorSession();
  const { importAttendanceList } = await import('@/lib/attendance');
  const { revalidateCampaign } = await import('@/lib/revalidate');
  const result = await importAttendanceList(campaignId, attendees);
  revalidateCampaign(campaignId);
  return result;
}
