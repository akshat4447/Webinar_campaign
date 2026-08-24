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

    // Contacts a human has explicitly approved/unapproved (approvedManually, set
    // by setApprovalAction / bulkSetApprovalAction) keep their approval as-is —
    // a re-score used to silently overwrite that decision with the threshold
    // verdict on every run. The score and explanation still refresh either way.
    const manuallySet = new Set(contacts.filter((c) => c.approvedManually).map((c) => c.id));
    await db.$transaction(
      results.map((r) =>
        db.contact.update({
          where: { id: r.id },
          data: {
            score: r.score,
            explanation: r.explanation,
            ...(manuallySet.has(r.id) ? {} : { approved: r.score >= campaign.scoringThreshold }),
          },
        })
      )
    );
    const preserved = results.filter((r) => manuallySet.has(r.id)).length;

    await db.activityLogEntry.create({
      data: {
        campaignId,
        text: `Claude scored ${results.length} contacts against "${campaign.name}"${preserved > 0 ? ` — kept ${preserved} manually-set approval${preserved === 1 ? '' : 's'} as-is` : ''}`,
        dot: 'var(--accent-500)',
      },
    });

    revalidateCampaign(campaignId);
    return { ok: true, scoredCount: results.length, preservedManualApprovals: preserved };
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
  // The Scoring tab's slider already clamps to 0–100 client-side, but the
  // server action is the actual boundary — clamp here too rather than trusting
  // the UI never sends anything else.
  const threshold = data.threshold !== undefined ? Math.max(0, Math.min(100, Math.round(data.threshold))) : undefined;

  await db.campaign.update({
    where: { id: campaignId },
    data: {
      ...(data.prompt !== undefined ? { scoringPrompt: data.prompt } : {}),
      ...(data.criteria !== undefined ? { scoringCriteria: data.criteria } : {}),
      ...(threshold !== undefined ? { scoringThreshold: threshold } : {}),
    },
  });
  revalidateCampaign(campaignId);
}

// approvedManually marks this contact's approval as a human decision — a
// later re-score (runScoringAction above) leaves it alone instead of
// overwriting it with the AI's threshold verdict.
export async function setApprovalAction(contactId: string, approved: boolean) {
  await db.contact.update({ where: { id: contactId }, data: { approved, approvedManually: true } });
}

export async function bulkSetApprovalAction(contactIds: string[], approved: boolean) {
  await db.contact.updateMany({ where: { id: { in: contactIds } }, data: { approved, approvedManually: true } });
}
