import { db } from '@/lib/db';
import { processDueSends } from '@/lib/cadence';
import { pushEngagementActivities } from '@/lib/activityPush';

// Attendance always comes from Zoom's reporting API (see importAttendanceFromZoom
// below), pulled automatically once a webinar has ended — see
// lib/zoomAutosync.ts. Ends up as an email->duration map and goes through
// applyAttendance, the one place "attended" actually gets decided.

export interface AttendanceImportResult {
  ok: boolean;
  error?: string;
  attendedCount?: number;
  noShowCount?: number;
  matchedEmails?: string[];
}

/**
 * The shared core: given who watched for how long, mark contacts attended or
 * no-show, queue whichever of those two steps are enabled, and push the
 * engagement activities to LeadSquared. Neither import path duplicates this.
 */
async function applyAttendance(campaignId: string, emailToDuration: Map<string, number>): Promise<AttendanceImportResult> {
  const approvedContacts = await db.contact.findMany({ where: { campaignId, approved: true } });
  const attendedIds: string[] = [];
  const noShowIds: string[] = [];

  for (const contact of approvedContacts) {
    const email = contact.email?.trim().toLowerCase();
    const duration = email ? emailToDuration.get(email) : undefined;
    if (duration !== undefined) {
      await db.contact.update({ where: { id: contact.id }, data: { attended: true, watchMinutes: duration } });
      attendedIds.push(contact.id);
    } else {
      noShowIds.push(contact.id);
    }
  }

  await db.campaign.update({ where: { id: campaignId }, data: { attendanceImportedAt: new Date() } });

  const now = (await db.campaign.findUniqueOrThrow({ where: { id: campaignId }, select: { simulatedNow: true } })).simulatedNow ?? new Date();
  const enabledSteps = await db.cadenceStep.findMany({ where: { campaignId, key: { in: ['attend', 'noshow'] }, enabled: true, removedAt: null } });
  const enabledKeys = new Set(enabledSteps.map((s) => s.key));

  const existing = await db.cadenceSend.findMany({ where: { campaignId, stepKey: { in: ['attend', 'noshow'] } }, select: { contactId: true, stepKey: true } });
  const existingKey = new Set(existing.map((e) => `${e.contactId}:${e.stepKey}`));

  const newSends = [
    ...(enabledKeys.has('attend') ? attendedIds.filter((id) => !existingKey.has(`${id}:attend`)).map((contactId) => ({ campaignId, contactId, stepKey: 'attend', dueAt: now, status: 'queued' })) : []),
    ...(enabledKeys.has('noshow') ? noShowIds.filter((id) => !existingKey.has(`${id}:noshow`)).map((contactId) => ({ campaignId, contactId, stepKey: 'noshow', dueAt: now, status: 'queued' })) : []),
  ];
  if (newSends.length > 0) await db.cadenceSend.createMany({ data: newSends });
  await processDueSends(campaignId);

  const pushResult = await pushEngagementActivities(campaignId, [
    ...attendedIds.map((contactId) => ({ contactId, stage: 'Attended' as const })),
    ...noShowIds.map((contactId) => ({ contactId, stage: 'No-show' as const })),
  ]);

  await db.activityLogEntry.create({
    data: {
      campaignId,
      text: `Imported attendance: ${attendedIds.length} attended, ${noShowIds.length} no-show. Pushed ${pushResult.pushed} engagement activities to LeadSquared.`,
      dot: 'var(--success-500)',
    },
  });

  return { ok: true, attendedCount: attendedIds.length, noShowCount: noShowIds.length, matchedEmails: [...emailToDuration.keys()] };
}

/**
 * Pull attendance straight from Zoom's reporting API for the meeting this
 * campaign is linked to. Needs a paid Zoom plan — the report endpoints are
 * not on the free tier, so a campaign on a free/basic Zoom plan simply never
 * gets attendance filled in automatically until the account is upgraded.
 */
export async function importAttendanceFromZoom(campaignId: string): Promise<AttendanceImportResult> {
  const campaign = await db.campaign.findUniqueOrThrow({ where: { id: campaignId }, select: { zoomMeetingId: true } });
  if (!campaign.zoomMeetingId) {
    return { ok: false, error: 'No Zoom meeting is linked to this webinar — link one from Setup.' };
  }

  const { fetchParticipants } = await import('@/lib/zoom/meetings');
  let participants;
  try {
    participants = await fetchParticipants(campaign.zoomMeetingId);
  } catch (err) {
    return { ok: false, error: `Zoom's participants report could not be fetched: ${String(err)}` };
  }
  if (participants.length === 0) {
    return { ok: false, error: 'Zoom returned no participants for this meeting — the report may need the paid Webinar add-on, or nobody has joined yet.' };
  }

  const emailToDuration = new Map<string, number>();
  for (const p of participants) {
    const email = p.email?.trim().toLowerCase();
    if (!email) continue;
    emailToDuration.set(email, Math.max(emailToDuration.get(email) ?? 0, p.durationMinutes));
  }

  return applyAttendance(campaignId, emailToDuration);
}
