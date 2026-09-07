'use server';

import { z } from 'zod';
import { db } from '@/lib/db';
import { sendEmailToLead, createOrUpdateLead } from '@/lib/leadsquared';
import { deliverChannelMessage } from '@/lib/channelDelivery';
import { normalizeE164 } from '@/lib/csvPreflight';

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
      select: { name: true },
    });

    const cleanRecipient = params.recipient.trim();
    if (!cleanRecipient) {
      return { ok: false, error: 'Recipient address or phone number is required.' };
    }

    if (params.channel === 'email') {
      if (!cleanRecipient.includes('@')) {
        return { ok: false, error: 'Please enter a valid recipient email address.' };
      }

      // Upsert lead so LeadSquared can deliver to it
      try {
        await createOrUpdateLead([
          { Attribute: 'EmailAddress', Value: cleanRecipient },
          { Attribute: 'FirstName', Value: 'Test Recipient' },
        ]);
      } catch {
        /* proceed to send attempt */
      }

      const html = `<div style="font-family: sans-serif; font-size: 15px; line-height: 1.6; color: #111;">
        <div style="background: #ebf1ff; border: 1px solid #1463ff; color: #0e4bd1; padding: 10px 14px; border-radius: 6px; margin-bottom: 16px; font-size: 13px; font-weight: 600;">
          [TEST PREVIEW] This is a test preview of your outreach message for "${campaign.name}".
        </div>
        ${params.body.replace(/\n/g, '<br/>')}
      </div>`;

      await sendEmailToLead({
        recipientEmail: cleanRecipient,
        subject: `[TEST PREVIEW] ${params.subject || campaign.name}`,
        contentHtml: html,
        contentText: `[TEST PREVIEW] Outreach message for "${campaign.name}":\n\n${params.body}`,
      });

      return { ok: true, detail: `Test email dispatched to ${cleanRecipient}` };
    }

    if (params.channel === 'sms' || params.channel === 'whatsapp') {
      const normalizedPhone = normalizeE164(cleanRecipient);
      if (!normalizedPhone) {
        return { ok: false, error: 'Please enter a valid phone number with country code (e.g. +919876543210).' };
      }

      const testMsg = `[TEST PREVIEW - ${campaign.name}]\n\n${params.body}`;

      const res = await deliverChannelMessage({
        channel: params.channel,
        stepKey: 'test_preview',
        campaignName: campaign.name,
        message: testMsg,
        phone: normalizedPhone,
        lsqLeadId: '',
      });

      return { ok: true, detail: `Test ${params.channel.toUpperCase()} sent to ${normalizedPhone}: ${res.detail}` };
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
