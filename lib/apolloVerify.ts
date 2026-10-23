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

// Overridable so tests can point the whole Apollo integration at a local fake (test-support/fakes/apolloFake.ts).
const apolloBaseUrl = () => (process.env.APOLLO_API_BASE_URL?.trim() || 'https://api.apollo.io/api/v1').replace(/\/+$/, '');
const APOLLO_MATCH_URL = { toString: () => `${apolloBaseUrl()}/people/match` };
const CALL_GAP_MS = 300; // stay polite within Apollo's rate limits
/** Without a deadline one stalled request holds a whole server action open until the platform kills it. */
const APOLLO_TIMEOUT_MS = 20_000;

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
      const res = await fetch(String(APOLLO_MATCH_URL), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
        body: JSON.stringify({ ...splitName(c.name), organization_name: cleanOrgName(c.account), reveal_personal_emails: false }),
        cache: 'no-store',
        signal: AbortSignal.timeout(APOLLO_TIMEOUT_MS),
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
  /** Apollo's own verdict on the email ("verified", "unavailable", ...). Only "verified" is treated as verified here. */
  emailStatus?: string;
  phone?: string;
  title?: string;
  company?: string;
  linkedinUrl?: string;
}

/** What is known about a contact when asking Apollo: more identifying data means a better match. */
export interface ApolloLookup extends ContactBaseline {
  id: string;
  /** The employer's web domain, learned from colleagues' emails. Far more reliable than a company name. */
  domain?: string;
  linkedinUrl?: string;
  email?: string;
}

interface RawApolloPerson {
  first_name?: string;
  last_name?: string;
  name?: string;
  email?: string | null;
  email_status?: string | null;
  title?: string;
  match_confidence?: string;
  organization?: { name?: string };
  // Per Apollo's documentation phone numbers live under `contact`; the top-level form is kept as a fallback.
  contact?: { phone_numbers?: Array<{ raw_number?: string; sanitized_number?: string }> } | null;
  phone_numbers?: Array<{ raw_number?: string; sanitized_number?: string }>;
  linkedin_url?: string;
  linkedin_profile_url?: string;
}

/**
 * Apollo answers with a placeholder address (`email_not_unlocked@domain.com`) when an email exists but has not
 * been revealed (no credits left, or not unlocked). It is not an address anyone can receive mail at, so it must
 * never be stored as one.
 */
export function cleanApolloEmail(email: unknown): string | undefined {
  if (typeof email !== 'string') return undefined;
  const e = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return undefined;
  if (/^(email_not_unlocked|not_unlocked|unavailable|no[-_]?email|placeholder)\b/.test(e.split('@')[0])) return undefined;
  return e;
}

function firstPhone(p: RawApolloPerson): string | undefined {
  const n = p.contact?.phone_numbers?.[0] ?? p.phone_numbers?.[0];
  return n?.sanitized_number || n?.raw_number || undefined;
}

const nameKey = (v: string | undefined) => (v ?? '').toLowerCase().replace(/[^a-z0-9\u00c0-\u024f]/g, '');

/** A match is accepted only when it is plausibly the person asked about: guards against results in another order. */
export function namesAgree(asked: ContactBaseline, got: { first_name?: string; last_name?: string; name?: string }): boolean {
  const want = splitName(asked.name);
  const gotFirst = got.first_name ?? (got.name ?? '').trim().split(/\s+/)[0];
  const gotLast = got.last_name ?? (got.name ?? '').trim().split(/\s+/).slice(1).join(' ');
  if (!nameKey(gotFirst)) return false;
  if (nameKey(want.first_name) !== nameKey(gotFirst)) return false;
  if (want.last_name && gotLast) {
    // Same surname, or a shared part of a compound one ("Smith" and "Smith-Jones"). A mere prefix is not enough:
    // "Kim" is not "Kimball".
    const parts = (v: string) => v.toLowerCase().split(/[\s-]+/).map(nameKey).filter((t) => t.length >= 2);
    const a = parts(want.last_name);
    const b = parts(gotLast);
    if (nameKey(want.last_name) === nameKey(gotLast)) return true;
    return a.some((t) => b.includes(t));
  }
  return true;
}

