import { createHash } from 'node:crypto';
import { resolveStepDate } from '@/lib/stepSchedule';
import { db } from '@/lib/db';
import { revalidateCampaign } from '@/lib/revalidate';

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

// Zoom logs a join/leave event pair even for a connection that drops almost
// immediately, which can round to 0 total minutes. Treating that as a full
// "Attended" — a real engagement signal pushed to LeadSquared — overstates a
// blip, so require at least one rounded minute of aggregate watch time.
const MIN_ATTENDANCE_MINUTES = 1;

/**
 * The shared core: given who watched for how long, mark contacts attended or
 * no-show, queue whichever of those two steps are enabled, and push the
 * engagement activities to LeadSquared. Neither import path duplicates this.
 */
async function applyAttendance(campaignId: string, emailToDuration: Map<string, number>): Promise<AttendanceImportResult> {
  for (const value of emailToDuration.values()) if (!Number.isFinite(value) || value < 0) throw new Error('Attendance duration must be a finite, non-negative number.');
  const fingerprint = createHash('sha256').update(JSON.stringify([...emailToDuration].sort(([a], [b]) => a.localeCompare(b)))).digest('hex');
  const summary = await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Campaign" WHERE "id" = ${campaignId} FOR UPDATE`;
    const campaign = await tx.campaign.findUniqueOrThrow({ where: { id: campaignId } });
    const contacts = await tx.contact.findMany({ where: { campaignId, OR: [{ approved: true }, { registeredAt: { not: null } }] } });
    const attendedIds = contacts.filter(c => (emailToDuration.get(c.email?.toLowerCase() || '') ?? 0) >= MIN_ATTENDANCE_MINUTES).map(c => c.id);
    const attendedSet = new Set(attendedIds);
    const noShowIds = contacts.filter(c => c.registeredAt && !attendedSet.has(c.id)).map(c => c.id);
    if (campaign.attendanceFingerprint === fingerprint) return { attendedIds, noShowIds };
    const revision = campaign.attendanceVersion + 1;
    const durationGroups = new Map<number, string[]>();
    for (const c of contacts) {
      const minutes = Math.max(0, Math.floor(emailToDuration.get(c.email?.toLowerCase() || '') ?? 0));
      const ids = durationGroups.get(minutes) ?? []; ids.push(c.id); durationGroups.set(minutes, ids);
    }
    for (const [minutes, ids] of durationGroups) await tx.contact.updateMany({ where: { campaignId, id: { in: ids } }, data: { attended: minutes >= MIN_ATTENDANCE_MINUTES, watchMinutes: minutes } });
    const steps = await tx.cadenceStep.findMany({ where: { campaignId, trigger: 'attendance', enabled: true, removedAt: null } });
    const now = new Date();
    for (const step of steps) {
      const segment = step.key === 'attend' ? 'attended' : step.key === 'noshow' ? 'noshow' : step.audience;
      const ids = segment === 'attended' ? attendedIds : segment === 'noshow' ? noShowIds : [...attendedIds, ...noShowIds];
      await tx.cadenceSend.updateMany({ where: { campaignId, stepKey: step.key, contactId: { notIn: ids }, status: { in: ['queued', 'processing'] } }, data: { status: 'skipped', claimedAt: null, error: 'Attendance correction changed the segment.' } });
      const resolved = step.anchor === 'event' ? new Date(now.getTime() + step.offsetValue * (step.offsetUnit === 'minutes' ? 60_000 : step.offsetUnit === 'hours' ? 3_600_000 : 86_400_000)) : resolveStepDate(step, { launchAt: campaign.launchedAt ?? now, webinarAt: campaign.scheduledAt });
      const dueAt = resolved && resolved > now ? resolved : now;
      await tx.cadenceSend.updateMany({ where: { campaignId, stepKey: step.key, contactId: { in: ids }, status: 'skipped', error: 'Attendance correction changed the segment.' }, data: { status: 'queued', error: null, dueAt } });
      if (ids.length) await tx.cadenceSend.createMany({ data: ids.map(contactId => ({ campaignId, contactId, stepKey: step.key, dueAt })), skipDuplicates: true });
    }
    // Engagement synchronization is durable and versioned; repeat imports do not repost outcomes.
    await tx.registrationJob.updateMany({ where: { campaignId, kind: { startsWith: 'engagement_' }, status: { in: ['pending','failed','blocked'] } }, data: { status: 'cancelled' } });
    const jobs = [...attendedIds.map(contactId => ({ campaignId, contactId, kind: `engagement_attended:${revision}` })), ...noShowIds.map(contactId => ({ campaignId, contactId, kind: `engagement_noshow:${revision}` }))];
    if (jobs.length) await tx.registrationJob.createMany({ data: jobs, skipDuplicates: true });
    await tx.campaign.update({ where: { id: campaignId }, data: { attendanceImportedAt: now, attendanceFingerprint: fingerprint, attendanceVersion: revision } });
    await tx.activityLogEntry.create({ data: { campaignId, text: `Attendance import ${revision}: ${attendedIds.length} attended, ${noShowIds.length} no-show; CRM synchronization queued.`, dot: 'var(--success-500)' } });
    return { attendedIds, noShowIds };
  }, { timeout: 30_000 });
  revalidateCampaign(campaignId);
  return { ok: true, attendedCount: summary.attendedIds.length, noShowCount: summary.noShowIds.length, matchedEmails: [...emailToDuration.keys()] };
}

