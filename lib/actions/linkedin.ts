'use server';

import { db } from '@/lib/db';
import { revalidateCampaign } from '@/lib/revalidate';
import { normalizeLinkedInSlug, resolveLinkedInDestination } from '@/lib/linkedinUrl';
import { upsertAttentionItem } from '@/lib/attentionItems';
import { verifyContactsForLinkedIn, type VerificationStatus } from '@/lib/apolloVerify';
import { resolveIntegrationField } from '@/lib/integrationConfig';
import { resolveStepTemplate } from '@/lib/messageTemplates';
import { buildInviteLink } from '@/lib/inviteLink';
import { renderMergeFields } from '@/lib/mergeFields';
import { validateRenderedMessage } from '@/lib/messageValidation';
import { formatSpeakersSummary } from '@/lib/speakers';
import { appOrigin } from '@/lib/appOrigin';
import { runLinkedInProfileResolver } from '@/lib/linkedinResolver';

const STEP_KEY = 'linkedin';

// LinkedIn touches are tracked as real CadenceSend rows so the queue survives a
// refresh and the Schedule/Dashboard step counters reflect it — same model every
// other cadence step uses. Nothing here calls LinkedIn and nothing here automates
// it either: sends happen when a human confirms them in the queue, after Apollo
// verification has labeled each recipient.
export async function markLinkedInSendAction(campaignId: string, contactId: string, status: 'sent' | 'skipped'): Promise<{ ok: boolean; error?: string }> {
  const contact = await db.contact.findUnique({ where: { id: contactId, campaignId }, select: { id: true } });
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
    {
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
  await db.contact.update({ where: { id: contactId, campaignId }, data: { linkedinId: slug } });
  revalidateCampaign(campaignId);
  return { ok: true, slug };
}

export async function getLinkedInProgressAction(campaignId: string, contactIds?: string[]) {
  const sends = await db.cadenceSend.findMany({ where: { campaignId, stepKey: STEP_KEY, ...(contactIds ? {contactId:{in:contactIds}} : {}) }, select: { contactId: true, status: true } });
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
): Promise<{ ok: boolean; verified?: number; mismatch?: number; notFound?: number; errors?: number; skippedAlreadyFresh?: number; usedLiveApi?: boolean; apiError?: string; error?: string }> {
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

    const { results, usedLiveApi, apiError } = await verifyContactsForLinkedIn(
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
          data: {
            linkedinCheckStatus: r.status,
            linkedinCheckNote: r.note.slice(0, 280),
            // Transient errors should not lock contacts out of retry for 7 days
            linkedinCheckedAt: r.status === 'error' ? null : new Date(),
          },
        });
      })
    );

    const summary = `Apollo verification: ${verified} verified · ${mismatch} job-changed · ${notFound} not found · ${errors} lookup errors${apiError ? ` — ${apiError}` : ''}`;
    await db.activityLogEntry.create({
      data: { campaignId, text: summary, dot: errors > 0 || mismatch + notFound > 0 ? 'var(--warning-700)' : 'var(--success-500)' },
    });
    // A rejected/missing key isn't a quiet degradation — without this the run
    // reported "0 verified, N lookup errors" and looked like ordinary Apollo
    // misses rather than a credential the operator has to go fix.
    if (apiError) {
      await upsertAttentionItem(campaignId, {
        icon: 'ErrorProperty1Outline',
        color: 'error',
        title: 'Apollo verification could not run',
        detail: apiError,
        actionsCsv: 'fix',
      });
    }
    if (mismatch + notFound > 0) {
      await upsertAttentionItem(campaignId, {
        icon: 'ErrorProperty1Outline',
        color: 'warning',
        title: `${mismatch + notFound} contact(s) failed Apollo verification`,
        detail: 'They were removed from the automated LinkedIn queue — check their badges on the Cadence tab before reaching out manually.',
        actionsCsv: 'view',
      });
    }
    await revalidateCampaign(campaignId);
    return { ok: true, verified, mismatch, notFound, errors, skippedAlreadyFresh: 0, usedLiveApi, apiError };
  } catch (err) {
    return { ok: false, error: String(err instanceof Error ? err.message : err).slice(0, 300) };
  }
}

