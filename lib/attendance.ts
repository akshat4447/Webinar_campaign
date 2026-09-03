import { db } from '@/lib/db';
import { pickCol } from '@/lib/importHeuristics';
import { processDueSends } from '@/lib/cadence';
import { pushEngagementActivities } from '@/lib/activityPush';
import { parseCsvText } from '@/lib/csv';

// Zoom's own "Participants Report" export often has a summary section before
// the real header row — importAttendanceCsv below finds the first row that
// looks like a header (contains an "email" column) instead of assuming row 0.

export interface AttendanceImportResult {
  ok: boolean;
  error?: string;
  attendedCount?: number;
  noShowCount?: number;
  matchedEmails?: string[];
}

export async function importAttendanceCsv(campaignId: string, csvText: string): Promise<AttendanceImportResult> {
  const rows = parseCsvText(csvText);
  const headerIndex = rows.findIndex((r) => r.some((c) => c.toLowerCase().includes('email')));
  if (headerIndex < 0) return { ok: false, error: 'Could not find a column containing "email" in this file.' };

  const headers = rows[headerIndex].map((h) => h.trim().toLowerCase());
  const ci = {
    email: pickCol(headers, ['email']),
    name: pickCol(headers, ['name']),
    duration: pickCol(headers, ['duration', 'minutes']),
  };
  if (ci.email < 0) return { ok: false, error: 'No email column detected.' };

  const emailToDuration = new Map<string, number>();
  for (const r of rows.slice(headerIndex + 1)) {
    const email = (r[ci.email] ?? '').trim().toLowerCase();
    if (!email || !email.includes('@')) continue;
    const duration = ci.duration >= 0 ? parseInt(r[ci.duration] ?? '0', 10) || 0 : 0;
    emailToDuration.set(email, Math.max(emailToDuration.get(email) ?? 0, duration));
  }

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

  // Queue the real attend/no-show sends for whichever of those steps are enabled.
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
