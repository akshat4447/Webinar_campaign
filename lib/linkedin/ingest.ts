// Registration ingestion — closes the loop the whole feature exists for:
//
//   webhook row ─▶ resolve campaign by event URN ─▶ fetch/normalize registrant
//     ─▶ dedupe by email ─▶ create Contact (source "LinkedIn Event")
//     ─▶ Claude scores it (existing path) ─▶ LeadSquared sync (existing path)
//     ─▶ registerContact() queues every registration-triggered cadence step
//
// Failures deliberately do NOT mark the row processed (except data-terminal
// ones like "no email"), so scripts/linkedin-process.ts can retry them.
import { createHash } from 'crypto';
import type { LinkedinRegistration, Campaign } from '@/lib/generated/prisma/client';
import { db } from '@/lib/db';
import { revalidateCampaign } from '@/lib/revalidate';
import { registerContact } from '@/lib/registerContact';
import { upsertAttentionItem } from '@/lib/attentionItems';
import { scoreContacts } from '@/lib/claude';
import { syncContactsToLeadSquared } from '@/lib/leadSync';
import { getLinkedinMode, restRequest } from './client';
import { normalizeRegistrant } from './webhook';
import { buildContactFields } from './mapping';

/** Live mode reads LinkedIn's lead-form response record; sandbox fabricates a stable fixture. */
async function fetchRegistrantRaw(row: LinkedinRegistration): Promise<unknown> {
  if ((await getLinkedinMode()) !== 'live') {
    const suffix = createHash('sha1').update(row.responseUrn).digest('hex').slice(0, 6);
    return {
      firstName: 'Priya',
      lastName: 'Nair',
      email: `priya.nair.${suffix}@example.com`,
      jobTitle: 'VP Marketing',
      company: 'Acme Financial',
    };
  }
  const res = await restRequest(`/leadFormResponses/${encodeURIComponent(row.responseUrn)}`);
  return res.json;
}

export interface IngestBatchResult {
  processed: number;
  failed: number;
  skipped: number;
}

/**
 * Processes queued registrations oldest-first, with a claim step so overlapping
 * runners (webhook after() bursts + the CLI drain) can never double-process:
 *
 *   1. release claims stuck >5 min (crashed runner recovery)
 *   2. inside one transaction: select unclaimed rows → atomically stamp
 *      claimedAt on exactly those ids (loser of a race claims zero)
 *   3. re-fetch the claimed rows fresh — dedupe maps are built AFTER claiming,
 *      from a snapshot that already includes contacts created by other runners
 */
