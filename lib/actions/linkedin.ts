'use server';

import { db } from '@/lib/db';
import { revalidateCampaign } from '@/lib/revalidate';

const STEP_KEY = 'linkedin';

// LinkedIn touches are tracked as real CadenceSend rows so the queue survives a
// refresh and the Schedule/Dashboard step counters reflect it — same model every
// other cadence step uses. Nothing here calls LinkedIn: "assisted" records what a
// human did by hand, "automated" is an explicitly simulated batch (see below).
export async function markLinkedInSendAction(campaignId: string, contactId: string, status: 'sent' | 'skipped', viaBot: boolean) {
  const existing = await db.cadenceSend.findFirst({ where: { campaignId, contactId, stepKey: STEP_KEY } });
  const data = { status, sentAt: status === 'sent' ? new Date() : null, error: viaBot ? 'Simulated bot send — no real LinkedIn API call was made' : null };

  if (existing) {
    await db.cadenceSend.update({ where: { id: existing.id }, data });
  } else {
    await db.cadenceSend.create({ data: { campaignId, contactId, stepKey: STEP_KEY, dueAt: new Date(), ...data } });
  }
  revalidateCampaign(campaignId);
}

/** Persists the chosen outreach mode so it survives a reload and is auditable. */
export async function setLinkedInModeAction(campaignId: string, mode: 'assisted' | 'automated', queueSize: number) {
  const campaign = await db.campaign.findUniqueOrThrow({ where: { id: campaignId }, select: { linkedinMode: true } });
  if (campaign.linkedinMode === mode) return;

  await db.campaign.update({ where: { id: campaignId }, data: { linkedinMode: mode } });
  await db.activityLogEntry.create({
    data: {
      campaignId,
      text:
        mode === 'assisted'
          ? `LinkedIn outreach set to manual send — ${queueSize} drafts queued for a human to copy and send`
          : `LinkedIn outreach set to automated bot (simulated) — ${queueSize} drafts queued; no real LinkedIn calls are made in this build`,
      dot: mode === 'assisted' ? 'var(--accent-500)' : 'var(--warning-700)',
    },
  });
  revalidateCampaign(campaignId);
}

export async function getLinkedInProgressAction(campaignId: string) {
  const sends = await db.cadenceSend.findMany({ where: { campaignId, stepKey: STEP_KEY }, select: { contactId: true, status: true } });
  return Object.fromEntries(sends.map((s) => [s.contactId, s.status]));
}
