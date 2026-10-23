import { db } from '@/lib/db';
import { purgeExpiredOAuthReturns } from '@/lib/oauthReturn';
import { ABANDONED_DRAFT_AFTER_MS } from '@/lib/wizardDraft';

// Housekeeping for the creation wizard. A draft that was started, never went past the first screen and
// holds nothing but a title is clutter after a week; it is archived (never deleted) so it can still be
// restored from the Archived filter. Anything with real content, however old, is left alone.

const LAST_RUN_KEY = 'housekeeping.drafts.lastRun';
const DAY_MS = 24 * 60 * 60 * 1000;
const TOKEN_PREFIX = 'wizard.draft_token.';
const TOKEN_TTL_MS = 2 * DAY_MS;

export async function archiveAbandonedDrafts(now: Date = new Date()): Promise<string[]> {
  const cutoff = new Date(now.getTime() - ABANDONED_DRAFT_AFTER_MS);
  const stale = await db.campaign.findMany({
    where: {
      status: 'draft',
      archived: false,
      wizardFurthestStep: 0,
      scheduledAt: null,
      description: null,
      zoomLink: null,
      zoomMeetingId: null,
      registrationLink: null,
      speakerName: null,
      capacity: null,
      contacts: { none: {} },
      OR: [{ draftTouchedAt: { lt: cutoff } }, { draftTouchedAt: null, updatedAt: { lt: cutoff } }],
    },
    select: { id: true },
    take: 200,
  });
  if (stale.length === 0) return [];
  const ids = stale.map((c) => c.id);
  await db.campaign.updateMany({ where: { id: { in: ids } }, data: { archived: true } });
  await db.activityLogEntry.createMany({
    data: ids.map((campaignId) => ({ campaignId, text: 'Archived automatically: a draft with only a title and no activity for 7 days', dot: 'var(--n50)' })),
  });
  console.info(`[drafts] archived ${ids.length} abandoned draft(s): ${ids.join(', ')}`);
  return ids;
}

/** Drops creation tokens whose retry window has passed. */
export async function purgeExpiredDraftTokens(now: Date = new Date()): Promise<number> {
  const rows = await db.appSetting.findMany({ where: { key: { startsWith: TOKEN_PREFIX } } });
  const expired = rows.filter((r) => now.getTime() - Number(r.value.split('|')[1] ?? 0) > TOKEN_TTL_MS).map((r) => r.key);
  if (expired.length === 0) return 0;
  return (await db.appSetting.deleteMany({ where: { key: { in: expired } } })).count;
}

/**
 * Called from the worker tick. Runs the archive at most once a day (the tick itself runs every few minutes),
 * and the cheap token purges every time.
 */
export async function runDraftHousekeeping(now: Date = new Date()): Promise<{ archived: number; ranArchive: boolean }> {
  await purgeExpiredDraftTokens(now);
  await purgeExpiredOAuthReturns(now.getTime());

  const last = await db.appSetting.findUnique({ where: { key: LAST_RUN_KEY } });
  if (last && now.getTime() - Number(last.value) < DAY_MS - 60 * 60 * 1000) return { archived: 0, ranArchive: false };
  const value = String(now.getTime());
  await db.appSetting.upsert({ where: { key: LAST_RUN_KEY }, create: { key: LAST_RUN_KEY, value }, update: { value } });
  const archived = await archiveAbandonedDrafts(now);
  return { archived: archived.length, ranArchive: true };
}
