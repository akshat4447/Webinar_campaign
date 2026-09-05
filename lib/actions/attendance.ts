'use server';

import { importAttendanceCsv } from '@/lib/attendance';
import { revalidateCampaign } from '@/lib/revalidate';

export async function importAttendanceAction(campaignId: string, formData: FormData) {
  const file = formData.get('file') as File | null;
  if (!file) return { ok: false, error: 'No file provided.' };
  const text = await file.text();
  const result = await importAttendanceCsv(campaignId, text);
  revalidateCampaign(campaignId);
  return result;
}

export async function importAttendanceFromZoomAction(campaignId: string) {
  const { importAttendanceFromZoom } = await import('@/lib/attendance');
  const result = await importAttendanceFromZoom(campaignId);
  if (result.ok) revalidateCampaign(campaignId);
  return result;
}

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
