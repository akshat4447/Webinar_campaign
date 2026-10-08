'use server';
import { db } from '@/lib/db';
import { processBroadcastJob } from '@/lib/broadcast';
import { revalidateCampaign } from '@/lib/revalidate';
import { z } from 'zod';
export interface BroadcastReminderInput {
  channel: 'email' | 'whatsapp' | 'sms' | 'all'; subject?: string; message: string; testMode?: boolean; testRecipientEmail?: string;
}
export interface BroadcastReminderResult {
  ok: boolean; sentCount: number; failedCount: number; totalEligible: number; error?: string; skippedCount?: number; queuedCount?: number; jobId?: string; status?: string;
}
const schema = z.object({ channel: z.enum(['email','whatsapp','sms','all']), subject: z.string().max(300).optional(), message: z.string().trim().min(1).max(10_000), testMode: z.boolean().optional(), testRecipientEmail: z.email().optional() });
export async function broadcastWebinarReminderAction(campaignId: string, input: BroadcastReminderInput): Promise<BroadcastReminderResult> {
  try {
    const parsed = schema.parse(input);
    if (parsed.testMode && (parsed.channel !== 'email' || !parsed.testRecipientEmail)) throw new Error('A preview requires the email channel and an explicit test recipient.');
    const campaign = await db.campaign.findUniqueOrThrow({ where: { id: campaignId } });
    if (campaign.status === 'completed' || campaign.archived || campaign.cadenceStatus === 'stopped') throw new Error('This webinar is closed.');
    const contacts = await db.contact.findMany({ where: { campaignId, registeredAt: { not: null } }, select: { id: true }, orderBy: { id: 'asc' } });
    if (!contacts.length) throw new Error('No registered attendees found.');
    const contactIds = (parsed.testMode ? contacts.slice(0,1) : contacts).map(c => c.id);
    const job = await db.operationJob.create({ data: { campaignId, kind: 'broadcast', payloadJson: JSON.stringify({ input: parsed, contactIds }), total: contactIds.length } });
    const result = await processBroadcastJob(job.id);
    revalidateCampaign(campaignId);
    return result;
  } catch (error) { return { ok: false, sentCount: 0, failedCount: 0, totalEligible: 0, error: error instanceof Error ? error.message : String(error) }; }
}