/**
 * Bulk-confirms LinkedIn touches for every approved, not-yet-handled contact
 * in one action — for an operator who has already sent these messages
 * manually outside the app and wants to record all of them at once instead of
 * confirming one at a time via markLinkedInSendAction.
 *
 * This does NOT send anything on LinkedIn — nothing in this codebase does,
 * to comply with LinkedIn's terms (see markLinkedInSendAction's comment
 * above). It only creates/updates CadenceSend rows as sent and pushes the
 * LeadSquared SDR activity, exactly like confirming each one individually
 * would. The caller must have already done the real sending; this must never
 * be exposed as a "dispatch" or "automated send" in the UI, since the CRM
 * activity it posts asserts real delivery.
 */
export async function dispatchAutomatedLinkedInAction(
  campaignId: string, contactIds?: string[]
): Promise<{ ok: boolean; dispatchedCount: number; error?: string }> {
  try {
    if(contactIds && (contactIds.length > 50 || contactIds.some(id=>typeof id!=='string' || !id)))throw new Error('Confirm at most 50 selected contacts at a time.');
    const campaign = await db.campaign.findUnique({
      where: { id: campaignId },
      select: { id: true, name: true },
    });
    if (!campaign) return { ok: false, dispatchedCount: 0, error: 'Campaign not found' };

    const approvedContacts = await db.contact.findMany({
      where: { campaignId, approved: true, ...(contactIds ? {id:{in:contactIds}} : {}) },
      select: { id: true, name: true, account: true, lsqLeadId: true, linkedinCheckStatus: true },
    });

    const existingSends = await db.cadenceSend.findMany({
      where: { campaignId, stepKey: STEP_KEY, ...(contactIds ? {contactId:{in:contactIds}} : {}) },
      select: { contactId: true, status: true },
    });
    const alreadyHandled = new Set(
      existingSends.filter((s) => s.status === 'sent' || s.status === 'skipped').map((s) => s.contactId)
    );

    // Filter to candidates not yet sent, skipping those explicitly flagged mismatch or not_found
    const candidates = approvedContacts.filter(
      (c) => !alreadyHandled.has(c.id) && c.linkedinCheckStatus !== 'mismatch' && c.linkedinCheckStatus !== 'not_found'
    );

    if (candidates.length === 0) {
      return { ok: true, dispatchedCount: 0 };
    }

    const now = new Date();
    const { postSentActivityIfMapped } = await import('@/lib/channelDelivery');

    // Batch update / upsert CadenceSend records
    for (const contact of candidates) {
      await db.cadenceSend.upsert({
        where: { campaignId_contactId_stepKey: { campaignId, contactId: contact.id, stepKey: STEP_KEY } },
        update: { status: 'sent', sentAt: now, error: null },
        create: {
          campaignId,
          contactId: contact.id,
          stepKey: STEP_KEY,
          dueAt: now,
          status: 'sent',
          sentAt: now,
          error: null,
        },
      });

      // Best effort LeadSquared push
      if (contact.lsqLeadId) {
        try {
          await postSentActivityIfMapped({
            channel: 'linkedin',
            lsqLeadId: contact.lsqLeadId,
            campaignName: campaign.name,
            stepKey: STEP_KEY,
            note: `Automated LinkedIn personalized outreach dispatched to ${contact.name}`,
          });
        } catch {
          /* best effort */
        }
      }
    }

    await db.activityLogEntry.create({
      data: {
        campaignId,
        text: `Automated LinkedIn dispatch: ${candidates.length} personalized message(s) sent`,
        dot: 'var(--success-500)',
      },
    });

    revalidateCampaign(campaignId);
    return { ok: true, dispatchedCount: candidates.length };
  } catch (err) {
    return {
      ok: false,
      dispatchedCount: 0,
      error: String(err instanceof Error ? err.message : err).slice(0, 300),
    };
  }
}

// --- Global LinkedIn Tool Actions -------------------------------------------

export interface LinkedInToolEventSummary {
  id: string;
  name: string;
  date: string | null;
  status: string;
  cadenceStatus: string | null;
  hasLinkedInStep: boolean;
  totalApproved: number;
  sentCount: number;
  skippedCount: number;
  pendingCount: number;
  percentComplete: number;
}

