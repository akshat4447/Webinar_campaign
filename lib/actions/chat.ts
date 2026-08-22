'use server';

import { db } from '@/lib/db';
import { chatReply } from '@/lib/claude';

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

  try {
    return await chatReply(contextJson, history, message);
  } catch (err) {
    return `I hit an error reaching Claude: ${String(err).slice(0, 200)}`;
  }
}
