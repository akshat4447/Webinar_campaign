'use server';

// Attendance import itself has no manual trigger anymore — it runs
// automatically from lib/zoomAutosync.ts once a webinar has ended. This file
// keeps the one attendance-adjacent action that's still UI-triggered.

export async function pushAccountsForSdrAction(campaignId: string, contactIds: string[]) {
  const { pushEngagementActivities } = await import('@/lib/activityPush');
  const { revalidateCampaign } = await import('@/lib/revalidate');
  const result = await pushEngagementActivities(
    campaignId,
    contactIds.map((contactId) => ({ contactId, stage: 'SDR follow-up' as const }))
  );
  revalidateCampaign(campaignId);
  return result;
}

export async function generatePostEventDebriefAction(campaignId: string) {
  const { getPostEventDebrief } = await import('@/lib/postEvent');
  return getPostEventDebrief(campaignId);
}
