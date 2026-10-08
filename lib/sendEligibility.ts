import { db } from '@/lib/db';
import { isEmailSuppressed } from '@/lib/netcore';
import { isEmailCampaignSuppressed } from '@/lib/campaignSuppression';
import { isContactEligibleForChannel, normalizeChannel } from '@/lib/channels';
/** Contact-wide exclusions are enforced before routing to any provider. */
export async function sendEligibility(campaignId: string, contact: { email: string | null; phone?: string | null; lsqLeadId?: string | null; smsOptOut?: boolean; whatsappOptIn?: boolean; emailSimulated?: boolean; emailVerified?: boolean; unsubscribedAt?: Date | null }, channel: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (contact.unsubscribedAt) return { ok: false, reason: 'Contact unsubscribed — send skipped' };
  if (normalizeChannel(channel) === 'sms' && contact.smsOptOut) return {ok:false,reason:'Contact has opted out of SMS'};
  if (!isContactEligibleForChannel({ ...contact, phone: contact.phone ?? null, whatsappOptIn: contact.whatsappOptIn ?? false, emailSimulated: contact.emailSimulated ?? false, emailVerified: contact.emailVerified ?? false }, channel)) return { ok: false, reason: `Missing destination, verification, or consent for ${normalizeChannel(channel)}.` };
  if (contact.email) {
    const global = await isEmailSuppressed(contact.email);
    if (global) return { ok: false, reason: `Email suppressed (${global.reason}): ${global.detail || 'refused'}` };
    const local = await isEmailCampaignSuppressed(campaignId, contact.email);
    if (local) return { ok: false, reason: `Campaign exclusion: ${local.matchPattern}.` };
  }
  if (contact.lsqLeadId) {
    const row = await db.appSetting.findUnique({ where: { key: `exclusion.snapshot.${campaignId}` } });
    if (row && (JSON.parse(row.value) as { leadIds?: string[] }).leadIds?.includes(contact.lsqLeadId)) return { ok: false, reason: 'Contact belongs to a LeadSquared exclusion list.' };
  }
  return { ok: true };
}
