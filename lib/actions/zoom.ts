'use server';

import { db } from '@/lib/db';
import { formatWebinarDate } from '@/lib/campaignDate';
import { revalidateCampaign } from '@/lib/revalidate';
import type { ZoomMeeting } from '@/lib/zoom/meetings';

export type { ZoomMeeting };

// Shared between the creation wizard and the Setup tab — linking or creating a
// Zoom meeting is the same operation whether the campaign is a fresh draft or
// one that's been running for weeks. Nothing here is wizard-specific.

/** Upcoming meetings on the connected Zoom account, for a "pick one" list.
 *  Empty (never thrown) if Zoom is unreachable — callers fall back to a
 *  manual link instead of blocking on it. */
export async function listZoomMeetingsAction(): Promise<ZoomMeeting[]> {
  const { listUpcomingMeetings } = await import('@/lib/zoom/meetings');
  try {
    return await listUpcomingMeetings();
  } catch {
    return [];
  }
}

/**
 * Links a campaign to a real Zoom meeting: title, date/time and join link all
 * come from Zoom, matching the prototype's "pulled from Zoom — title, date &
 * time set automatically" behaviour. Works the same for a brand-new draft or
 * a campaign that's already live — same as every other Setup field, editing
 * here is never gated on cadence state; the operator adjusts step timing on
 * the Cadence planner afterward if the date actually moved.
 */
export async function linkZoomMeetingAction(campaignId: string, meetingId: string) {
  const { listUpcomingMeetings } = await import('@/lib/zoom/meetings');
  const meetings = await listUpcomingMeetings();
  const meeting = meetings.find((m) => m.id === meetingId);
  if (!meeting) return { ok: false as const, error: 'That meeting is no longer on the list — refresh and try again.' };

  const scheduledAt = meeting.startTime ? new Date(meeting.startTime) : null;
  await db.campaign.update({
    where: { id: campaignId },
    data: {
      name: meeting.topic,
      date: scheduledAt ? formatWebinarDate(scheduledAt) : 'Not scheduled yet',
      scheduledAt,
      zoomLink: meeting.joinUrl,
      zoomMeetingId: meeting.id,
      zoomMode: 'existing',
    },
  });
  revalidateCampaign(campaignId);
  return { ok: true as const, meeting };
}

/** Creates a brand-new Zoom meeting from the campaign's own current title,
 *  date and description — for a campaign with no Zoom meeting yet at all. */
export async function createZoomMeetingAction(campaignId: string) {
  const { createMeeting } = await import('@/lib/zoom/meetings');
  const campaign = await db.campaign.findUniqueOrThrow({
    where: { id: campaignId },
    select: { name: true, scheduledAt: true, description: true },
  });
  try {
    const meeting = await createMeeting({
      topic: campaign.name || 'Untitled webinar',
      startTime: campaign.scheduledAt,
      agenda: campaign.description ?? undefined,
    });
    await db.campaign.update({
      where: { id: campaignId },
      data: { zoomLink: meeting.joinUrl, zoomMeetingId: meeting.id, zoomMode: 'new' },
    });
    revalidateCampaign(campaignId);
    return { ok: true as const, meeting };
  } catch (err) {
    return { ok: false as const, error: String(err) };
  }
}

/** Un-links the campaign from a specific Zoom meeting, keeping the join link
 *  itself as a plain manual value — for when the operator wants to detach
 *  from Zoom's own tracking (e.g. before deleting that Zoom meeting) without
 *  losing the URL contacts already have. */
export async function unlinkZoomMeetingAction(campaignId: string) {
  await db.campaign.update({ where: { id: campaignId }, data: { zoomMeetingId: null, zoomMode: null } });
  revalidateCampaign(campaignId);
  return { ok: true as const };
}
