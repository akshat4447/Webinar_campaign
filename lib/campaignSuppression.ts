import { db } from './db';
import type { CampaignSuppression } from './generated/prisma/client';

export interface CampaignSuppressionMatch {
  suppressed: boolean;
  reason: string;
  source: string;
  matchPattern: string;
  id: string;
}

/**
 * Normalizes an email or domain string for suppression storage and lookup.
 * e.g. " Alex@Acme.COM " -> "alex@acme.com"
 * e.g. " @Competitor.com " -> "@competitor.com"
 * e.g. "competitor.com" -> "@competitor.com" (if no @, prepend @ to treat as domain)
 */
export function normalizeSuppressionTarget(raw: string): { target: string; isDomain: boolean } {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) {
    return { target: '', isDomain: false };
  }

  // If it contains an '@'
  if (trimmed.includes('@')) {
    if (trimmed.startsWith('@')) {
      // Domain wildcard e.g. "@competitor.com"
      return { target: trimmed, isDomain: true };
    }
    // Full email e.g. "alex@acme.com"
    return { target: trimmed, isDomain: false };
  }

  // If it's a domain pattern like "competitor.com" or "acme.io"
  if (trimmed.includes('.') && !trimmed.includes(' ')) {
    return { target: `@${trimmed}`, isDomain: true };
  }

  return { target: trimmed, isDomain: false };
}

/**
 * Check if a specific email address is suppressed for a specific campaign/webinar.
 * Checks both:
 * 1. Exact email match (e.g. "john@example.com")
 * 2. Domain wildcard match (e.g. "@example.com")
 */
export async function isEmailCampaignSuppressed(
  campaignId: string,
  email: string | null | undefined
): Promise<CampaignSuppressionMatch | null> {
  if (!campaignId || !email || typeof email !== 'string' || !email.trim()) {
    return null;
  }

  const normalized = email.trim().toLowerCase();
  const domainPart = normalized.includes('@') ? `@${normalized.split('@')[1]}` : null;

  const patternsToCheck = [normalized];
  if (domainPart) {
    patternsToCheck.push(domainPart);
  }

  if (!db?.campaignSuppression?.findFirst) {
    return null;
  }

  const match = await db.campaignSuppression.findFirst({
    where: {
      campaignId,
      email: { in: patternsToCheck },
    },
  });

  if (!match) return null;

  return {
    suppressed: true,
    reason: match.reason,
    source: match.source,
    matchPattern: match.email,
    id: match.id,
  };
}

/**
 * Returns the count of active webinar-specific suppressions for a campaign.
 */
export async function getCampaignSuppressionCount(campaignId: string): Promise<number> {
  if (!campaignId || !db?.campaignSuppression?.count) return 0;
  return db.campaignSuppression.count({
    where: { campaignId },
  });
}

/**
 * Adds a single email or domain to a campaign's suppression list.
 * Automatically skips any queued CadenceSend rows for matching contacts in this campaign.
 */
export async function addCampaignSuppression(
  campaignId: string,
  rawTarget: string,
  reason = 'manual',
  source = 'manual'
): Promise<CampaignSuppression> {
  const { target } = normalizeSuppressionTarget(rawTarget);
  if (!target) {
    throw new Error('Valid email address or domain is required.');
  }

  const record = await db.campaignSuppression.upsert({
    where: {
      campaignId_email: {
        campaignId,
        email: target,
      },
    },
    create: {
      campaignId,
      email: target,
      reason,
      source,
    },
    update: {
      reason,
      source,
    },
  });

  // Automatically cancel pending CadenceSend items for contacts that match this suppression target
  try {
    const isDomain = target.startsWith('@');
    const domainSuffix = isDomain ? target.slice(1) : null;

    const matchingContacts = await db.contact.findMany({
      where: {
        campaignId,
        ...(isDomain && domainSuffix
          ? { email: { endsWith: `@${domainSuffix}`, mode: 'insensitive' } }
          : { email: { equals: target, mode: 'insensitive' } }),
      },
      select: { id: true },
    });

    if (matchingContacts.length > 0) {
      const contactIds = matchingContacts.map((c) => c.id);
      await db.cadenceSend.updateMany({
        where: {
          campaignId,
          contactId: { in: contactIds },
          status: { in: ['queued', 'processing'] },
        },
        data: {
          status: 'skipped',
          error: `Webinar suppression list: excluded by target "${target}" (${reason})`,
        },
      });
    }

    // Add activity log entry
    await db.activityLogEntry.create({
      data: {
        campaignId,
        text: `Added "${target}" to webinar suppression list (${reason})`,
        dot: 'var(--warning-700)',
      },
    }).catch(() => {});
  } catch (err) {
    console.error('Error auto-cancelling sends for campaign suppression:', err);
  }

  return record;
}

