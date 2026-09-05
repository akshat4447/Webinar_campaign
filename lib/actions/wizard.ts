'use server';

import { db } from '@/lib/db';
import { provisionCampaignDefaults } from '@/lib/campaignDefaults';
import { formatWebinarDate } from '@/lib/campaignDate';
import { revalidateCampaign } from '@/lib/revalidate';

// Server actions for the creation wizard.
//
// The campaign row is created at the end of step 0 rather than at the end of
// the wizard, because steps 1-3 (import, enrich, score) all need something to
// attach to and all reuse the existing per-campaign actions. A wizard abandoned
// after step 0 leaves a draft, which is exactly what the Drafts filter is for.

export interface WizardDetails {
  title: string;
  date: string;
  time: string;
  speakerName: string;
  speakerTitle: string;
  description: string;
  capacity: string;
  registrationLink: string;
  zoomLink: string;
}

export interface WizardMessaging {
  msgMode: 'ai' | 'templatized';
  tone: string;
  msgLength: string;
  aiInstructions: string;
  brief: string;
  oneClickSignup: boolean;
  channels: Record<string, boolean>;
}

function combineDateTime(date: string, time: string): Date | null {
  if (!date) return null;
  const iso = time ? `${date}T${time}` : `${date}T09:00`;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Step 0 → creates the draft campaign and provisions its defaults. */
export async function createCampaignFromWizardAction(details: WizardDetails) {
  const scheduledAt = combineDateTime(details.date, details.time);
  const capacity = Number.parseInt(details.capacity, 10);

  const campaign = await db.campaign.create({
    data: {
      name: details.title.trim() || 'Untitled webinar',
      vertical: 'Unassigned',
      date: scheduledAt ? formatWebinarDate(scheduledAt) : 'Not scheduled yet',
      scheduledAt,
      description: details.description.trim() || null,
      speakerName: details.speakerName.trim() || null,
      speakerTitle: details.speakerTitle.trim() || null,
      capacity: Number.isFinite(capacity) && capacity > 0 ? capacity : null,
      registrationLink: details.registrationLink.trim() || null,
      zoomLink: details.zoomLink.trim() || null,
    },
  });

  await provisionCampaignDefaults(campaign.id);
  await db.activityLogEntry.create({
    data: { campaignId: campaign.id, text: 'Webinar created', dot: 'var(--accent-500)' },
  });
  revalidateCampaign(campaign.id);
  return campaign.id;
}

/** Step 0 edits after the draft exists (the wizard allows going Back). */
export async function updateWizardDetailsAction(campaignId: string, details: WizardDetails) {
  const scheduledAt = combineDateTime(details.date, details.time);
  const capacity = Number.parseInt(details.capacity, 10);

  await db.campaign.update({
    where: { id: campaignId },
    data: {
      name: details.title.trim() || 'Untitled webinar',
      date: scheduledAt ? formatWebinarDate(scheduledAt) : 'Not scheduled yet',
      scheduledAt,
      description: details.description.trim() || null,
      speakerName: details.speakerName.trim() || null,
      speakerTitle: details.speakerTitle.trim() || null,
      capacity: Number.isFinite(capacity) && capacity > 0 ? capacity : null,
      registrationLink: details.registrationLink.trim() || null,
      zoomLink: details.zoomLink.trim() || null,
    },
  });
  revalidateCampaign(campaignId);
}

/** Step 3 → messaging mode and which channels this campaign uses. */
export async function saveWizardMessagingAction(campaignId: string, messaging: WizardMessaging) {
  await db.campaign.update({
    where: { id: campaignId },
    data: {
      msgMode: messaging.msgMode,
      tone: messaging.tone,
      msgLength: messaging.msgLength,
      aiInstructions: messaging.aiInstructions,
      brief: messaging.brief,
      oneClickSignup: messaging.oneClickSignup,
    },
  });

  // Channel choice is expressed by enabling/disabling that channel's steps —
  // the same switch the planner uses, so the two can never disagree.
  const steps = await db.cadenceStep.findMany({
    where: { campaignId, removedAt: null },
    select: { id: true, channel: true },
  });
  const { normalizeChannel } = await import('@/lib/channels');
  await db.$transaction(
    steps.map((s) =>
      db.cadenceStep.update({
        where: { id: s.id },
        data: { enabled: messaging.channels[normalizeChannel(s.channel)] ?? false },
      })
    )
  );

  revalidateCampaign(campaignId);
}

/** Counts the wizard shows after an import, without loading every contact. */
export async function getWizardAudienceSummaryAction(campaignId: string) {
  const [total, withEmail, withLinkedin, missingTitle, scored, approved] = await Promise.all([
    db.contact.count({ where: { campaignId } }),
    db.contact.count({ where: { campaignId, email: { not: null } } }),
    db.contact.count({ where: { campaignId, linkedinId: { not: null } } }),
    db.contact.count({ where: { campaignId, missingInfo: true } }),
    db.contact.count({ where: { campaignId, score: { not: null } } }),
    db.contact.count({ where: { campaignId, approved: true } }),
  ]);
  return { total, withEmail, withLinkedin, missingTitle, scored, approved };
}

/** Top scored contacts, for the wizard's score preview. */
export async function getWizardScorePreviewAction(campaignId: string, take = 6) {
  const rows = await db.contact.findMany({
    where: { campaignId, score: { not: null } },
    orderBy: { score: 'desc' },
    take,
    select: { id: true, name: true, title: true, account: true, score: true },
  });
  return rows;
}

/**
 * Description rewrite during step 0, before any campaign row exists.
 *
 * The existing improveDescriptionAction needs a campaign to read the topic
 * from; here the topic is simply what the operator has typed so far.
 */
export async function improveDraftDescriptionAction(topic: string, current: string) {
  const { improveDescription } = await import('@/lib/claude');
  if (!topic.trim()) return { ok: false as const, error: 'Add a title first — it is what the description is written from.' };
  try {
    const result = await improveDescription({ topic, vertical: 'B2B', current });
    if (!result) return { ok: false as const, error: 'Claude returned nothing usable.' };
    return { ok: true as const, description: result };
  } catch (err) {
    return { ok: false as const, error: String(err) };
  }
}

// --- Zoom, wizard step 0 ---

export interface WizardZoomMeeting {
  id: string;
  topic: string;
  startTime: string | null;
  duration: number | null;
  joinUrl: string;
}

/** Upcoming meetings for the "link existing event" choice. */
export async function listWizardZoomMeetingsAction(): Promise<WizardZoomMeeting[]> {
  const { listUpcomingMeetings } = await import('@/lib/zoom/meetings');
  try {
    return await listUpcomingMeetings();
  } catch {
    // Zoom being unreachable must not block the wizard — the operator can
    // still type a join link by hand.
    return [];
  }
}

/**
 * Applies a chosen Zoom meeting to the campaign draft: title, date/time and
 * join link all come from Zoom, matching the prototype's "pulled from Zoom —
 * title, date & time set automatically" behaviour.
 */
export async function applyWizardZoomMeetingAction(campaignId: string, meetingId: string) {
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

/** Creates a brand-new Zoom meeting from the wizard's own title/date/time fields. */
export async function createWizardZoomMeetingAction(campaignId: string, details: WizardDetails) {
  const { createMeeting } = await import('@/lib/zoom/meetings');
  const scheduledAt = combineDateTime(details.date, details.time);
  try {
    const meeting = await createMeeting({
      topic: details.title.trim() || 'Untitled webinar',
      startTime: scheduledAt,
      agenda: details.description,
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
