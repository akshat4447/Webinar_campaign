/**
 * The single place that answers "is this webinar over" — every page that
 * needs to switch from a live/editable view to a locked, read-only one
 * checks this rather than re-deriving it from status/cadenceStatus/date
 * independently, which is how overview, results, messaging and cadence used
 * to each render as if the campaign were still in flight even after
 * `status` had been marked 'completed'.
 *
 * Deliberately a manual transition (see markCampaignCompletedAction in
 * lib/actions/lifecycle.ts), not inferred from scheduledAt having passed —
 * an operator may still be importing attendance or wrapping up outreach for
 * days after the actual webinar date, and a silent date-based flip would
 * lock them out of finishing that work.
 */
export function isCampaignCompleted(status: string): boolean {
  return status === 'completed';
}

/** How long after the planned end a webinar may stay "live" before the UI nudges the operator to wrap up. */
export const WRAP_UP_NUDGE_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * True when a webinar's scheduled end passed more than a day ago but it was
 * never marked completed. The transition stays manual (see above); this only
 * drives a reminder so a finished event is not left looking "live" for weeks.
 */
export function isWrapUpOverdue(
  campaign: { status: string; scheduledAt: Date | null; durationMinutes?: number | null },
  nowMs: number,
): boolean {
  if (isCampaignCompleted(campaign.status) || campaign.status === 'archived') return false;
  if (!campaign.scheduledAt) return false;
  const endMs = campaign.scheduledAt.getTime() + (campaign.durationMinutes ?? 60) * 60_000;
  return nowMs - endMs > WRAP_UP_NUDGE_AFTER_MS;
}

/**
 * True once a webinar has been launched (the cadence was started, even if since paused or stopped) or finished.
 * From then on the setup is a record, not a form: audience, scoring, registration settings and webinar details
 * are shown read-only. What stays editable is only what has not been delivered yet (unsent cadence steps and
 * their copy), which those tabs gate per step.
 */
export function isSetupLocked(campaign: { status: string; cadenceStatus?: string | null }): boolean {
  if (isCampaignCompleted(campaign.status)) return true;
  if (campaign.status === 'live') return true;
  return !!campaign.cadenceStatus && campaign.cadenceStatus !== 'not_started';
}
