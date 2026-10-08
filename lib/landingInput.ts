// Pure parsing/sanitising for the PUBLIC landing-page registration endpoint.
// It is reachable cross-origin by anyone, so every field is length-capped and
// shape-checked before it can reach the database, a CRM payload or an email.

export interface LandingInput {
  token: string | null;
  campaignId: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  company: string;
  jobTitle: string;
  source: string;
  /** True when the invisible honeypot field was filled — a bot, not a person. */
  honeypotTripped: boolean;
}

export type LandingParse = { ok: true; data: LandingInput } | { ok: false; error: string };

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;
const DEFAULT_SOURCE = 'framer_landing_page';

/** Trim, drop control characters and cap length. Non-strings become ''. */
export function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

/** Channel/source tags are short slugs; anything else falls back to the default. */
export function cleanSource(value: unknown): string {
  // Reject (don't truncate) an overlong tag: a clipped attacker string is still attacker-chosen.
  const v = cleanText(value, 41).toLowerCase();
  return v.length <= 40 && /^[a-z0-9][a-z0-9_.:-]*$/.test(v) ? v : DEFAULT_SOURCE;
}

export function parseLandingPayload(raw: unknown): LandingParse {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'A JSON object body is required' };
  const b = raw as Record<string, unknown>;

  const email = cleanText(b.email, 254).toLowerCase();
  if (email && !EMAIL_RE.test(email)) return { ok: false, error: 'A valid email address is required' };

  return {
    ok: true,
    data: {
      token: typeof b.token === 'string' && b.token.length <= 2048 ? b.token : null,
      campaignId: cleanText(b.campaignId, 64),
      email,
      firstName: cleanText(b.firstName, 100),
      lastName: cleanText(b.lastName, 100),
      phone: cleanText(b.phone, 32),
      company: cleanText(b.company, 200),
      jobTitle: cleanText(b.jobTitle, 200),
      source: cleanSource(b.source),
      // Common honeypot names; a real browser user never sees or fills these.
      honeypotTripped: ['website', 'hp', 'company_url', '_gotcha'].some((k) => typeof b[k] === 'string' && (b[k] as string).trim() !== ''),
    },
  };
}