function toEnriched(p: RawApolloPerson | null | undefined): ApolloEnrichedContact {
  if (!isRealMatch(p)) return { found: false };
  return {
    found: true,
    email: cleanApolloEmail(p!.email),
    emailStatus: p!.email_status ?? undefined,
    phone: firstPhone(p!),
    title: p!.title,
    company: p!.organization?.name,
    linkedinUrl: p!.linkedin_url || p!.linkedin_profile_url || undefined,
  };
}

export const APOLLO_BULK_SIZE = 10;

export interface ApolloEnrichOutcome {
  /** Contacts Apollo actually answered for: a match, or a confirmed non-match. */
  results: Map<string, ApolloEnrichedContact>;
  usedLiveApi: boolean;
  apiError?: string;
  /** The problem will not fix itself (bad or unauthorised key, rejected request): stop rather than try again. */
  fatal?: boolean;
  /** Contacts Apollo was NOT asked about or could not answer for (rate limit, outage). Try them again later. */
  deferred: string[];
  /** Seconds Apollo asked to wait before the next attempt, when it rate limited. */
  retryAfterSec?: number;
  creditsConsumed: number;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Real Apollo enrichment (not verification): asks Apollo for the person's email (and title, phone and LinkedIn
 * profile if it has them) through the bulk endpoint, ten people per request, which is what keeps a large list
 * inside Apollo's rate limits (one request per person is ten times as many).
 *
 * What it will not do, because each was a way for this to go quietly wrong:
 *  - treat a rate limit as "no match" (those contacts come back in `deferred`, to be retried);
 *  - store a placeholder address as an email, or call an unverified one verified;
 *  - assign a result to a contact it does not name-match (the docs do not promise input order).
 */