/**
 * Parses raw text, CSV, or multi-line string of emails/domains and adds them in bulk.
 */
export async function bulkAddCampaignSuppression(
  campaignId: string,
  rawContent: string,
  defaultReason = 'csv_import',
  source = 'csv_upload'
): Promise<{ added: number; skipped: number; targets: string[] }> {
  if (!campaignId || !rawContent || !rawContent.trim()) {
    return { added: 0, skipped: 0, targets: [] };
  }

  // Split by newlines, commas, or semicolons
  const lines = rawContent.split(/[\r\n,;]+/);
  const validTargets: string[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    const cleaned = line.trim();
    if (!cleaned) continue;
    // Skip CSV header row if present
    if (cleaned.toLowerCase() === 'email' || cleaned.toLowerCase() === 'domain' || cleaned.toLowerCase() === 'pattern') {
      continue;
    }
    const { target } = normalizeSuppressionTarget(cleaned);
    if (target && !seen.has(target)) {
      seen.add(target);
      validTargets.push(target);
    }
  }

  if (validTargets.length === 0) {
    return { added: 0, skipped: 0, targets: [] };
  }

  let added = 0;
  for (const target of validTargets) {
    try {
      await db.campaignSuppression.upsert({
        where: {
          campaignId_email: { campaignId, email: target },
        },
        create: {
          campaignId,
          email: target,
          reason: defaultReason,
          source,
        },
        update: {
          reason: defaultReason,
          source,
        },
      });
      added++;
    } catch {
      // Ignore individual upsert error
    }
  }

  // Cancel any matching queued cadence sends in this campaign
  try {
    const directEmails = validTargets.filter((t) => !t.startsWith('@'));
    const domains = validTargets.filter((t) => t.startsWith('@')).map((t) => t.slice(1));

    const orConditions: Array<{ email?: { in?: string[]; mode?: 'insensitive'; endsWith?: string } }> = [];
    if (directEmails.length > 0) {
      orConditions.push({ email: { in: directEmails, mode: 'insensitive' } });
    }
    for (const d of domains) {
      orConditions.push({ email: { endsWith: `@${d}`, mode: 'insensitive' } });
    }

    if (orConditions.length > 0) {
      const matchingContacts = await db.contact.findMany({
        where: {
          campaignId,
          OR: orConditions,
        },
        select: { id: true },
      });

      if (matchingContacts.length > 0) {
        await db.cadenceSend.updateMany({
          where: {
            campaignId,
            contactId: { in: matchingContacts.map((c) => c.id) },
            status: { in: ['queued', 'processing'] },
          },
          data: {
            status: 'skipped',
            error: `Webinar suppression list bulk import: excluded (${defaultReason})`,
          },
        });
      }
    }

    await db.activityLogEntry.create({
      data: {
        campaignId,
        text: `Bulk imported ${added} entry(ies) into webinar suppression list`,
        dot: 'var(--warning-700)',
      },
    }).catch(() => {});
  } catch (err) {
    console.error('Error auto-cancelling sends on bulk campaign suppression:', err);
  }

  return {
    added,
    skipped: lines.length - added,
    targets: validTargets,
  };
}

/**
 * Removes an email or domain from the campaign suppression list.
 */
export async function removeCampaignSuppression(campaignId: string, id: string): Promise<boolean> {
  if (!campaignId || !id) return false;

  try {
    const deleted = await db.campaignSuppression.delete({
      where: { id, campaignId },
    });

    await db.activityLogEntry.create({
      data: {
        campaignId,
        text: `Removed "${deleted.email}" from webinar suppression list`,
        dot: 'var(--accent-500)',
      },
    }).catch(() => {});

    return true;
  } catch {
    return false;
  }
}

/**
 * Lists campaign suppressions with optional search query.
 */
export async function getCampaignSuppressions(
  campaignId: string,
  search?: string
): Promise<CampaignSuppression[]> {
  if (!campaignId || !db?.campaignSuppression?.findMany) return [];

  const where: { campaignId: string; email?: { contains: string; mode: 'insensitive' } } = { campaignId };
  if (search && search.trim()) {
    where.email = { contains: search.trim().toLowerCase(), mode: 'insensitive' };
  }

  return db.campaignSuppression.findMany({
    where,
    orderBy: { createdAt: 'desc' },
  });
}
