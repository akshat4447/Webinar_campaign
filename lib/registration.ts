import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';

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
/**
 * v2 is the compact form: `v2.<campaignId>.<contactId>.<iat base36>.<signature>` (about 85 characters
 * instead of about 150). It exists because these links go into LinkedIn notes (300 characters) and SMS.
 * v1 tokens already sent in messages stay valid.
 */
const VERSION_COMPACT = 'v2';
const SIG_BYTES_COMPACT = 16;

/** Days a link stays valid. Long enough for a webinar cycle, not forever. */
export const TOKEN_TTL_DAYS = 120;

// Development gets a process-random key, never a public constant. Production requires a stable key.
const developmentSecret = randomBytes(32).toString('hex');
function secret(): string {
  if (process.env.REGISTRATION_SECRET?.length && process.env.REGISTRATION_SECRET.length >= 32) return process.env.REGISTRATION_SECRET;
  if (process.env.NODE_ENV === 'production') throw new Error('REGISTRATION_SECRET must contain at least 32 characters.');
  return developmentSecret;
}
export function registrationSecretIsWeak(): boolean {
  return !process.env.REGISTRATION_SECRET || process.env.REGISTRATION_SECRET.length < 32;
}

function b64url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(str: string): Buffer {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  const base64 = (str + pad).replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64');
}

function sign(payload: string): string {
  const digest = createHmac('sha256', secret()).update(payload).digest('base64');
  return digest.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
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
  // Ids containing the separator cannot be encoded compactly; fall back to the self-describing v1 form.
  if (campaignId.includes(SEP) || contactId.includes(SEP)) {
    const body = b64url(JSON.stringify({ campaignId, contactId, iat }));
    return [VERSION, body, sign(`${VERSION}${SEP}${body}`)].join(SEP);
  }
  const head = [VERSION_COMPACT, campaignId, contactId, iat.toString(36)].join(SEP);
  return `${head}${SEP}${signCompact(head)}`;
}

function signCompact(head: string): string {
  const digest = createHmac('sha256', secret()).update(head).digest().subarray(0, SIG_BYTES_COMPACT);
  return b64url(digest);
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
  let payload: TokenPayload;

  if (parts[0] === VERSION_COMPACT && parts.length === 5) {
    const [, campaignId, contactId, iat36, provided] = parts;
    const expected = signCompact([VERSION_COMPACT, campaignId, contactId, iat36].join(SEP));
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: 'bad-signature' };
    const iat = parseInt(iat36, 36);
    if (!campaignId || !contactId || !Number.isFinite(iat)) return { ok: false, reason: 'malformed' };
    payload = { campaignId, contactId, iat };
  } else {
    if (parts.length !== 3 || parts[0] !== VERSION) return { ok: false, reason: 'malformed' };

    const [, body, provided] = parts;
    const expected = sign(`${VERSION}${SEP}${body}`);

    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    // timingSafeEqual throws on length mismatch, which is itself a leak of
    // information — compare lengths first and fail the same way.
    if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: 'bad-signature' };

    try {
      payload = JSON.parse(fromB64url(body).toString('utf8')) as TokenPayload;
    } catch {
      return { ok: false, reason: 'malformed' };
    }
  }
  if (!payload?.campaignId || !payload?.contactId || typeof payload.iat !== 'number' || !Number.isFinite(payload.iat)) {
    return { ok: false, reason: 'malformed' };
  }

  const ageDays = (now.getTime() / 1000 - payload.iat) / 86400;
  if (ageDays < 0 || ageDays > TOKEN_TTL_DAYS) return { ok: false, reason: 'expired' };

  return { ok: true, payload };
}

/** The link that goes into a message. */
export function registrationUrl(origin: string, campaignId: string, contactId: string, channel?: string): string {
  const base = `${origin.replace(/\/$/, '')}/r/${mintRegistrationToken(campaignId, contactId)}`;
  return channel ? `${base}?source=${encodeURIComponent(channel)}` : base;
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
  const trimmed = (url ?? '').trim();
  if (!trimmed) return 'about:blank';
  // Block dangerous schemes and protocol-relative redirects
  if (/^(javascript|data|vbscript|file):/i.test(trimmed) || trimmed.startsWith('//')) {
    return 'about:blank';
  }
  return /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
}
