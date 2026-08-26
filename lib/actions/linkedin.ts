'use server';

import { db } from '@/lib/db';
import { revalidateCampaign } from '@/lib/revalidate';
import { normalizeLinkedInSlug } from '@/lib/linkedinUrl';
import { upsertAttentionItem } from '@/lib/attentionItems';
import { verifyContactsForLinkedIn } from '@/lib/apolloVerify';
import { resolveIntegrationField } from '@/lib/integrationConfig';

const STEP_KEY = 'linkedin';

// LinkedIn touches are tracked as real CadenceSend rows so the queue survives a
// refresh and the Schedule/Dashboard step counters reflect it — same model every
// other cadence step uses. Nothing here calls LinkedIn and nothing here automates
// it either: sends happen when a human confirms them in the queue, after Apollo
// verification has labeled each recipient.
export async function markLinkedInSendAction(campaignId: string, contactId: string, status: 'sent' | 'skipped'): Promise<{ ok: boolean; error?: string }> {
  const contact = await db.contact.findUnique({ where: { id: contactId }, select: { id: true } });
  if (!contact) return { ok: false, error: 'Contact no longer exists.' };

  // Upsert (not findFirst+create): two rapid calls for the same contact raced
  // the unique constraint and the loser crashed with an unhandled P2002.
  await db.cadenceSend.upsert({
    where: { campaignId_contactId_stepKey: { campaignId, contactId, stepKey: STEP_KEY } },
    update: { status, sentAt: status === 'sent' ? new Date() : null, error: null },
    create: { campaignId, contactId, stepKey: STEP_KEY, dueAt: new Date(), status, sentAt: status === 'sent' ? new Date() : null, error: null },
  });

  // Optional mapped-activity hook on manual LinkedIn confirmation too.
  if (status === 'sent') {
    try {
      const contact = await db.contact.findUnique({ where: { id: contactId }, select: { lsqLeadId: true, name: true } });
      if (contact?.lsqLeadId) {
        const { postSentActivityIfMapped } = await import('@/lib/channelDelivery');
        await postSentActivityIfMapped({
          channel: 'linkedin',
          lsqLeadId: contact.lsqLeadId,
          campaignName: '',
          stepKey: STEP_KEY,
          note: `LinkedIn touch confirmed sent to ${contact.name}`,
        });
      }
    } catch {
      /* mapping hook is best-effort */
    }
  }

  revalidateCampaign(campaignId);
  return { ok: true };
}


/**
 * Saves a pasted LinkedIn profile URL so the next open lands on the person
 * instead of a name search. Stores the normalized slug in Contact.linkedinId
 * (the column already exists and is what the CSV importer fills).
 */
export async function setLinkedInProfileAction(
  campaignId: string,
  contactId: string,
  raw: string
): Promise<{ ok: true; slug: string } | { ok: false; error: string }> {
  const slug = normalizeLinkedInSlug(raw);
  if (!slug) {
    return { ok: false, error: "That doesn't look like a profile URL — expected something like linkedin.com/in/their-name" };
  }
  await db.contact.update({ where: { id: contactId }, data: { linkedinId: slug } });
  revalidateCampaign(campaignId);
  return { ok: true, slug };
}

export async function getLinkedInProgressAction(campaignId: string) {
  const sends = await db.cadenceSend.findMany({ where: { campaignId, stepKey: STEP_KEY }, select: { contactId: true, status: true } });
  return Object.fromEntries(sends.map((s) => [s.contactId, s.status]));
}

// --- Apollo self-verification -------------------------------------------------

const CHECK_TTL_MS = 7 * 24 * 60 * 60 * 1000; // re-verify anything older than a week

/**
 * Runs the Apollo people-match gate over every approved contact that still has
 * a pending LinkedIn touch and no fresh verdict (never checked, or checked
 * more than 7 days ago). Persists status + note + timestamp per contact.
 */
export async function verifyLinkedInQueueAction(
  campaignId: string
): Promise<{ ok: boolean; verified?: number; mismatch?: number; notFound?: number; errors?: number; skippedAlreadyFresh?: number; usedLiveApi?: boolean; error?: string }> {
  try {
    const sent = await db.cadenceSend.findMany({ where: { campaignId, stepKey: STEP_KEY, status: 'sent' }, select: { contactId: true } });
    const sentIds = new Set(sent.map((s) => s.contactId));

    const now = Date.now();
    const candidates = (
      await db.contact.findMany({
        where: { campaignId, approved: true },
        select: { id: true, name: true, title: true, account: true, linkedinCheckedAt: true },
      })
    ).filter((c) => !sentIds.has(c.id) && (!c.linkedinCheckedAt || now - c.linkedinCheckedAt.getTime() > CHECK_TTL_MS));

    if (candidates.length === 0) {
      const fresh = await db.contact.count({
        where: { campaignId, approved: true, linkedinCheckStatus: { not: null }, linkedinCheckedAt: { gt: new Date(now - CHECK_TTL_MS) } },
      });
      return { ok: true, verified: 0, mismatch: 0, notFound: 0, errors: 0, skippedAlreadyFresh: fresh, usedLiveApi: false };
    }

    const { results, usedLiveApi } = await verifyContactsForLinkedIn(
      candidates.map((c) => ({ id: c.id, name: c.name, title: c.title ?? '', account: c.account })),
      { apiKey: (await resolveIntegrationField('apollo', 'apiKey')) || process.env.APOLLO_API_KEY || '' }
    );

    let verified = 0;
    let mismatch = 0;
    let notFound = 0;
    let errors = 0;
    await db.$transaction(
      candidates.map((c) => {
        const r = results.get(c.id) ?? { status: 'error' as const, note: 'No verdict returned.' };
        if (r.status === 'verified') verified++;
        else if (r.status === 'mismatch') mismatch++;
        else if (r.status === 'not_found') notFound++;
        else errors++;
        return db.contact.update({
          where: { id: c.id },
          data: { linkedinCheckStatus: r.status, linkedinCheckNote: r.note.slice(0, 280), linkedinCheckedAt: new Date() },
        });
      })
    );

    const summary = `Apollo verification: ${verified} verified · ${mismatch} job-changed · ${notFound} not found · ${errors} lookup errors${usedLiveApi ? '' : ' (no API key — all marked verified-with-note)'}`;
    await db.activityLogEntry.create({
      data: { campaignId, text: summary, dot: errors > 0 || mismatch + notFound > 0 ? 'var(--warning-700)' : 'var(--success-500)' },
    });
    if (mismatch + notFound > 0) {
      await upsertAttentionItem(campaignId, {
        icon: 'ErrorProperty1Outline',
        color: 'warning',
        title: `${mismatch + notFound} contact(s) failed Apollo verification`,
        detail: 'They were removed from the automated LinkedIn queue — check their badges on the Schedule tab before reaching out manually.',
        actionsCsv: 'view',
      });
    }
    await revalidateCampaign(campaignId);
    return { ok: true, verified, mismatch, notFound, errors, skippedAlreadyFresh: 0, usedLiveApi };
  } catch (err) {
    return { ok: false, error: String(err instanceof Error ? err.message : err).slice(0, 300) };
  }
}