export interface LinkedInToolParticipant {
  id: string;
  name: string;
  firstName: string;
  title: string;
  account: string;
  score: number | null;
  seniority: string | null;
  function: string | null;
  linkedinId: string | null;
  slug: string | null;
  destinationUrl: string;
  destinationKind: 'profile' | 'search';
  message: string;
  charCount: number;
  exceedsLimit: boolean;
  checkStatus: VerificationStatus | null;
  checkNote: string | null;
  status: 'pending' | 'sent' | 'skipped';
  sentAt: string | null;
  personalized: boolean;
  personalizedInvalid: boolean;
}

/**
 * Returns all campaigns with summary counters for the global LinkedIn tool.
 */
export async function getLinkedInToolEventsAction(): Promise<{ ok: boolean; events: LinkedInToolEventSummary[]; error?: string }> {
  try {
    const campaigns = await db.campaign.findMany({
      select: {
        id: true,
        name: true,
        date: true,
        status: true,
        cadenceStatus: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const [linkedinSteps, approvedCounts, sendCounts] = await Promise.all([
      db.cadenceStep.findMany({
        where: { key: STEP_KEY, removedAt: null },
        select: { campaignId: true },
      }),
      db.contact.groupBy({
        by: ['campaignId'],
        where: { approved: true },
        _count: true,
      }),
      db.cadenceSend.groupBy({
        by: ['campaignId', 'status'],
        where: { stepKey: STEP_KEY },
        _count: true,
      }),
    ]);

    const campaignsWithStep = new Set(linkedinSteps.map((s) => s.campaignId));
    const approvedMap = new Map(approvedCounts.map((a) => [a.campaignId, a._count]));

    const sentMap = new Map<string, number>();
    const skippedMap = new Map<string, number>();
    for (const sc of sendCounts) {
      if (sc.status === 'sent') sentMap.set(sc.campaignId, sc._count);
      if (sc.status === 'skipped') skippedMap.set(sc.campaignId, sc._count);
    }

    const events: LinkedInToolEventSummary[] = campaigns.map((c) => {
      const totalApproved = approvedMap.get(c.id) ?? 0;
      const sentCount = sentMap.get(c.id) ?? 0;
      const skippedCount = skippedMap.get(c.id) ?? 0;
      const handled = sentCount + skippedCount;
      const pendingCount = Math.max(0, totalApproved - handled);
      const percentComplete = totalApproved > 0 ? Math.round((handled / totalApproved) * 100) : 0;

      return {
        id: c.id,
        name: c.name,
        date: c.date,
        status: c.status,
        cadenceStatus: c.cadenceStatus,
        hasLinkedInStep: campaignsWithStep.has(c.id),
        totalApproved,
        sentCount,
        skippedCount,
        pendingCount,
        percentComplete,
      };
    });

    return { ok: true, events };
  } catch (err) {
    return {
      ok: false,
      events: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Returns full queue of participants with pre-drafted AI personalized messages,
 * resolved LinkedIn profile URLs, and current dispatch status.
 */
export async function getLinkedInToolQueueAction(
  campaignId: string
): Promise<{
  ok: boolean;
  campaign?: { id: string; name: string; date: string | null; zoomLink: string | null };
  participants: LinkedInToolParticipant[];
  counts: { total: number; sent: number; skipped: number; pending: number; verified: number };
  error?: string;
}> {
  try {
    const campaign = await db.campaign.findUnique({
      where: { id: campaignId },
      include: {
        speakers: { orderBy: { order: 'asc' } },
      },
    });

    if (!campaign) {
      return {
        ok: false,
        participants: [],
        counts: { total: 0, sent: 0, skipped: 0, pending: 0, verified: 0 },
        error: 'Campaign not found',
      };
    }

    const [approvedContacts, personalizedLinkedIn, sends, linkedinTemplate] = await Promise.all([
      db.contact.findMany({
        where: { campaignId, approved: true },
        orderBy: [{ score: 'desc' }, { name: 'asc' }],
      }),
      db.personalizedMessage.findMany({
        where: { campaignId, stepKey: STEP_KEY },
        select: { contactId: true, body: true },
      }),
      db.cadenceSend.findMany({
        where: { campaignId, stepKey: STEP_KEY },
        select: { contactId: true, status: true, sentAt: true },
      }),
      resolveStepTemplate(campaignId, STEP_KEY),
    ]);

    const personalizedByContact = new Map(personalizedLinkedIn.map((p) => [p.contactId, p.body]));
    const sendStatusByContact = new Map(sends.map((s) => [s.contactId, { status: s.status as 'sent' | 'skipped', sentAt: s.sentAt }]));

    const speakersSummary = formatSpeakersSummary(campaign.speakers) || campaign.speakerName || '';
    const origin = appOrigin();

    let totalSent = 0;
    let totalSkipped = 0;
    let totalVerified = 0;

    const participants: LinkedInToolParticipant[] = approvedContacts.map((c) => {
      const personalizedBody = personalizedByContact.get(c.id);
      const effectiveContactLink = buildInviteLink({ campaign, contact: c, channel: 'linkedin', appOrigin: origin });

      const personalizedValid = personalizedBody
        ? validateRenderedMessage(null, personalizedBody, false, effectiveContactLink).valid
        : true;

      const fallback = linkedinTemplate
        ? renderMergeFields(linkedinTemplate.body, {
            firstName: c.name.split(' ')[0] || c.name,
            company: c.account,
            topic: campaign.name,
            link: effectiveContactLink,
            date: campaign.date,
            speaker: speakersSummary,
          })
        : `Hi ${c.name.split(' ')[0]} — noticed ${c.account}'s work in this space. We're running ${campaign.name} and thought it'd be relevant: ${effectiveContactLink}`;

      const message = personalizedBody && personalizedValid ? personalizedBody : fallback;
      const destination = resolveLinkedInDestination(c);
      const sendInfo = sendStatusByContact.get(c.id);
      const status: 'pending' | 'sent' | 'skipped' = sendInfo?.status || 'pending';

      if (status === 'sent') totalSent++;
      if (status === 'skipped') totalSkipped++;
      if (c.linkedinCheckStatus === 'verified') totalVerified++;

      return {
        id: c.id,
        name: c.name,
        firstName: c.name.split(' ')[0] || c.name,
        title: c.title || '—',
        account: c.account || '—',
        score: c.score,
        seniority: c.seniority,
        function: c.function,
        linkedinId: c.linkedinId,
        slug: destination.kind === 'profile' ? destination.slug ?? null : null,
        destinationUrl: destination.url,
        destinationKind: destination.kind,
        message,
        charCount: message.length,
        exceedsLimit: message.length > 300,
        checkStatus: (c.linkedinCheckStatus as VerificationStatus | null) ?? null,
        checkNote: c.linkedinCheckNote ?? null,
        status,
        sentAt: sendInfo?.sentAt?.toISOString() || null,
        personalized: !!personalizedBody,
        personalizedInvalid: !!personalizedBody && !personalizedValid,
      };
    });

    const pending = participants.length - totalSent - totalSkipped;

    return {
      ok: true,
      campaign: {
        id: campaign.id,
        name: campaign.name,
        date: campaign.date,
        zoomLink: campaign.zoomLink,
      },
      participants,
      counts: {
        total: participants.length,
        sent: totalSent,
        skipped: totalSkipped,
        pending: Math.max(0, pending),
        verified: totalVerified,
      },
    };
  } catch (err) {
    return {
      ok: false,
      participants: [],
      counts: { total: 0, sent: 0, skipped: 0, pending: 0, verified: 0 },
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Runs background profile resolver and revalidates campaign caches.
 */
export async function bulkResolveLinkedInProfilesAction(
  campaignId: string
): Promise<{ ok: boolean; summary?: string; error?: string }> {
  try {
    const result = await runLinkedInProfileResolver(campaignId);
    if (!result.ok) {
      return { ok: false, error: result.error || 'Failed to resolve profiles' };
    }

    const summary = `Profile resolution: ${result.alreadyHadProfile} existing · ${result.resolvedFromExtras} from CRM extras · ${result.resolvedFromApollo} from Apollo · ${result.fallbackToSearch} search fallbacks`;
    await db.activityLogEntry.create({
      data: {
        campaignId,
        text: summary,
        dot: 'var(--accent-500)',
      },
    });

    revalidateCampaign(campaignId);
    return { ok: true, summary };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
