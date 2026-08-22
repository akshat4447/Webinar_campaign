'use server';

import { db } from '@/lib/db';
import { scoreContacts } from '@/lib/claude';
import { upsertAttentionItem } from '@/lib/attentionItems';
import { revalidateCampaign } from '@/lib/revalidate';

export async function runScoringAction(campaignId: string) {
  const campaign = await db.campaign.findUniqueOrThrow({ where: { id: campaignId } });
  const contacts = await db.contact.findMany({ where: { campaignId } });
  if (contacts.length === 0) return { ok: false, error: 'No contacts imported yet — go to Setup first.' };

  try {
    const results = await scoreContacts(
      campaign.name,
      campaign.vertical,
      campaign.scoringPrompt,
      campaign.scoringCriteria,
      contacts.map((c) => ({
        id: c.id,
        name: c.name,
        title: c.title,
        function: c.function,
        seniority: c.seniority,
        account: c.account,
        vertical: c.vertical,
        missingInfo: c.missingInfo,
      }))
    );

    await db.$transaction(
      results.map((r) =>
        db.contact.update({
          where: { id: r.id },
          data: { score: r.score, explanation: r.explanation, approved: r.score >= campaign.scoringThreshold },
        })
      )
    );

    await db.activityLogEntry.create({
      data: { campaignId, text: `Claude scored ${results.length} contacts against "${campaign.name}"`, dot: 'var(--accent-500)' },
    });

    revalidateCampaign(campaignId);
    return { ok: true, scoredCount: results.length };
  } catch (err) {
    await upsertAttentionItem(campaignId, {
      icon: 'ErrorProperty1Outline',
      color: 'error',
      title: 'Audience scoring failed',
      detail: String(err).slice(0, 300),
      actionsCsv: 'retry',
    });
    return { ok: false, error: String(err) };
  }
}

export async function updateScoringConfigAction(campaignId: string, data: { prompt?: string; criteria?: string; threshold?: number }) {
  await db.campaign.update({
    where: { id: campaignId },
    data: {
      ...(data.prompt !== undefined ? { scoringPrompt: data.prompt } : {}),
      ...(data.criteria !== undefined ? { scoringCriteria: data.criteria } : {}),
      ...(data.threshold !== undefined ? { scoringThreshold: data.threshold } : {}),
    },
  });
  revalidateCampaign(campaignId);
}

export async function setApprovalAction(contactId: string, approved: boolean) {
  await db.contact.update({ where: { id: contactId }, data: { approved } });
}

export async function bulkSetApprovalAction(contactIds: string[], approved: boolean) {
  await db.contact.updateMany({ where: { id: { in: contactIds } }, data: { approved } });
}
