// Pure. Date/time formatting per the LeadSquared design system: `12 Jan 2020 | 01:22 PM`.
// Always formatted in an explicit IANA timezone (the webinar's own), never the server's or the
// viewer's — the audit found three different formats and an implicit IST.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parts(date: Date, timeZone: string) {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: '2-digit',
    month: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
  const out: Record<string, string> = {};
  for (const p of f.formatToParts(date)) out[p.type] = p.value;
  return out;
}

export const DEFAULT_TIMEZONE = 'Asia/Kolkata';

/** Falls back to the default zone instead of throwing on a bad/unknown IANA name. */
export function safeTimeZone(tz: string | null | undefined): string {
  if (!tz) return DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

/** `21 Oct 2026` */
export function formatLsqDate(date: Date, timeZone?: string | null): string {
  if (Number.isNaN(date.getTime())) return '—';
  const p = parts(date, safeTimeZone(timeZone));
  return `${Number(p.day)} ${MONTHS[Number(p.month) - 1]} ${p.year}`;
}

/** `03:00 PM` */
export function formatLsqTime(date: Date, timeZone?: string | null): string {
  if (Number.isNaN(date.getTime())) return '—';
  const p = parts(date, safeTimeZone(timeZone));
  return `${p.hour}:${p.minute} ${String(p.dayPeriod).toUpperCase()}`;
}

/** `21 Oct 2026 | 03:00 PM` */
export function formatLsqDateTime(date: Date | null | undefined, timeZone?: string | null): string {
  if (!date || Number.isNaN(date.getTime())) return '—';
  return `${formatLsqDate(date, timeZone)} | ${formatLsqTime(date, timeZone)}`;
}

/** Short zone label for display next to a time, e.g. `IST`, `PST`. */
export function timeZoneLabel(date: Date, timeZone?: string | null): string {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: safeTimeZone(timeZone), timeZoneName: 'short' });
  return f.formatToParts(date).find((p) => p.type === 'timeZoneName')?.value ?? '';
}

/** Offset in ms of `timeZone` from UTC at the instant `utcMs` (positive east of UTC). */
function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const o: Record<string, number> = {};
  for (const p of f.formatToParts(new Date(utcMs))) if (p.type !== 'literal') o[p.type] = Number(p.value);
  const asUtc = Date.UTC(o.year, o.month - 1, o.day, o.hour === 24 ? 0 : o.hour, o.minute, o.second);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/**
 * Turns a wall-clock time typed for a webinar ("2026-10-21T15:00" meaning 3 PM in `timeZone`) into the real
 * instant. `new Date("2026-10-21T15:00")` instead uses the SERVER's zone, so a UTC server stored IST webinars
 * 5.5 hours off. Returns null when the text is not a valid date and time.
 */
export function wallClockToDate(local: string, timeZone?: string | null): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(local.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const tz = safeTimeZone(timeZone);
  const asUtc = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? 0));
  if (Number.isNaN(asUtc)) return null;
  // Two passes settle the offset across a daylight-saving boundary.
  let guess = asUtc - zoneOffsetMs(asUtc, tz);
  guess = asUtc - zoneOffsetMs(guess, tz);
  const result = new Date(guess);
  // Reject rolled-over dates such as 2026-02-31.
  const back = dateToWallClock(result, tz);
  return back.slice(0, 10) === `${y}-${mo}-${d}` ? result : null;
}

/** The `YYYY-MM-DDTHH:mm` value a datetime-local/date+time input expects, in the webinar's own zone. */
export function dateToWallClock(date: Date, timeZone?: string | null): string {
  const tz = safeTimeZone(timeZone);
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const o: Record<string, string> = {};
  for (const p of f.formatToParts(date)) o[p.type] = p.value;
  const hour = o.hour === '24' ? '00' : o.hour;
  return `${o.year}-${o.month}-${o.day}T${hour}:${o.minute}`;
}

/** Zones offered when setting up a webinar. Any IANA name already saved on a webinar is still honoured. */
export const COMMON_TIME_ZONES = [
  'Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney', 'Europe/London', 'Europe/Berlin',
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'UTC',
] as const;