/**
 * Pull attendance straight from Zoom's Meetings API (past meeting
 * participants) for the meeting this campaign is linked to — see
 * lib/zoom/meetings.ts fetchParticipants for why this endpoint rather than
 * the Reports API one.
 */
export async function importAttendanceFromZoom(campaignId: string): Promise<AttendanceImportResult> {
  const campaign = await db.campaign.findUniqueOrThrow({ where: { id: campaignId }, select: { zoomMeetingId: true, zoomEventType: true } });
  if (!campaign.zoomMeetingId) {
    return { ok: false, error: 'No Zoom meeting is linked to this webinar — link one from Setup.' };
  }

  const { fetchParticipants } = await import('@/lib/zoom/meetings');
  let participants;
  try {
    participants = await fetchParticipants(campaign.zoomMeetingId, campaign.zoomEventType === 'webinar' ? 'webinar' : 'meeting');
  } catch (err) {
    return { ok: false, error: `Zoom's participants report could not be fetched: ${String(err)}` };
  }
  if (participants.length === 0) {
    return { ok: false, error: 'Zoom returned no participants for this meeting — nobody may have joined yet, or the meeting has not ended.' };
  }

  // Zoom's participants report has one row per join/leave session — a
  // rejoin (dropped call, switched device, common in practice) shows up as
  // multiple rows for the same email. Summing them is the actual total
  // watch time; taking the max (the previous behavior) silently discarded
  // every session but the longest one.
  const emailToDuration = new Map<string, number>();
  for (const p of participants) {
    const email = p.email?.trim().toLowerCase();
    if (!email) continue;
    emailToDuration.set(email, (emailToDuration.get(email) ?? 0) + p.durationMinutes);
  }

  return applyAttendance(campaignId, emailToDuration);
}

export { applyAttendance };

export async function importAttendanceList(
  campaignId: string,
  attendees: { email: string; watchMinutes?: number }[]
): Promise<AttendanceImportResult> {
  const emailToDuration = new Map<string, number>();
  for (const a of attendees) {
    const email = a.email?.trim().toLowerCase();
    if (email) {
      emailToDuration.set(email, Math.max(emailToDuration.get(email) ?? 0, a.watchMinutes ?? 60));
    }
  }
  return applyAttendance(campaignId, emailToDuration);
}
