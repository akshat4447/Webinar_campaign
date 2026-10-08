// Apollo pre-flight for the LinkedIn send queue — "self-verification before
// sending the invite", done through Apollo's official people-match API.
//
// LinkedIn outreach remains assisted: verification does not claim that a
// message was sent. An operator records the actual manual delivery outcome.
//
// Verdicts:
//   verified  — Apollo found the person and company/title still line up
//   mismatch  — Apollo found them somewhere else or in a different role
//   not_found — no confident profile match for name + company
//   error     — the lookup could not be performed (no API key, auth rejected,
//               rate limited, request threw). Deliberately NOT 'verified':
//               only 'mismatch'/'not_found' block a LinkedIn touch, so 'error'
//               still lets an operator work without Apollo — but it does not
//               claim a check happened, and the caller leaves linkedinCheckedAt
//               null so a later run with a working key actually re-checks.
//               Reporting these as 'verified' used to stamp every contact
//               fresh for the 7-day TTL, so saving a real key afterwards
//               verified nobody.

import { functionFor, seniorityFor } from './importHeuristics';

export type VerificationStatus = 'verified' | 'mismatch' | 'not_found' | 'error';

export interface VerificationOutcome {
  status: VerificationStatus;
  note: string;
}

export interface ContactBaseline {
  name: string;
  title: string;
  account: string;
}

export interface ApolloPerson {
  found: boolean;
  title?: string;
  company?: string;
  linkedinUrl?: string;
}

const COMPANY_SUFFIXES = /\b(inc|llc|ltd|limited|corp|corporation|co|company|group|holdings|technologies|technology|labs|plc|pvt|private|gmbh|sa|bv)\b/gi;

