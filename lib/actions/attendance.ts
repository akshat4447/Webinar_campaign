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