export async function processPendingLinkedinRegistrations(limit = 25, campaignId?: string): Promise<IngestBatchResult> {
  // Crash recovery: a runner that died mid-processing leaves rows claimed
  // forever otherwise. Anything claimed >5 min ago with no processedAt is fair game.
  const staleCutoff = new Date(Date.now() - 5 * 60 * 1000);
  await db.linkedinRegistration.updateMany({
    where: { claimedAt: { not: null, lt: staleCutoff }, processedAt: null },
    data: { claimedAt: null },
  });

  const now = new Date();
  const claimedIds = await db.$transaction(async (tx) => {
    const candidates = await tx.linkedinRegistration.findMany({
      where: { processedAt: null, claimedAt: null, ...(campaignId ? { campaignId } : {}) },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: { id: true },
    });
    if (candidates.length === 0) return [];
    await tx.linkedinRegistration.updateMany({
      where: { id: { in: candidates.map((c) => c.id) }, claimedAt: null },
      data: { claimedAt: now },
    });
    return candidates.map((c) => c.id);
  });
  if (claimedIds.length === 0) return { processed: 0, failed: 0, skipped: 0 };

  // Fresh fetch AFTER claiming — includes campaign and reflects rows other
  // runners finished while we were claiming.
  const rows = await db.linkedinRegistration.findMany({
    where: { id: { in: claimedIds }, claimedAt: now },
    orderBy: { createdAt: 'asc' },
    include: { campaign: true },
  });

  let processed = 0;
  let failed = 0;
  let skipped = 0;
  const maps = new Map<string, Map<string, string>>();
  const modifiedCampaignIds = new Set<string>();

  for (const row of rows) {
    if (row.campaignId && !maps.has(row.campaignId)) {
      const contacts = await db.contact.findMany({ where: { campaignId: row.campaignId, email: { not: null } }, select: { id: true, email: true } });
      const map = new Map<string, string>();
      for (const c of contacts) if (c.email) map.set(c.email.toLowerCase(), c.id);
      maps.set(row.campaignId, map);
    }
    const outcome = await processOne(row, row.campaignId ? maps.get(row.campaignId)! : new Map());
    if (outcome === 'ok') {
      processed++;
      if (row.campaignId) modifiedCampaignIds.add(row.campaignId);
    } else if (outcome === 'failed') {
      failed++;
    } else {
      skipped++;
    }
  }

  // Batch CRM sync once per modified campaign to prevent N+1 sync storms and 429 rate limits
  for (const campaignId of modifiedCampaignIds) {
    try {
      await syncContactsToLeadSquared(campaignId);
    } catch (err) {
      await upsertAttentionItem(campaignId, {
        icon: 'ErrorProperty1Outline',
        color: 'error',
        title: 'LeadSquared sync failed after LinkedIn registration batch',
        detail: String(err instanceof Error ? err.message : err).slice(0, 300),
        actionsCsv: 'retry',
      });
    }
  }

  return { processed, failed, skipped };
}

