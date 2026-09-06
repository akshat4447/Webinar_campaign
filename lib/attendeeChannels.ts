import { db } from '@/lib/db';

// Classifies attendees by which channel their invite went out on — the three
// built-in invite steps are each a distinct channel (see lib/demo-data.ts's
// step catalogue), so a "sent" CadenceSend row for one of these keys IS the
// record of how that contact was invited.
//
// Not mutually exclusive: a contact invited on more than one channel (e.g.
// email AND SMS, both enabled) counts under each, so per-channel counts can
// add up to more than the total attendee count. That's intentional — this
// answers "how many attendees came in through channel X", not "what was each
// attendee's one true channel".
const INVITE_STEP_CHANNEL: Record<string, string> = {
  invite: 'Email',
  smsInvite: 'SMS',
  waInvite: 'WhatsApp',
};

export interface AttendeeChannelStat {
  label: string;
  attended: number;
  pctOfAttendees: number;
}

async function computeBreakdown(campaignFilter: string | { in: string[] }): Promise<AttendeeChannelStat[]> {
  const [sends, attendedContacts] = await Promise.all([
    db.cadenceSend.findMany({
      where: { campaignId: campaignFilter, stepKey: { in: Object.keys(INVITE_STEP_CHANNEL) }, status: 'sent' },
      select: { contactId: true, stepKey: true },
    }),
    db.contact.findMany({ where: { campaignId: campaignFilter, attended: true }, select: { id: true } }),
  ]);

  const attendedIds = new Set(attendedContacts.map((c) => c.id));
  const totalAttended = attendedIds.size;
  if (totalAttended === 0) return [];

  const byChannel = new Map<string, Set<string>>();
  for (const s of sends) {
    if (!attendedIds.has(s.contactId)) continue;
    const channel = INVITE_STEP_CHANNEL[s.stepKey];
    const set = byChannel.get(channel) ?? new Set<string>();
    set.add(s.contactId);
    byChannel.set(channel, set);
  }

  return Object.values(INVITE_STEP_CHANNEL)
    .map((label) => {
      const attended = byChannel.get(label)?.size ?? 0;
      return { label, attended, pctOfAttendees: Math.round((attended / totalAttended) * 100) };
    })
    .filter((c) => c.attended > 0)
    .sort((a, b) => b.attended - a.attended);
}

/** One campaign's attendees, classified by invite channel. */
export function getAttendeeChannelBreakdown(campaignId: string): Promise<AttendeeChannelStat[]> {
  return computeBreakdown(campaignId);
}

/** Same classification, summed across every campaign in the given set — for
 *  the cross-campaign dashboard. Contact ids never cross campaigns, so this
 *  is a plain aggregate, not a per-campaign computation repeated and merged. */
export function getAttendeeChannelBreakdownAcrossCampaigns(campaignIds: string[]): Promise<AttendeeChannelStat[]> {
  if (campaignIds.length === 0) return Promise.resolve([]);
  return computeBreakdown({ in: campaignIds });
}