function normalizeCompany(name: string): string[] {
  return (name ?? '')
    .toLowerCase()
    .replace(COMPANY_SUFFIXES, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

export function cleanOrgName(account?: string | null): string | undefined {
  if (!account) return undefined;
  const trimmed = account.trim();
  if (!trimmed || trimmed === '—' || trimmed === '-' || /^(unassigned|n\/a|na|none|unknown)$/i.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

/** True when both company names share any significant token ("acme financial" ≈ "Acme Financial Inc"). */
export function companiesMatch(a: string, b: string): boolean {
  const ta = normalizeCompany(a);
  const tb = normalizeCompany(b);
  if (ta.length === 0 || tb.length === 0) return false;
  return ta.some((t) => t.length >= 3 && tb.includes(t));
}

/**
 * The verdict logic — pure so vitest can pin every branch. Lenient by design
 * when our own baseline is sparse (no title/company on file there's nothing
 * to contradict), strict when Apollo contradicts it.
 */
export function evaluateApolloMatch(contact: ContactBaseline, match: ApolloPerson): VerificationOutcome {
  if (!match.found) {
    return {
      status: 'not_found',
      note: `Apollo has no confident profile for "${contact.name}" at ${contact.account} — likely changed jobs or the record is stale.`,
    };
  }

  const apolloTitle = (match.title ?? '').trim();
  const apolloCompany = (match.company ?? '').trim();

  // Company check first — a different employer is the clearest "don't send".
  const hadCompany = contact.account.trim().length > 0;
  if (hadCompany && apolloCompany && !companiesMatch(contact.account, apolloCompany)) {
    return {
      status: 'mismatch',
      note: `Apollo shows them at ${apolloCompany} now, not ${contact.account} — job change since import.`,
    };
  }

  // Role drift check — same company but moved into a very different function
  // AND seniority band than the one the campaign targeted.
  const hadTitle = contact.title.trim().length > 0;
  if (hadTitle && apolloTitle) {
    const oldFn = functionFor(contact.title);
    const newFn = functionFor(apolloTitle);
    const oldSr = seniorityFor(contact.title);
    const newSr = seniorityFor(apolloTitle);
    if (oldFn !== newFn && oldSr !== newSr && newFn !== 'Other') {
      return {
        status: 'mismatch',
        note: `Role drifted: was ${contact.title} (${oldFn}/${oldSr}), Apollo now lists ${apolloTitle} (${newFn}/${newSr}).`,
      };
    }
  }

  const bits = [apolloTitle, apolloCompany].filter(Boolean).join(' · ');
  return { status: 'verified', note: bits ? `Apollo confirms current role: ${bits}` : 'Apollo matched this person with no contradicting signals.' };
}

const APOLLO_MATCH_URL = 'https://api.apollo.io/api/v1/people/match';
const CALL_GAP_MS = 300; // stay polite within Apollo's rate limits

/**
 * Apollo's /people/match only returns a confident match when first/last name
 * are split — a combined `name` field (or the wrong org param, see below)
 * silently degrades every call to a `match_confidence: "none"` stub (a `200`
 * with a person object but no real title/org/email), confirmed empirically
 * against the live API. Splitting on the first space is enough for the
 * vast majority of real contact names Apollo also expects this way.
 */
export function splitName(name: string): { first_name: string; last_name?: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first_name: '' };
  if (parts.length === 1) return { first_name: parts[0] };
  return { first_name: parts[0], last_name: parts.slice(1).join(' ') };
}

interface RawApolloResponse {
  person?: {
    title?: string;
    match_confidence?: string;
    organization?: { name?: string };
    employment_history?: Array<{ title?: string; organization_name?: string }>;
    linkedin_url?: string;
    linkedin_profile_url?: string;
  } | null;
}

// A `person` object is present even for a "none" match (Apollo's own
// documented behavior for underspecified queries) — match_confidence is the
// real found/not-found signal, empirically confirmed against the live API.
function isRealMatch(p: { match_confidence?: string } | null | undefined): boolean {
  return !!p && p.match_confidence !== 'none';
}

function extractPerson(json: unknown): ApolloPerson {
  const p = (json as RawApolloResponse | null)?.person;
  if (!isRealMatch(p)) return { found: false };
  const history = p!.employment_history?.[0];
  return {
    found: true,
    title: p!.title || history?.title,
    company: p!.organization?.name || history?.organization_name,
    linkedinUrl: p!.linkedin_url || p!.linkedin_profile_url || undefined,
  };
}

export interface VerifyBatchResult {
  results: Map<string, VerificationOutcome>;
  usedLiveApi: boolean;
  /** Set when the batch was cut short by something the operator has to fix —
   *  a rejected/missing key, or a rate limit. Callers must surface this rather
   *  than reporting a clean run: a 401 on the first contact used to abandon
   *  every remaining lookup silently while the summary still read "0 errors". */
  apiError?: string;
}

/**
 * Verifies contacts against Apollo. With an API key this makes one real
 * people-match call per contact (sequential + gapped); without one it
 * short-circuits to explicit "skipped" verdicts instead of pretending.
 * The caller resolves the key (this module stays dependency-free/pure-testable).
 */
export async function verifyContactsForLinkedIn(
  contacts: Array<{ id: string } & ContactBaseline>,
  opts: { apiKey: string }
): Promise<VerifyBatchResult> {
  const apiKey = opts.apiKey;

  if (!apiKey) {
    const results = new Map<string, VerificationOutcome>();
    for (const c of contacts) {
      results.set(c.id, { status: 'error', note: 'Not verified — no Apollo API key configured on the Integrations page.' });
    }
    return { results, usedLiveApi: false, apiError: 'No Apollo API key configured — nothing was verified.' };
  }

  const results = new Map<string, VerificationOutcome>();
  let rateLimited = false;
  let apiError: string | undefined;

  for (const c of contacts) {
    if (rateLimited) {
      results.set(c.id, { status: 'error', note: 'Skipped — Apollo rate limit/auth hit earlier in this batch; re-run verify shortly.' });
      continue;
    }
    try {
      const res = await fetch(APOLLO_MATCH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
        body: JSON.stringify({ ...splitName(c.name), organization_name: cleanOrgName(c.account), reveal_personal_emails: false }),
        cache: 'no-store',
      });

      if (res.status === 429) {
        rateLimited = true;
        apiError = apiError ?? 'Apollo rate limit hit (429) — the rest of this batch was skipped. Re-run verify shortly.';
        results.set(c.id, { status: 'error', note: 'Apollo rate limit hit (429) — re-run verify shortly.' });
        continue;
      }
      if (res.status === 401 || res.status === 403) {
        rateLimited = true;
        apiError = apiError ?? `Apollo rejected the API key (HTTP ${res.status}) — save a valid key on the Integrations page. Nothing was verified.`;
        results.set(c.id, { status: 'error', note: 'Apollo rejected the API key — save a valid key on the Integrations page.' });
        continue;
      }
      if (!res.ok) {
        results.set(c.id, { status: 'error', note: `Apollo lookup failed with HTTP ${res.status}.` });
        continue;
      }

      const json = (await res.json().catch(() => null)) as unknown;
      results.set(c.id, evaluateApolloMatch(c, extractPerson(json)));
    } catch (err) {
      results.set(c.id, { status: 'error', note: `Apollo lookup threw: ${String(err instanceof Error ? err.message : err).slice(0, 160)}` });
    }
    await new Promise((r) => setTimeout(r, CALL_GAP_MS));
  }

  return { results, usedLiveApi: true, apiError };
}

export interface ApolloEnrichedContact {
  found: boolean;
  email?: string;
  phone?: string;
  title?: string;
  company?: string;
  linkedinUrl?: string;
}

interface RawApolloEnrichResponse {
  person?: {
    email?: string | null;
    title?: string;
    match_confidence?: string;
    organization?: { name?: string };
    phone_numbers?: Array<{ raw_number?: string; sanitized_number?: string }>;
    linkedin_url?: string;
    linkedin_profile_url?: string;
  } | null;
}

/**
 * Real Apollo enrichment (not verification) — the same people/match endpoint,
 * but asking Apollo to reveal the person's email (and phone, if it has one on
 * file) instead of just confirming title/company. This is the genuine Apollo
 * API call behind "enrich this sparse contact", as opposed to the local
 * pattern-guess fallback lib/enrichment.ts uses when Apollo has no match or
 * isn't configured at all.
 */
export async function enrichContactsViaApollo(
  contacts: Array<{ id: string } & ContactBaseline>,
  opts: { apiKey: string; revealEmails?: boolean }
): Promise<{ results: Map<string, ApolloEnrichedContact>; usedLiveApi: boolean; apiError?: string }> {
  const apiKey = opts.apiKey;
  if (!apiKey) return { results: new Map(), usedLiveApi: false, apiError: 'No Apollo API key configured.' };

  const results = new Map<string, ApolloEnrichedContact>();
  let rateLimited = false;
  let apiError: string | undefined;

  for (const c of contacts) {
    if (rateLimited) continue;
    try {
      const res = await fetch(APOLLO_MATCH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
        body: JSON.stringify({
          ...splitName(c.name),
          organization_name: cleanOrgName(c.account),
          // Revealing a personal email is a separately-billed Apollo credit.
          // This was hardcoded true, so an operator who unchecked "Email" in
          // the enrichment moderation modal still paid for one reveal per
          // contact — and the revealed address was then discarded unread.
          reveal_personal_emails: opts.revealEmails !== false,
        }),
        cache: 'no-store',
      });

      if (res.status === 401 || res.status === 403) {
        rateLimited = true;
        apiError = `Apollo rejected the API key (HTTP ${res.status}) — no contact was enriched from Apollo. Save a valid key on the Integrations page.`;
        continue;
      }
      if (res.status === 429) {
        rateLimited = true;
        apiError = 'Apollo rate limit hit (429) — the rest of this run was skipped. Try again shortly.';
        continue;
      }
      if (!res.ok) continue;

      const json = (await res.json().catch(() => null)) as RawApolloEnrichResponse | null;
      const p = json?.person;
      if (isRealMatch(p)) {
        results.set(c.id, {
          found: true,
          email: p!.email?.trim() || undefined,
          phone: p!.phone_numbers?.[0]?.sanitized_number || p!.phone_numbers?.[0]?.raw_number || undefined,
          title: p!.title,
          company: p!.organization?.name,
          linkedinUrl: p!.linkedin_url || p!.linkedin_profile_url || undefined,
        });
      } else {
        results.set(c.id, { found: false });
      }
    } catch {
      results.set(c.id, { found: false });
    }
    await new Promise((r) => setTimeout(r, CALL_GAP_MS));
  }

  return { results, usedLiveApi: true, apiError };
}