import { randomUUID } from 'node:crypto';
import { db } from '@/lib/db';
import { provisionCampaignDefaults } from '@/lib/campaignDefaults';
import { formatWebinarDate } from '@/lib/campaignDate';
import { isSetupLocked } from '@/lib/campaignLifecycle';
import { dateToWallClock, safeTimeZone, wallClockToDate } from '@/lib/dateFormat';
import { syncSpeakersForCampaign } from '@/lib/speakers';
import type { SpeakerTxClient } from '@/lib/speakers';
import { serializeSelectedChannels, type RegistrationChannelKey } from '@/lib/registrationChannels';
import { applyMessagingPatch, type MessagingPatch } from '@/lib/wizardMessagingPersist';
import {
  clampStep,
  conflictingGroups,
  sanitizeGroupBases,
  isEmptyPatch,
  nextFurthestStep,
  parseFieldRevs,
  remoteChangedGroups,
  sanitizeDraftPatch,
  shouldCreateDraft,
  stampGroups,
  type DraftPatch,
  type SaveDraftResult,
} from '@/lib/wizardDraft';

export type { SaveDraftResult };

// The one place a wizard draft is written. Used by the server action (lib/actions/wizardDraft.ts) and by
// the unload-safe beacon route (app/api/wizard/draft/route.ts).
//
// This module writes OUR database and nothing else. It must never reach Zoom, LeadSquared, Netcore, Apollo,
// the AI client or any sender: a draft save is safe to fire on every pause in typing. A guard test
// (lib/wizardDraftServer.test.ts) walks this file's imports and fails if one of those appears.

export interface SaveDraftInput {
  /** The draft being edited, or null to create one (only once the patch is substantial enough). */
  campaignId: string | null;
  /** The step the person is on. Recorded as the resume point and raises the furthest step. */
  step: number;
  patch: unknown;
  /** The draft revision this client loaded the draft at. */
  baseRevision: number;
  /** Per group, the revision of this client's own latest write or resolved conflict (see GroupBases). */
  groupBases?: Record<string, number>;
  /** Makes creation idempotent: a retry after a lost response returns the same draft. */
  createToken?: string;
}

type Tx = SpeakerTxClient;

const TOKEN_KEY = (token: string) => `wizard.draft_token.${token}`;
export const DRAFT_TOKEN_TTL_MS = 2 * 24 * 60 * 60 * 1000;

