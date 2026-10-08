import { db } from '@/lib/db';
import { verifyRegistrationToken } from '@/lib/registration';

/** Resolve the contact as well as the signature; a valid invite is not an attendee record. */
export async function getAttendee(token: string | null, campaignId?: string) {
  if (!token) return null;
  const verified = verifyRegistrationToken(token);
  if (!verified.ok || (campaignId && verified.payload.campaignId !== campaignId)) return null;
  const contact = await db.contact.findFirst({ where: { id: verified.payload.contactId, campaignId: verified.payload.campaignId, registeredAt: { not: null } }, include: { campaign: { include: { speakers: { orderBy: [{ order: 'asc' }, { id: 'asc' }] } } } } });
  if (!contact) return null;
  const joinUrl = contact.zoomJoinUrl || (!contact.campaign.zoomMeetingId ? contact.campaign.zoomLink : null);
  return { contact, campaign: contact.campaign, joinUrl };
}
