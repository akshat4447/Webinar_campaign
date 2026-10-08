

import { db } from '@/lib/db';
import { scoreContacts } from '@/lib/claude';
import { upsertAttentionItem, resolveAttentionItems } from '@/lib/attentionItems';
import { revalidateCampaign } from '@/lib/revalidate';

import { assertSetupEditable } from '@/lib/setupLock';
import { z } from 'zod';

const campaignIdSchema = z.string().min(1);

export async function runScoringBatch(campaignId: string, contactIds?: string[]) {
  const validCampaignId = campaignIdSchema.parse(campaignId);
  await assertSetupEditable(validCampaignId);
  const campaign = await db.campaign.findUniqueOrThrow({ where: { id: validCampaignId } });
  const contacts = await db.contact.findMany({ where: { campaignId: validCampaignId, ...(contactIds ? { id: { in: contactIds } } : {}) } });
  if (contacts.length === 0) return { ok: false, error: 'No contacts imported yet — import a contact list on the Audience tab first.' };

  try {
    const { results, failedBatches } = await scoreContacts(
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
    const validIds = new Set(contacts.map((c) => c.id));
    const validResults = results.filter((r) => validIds.has(r.id));
    const manuallySet = new Set(contacts.filter((c) => c.approvedManually).map((c) => c.id));
    await db.$transaction(
      validResults.map((r) =>
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
    const preserved = validResults.filter((r) => manuallySet.has(r.id)).length;

    await db.activityLogEntry.create({
      data: {
        campaignId,
        text: `Claude scored ${validResults.length} contacts against "${campaign.name}"${preserved > 0 ? ` — kept ${preserved} manually-set approval${preserved === 1 ? '' : 's'} as-is` : ''}${
          failedBatches > 0 ? ` — ${failedBatches} batch${failedBatches === 1 ? '' : 'es'} returned no usable output and were left unscored` : ''
        }`,
        dot: failedBatches > 0 ? 'var(--warning-700)' : 'var(--accent-500)',
      },
    });

    // A dropped batch used to just vanish silently, leaving those contacts
    // unscored with nothing telling the operator a re-run is needed.
    if (failedBatches > 0) {
      await upsertAttentionItem(campaignId, {
        icon: 'ErrorProperty1Outline',
        color: 'warning',
        title: 'Audience scoring incomplete',
        detail: `${failedBatches} batch${failedBatches === 1 ? '' : 'es'} of contacts got no usable output from Claude and were left unscored this run — re-run scoring to pick them up.`,
        actionsCsv: 'retry',
      });
    } else {
      await resolveAttentionItems(campaignId, ['Audience scoring incomplete']);
    }

    await resolveAttentionItems(campaignId, ['Audience scoring failed']);
    revalidateCampaign(campaignId);
    return { ok: true, scoredCount: validResults.length, preservedManualApprovals: preserved, failedBatches };
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
