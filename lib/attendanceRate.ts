/**
 * The one definition of "attendance rate" in this product.
 *
 * It previously had four: attended/approved on the webinar list card,
 * attended/max(campaign.registrations, registeredCount) on the dashboard
 * table, attended/(registered || approved) on a campaign's Overview, and
 * attended-among-registered/approved on the Results tile. For a campaign with
 * 100 approved, 60 registered and 40 attended those render 40%, 67%, 67% and
 * 40% — several of them visible at the same time, which is how a reporting
 * screen loses an operator's trust entirely.
 *
 * Registered is the denominator, because that is what the term means
 * everywhere outside this codebase: of the people who signed up, how many
 * turned up. Approved is an outreach-funnel number, not an attendance one.
 */

export const ATTENDANCE_RATE_LABEL = 'Attendance rate';
export const ATTENDANCE_RATE_SUBLABEL = 'of registered';

/**
 * Returns a whole-number percentage, or null when there is nothing honest to
 * show — no registrations yet, or an attended count that exceeds them.
 *
 * Attended can legitimately exceed registered (someone whose Zoom email
 * matched but who never completed registration), and rendering 140% reads as
 * a bug rather than as the data quirk it is, so that case reports null too.
 */
export function attendanceRate(attended: number, registered: number): number | null {
  if (!Number.isFinite(attended) || !Number.isFinite(registered)) return null;
  if (registered <= 0 || attended < 0) return null;
  if (attended > registered) return null;
  return Math.round((attended / registered) * 100);
}

/** `attendanceRate` formatted for display, with the shared em-dash fallback. */
export function formatAttendanceRate(attended: number, registered: number, dash = '—'): string {
  const rate = attendanceRate(attended, registered);
  return rate === null ? dash : `${rate}%`;
}
