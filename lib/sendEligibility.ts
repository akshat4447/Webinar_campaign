import { db } from '@/lib/db';
import { isEmailSuppressed } from '@/lib/netcore';
import { isEmailCampaignSuppressed } from '@/lib/campaignSuppression';
import { isContactEligibleForChannel, normalizeChannel } from '@/lib/channels';
import { loadSuppressionListMembers, isHeldBySuppressionList } from '@/lib/lsqExclusions';
/** Contact-wide exclusions are enforced before routing to any provider. */
export async function sendEligibility(campaignId: string, contact: { email: string | null; phone?: string | null; lsqLeadId?: string | null; smsOptOut?: boolean; whatsappOptIn?: boolean; emailSimulated?: boolean; emailVerified?: boolean; unsubscribedAt?: Date | null; registeredAt?: Date | null }, channel: string): Promise<{ ok: true } | { ok: false; reason: string }> {
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
  // On the attached suppression list already, and has not registered: held back (see lib/lsqExclusions.ts).
  if (!contact.registeredAt && (contact.lsqLeadId || contact.email)) {
    if (isHeldBySuppressionList(await loadSuppressionListMembers(campaignId), contact)) return { ok: false, reason: "Contact is already on this webinar's LeadSquared suppression list." };
  }
  return { ok: true };
}

/**
 * Who, among these contacts, must be sent nothing on any channel: the same rules sendEligibility applies to one send, decided in bulk
 * for the places that choose people from a list (the LinkedIn queue and dispatch). Unsubscribed, on the global suppression list,
 * excluded for this webinar (a pattern or a LeadSquared exclusion list), or already on the webinar's suppression list without having
 * registered.
 */
export async function excludedContactIds(
  campaignId: string,
  contacts: Array<{ id: string; email: string | null; lsqLeadId?: string | null; unsubscribedAt?: Date | null; registeredAt?: Date | null }>,
): Promise<Set<string>> {
  const out = new Set<string>();
  if (contacts.length === 0) return out;

  const emails = [...new Set(contacts.map((c) => c.email?.trim().toLowerCase()).filter((e): e is string => Boolean(e)))];
  const [globalRows, campaignRows, snapshot, members] = await Promise.all([
    emails.length ? db.emailSuppression.findMany({ where: { email: { in: emails } }, select: { email: true } }) : Promise.resolve([]),
    db.campaignSuppression.findMany({ where: { campaignId }, select: { email: true } }),
    db.appSetting.findUnique({ where: { key: `exclusion.snapshot.${campaignId}` } }),
    loadSuppressionListMembers(campaignId),
  ]);
  const globalSuppressed = new Set(globalRows.map((r) => r.email.toLowerCase()));
  const exact = new Set(campaignRows.filter((r) => !r.email.startsWith('@')).map((r) => r.email.toLowerCase()));
  const domains = new Set(campaignRows.filter((r) => r.email.startsWith('@')).map((r) => r.email.toLowerCase()));
  let excludedLeadIds = new Set<string>();
  try {
    excludedLeadIds = new Set((JSON.parse(snapshot?.value ?? '{}') as { leadIds?: string[] }).leadIds ?? []);
  } catch {
    // an unreadable snapshot excludes nobody by lead id; the email rules above still apply
  }

  for (const c of contacts) {
    const email = c.email?.trim().toLowerCase() ?? '';
    const domain = email.includes('@') ? `@${email.split('@')[1]}` : '';
    if (
      c.unsubscribedAt ||
      (email && (globalSuppressed.has(email) || exact.has(email) || (domain && domains.has(domain)))) ||
      (c.lsqLeadId && excludedLeadIds.has(c.lsqLeadId)) ||
      isHeldBySuppressionList(members, c)
    ) out.add(c.id);
  }
  return out;
}
