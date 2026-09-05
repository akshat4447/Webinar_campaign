import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * One-click sign-up links.
 *
 * A message carries a link that registers the contact on click, with no
 * landing-page form. That link is therefore a bearer credential: anyone
 * holding it can register that contact. It is signed so it cannot be forged or
 * edited, and scoped to one campaign+contact pair so a leaked link cannot be
 * used to register anybody else.
 *
 * Deliberately NOT a database token table: a signed token needs no storage, no
 * cleanup, and no read on the hot path. Idempotency comes from the contact's
 * own `registeredAt`, not from consuming a row.
 */

const SEP = '.';
const VERSION = 'v1';

/** Days a link stays valid. Long enough for a webinar cycle, not forever. */
export const TOKEN_TTL_DAYS = 120;

function secret(): string {
  // Reuses the LinkedIn client secret when present so a deployment that
  // already has one does not need a second. Falls back to a build-local value
  // so development works; production without either is caught by
  // `registrationSecretIsWeak` below rather than failing silently.
  return process.env.REGISTRATION_SECRET || process.env.LINKEDIN_CLIENT_SECRET || 'dev-only-insecure-secret';
}

/** True when the signing key is the built-in development fallback. */
export function registrationSecretIsWeak(): boolean {
  return !process.env.REGISTRATION_SECRET && !process.env.LINKEDIN_CLIENT_SECRET;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url');
}

export interface TokenPayload {
  campaignId: string;
  contactId: string;
  /** Issued-at, epoch seconds. */
  iat: number;
}

/** Mint a signed link token for one contact on one campaign. */
export function mintRegistrationToken(campaignId: string, contactId: string, now = new Date()): string {
  const iat = Math.floor(now.getTime() / 1000);
  const body = b64url(JSON.stringify({ campaignId, contactId, iat }));
  return [VERSION, body, sign(`${VERSION}${SEP}${body}`)].join(SEP);
}

export type VerifyResult =
  | { ok: true; payload: TokenPayload }
  | { ok: false; reason: 'malformed' | 'bad-signature' | 'expired' };

/**
 * Verify a token. Signature is checked with a constant-time comparison so the
 * endpoint cannot be used as an oracle to guess a valid signature byte by byte.
 */
export function verifyRegistrationToken(token: string, now = new Date()): VerifyResult {
  const parts = token.split(SEP);
  if (parts.length !== 3 || parts[0] !== VERSION) return { ok: false, reason: 'malformed' };

  const [, body, provided] = parts;
  const expected = sign(`${VERSION}${SEP}${body}`);

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on length mismatch, which is itself a leak of
  // information — compare lengths first and fail the same way.
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: 'bad-signature' };

  let payload: TokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TokenPayload;
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (!payload?.campaignId || !payload?.contactId || typeof payload.iat !== 'number') {
    return { ok: false, reason: 'malformed' };
  }

  const ageDays = (now.getTime() / 1000 - payload.iat) / 86400;
  if (ageDays > TOKEN_TTL_DAYS) return { ok: false, reason: 'expired' };

  return { ok: true, payload };
}

/** The link that goes into a message. */
export function registrationUrl(origin: string, campaignId: string, contactId: string): string {
  return `${origin.replace(/\/$/, '')}/r/${mintRegistrationToken(campaignId, contactId)}`;
}

/**
 * A campaign's zoomLink/registrationLink is stored and displayed as a bare,
 * scheme-less short link ("lsq.co/w/my-webinar") — fine as text in a message
 * body, but `NextResponse.redirect` requires a real absolute URL and throws
 * `ERR_INVALID_URL` on anything else. This is only needed at the one place
 * such a link is ever actually navigated to (the one-click join redirect in
 * `app/r/[token]/route.ts`), so the fixup lives here rather than on the
 * stored value itself.
 */
export function ensureAbsoluteUrl(url: string): string {
  return /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`;
}
