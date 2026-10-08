'use server';

import { z } from 'zod';
import { db } from '@/lib/db';
import { sendEmailToLead, createOrUpdateLead } from '@/lib/leadsquared';
import { deliverChannelMessage } from '@/lib/channelDelivery';
import { normalizeE164 } from '@/lib/csvPreflight';
import { resolveRecipient } from '@/lib/sendGuard';
import { isEmailSuppressed } from '@/lib/netcore';
import { isEmailCampaignSuppressed } from '@/lib/campaignSuppression';
import { sendEligibility } from '@/lib/sendEligibility';
import { refreshLsqExclusions } from '@/lib/lsqExclusions';
import type { Contact } from '@/lib/generated/prisma/client';

const campaignIdSchema = z.string().min(1);

export async function sendTestMessageAction(params: {
  campaignId: string;
  channel: 'email' | 'linkedin' | 'sms' | 'whatsapp';
  recipient: string;
  subject?: string | null;
  body: string;
}): Promise<{ ok: boolean; detail?: string; error?: string }> {
  try {
    const campaignId = campaignIdSchema.parse(params.campaignId);
    const campaign = await db.campaign.findUniqueOrThrow({
      where: { id: campaignId },
      select: { name: true, emailProvider: true },
    });

    const cleanRecipient = params.recipient.trim();
    if (!cleanRecipient) {
      return { ok: false, error: 'Recipient address or phone number is required.' };
    }

    // Previews are real messages and cannot bypass a known contact's consent.
    await refreshLsqExclusions(campaignId);
    let known: Contact[] = [];
    if (params.channel === 'email') known = await db.contact.findMany({ where: { campaignId, email: { equals: cleanRecipient, mode: 'insensitive' } } });
    else if (params.channel === 'sms' || params.channel === 'whatsapp') {
      const digits = (normalizeE164(cleanRecipient) || '').replace(/\D/g, '');
      if (digits) known = await db.$queryRaw<Contact[]>`SELECT * FROM "Contact" WHERE "campaignId" = ${campaignId} AND regexp_replace(COALESCE("phone", ''), '[^0-9]', '', 'g') = ${digits}`;
    }
    for (const contact of known) {
      const eligible = await sendEligibility(campaignId, contact, params.channel);
      if (!eligible.ok) return { ok: false, error: eligible.reason };
    }

    if (params.channel === 'email') {
      if (!cleanRecipient.includes('@')) {
        return { ok: false, error: 'Please enter a valid recipient email address.' };
      }

      // Check webinar-specific suppression list
      const campSuppression = await isEmailCampaignSuppressed(campaignId, cleanRecipient);
      if (campSuppression) {
        return {
          ok: false,
          error: `${cleanRecipient} is on this webinar's suppression list (${campSuppression.reason}): excluded by pattern "${campSuppression.matchPattern}"`,
        };
      }

      const isNetcore = campaign.emailProvider === 'netcore';

      if (isNetcore) {
        const { sendNetcoreEmail } = await import('@/lib/netcore');
        const html = `<div style="font-family: sans-serif; font-size: 15px; line-height: 1.6; color: #111;">
          <div style="background: #ebf1ff; border: 1px solid #1463ff; color: #0e4bd1; padding: 10px 14px; border-radius: 6px; margin-bottom: 16px; font-size: 13px; font-weight: 600;">
            [TEST PREVIEW - NETCORE CLOUD] This is a test preview of your outreach message for "${campaign.name}".
          </div>
          ${params.body.replace(/\n/g, '<br/>')}
        </div>`;

        try {
          const netcoreRes = await sendNetcoreEmail({
            to: cleanRecipient,
            subject: `[TEST PREVIEW] ${params.subject || campaign.name}`,
            html,
            text: `[TEST PREVIEW] Outreach message for "${campaign.name}":\n\n${params.body}`,
            tags: ['test_preview'],
          });

          if (!netcoreRes.ok) {
            return { ok: false, error: netcoreRes.error ?? 'Netcore test email delivery failed.' };
          }

          return {
            ok: true,
            detail: `Test email dispatched via Netcore Cloud to ${cleanRecipient} (Message ID: ${netcoreRes.messageId})`,
          };
        } catch (netcoreErr) {
          return {
            ok: false,
            error: netcoreErr instanceof Error ? netcoreErr.message : 'Netcore delivery failed.',
          };
        }
      }

      const suppression = await isEmailSuppressed(cleanRecipient);
      if (suppression) {
        return {
          ok: false,
          error: `${cleanRecipient} is on the suppression list (${suppression.reason}): ${suppression.detail || 'refused'}`,
        };
      }

      const { email: targetEmail } = resolveRecipient(
        { email: cleanRecipient, emailSimulated: false, emailVerified: true }
      );

      // Upsert lead so LeadSquared can deliver to it
      try {
        await createOrUpdateLead([
          { Attribute: 'EmailAddress', Value: targetEmail },
        ]);
      } catch {
        /* proceed to send attempt */
      }

      const html = `<div style="font-family: sans-serif; font-size: 15px; line-height: 1.6; color: #111;">
        <div style="background: #ebf1ff; border: 1px solid #1463ff; color: #0e4bd1; padding: 10px 14px; border-radius: 6px; margin-bottom: 16px; font-size: 13px; font-weight: 600;">
          [TEST PREVIEW - LEADSQUARED] This is a test preview of your outreach message for "${campaign.name}".
        </div>
        ${params.body.replace(/\n/g, '<br/>')}
      </div>`;

      await sendEmailToLead({
        recipientEmail: targetEmail,
        subject: `[TEST PREVIEW] ${params.subject || campaign.name}`,
        contentHtml: html,
        contentText: `[TEST PREVIEW] Outreach message for "${campaign.name}":\n\n${params.body}`,
      });

      return {
        ok: true,
        detail: `Test email dispatched via LeadSquared CRM to ${targetEmail}`,
      };
    }

    if (params.channel === 'sms' || params.channel === 'whatsapp') {
      const normalizedPhone = normalizeE164(cleanRecipient);
      if (!normalizedPhone) {
        return { ok: false, error: 'Please enter a valid phone number with country code (e.g. +919876543210).' };
      }

      const targetPhone = normalizedPhone;

      const testMsg = `[TEST PREVIEW - ${campaign.name}]\n\n${params.body}`;

      const res = await deliverChannelMessage({
        channel: params.channel,
        stepKey: 'test_preview',
        campaignName: campaign.name,
        message: testMsg,
        phone: targetPhone,
        lsqLeadId: known.find(c => c.lsqLeadId)?.lsqLeadId || '',
      });

      return {
        ok: true,
        detail: `Test ${params.channel.toUpperCase()} sent to ${normalizedPhone}: ${res.detail}`,
      };
    }

    if (params.channel === 'linkedin') {
      return {
        ok: true,
        detail: 'LinkedIn outreach is assisted/manual to comply with LinkedIn terms. The message draft is verified and ready for copy-paste.',
      };
    }

    return { ok: false, error: `Unsupported channel: ${params.channel}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
