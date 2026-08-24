'use server';

import { db } from '@/lib/db';
import { chatReply } from '@/lib/claude';

// ChatMessage rows were being written by the schema (a campaignId FK, a
// Campaign.chatMessages relation) but nothing ever inserted into the table —
// history lived only in ChatWidget's React state, so it vanished on every
// navigation between tabs. This now persists both sides of the conversation
// whenever there's a campaign to attach them to (the table requires one; the
// landing-page-level chat with no campaignId stays session-only, same as before).
export async function getChatHistoryAction(campaignId: string): Promise<{ from: 'agent' | 'user'; text: string }[]> {
  const messages = await db.chatMessage.findMany({
    where: { campaignId },
    orderBy: { createdAt: 'asc' },
    select: { from: true, text: true },
  });
  return messages.map((m) => ({ from: m.from as 'agent' | 'user', text: m.text }));
}

export async function chatReplyAction(campaignId: string | null, history: { from: 'agent' | 'user'; text: string }[], message: string): Promise<string> {
  let contextJson: string;

  if (campaignId) {
    const [campaign, contactCount, approvedCount, attendedCount, sendCounts, attentionCount] = await Promise.all([
      db.campaign.findUnique({ where: { id: campaignId } }),
      db.contact.count({ where: { campaignId } }),
      db.contact.count({ where: { campaignId, approved: true } }),
      db.contact.count({ where: { campaignId, attended: true } }),
      db.cadenceSend.groupBy({ by: ['stepKey', 'status'], where: { campaignId }, _count: true }),
      db.attentionItem.count({ where: { campaignId, resolvedAt: null } }),
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

  if (campaignId) await db.chatMessage.create({ data: { campaignId, from: 'user', text: message } });

  let reply: string;
  try {
    reply = await chatReply(contextJson, history, message);
  } catch (err) {
    reply = `I hit an error reaching Claude: ${String(err).slice(0, 200)}`;
  }

  if (campaignId) await db.chatMessage.create({ data: { campaignId, from: 'agent', text: reply } });
  return reply;
}
