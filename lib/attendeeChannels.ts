import { Prisma } from '@/lib/generated/prisma/client';
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
  const campaignIds=typeof campaignFilter==='string'?[campaignFilter]:campaignFilter.in;
  if(!campaignIds.length)return [];
  const [totals,channels]=await Promise.all([
    db.contact.count({where:{campaignId:{in:campaignIds},attended:true}}),
    db.$queryRaw<Array<{stepKey:string;attended:number}>>(Prisma.sql`SELECT s."stepKey",count(DISTINCT c.id)::int AS attended FROM "Contact" c JOIN "CadenceSend" s ON s."contactId"=c.id AND s."campaignId"=c."campaignId" WHERE c."campaignId" IN (${Prisma.join(campaignIds)}) AND c.attended AND s.status='sent' AND s."stepKey" IN ('invite','smsInvite','waInvite') GROUP BY s."stepKey"`),
  ]);
  return channels.map(c=>({label:INVITE_STEP_CHANNEL[c.stepKey],attended:c.attended,pctOfAttendees:totals?Math.round(c.attended/totals*100):0})).filter(c=>c.attended>0).sort((a,b)=>b.attended-a.attended);
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
