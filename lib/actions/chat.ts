'use server';

import { db } from '@/lib/db';
import { chatReply } from '@/lib/claude';
import { z } from 'zod';

const getChatHistorySchema = z.string().min(1);
const chatReplySchema = z.object({
  campaignId: z.string().min(1).nullable(),
  history: z.array(z.object({
    from: z.enum(['agent', 'user']),
    text: z.string(),
  })),
  message: z.string().min(1).max(5000),
});

// ChatMessage rows were being written by the schema (a campaignId FK, a
// Campaign.chatMessages relation) but nothing ever inserted into the table —
// history lived only in ChatWidget's React state, so it vanished on every
// navigation between tabs. This now persists both sides of the conversation
// whenever there's a campaign to attach them to (the table requires one; the
// landing-page-level chat with no campaignId stays session-only, same as before).
export async function getChatHistoryAction(campaignId: string): Promise<{ from: 'agent' | 'user'; text: string }[]> {
  const validatedId = getChatHistorySchema.parse(campaignId);
  const messages = await db.chatMessage.findMany({
    where: { campaignId: validatedId },
    orderBy: { createdAt: 'asc' },
    select: { from: true, text: true },
  });
  return messages.map((m) => ({ from: m.from as 'agent' | 'user', text: m.text }));
}

export async function chatReplyAction(campaignId: string | null, history: { from: 'agent' | 'user'; text: string }[], message: string): Promise<string> {
  const parsed = chatReplySchema.parse({ campaignId, history, message });
  const validCampaignId = parsed.campaignId;
  const validHistory = parsed.history;
  const validMessage = parsed.message;
  let contextJson: string;

  if (validCampaignId) {
    const [campaign, contactCount, approvedCount, attendedCount, sendCounts, attentionCount] = await Promise.all([
      db.campaign.findUnique({ where: { id: validCampaignId } }),
      db.contact.count({ where: { campaignId: validCampaignId } }),
      db.contact.count({ where: { campaignId: validCampaignId, approved: true } }),
      db.contact.count({ where: { campaignId: validCampaignId, attended: true } }),
      db.cadenceSend.groupBy({ by: ['stepKey', 'status'], where: { campaignId: validCampaignId }, _count: true }),
      db.attentionItem.count({ where: { campaignId: validCampaignId, resolvedAt: null } }),
    ]);
    contextJson = JSON.stringify({
      campaign,
      contactCount,
      approvedCount,
      attendedCount,
      sendCounts: sendCounts.map((s) => ({ step: s.stepKey, status: s.status, count: s._count })),
      openAttentionItems: attentionCount,
    });
  } else {
    const campaigns = await db.campaign.findMany({ select: { id: true, name: true, status: true, vertical: true, date: true } });
    contextJson = JSON.stringify({ campaigns });
  }

  if (validCampaignId) await db.chatMessage.create({ data: { campaignId: validCampaignId, from: 'user', text: validMessage } });

  let reply: string;
  try {
    reply = await chatReply(contextJson, validHistory, validMessage);
  } catch (err) {
    reply = `I hit an error reaching Claude: ${String(err).slice(0, 200)}`;
  }

  if (validCampaignId) await db.chatMessage.create({ data: { campaignId: validCampaignId, from: 'agent', text: reply } });
  return reply;
}
