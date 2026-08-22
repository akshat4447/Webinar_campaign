// The app shows a human-readable webinar date everywhere (cards, headers, merge
// fields) but the Setup picker needs a machine value. These convert between the
// two so `date` (display) and `scheduledAt` (real) never drift apart.

const TZ_LABEL = 'IST';

/** "2026-08-28T15:00" (datetime-local value) -> "Aug 28, 2026 · 3:00 PM IST" */
export function formatWebinarDate(value: Date): string {
  const datePart = value.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const timePart = value.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  return `${datePart} · ${timePart} ${TZ_LABEL}`;
}

/** A Date -> the `value` a <input type="datetime-local"> expects, in local time. */
export function toDateTimeLocal(value: Date | null): string {
  if (!value) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

/**
 * Best-effort parse of the legacy free-text display strings ("Aug 28, 2026 ·
 * 3:00 PM IST") so existing campaigns show something sensible in the picker
 * before they've been re-saved. Returns null when it can't be trusted.
 */
export function parseLegacyWebinarDate(display: string): Date | null {
  const cleaned = display.replace(/·/g, '').replace(/\b(IST|UTC|GMT|EST|PST)\b/g, '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;
  const parsed = new Date(cleaned);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Offsets used by the reminder steps, resolved against the real webinar date. */
export function reminderDates(scheduledAt: Date) {
  const shift = (days = 0, hours = 0) => {
    const d = new Date(scheduledAt);
    d.setDate(d.getDate() - days);
    d.setHours(d.getHours() - hours);
    return d;
  };
  return { t3: shift(3), t1d: shift(1), t1h: shift(0, 1), event: new Date(scheduledAt) };
}
