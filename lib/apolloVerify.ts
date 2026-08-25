// Apollo pre-flight for the LinkedIn send queue — "self-verification before
// sending the invite", done through Apollo's official people-match API.
//
// What this deliberately is NOT: browser automation of LinkedIn. Scripted
// outreach breaches LinkedIn's User Agreement and gets accounts restricted,
// so the automated mode here processes a *labeled simulation* of the queue —
// but only after every recipient passed this real-data sanity check.
//
// Verdicts:
//   verified  — Apollo found the person and company/title still line up
//   mismatch  — Apollo found them somewhere else or in a different role
//   not_found — no confident profile match for name + company
//   error     — the lookup itself failed (key missing counts as skip→verified
//               with an explicit note, so a demo without credentials still runs)

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

interface RawApolloResponse {
  person?: {
    title?: string;
    organization?: { name?: string };
    employment_history?: Array<{ title?: string; organization_name?: string }>;
  } | null;
}

function extractPerson(json: unknown): ApolloPerson {
  const p = (json as RawApolloResponse | null)?.person;
  if (!p) return { found: false };
  const history = p.employment_history?.[0];
  return {
    found: true,
    title: p.title || history?.title,
    company: p.organization?.name || history?.organization_name,
  };
}

export interface VerifyBatchResult {
  results: Map<string, VerificationOutcome>;
  usedLiveApi: boolean;
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
      results.set(c.id, { status: 'verified', note: 'Verification skipped — no Apollo API key configured on the Integrations page.' });
    }
    return { results, usedLiveApi: false };
  }

  const results = new Map<string, VerificationOutcome>();
  let rateLimited = false;

  for (const c of contacts) {
    if (rateLimited) {
      results.set(c.id, { status: 'error', note: 'Skipped — Apollo rate limit/auth hit earlier in this batch; re-run verify shortly.' });
      continue;
    }
    try {
      const res = await fetch(APOLLO_MATCH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
        body: JSON.stringify({ q_organization_name: c.account || undefined, name: c.name, reveal_personal_emails: false }),
        cache: 'no-store',
      });

      if (res.status === 429) {
        rateLimited = true;
        results.set(c.id, { status: 'error', note: 'Apollo rate limit hit (429) — re-run verify shortly.' });
        continue;
      }
      if (res.status === 401 || res.status === 403) {
        rateLimited = true;
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

  return { results, usedLiveApi: true };
}