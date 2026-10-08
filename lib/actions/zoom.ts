'use server';

import { db } from '@/lib/db';
import { formatWebinarDate } from '@/lib/campaignDate';
import { revalidateCampaign } from '@/lib/revalidate';
import { zoomConnectionError } from '@/lib/zoom/client';
import type { ZoomMeeting } from '@/lib/zoom/meetings';
import { setupLockError, assertSetupEditable } from '@/lib/setupLock';

export type { ZoomMeeting };


/** Upcoming meetings on the connected Zoom account, for a "pick one" list. */
export async function listZoomMeetingsAction(): Promise<{ ok: true; meetings: ZoomMeeting[] } | { ok: false; error: string }> {
  const connectionError = await zoomConnectionError();
  if (connectionError) return { ok: false, error: connectionError };

  const { listUpcomingMeetings } = await import('@/lib/zoom/meetings');
  try {
    return { ok: true, meetings: await listUpcomingMeetings() };
  } catch (err) {
    return { ok: false, error: String(err instanceof Error ? err.message : err) };
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
export async function fetchZoomEventDetailsAction(idOrUrl: string): Promise<{ ok: true; meeting: ZoomMeeting } | { ok: false; error: string }> {
  const connectionError = await zoomConnectionError();
  if (connectionError) return { ok: false, error: connectionError };

  const { getZoomEventDetails } = await import('@/lib/zoom/meetings');
  try {
    const meeting = await getZoomEventDetails(idOrUrl);
    if (!meeting) {
      return { ok: false, error: 'Could not fetch details for that Zoom event. Ensure the Webinar/Meeting ID is valid and permissions are granted.' };
    }
    return { ok: true, meeting };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Links a campaign to a real Zoom meeting or webinar: title, date/time and join link all
 * come from Zoom, matching the prototype's "pulled from Zoom — title, date &
 * time set automatically" behaviour.
 */
export async function linkZoomMeetingAction(campaignId: string, meetingId: string) {
  const lockedMessage = await setupLockError(campaignId);
  if (lockedMessage) return { ok: false as const, error: lockedMessage };
  const connectionError = await zoomConnectionError();
  if (connectionError) return { ok: false as const, error: connectionError };

  const { getZoomEventDetails, listUpcomingMeetings } = await import('@/lib/zoom/meetings');
  // Prioritize deep event detail fetch to retrieve speakers, panelists, capacity & registration link
  let meeting = await getZoomEventDetails(meetingId);
  if (!meeting) {
    const meetings = await listUpcomingMeetings();
    meeting = meetings.find((m) => m.id === meetingId) || null;
  }
  if (!meeting) return { ok: false as const, error: 'That meeting/webinar was not found on your Zoom account — refresh or paste the link directly.' };

  // Personal join links belong to ONE Zoom meeting. Re-pointing the campaign at a different
  // meeting makes every stored link dead, so forget them: contacts fall back to the
  // campaign's own link, and the reconcile sweep re-registers recent registrants on the new meeting.
  const previous = await db.campaign.findUnique({ where: { id: campaignId }, select: { zoomMeetingId: true } });
  if (previous?.zoomMeetingId && previous.zoomMeetingId !== meeting.id) {
    await db.contact.updateMany({ where: { campaignId }, data: { zoomJoinUrl: null, zoomRegistrantId: null } });
  }

  const scheduledAt = meeting.startTime ? new Date(meeting.startTime) : null;
  const cleanTopic = meeting.topic.replace(/^\[Webinar\]\s*/, '');
  const primarySpeaker = meeting.speakers?.find((s) => s.isPrimary) || meeting.speakers?.[0];

  await db.campaign.update({
    where: { id: campaignId },
    data: {
      name: cleanTopic,
      date: scheduledAt ? formatWebinarDate(scheduledAt) : 'Not scheduled yet',
      scheduledAt,
      zoomLink: meeting.joinUrl,
      zoomMeetingId: meeting.id,
      zoomMode: 'existing',
      zoomEventType: meeting.type ?? 'meeting',
      // Zoom's own registration page lives in its own column — it must NOT overwrite registrationLink,
      // which is the operator's external landing page (registration mode "external").
      zoomRegistrationUrl: meeting.registrationUrl ?? null,
      ...(meeting.capacity ? { capacity: meeting.capacity } : {}),
      ...(meeting.agenda ? { description: meeting.agenda } : {}),
      ...(primarySpeaker ? {
        speakerName: primarySpeaker.name,
        speakerTitle: primarySpeaker.title || 'Host & Keynote Speaker',
      } : {}),
    },
  });

  // Sync speakers & panelists into the campaign's Speaker roster
  if (meeting.speakers && meeting.speakers.length > 0) {
    const { syncSpeakersForCampaign } = await import('@/lib/speakersServer');
    await syncSpeakersForCampaign(
      campaignId,
      meeting.speakers.map((s, idx) => ({
        name: s.name,
        title: s.title || (s.isPrimary ? 'Host & Keynote Speaker' : 'Panelist / Speaker'),
        company: s.company || 'LeadSquared',
        bio: s.bio,
        avatarUrl: s.avatarUrl,
        joinUrl: s.joinUrl,
        isPrimary: !!s.isPrimary,
        order: idx,
      }))
    );
  }

  // Reschedule anchor synchronization: update dueAt for all queued sends anchored to the webinar
  if (scheduledAt) {
    const { applyOffset } = await import('@/lib/stepSchedule');
    const webinarSteps = await db.cadenceStep.findMany({
      where: { campaignId, anchor: 'webinar' },
      select: { key: true, offsetValue: true, offsetUnit: true },
    });
    for (const s of webinarSteps) {
      const newDue = applyOffset(scheduledAt, s.offsetValue, s.offsetUnit);
      await db.cadenceSend.updateMany({
        where: { campaignId, stepKey: s.key, status: 'queued' },
        data: { dueAt: newDue },
      });
    }
  }

  revalidateCampaign(campaignId);
  return { ok: true as const, meeting };
}

/** Creates a brand-new Zoom meeting from the campaign's own current title,
 *  date and description — for a campaign with no Zoom meeting yet at all. */
export async function createZoomMeetingAction(campaignId: string) {
  const lockedMessage = await setupLockError(campaignId);
  if (lockedMessage) return { ok: false as const, error: lockedMessage };
  const connectionError = await zoomConnectionError();
  if (connectionError) return { ok: false as const, error: connectionError };

  const { createMeeting } = await import('@/lib/zoom/meetings');
  const campaign = await db.campaign.findUniqueOrThrow({
    where: { id: campaignId },
    select: { name: true, scheduledAt: true, description: true, timezone: true, durationMinutes: true },
  });
  try {
    const meeting = await createMeeting({
      topic: campaign.name || 'Untitled webinar',
      startTime: campaign.scheduledAt,
      agenda: campaign.description ?? undefined,
      durationMinutes: campaign.durationMinutes,
      timezone: campaign.timezone,
    });
    await db.campaign.update({
      where: { id: campaignId },
      data: {
        zoomLink: meeting.joinUrl,
        zoomMeetingId: meeting.id,
        zoomMode: 'new',
        zoomEventType: meeting.type ?? 'meeting',
        zoomRegistrationUrl: meeting.registrationUrl ?? null,
      },
    });
    revalidateCampaign(campaignId);
    // registrationEnabled === false means Zoom ignored the request (typically an unlicensed host):
    // the meeting exists but registrants cannot be added. Surfaced so the UI can say so.
    return { ok: true as const, meeting, registrationEnabled: meeting.registrationEnabled !== false };
  } catch (err) {
    return { ok: false as const, error: String(err) };
  }
}

/** Un-links the campaign from a specific Zoom meeting, keeping the join link
 *  itself as a plain manual value — for when the operator wants to detach
 *  from Zoom's own tracking (e.g. before deleting that Zoom meeting) without
 *  losing the URL contacts already have. No Zoom call involved, so no
 *  connection gate — there's nothing to fetch. */
export async function unlinkZoomMeetingAction(campaignId: string) {
  await assertSetupEditable(campaignId);
  await db.campaign.update({ where: { id: campaignId }, data: { zoomMeetingId: null, zoomMode: null, zoomEventType: null, zoomRegistrationUrl: null } });
  revalidateCampaign(campaignId);
  return { ok: true as const };
}

/** What the setup UI needs to know about the linked Zoom event's registration state. */
export type ZoomRegistrationHealth =
  | { linked: false }
  | { linked: true; kind: 'meeting' | 'webinar'; registrationEnabled: boolean; registrationUrl: string | null; error?: string };

export async function getZoomRegistrationHealthAction(campaignId: string): Promise<ZoomRegistrationHealth> {
  const campaign = await db.campaign.findUnique({ where: { id: campaignId }, select: { zoomMeetingId: true, zoomEventType: true, zoomRegistrationUrl: true } });
  if (!campaign?.zoomMeetingId) return { linked: false };
  const stored = (campaign.zoomEventType as 'meeting' | 'webinar' | null) ?? 'meeting';
  if (await zoomConnectionError()) {
    return { linked: true, kind: stored, registrationEnabled: Boolean(campaign.zoomRegistrationUrl), registrationUrl: campaign.zoomRegistrationUrl };
  }
  try {
    const { getZoomEventDetails } = await import('@/lib/zoom/meetings');
    const d = await getZoomEventDetails(campaign.zoomMeetingId);
    if (!d) return { linked: true, kind: stored, registrationEnabled: false, registrationUrl: campaign.zoomRegistrationUrl, error: 'Zoom could not find this event any more.' };
    return { linked: true, kind: d.type ?? stored, registrationEnabled: d.registrationEnabled !== false, registrationUrl: d.registrationUrl ?? campaign.zoomRegistrationUrl };
  } catch (err) {
    return { linked: true, kind: stored, registrationEnabled: Boolean(campaign.zoomRegistrationUrl), registrationUrl: campaign.zoomRegistrationUrl, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Turns registration on for the linked Zoom event (approval_type 2 -> 0). */
export async function enableZoomRegistrationAction(campaignId: string) {
  const connectionError = await zoomConnectionError();
  if (connectionError) return { ok: false as const, error: connectionError };
  const campaign = await db.campaign.findUnique({ where: { id: campaignId }, select: { zoomMeetingId: true, zoomEventType: true } });
  if (!campaign?.zoomMeetingId) return { ok: false as const, error: 'No Zoom event is linked to this webinar.' };
  const { enableZoomRegistration } = await import('@/lib/zoom/meetings');
  const kind = (campaign.zoomEventType as 'meeting' | 'webinar' | null) ?? 'meeting';
  const r = await enableZoomRegistration(campaign.zoomMeetingId, kind);
  if (!r.ok) return { ok: false as const, error: r.error ?? 'Zoom did not enable registration.' };
  await db.campaign.update({ where: { id: campaignId }, data: { zoomRegistrationUrl: r.registrationUrl ?? null } });
  revalidateCampaign(campaignId);
  return { ok: true as const, registrationUrl: r.registrationUrl ?? null };
}
