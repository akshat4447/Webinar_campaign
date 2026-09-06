// `Campaign.scheduleWindow` used to be pure decoration — a free-text field
// ("9:00 AM – 6:00 PM IST") that nothing ever parsed, so a send could fire at
// 3am if that's when its offset landed. This makes the window a real send-time
// guard: `isWithinSendWindow` is checked before any automated send goes out.
//
// Stored format is canonical 24-hour "HH:MM–HH:MM" (e.g. "09:00–18:00"), written
// by the two <input type="time"> controls on the Schedule tab. Older campaigns —
// or anyone hand-editing the DB — may still have the legacy free-text display
// string ("9:00 AM – 6:00 PM IST"); `parseSendWindow` reads both so nothing
// already saved breaks.

export interface SendWindow {
  startMinutes: number; // minutes since local midnight
  endMinutes: number;
}

const CANONICAL_RE = /^(\d{1,2}):(\d{2})\s*[–-]\s*(\d{1,2}):(\d{2})$/;
const LEGACY_RE = /(\d{1,2}):(\d{2})\s*(AM|PM)\s*[–-]\s*(\d{1,2}):(\d{2})\s*(AM|PM)/i;

function to24Hour(hour: number, meridiem: string): number {
  const h = hour % 12;
  return meridiem.toUpperCase() === 'PM' ? h + 12 : h;
}

export function parseSendWindow(value: string): SendWindow | null {
  const trimmed = value.trim();
  const canonical = trimmed.match(CANONICAL_RE);
  if (canonical) {
    const [, sh, sm, eh, em] = canonical;
    return { startMinutes: Number(sh) * 60 + Number(sm), endMinutes: Number(eh) * 60 + Number(em) };
  }
  const legacy = trimmed.match(LEGACY_RE);
  if (legacy) {
    const [, sh, sm, sMeridiem, eh, em, eMeridiem] = legacy;
    return {
      startMinutes: to24Hour(Number(sh), sMeridiem) * 60 + Number(sm),
      endMinutes: to24Hour(Number(eh), eMeridiem) * 60 + Number(em),
    };
  }
  return null;
}

/** Renders a canonical "HH:MM–HH:MM" window back to the friendly display string. */
export function formatSendWindow(window: SendWindow): string {
  const fmt = (mins: number) => {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    const meridiem = h < 12 ? 'AM' : 'PM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(m).padStart(2, '0')} ${meridiem}`;
  };
  return `${fmt(window.startMinutes)} – ${fmt(window.endMinutes)}`;
}

export function getMinutesInTimeZone(date: Date, timeZone: string): number {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    });
    const parts = formatter.formatToParts(date);
    let hour = 0;
    let minute = 0;
    for (const part of parts) {
      if (part.type === 'hour') {
        const val = Number(part.value);
        hour = val === 24 ? 0 : val;
      } else if (part.type === 'minute') {
        minute = Number(part.value);
      }
    }
    return hour * 60 + minute;
  } catch {
    return date.getHours() * 60 + date.getMinutes();
  }
}

/**
 * True when `at`'s clock time falls inside the window. Handles a window
 * that wraps past midnight (start > end, e.g. "10:00 PM – 2:00 AM").
 * An unparseable window (or one where start === end) is treated as "always
 * open" — we only ever narrow sending, never block it on a config we can't read.
 *
 * Defaults to Asia/Kolkata if timeZone is specified or if windowStr mentions IST.
 */
export function isWithinSendWindow(at: Date, windowStr: string, timeZone?: string): boolean {
  const window = parseSendWindow(windowStr);
  if (!window || window.startMinutes === window.endMinutes) return true;

  const tz = timeZone ?? (windowStr.toUpperCase().includes('IST') ? 'Asia/Kolkata' : undefined);
  const minutesNow = tz ? getMinutesInTimeZone(at, tz) : at.getHours() * 60 + at.getMinutes();

  if (window.startMinutes < window.endMinutes) {
    return minutesNow >= window.startMinutes && minutesNow < window.endMinutes;
  }
  // Wraps past midnight.
  return minutesNow >= window.startMinutes || minutesNow < window.endMinutes;
}