async function processOne(
  row: LinkedinRegistration & { campaign: Campaign | null },
  emailMap: Map<string, string>
): Promise<'ok' | 'failed' | 'skipped'> {
  const campaign = row.campaign as Campaign | null;

  try {
    if (!campaign || !row.campaignId) {
      // Event created outside the app (manually on LinkedIn) — keep the row
      // visible in the ledger but stop retrying it forever.
      await db.linkedinRegistration.update({
        where: { id: row.id },
        data: { processedAt: new Date(), error: 'No campaign is mapped to this LinkedIn event (event was not published by this app).' },
      });
      console.warn(`linkedin-ingest: ${row.responseUrn} arrived for unmapped ${row.eventUrn}`);
      return 'skipped';
    }

    // --- DELETED: member withdrew their registration -------------------------
    if (row.leadAction === 'DELETED') {
      await db.$transaction([
        db.$executeRaw`UPDATE "Campaign" SET "registrations" = MAX(COALESCE("registrations", 0) - 1, 0) WHERE "id" = ${campaign.id}`,
        db.linkedinRegistration.update({ where: { id: row.id }, data: { processedAt: new Date(), error: null } }),
      ]);
      await db.activityLogEntry.create({
        data: {
          campaignId: campaign.id,
          text: `A LinkedIn registrant withdrew (${row.responseUrn}) — the contact stays for history; suppress manually if needed`,
          dot: 'var(--warning-700)',
        },
      });
      await revalidateCampaign(campaign.id);
      return 'ok';
    }

    // --- CREATED: full pipeline ---------------------------------------------
    const raw = await fetchRegistrantRaw(row);
    const registrant = normalizeRegistrant(raw);

    if (!registrant.email) {
      await upsertAttentionItem(campaign.id, {
        icon: 'ErrorProperty1Outline',
        color: 'error',
        title: 'LinkedIn registrant has no usable email',
        detail: `${row.responseUrn} carried no email answer — a contact can't exist without one.`,
        actionsCsv: 'view',
      });
      await db.linkedinRegistration.update({
        where: { id: row.id },
        data: { processedAt: new Date(), error: 'Registrant has no recoverable email — cannot create a contact.', registrantName: registrant.name || null },
      });
      await revalidateCampaign(campaign.id);
      return 'skipped';
    }

    // Dedupe within the campaign — case-insensitive by design.
    const existingContactId = emailMap.get(registrant.email.toLowerCase()) ?? null;
    if (existingContactId) {
      await db.$transaction([
        db.linkedinRegistration.update({
          where: { id: row.id },
          data: { contactId: existingContactId, registrantName: registrant.name || null, registrantEmail: registrant.email, processedAt: new Date(), error: null },
        }),
      ]);
      await db.activityLogEntry.create({
        data: {
          campaignId: campaign.id,
          text: `${registrant.name || registrant.email} registered again via the LinkedIn Event — linked to their existing contact instead of duplicating`,
          dot: 'var(--accent-500)',
        },
      });
      // registerContact is idempotent, so this is a no-op for a contact that
      // registered before. For one that only existed from an import or a
      // manual add, THIS is their registration — set it and queue whatever
      // registration-triggered steps are enabled, exactly as a fresh contact
      // gets below.
      await registerContact(campaign.id, existingContactId, 'linkedin', row.occurredAt ?? undefined);
      await revalidateCampaign(campaign.id);
      return 'ok';
    }

    const fields = buildContactFields(registrant, campaign.vertical, (await getLinkedinMode()) !== 'live');
    const contact = await db.contact.create({ data: { campaignId: campaign.id, ...fields } });
    if (fields.email) {
      emailMap.set(fields.email.toLowerCase(), contact.id);
    }

    // Scoring is best-effort: a Claude outage must not lose the lead — it just
    // stays unscored until someone runs the normal Scoring action again.
    try {
      const [result] = await scoreContacts(campaign.name, campaign.vertical, campaign.scoringPrompt, campaign.scoringCriteria, [
        {
          id: contact.id,
          name: fields.name,
          title: fields.title,
          function: fields.function,
          seniority: fields.seniority,
          account: fields.account,
          vertical: fields.vertical,
          missingInfo: fields.missingInfo,
        },
      ]);
      if (result) {
        await db.contact.update({
          where: { id: contact.id },
          data: { score: result.score, explanation: result.explanation, approved: result.score >= campaign.scoringThreshold },
        });
      }
    } catch (err) {
      await upsertAttentionItem(campaign.id, {
        icon: 'ErrorProperty1Outline',
        color: 'warning',
        title: `LinkedIn lead imported but not scored — ${fields.name}`,
        detail: String(err instanceof Error ? err.message : err).slice(0, 300),
        actionsCsv: 'retry',
      });
    }

    // Registration is a first-class contact state (lib/registerContact.ts),
    // shared with the one-click sign-up path: it sets registeredAt/source and
    // queues every enabled registration-triggered step (not just confirm and
    // whatsapp — any step the operator has added in the planner), resolving
    // its template through the shared library rather than the legacy
    // per-campaign table this used to read.
    await registerContact(campaign.id, contact.id, 'linkedin', row.occurredAt ?? undefined);

    await db.linkedinRegistration.update({
      where: { id: row.id },
      data: { contactId: contact.id, registrantName: fields.name, registrantEmail: fields.email, processedAt: new Date(), error: null },
    });
    await db.activityLogEntry.create({
      data: {
        campaignId: campaign.id,
        text: `New LinkedIn Event registration: ${fields.name} (${fields.title || 'title unknown'} @ ${fields.account || 'company unknown'}) — scored and synced into the funnel`,
        dot: 'var(--success-500)',
      },
    });
    await revalidateCampaign(campaign.id);
    return 'ok';
  } catch (err) {
    const message = String(err instanceof Error ? err.message : err).slice(0, 300);
    // Release the claim on retryable failures so the next run picks the row up
    // again; only data-terminal skips keep a processed stamp.
    await db.linkedinRegistration.update({ where: { id: row.id }, data: { error: message, claimedAt: null } });
    if (campaign) {
      await upsertAttentionItem(campaign.id, {
        icon: 'ErrorProperty1Outline',
        color: 'error',
        title: 'LinkedIn registration processing failed',
        detail: `${row.responseUrn}: ${message}`,
        actionsCsv: 'retry',
      });
      await revalidateCampaign(campaign.id);
    }
    return 'failed';
  }
}