export async function enrichContactsViaApollo(
  contacts: ApolloLookup[],
  opts: { apiKey: string; revealEmails?: boolean; budgetMs?: number; maxRateLimitWaits?: number }
): Promise<ApolloEnrichOutcome> {
  const apiKey = opts.apiKey;
  const results = new Map<string, ApolloEnrichedContact>();
  if (!apiKey) return { results, usedLiveApi: false, apiError: 'No Apollo API key configured.', fatal: true, deferred: contacts.map((c) => c.id), creditsConsumed: 0 };

  const startedAt = Date.now();
  const budgetMs = opts.budgetMs ?? 45_000;
  const maxWaits = opts.maxRateLimitWaits ?? 3;
  const reveal = opts.revealEmails !== false;
  let creditsConsumed = 0;
  let consecutiveOutages = 0;
  const deferred: string[] = [];
  let apiError: string | undefined;
  let fatal = false;
  let retryAfterSec: number | undefined;

  for (let i = 0; i < contacts.length; i += APOLLO_BULK_SIZE) {
    const chunk = contacts.slice(i, i + APOLLO_BULK_SIZE);
    const rest = () => contacts.slice(i).map((c) => c.id);
    let done = false;
    let waits = 0;

    for (let attempt = 0; attempt < 3 && !done; attempt++) {
      let res: Response;
      try {
        res = await fetch(`${apolloBaseUrl()}/people/bulk_match?reveal_personal_emails=${reveal}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
          body: JSON.stringify({
            reveal_personal_emails: reveal,
            details: chunk.map((c) => ({
              ...splitName(c.name),
              organization_name: cleanOrgName(c.account),
              ...(c.domain ? { domain: c.domain } : {}),
              ...(c.linkedinUrl ? { linkedin_url: c.linkedinUrl } : {}),
              ...(c.email ? { email: c.email } : {}),
            })),
          }),
          cache: 'no-store',
          signal: AbortSignal.timeout(APOLLO_TIMEOUT_MS),
        });
      } catch (err) {
        // Timeout or network failure: nothing is known about this chunk, so it is neither matched nor "not found".
        if (attempt < 2) {
          await wait(500 * 2 ** attempt);
          continue;
        }
        consecutiveOutages++;
        apiError = `Apollo could not be reached: ${String(err instanceof Error ? err.message : err).slice(0, 120)}`;
        deferred.push(...chunk.map((c) => c.id));
        done = true;
        break;
      }

      if (res.status === 401 || res.status === 403) {
        fatal = true;
        apiError =
          res.status === 401
            ? 'Apollo rejected the API key (HTTP 401). Save a valid key on the Integrations page.'
            : 'Apollo refused this request (HTTP 403). The key may lack enrichment access on your Apollo plan, or may need to be a master API key.';
        deferred.push(...rest());
        return { results, usedLiveApi: true, apiError, fatal, deferred, creditsConsumed };
      }
      if (res.status === 429) {
        const hinted = Number(res.headers.get('retry-after'));
        const waitSec = Number.isFinite(hinted) && hinted > 0 ? hinted : 30;
        retryAfterSec = waitSec;
        const remaining = budgetMs - (Date.now() - startedAt);
        if (waits < maxWaits && waitSec * 1000 <= remaining) {
          waits++;
          attempt--; // waiting out a limit does not use up an attempt
          await wait(waitSec * 1000);
          continue;
        }
        apiError = `Apollo rate limit reached (HTTP 429). Apollo asked to wait about ${waitSec} seconds, so the remaining contacts were not looked up. Run enrichment again after that.`;
        deferred.push(...rest());
        return { results, usedLiveApi: true, apiError, fatal: false, deferred, retryAfterSec, creditsConsumed };
      }
      if (res.status === 400 || res.status === 422) {
        const detail = await res.json().catch(() => null) as { error?: string; message?: string } | null;
        fatal = true;
        apiError = `Apollo rejected the request (HTTP ${res.status}): ${detail?.error || detail?.message || 'invalid parameters'}.`;
        deferred.push(...rest());
        return { results, usedLiveApi: true, apiError, fatal, deferred, creditsConsumed };
      }
      if (!res.ok) {
        if (attempt < 2) {
          await wait(500 * 2 ** attempt);
          continue;
        }
        consecutiveOutages++;
        apiError = `Apollo answered HTTP ${res.status} repeatedly.`;
        deferred.push(...chunk.map((c) => c.id));
        done = true;
        break;
      }

      consecutiveOutages = 0;
      const json = (await res.json().catch(() => null)) as { matches?: Array<RawApolloPerson | null>; credits_consumed?: number } | null;
      if (!json || !Array.isArray(json.matches)) {
        apiError = 'Apollo returned a response this app does not understand.';
        deferred.push(...chunk.map((c) => c.id));
        done = true;
        break;
      }
      creditsConsumed += Number(json.credits_consumed) || 0;
      const pool = json.matches.filter((m): m is RawApolloPerson => !!m && isRealMatch(m));
      const used = new Set<RawApolloPerson>();
      chunk.forEach((c, idx) => {
        const aligned = json.matches![idx];
        const pick =
          aligned && isRealMatch(aligned) && namesAgree(c, aligned) && !used.has(aligned)
            ? aligned
            : pool.find((m) => !used.has(m) && namesAgree(c, m));
        if (pick) used.add(pick);
        results.set(c.id, toEnriched(pick));
      });
      done = true;
    }

    if (consecutiveOutages >= 2) {
      deferred.push(...contacts.slice(i + APOLLO_BULK_SIZE).map((c) => c.id));
      break;
    }
    if (i + APOLLO_BULK_SIZE < contacts.length) await wait(100);
  }

  return { results, usedLiveApi: true, apiError, fatal, deferred, retryAfterSec, creditsConsumed };
}