function capacityOf(text: string): number | null {
  const n = Number.parseInt(text, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

interface Existing {
  timezone: string;
  scheduledAt: Date | null;
}

/** The plain Campaign columns a patch writes. Side tables (speakers, messaging) are handled separately. */
export function columnsFromPatch(patch: DraftPatch, existing: Existing): Record<string, unknown> {
  const c: Record<string, unknown> = {};
  if (patch.title !== undefined) c.name = patch.title.trim() || 'Untitled webinar';
  if (patch.description !== undefined) c.description = patch.description.trim() || null;

  if (patch.date !== undefined || patch.time !== undefined || patch.timezone !== undefined) {
    const tz = safeTimeZone(patch.timezone ?? existing.timezone);
    const wall = existing.scheduledAt ? dateToWallClock(existing.scheduledAt, existing.timezone) : '';
    const date = patch.date ?? wall.slice(0, 10);
    const time = patch.time ?? wall.slice(11, 16);
    const at = date ? wallClockToDate(`${date}T${time || '09:00'}`, tz) : null;
    c.timezone = tz;
    c.scheduledAt = at;
    c.date = at ? formatWebinarDate(at, tz) : 'Not scheduled yet';
  }
  if (patch.durationMinutes !== undefined) c.durationMinutes = patch.durationMinutes;
  if (patch.capacity !== undefined) c.capacity = capacityOf(patch.capacity);

  if (patch.registrationLink !== undefined) {
    const link = patch.registrationLink.trim();
    c.registrationLink = link || null;
    // The same rule the Continue button and the Review step apply (updateWizardFunnelModeAction).
    c.oneClickSignup = !link;
    c.registrationMode = link ? 'external' : 'zoom';
  } else if (patch.oneClickSignup !== undefined) {
    c.oneClickSignup = patch.oneClickSignup;
  }

  if (patch.zoomLink !== undefined) c.zoomLink = patch.zoomLink.trim() || null;
  if (patch.zoomMeetingId !== undefined) c.zoomMeetingId = patch.zoomMeetingId.trim() || null;
  if (patch.selectedChannels !== undefined) c.selectedChannels = serializeSelectedChannels(patch.selectedChannels as RegistrationChannelKey[]);
  if (patch.scoringPrompt !== undefined) c.scoringPrompt = patch.scoringPrompt;
  if (patch.scoringCriteria !== undefined) c.scoringCriteria = patch.scoringCriteria;
  if (patch.scoringThreshold !== undefined) c.scoringThreshold = patch.scoringThreshold;
  return c;
}

function messagingOf(patch: DraftPatch): MessagingPatch {
  const m: MessagingPatch = {};
  if (patch.msgMode !== undefined) m.msgMode = patch.msgMode;
  if (patch.tone !== undefined) m.tone = patch.tone;
  if (patch.msgLength !== undefined) m.msgLength = patch.msgLength;
  if (patch.aiInstructions !== undefined) m.aiInstructions = patch.aiInstructions;
  if (patch.brief !== undefined) m.brief = patch.brief;
  if (patch.personalizationFields !== undefined) m.personalizationFields = patch.personalizationFields;
  if (patch.stepConfigs !== undefined) m.stepConfigs = patch.stepConfigs;
  return m;
}

/** Side tables a patch writes inside the caller's transaction. */
async function applySideTables(client: Tx | typeof db, campaignId: string, patch: DraftPatch): Promise<void> {
  if (patch.speakers !== undefined) await syncSpeakersForCampaign(campaignId, patch.speakers, client === db ? undefined : (client as Tx));
  const messaging = messagingOf(patch);
  if (Object.keys(messaging).length > 0) await applyMessagingPatch(campaignId, messaging, client);
}

/** A value already stored needs no conflict: re-sending it overwrites nothing. */
function alreadyHolds(row: Record<string, unknown>, patch: DraftPatch, group: string): boolean {
  const holds = (patchKey: keyof DraftPatch, column: string, norm: (v: never) => unknown = (v) => v) =>
    patch[patchKey] === undefined || norm(patch[patchKey] as never) === row[column];
  switch (group) {
    case 'title': return holds('title', 'name', (v: string) => v.trim() || 'Untitled webinar');
    case 'description': return holds('description', 'description', (v: string) => v.trim() || null);
    case 'durationMinutes': return holds('durationMinutes', 'durationMinutes');
    case 'capacity': return holds('capacity', 'capacity', (v: string) => capacityOf(v));
    case 'scoringPrompt': return holds('scoringPrompt', 'scoringPrompt');
    case 'scoringCriteria': return holds('scoringCriteria', 'scoringCriteria');
    case 'scoringThreshold': return holds('scoringThreshold', 'scoringThreshold');
    case 'msgMode': return holds('msgMode', 'msgMode');
    case 'tone': return holds('tone', 'tone');
    case 'msgLength': return holds('msgLength', 'msgLength');
    case 'aiInstructions': return holds('aiInstructions', 'aiInstructions');
    case 'brief': return holds('brief', 'brief');
    case 'selectedChannels': return holds('selectedChannels', 'selectedChannels', (v: string[]) => v.join(','));
    case 'personalizationFields': return holds('personalizationFields', 'personalizationFields', (v: string[]) => v.join(','));
    case 'schedule': {
      const next = columnsFromPatch(patch, { timezone: String(row.timezone), scheduledAt: (row.scheduledAt as Date | null) ?? null });
      const at = next.scheduledAt as Date | null | undefined;
      return (at?.getTime() ?? null) === ((row.scheduledAt as Date | null)?.getTime() ?? null) && (next.timezone ?? row.timezone) === row.timezone;
    }
    case 'registration':
      return holds('registrationLink', 'registrationLink', (v: string) => v.trim() || null) && holds('oneClickSignup', 'oneClickSignup');
    case 'zoom':
      return holds('zoomLink', 'zoomLink', (v: string) => v.trim() || null) && holds('zoomMeetingId', 'zoomMeetingId', (v: string) => v.trim() || null);
    default: return false;
  }
}

const ROW_SELECT = {
  id: true, name: true, description: true, status: true, archived: true, wizardStep: true, personalizationFields: true, selectedChannels: true, cadenceStatus: true, timezone: true, scheduledAt: true,
  durationMinutes: true, capacity: true, registrationLink: true, oneClickSignup: true, zoomLink: true, zoomMeetingId: true,
  scoringPrompt: true, scoringCriteria: true, scoringThreshold: true, msgMode: true, tone: true,
  msgLength: true, aiInstructions: true, brief: true, wizardFurthestStep: true, draftRevision: true, draftFieldRevs: true,
} as const;

/**
 * Applies a draft patch. Safe to call repeatedly and concurrently: every save for one draft runs under a
 * transaction-scoped advisory lock, so the revision check and the write cannot interleave with another tab's.
 */
export async function saveWizardDraft(input: SaveDraftInput): Promise<SaveDraftResult> {
  const patch = sanitizeDraftPatch(input.patch);
  const step = clampStep(input.step);
  const base = Number.isFinite(input.baseRevision) ? Math.max(0, Math.trunc(input.baseRevision)) : 0;
  const bases = sanitizeGroupBases(input.groupBases);
  const createToken = input.createToken ? input.createToken.slice(0, 64) : undefined;
  // Saves to one draft are serialised on its id; a creation is serialised on its token (a fresh key when none).
  const lockKey = input.campaignId ?? (createToken ? `token:${createToken}` : `new:${randomUUID()}`);

  if (!input.campaignId && !shouldCreateDraft(patch)) return { status: 'skipped' };
  if (input.campaignId === '') return { status: 'gone' };

  const run = async (tx: Tx): Promise<SaveDraftResult> => {
    const now = new Date();

    let targetId = input.campaignId;
    let creationRetry = false;
    if (!targetId && createToken) {
      // A retried creation (a lost response, or the unload post) finds the draft the first attempt made. Its
      // patch may carry edits typed since, so it continues as an ordinary update, not as a no-op.
      const prior = await tx.appSetting.findUnique({ where: { key: TOKEN_KEY(createToken) } });
      const priorId = prior?.value.split('|')[0];
      if (priorId && (await tx.campaign.findUnique({ where: { id: priorId }, select: { id: true } }))) {
        targetId = priorId;
        creationRetry = true;
      }
    }

    if (!targetId) {
      const cols = columnsFromPatch(patch, { timezone: 'Asia/Kolkata', scheduledAt: null });
      const revs = stampGroups({}, patch, 1);
      // Written on the shared client rather than inside the lock's transaction: provisioning the cadence
      // runs its own queries, which could not see a row this transaction had not committed yet.
      const created = await db.campaign.create({
        data: {
          name: 'Untitled webinar',
          vertical: 'Unassigned',
          date: 'Not scheduled yet',
          ...cols,
          wizardStep: step,
          wizardFurthestStep: step,
          draftRevision: 1,
          draftFieldRevs: JSON.stringify(revs),
          draftTouchedAt: now,
        },
      });
      try {
        await provisionCampaignDefaults(created.id);
        await applySideTables(db, created.id, patch);
        await db.activityLogEntry.create({ data: { campaignId: created.id, text: 'Webinar created', dot: 'var(--accent-500)' } });
        if (createToken) {
          const value = `${created.id}|${now.getTime()}`;
          await tx.appSetting.upsert({ where: { key: TOKEN_KEY(createToken) }, create: { key: TOKEN_KEY(createToken), value }, update: { value } });
        }
      } catch (err) {
        // Never leave a half-built draft behind: the client retries creation with the same token.
        await db.campaign.delete({ where: { id: created.id } }).catch(() => undefined);
        throw err;
      }
      return { status: 'saved', campaignId: created.id, revision: 1, created: true, remoteGroups: [] };
    }

    const row = await tx.campaign.findUnique({ where: { id: targetId }, select: ROW_SELECT });
    // An archived draft is treated like a deleted one: a stale tab must not keep editing something hidden.
    if (!row || row.archived) return { status: 'gone' };
    // A launched or finished webinar's setup is a record. A stale tab must not be able to change it.
    if (isSetupLocked(row)) return { status: 'locked', campaignId: row.id };

    const revs = parseFieldRevs(row.draftFieldRevs);
    // A retried creation was based on the draft as the first attempt left it (revision 1).
    const writerBase = creationRetry ? 1 : base;
    const writerBases = creationRetry ? {} : bases;
    const clashes = conflictingGroups(patch, revs, writerBase, writerBases).filter((g) => !alreadyHolds(row as unknown as Record<string, unknown>, patch, g));
    if (clashes.length > 0) return { status: 'conflict', campaignId: row.id, revision: row.draftRevision, groups: clashes };

    const stepChanged = step !== row.wizardStep || step > row.wizardFurthestStep;
    if (isEmptyPatch(patch) && !stepChanged) {
      return { status: 'saved', campaignId: row.id, revision: row.draftRevision, created: false, remoteGroups: remoteChangedGroups(patch, revs, writerBase, writerBases) };
    }

    const revision = row.draftRevision + 1;
    await applySideTables(tx, row.id, patch);
    await tx.campaign.update({
      where: { id: row.id },
      data: {
        ...columnsFromPatch(patch, row),
        wizardStep: step,
        wizardFurthestStep: nextFurthestStep(row.wizardFurthestStep, step),
        draftRevision: revision,
        draftFieldRevs: JSON.stringify(stampGroups(revs, patch, revision)),
        draftTouchedAt: now,
      },
    });
    return { status: 'saved', campaignId: row.id, revision, created: false, remoteGroups: remoteChangedGroups(patch, revs, writerBase, writerBases) };
  };

  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}::text, 0))`;
      return run(tx);
    },
    { maxWait: 10_000, timeout: 30_000 },
  );
}
