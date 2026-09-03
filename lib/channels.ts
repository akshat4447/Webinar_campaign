// Pure channel helpers for the multi-channel cadence — routing, SMS encoding
// math, and nothing else. No imports: vitest pins every rule here, and both
// the cadence router (lib/cadence.ts) and the validators
// (lib/messageValidation.ts) share this single source of truth.

export type Channel = 'email' | 'sms' | 'whatsapp' | 'linkedin';

/**
 * Maps a CadenceStep/Template display channel string onto a routable channel.
 * Multi-channel labels like "Email + LinkedIn" route by their primary (email)
 * — that's how the existing T-1d step was always delivered. Anything unknown
 * falls back to email, which is every pre-existing row's actual behaviour.
 */
export function normalizeChannel(display: string | null | undefined): Channel {
  const v = (display ?? '').toLowerCase();
  if (v.includes('sms')) return 'sms';
  if (v.includes('whatsapp')) return 'whatsapp';
  if (v.includes('linkedin') && !v.includes('email')) return 'linkedin';
  return 'email';
}

/**
 * Whether the app can send this channel by itself.
 *
 * LinkedIn cannot be automated — there is no send API for messages, so those
 * steps go to the assisted queue for a human to send one-click. A mixed label
 * like "Email + LinkedIn" routes by its primary channel and so IS automatable.
 *
 * Lives here rather than in lib/cadence.ts because client components need it
 * and lib/cadence.ts imports the database.
 */
export function isAutomatableChannel(channel: string): boolean {
  return normalizeChannel(channel) !== 'linkedin';
}

// GSM 03.38 basic character set — everything outside it forces UCS-2 encoding,
// which drops the per-segment budget from 160 to 70 characters.
const GSM7_REGEX = /^[A-Za-z0-9 \r\n@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà^{}\\\[~\]|€]*$/;

export function isGsm7(body: string): boolean {
  return GSM7_REGEX.test(body);
}

/** Segments after concatenation overhead: 160/153 GSM-7, 70/67 UCS-2. */
export function smsSegmentCount(body: string): number {
  if (!body) return 0;
  if (isGsm7(body)) {
    if (body.length <= 160) return 1;
    return Math.ceil(body.length / 153);
  }
  if (body.length <= 70) return 1;
  return Math.ceil(body.length / 67);
}

export interface SmsCheck {
  segments: number;
  gsm7: boolean;
}

/**
 * SMS-specific body rules layered on top of the shared validators:
 *   error   — empty body; more than 3 segments (cost + truncation risk)
 *   warning — non-GSM content; any multi-segment body at all
 */
export function checkSmsBody(body: string): { issues: Array<{ severity: 'error' | 'warning'; message: string }>; valid: boolean } & SmsCheck {
  const issues: Array<{ severity: 'error' | 'warning'; message: string }> = [];
  const segments = smsSegmentCount(body);
  const gsm7 = isGsm7(body);

  if (!body.trim()) {
    issues.push({ severity: 'error', message: 'Message body is empty' });
    return { issues, valid: false, segments: 0, gsm7: true };
  }
  if (!gsm7) {
    issues.push({ severity: 'warning', message: 'Non-GSM characters (emoji/smart quotes) force UCS-2 encoding — 70 chars per segment instead of 160' });
  }
  if (segments > 1) {
    issues.push({ severity: 'warning', message: `Multi-segment SMS — ${segments} segments billed` });
  }
  if (segments > 3) {
    issues.push({ severity: 'error', message: `${segments} segments is far too long for an SMS reminder — cut it to ≤3` });
  }

  return { issues, valid: !issues.some((i) => i.severity === 'error'), segments, gsm7 };
}