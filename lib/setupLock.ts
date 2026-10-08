import { db } from '@/lib/db';
import { isSetupLocked } from '@/lib/campaignLifecycle';

export const SETUP_LOCKED_MESSAGE =
  'This webinar has launched, so its setup is locked. Only cadence steps that have not sent yet can still be changed.';

/**
 * Server-side half of the post-launch lock (the UI hides the controls; this stops a stale tab or a direct
 * call from changing launched setup). Returns the message to show, or null when editing is allowed.
 *
 * A failed lookup must never permit a change to potentially launched setup.
 */
export async function setupLockError(campaignId: string): Promise<string | null> {
  try {
    const c = await db.campaign.findUnique({ where: { id: campaignId }, select: { status: true, cadenceStatus: true } });
    return !c ? 'Webinar not found.' : isSetupLocked(c) ? SETUP_LOCKED_MESSAGE : null;
  } catch {
    return 'Could not verify webinar state. Please retry.';
  }
}

/** Throwing form, for actions whose callers already surface thrown errors. */
export async function assertSetupEditable(campaignId: string): Promise<void> {
  const err = await setupLockError(campaignId);
  if (err) throw new Error(err);
}

export const STEP_SENT_MESSAGE = 'This step has already sent, so it is locked.';

/** A cadence step that has delivered anything is a record. Returns the message to show, or null when it can still change. */
export async function stepSentError(campaignId: string, stepKey: string): Promise<string | null> {
  try {
    const sent = await db.cadenceSend.count({ where: { campaignId, stepKey, status: 'sent' } });
    return sent > 0 ? STEP_SENT_MESSAGE : null;
  } catch {
    return 'Could not verify delivery history. Please retry.';
  }
}

export async function assertStepUnsent(campaignId: string, stepKey: string): Promise<void> {
  const err = await stepSentError(campaignId, stepKey);
  if (err) throw new Error(err);
}
