// Server-only. Finds a LeadSquared sending identity that this tenant actually
// accepts, so a new tenant doesn't need manual trial and error.
//
// Why this exists: accessKey/secretKey/host authenticate, but SendEmailToLead
// additionally needs a `Sender` that is an ACTIVE user *in that same tenant*.
// An address that works in one org is rejected in another, so the sender is the
// one genuinely per-tenant setting — and it used to be found by hand.
//
// Safety: discovery sends NO email. probeSenderIdentity() aims at an
// undeliverable reserved-TLD recipient, so LeadSquared validates the sender and
// then finds nobody to deliver to. See its doc comment for the two signals.

import { listUsers, probeSenderIdentity, type LsqUser } from '@/lib/leadsquared';
import { rankSenderCandidates } from '@/lib/claude';

/** Probing stops at the first valid sender; this caps the worst case. */
const MAX_PROBES = 15;

export interface SenderAttempt {
  email: string;
  verdict: 'valid' | 'invalid' | 'error';
  detail: string;
  /** Why the ranker put it here, when Claude was reachable. */
  reason?: string;
}

export interface DiscoverSenderResult {
  /** The first address LeadSquared accepted, or null if none did. */
  sender: string | null;
  attempts: SenderAttempt[];
  totalUsers: number;
  activeUsers: number;
  /** False when ranking fell back to plain order because Claude was unreachable. */
  ranked: boolean;
  /** Set only when ranking failed — the reason, so the fallback isn't silent. */
  rankError?: string | null;
  note: string;
}

/**
 * Ranks the tenant's active users, then probes them best-first and returns the
 * first one LeadSquared accepts.
 */
export async function discoverSender(operatorEmail: string): Promise<DiscoverSenderResult> {
  const users = await listUsers();
  const active = users.filter((u) => u.active);

  if (active.length === 0) {
    return {
      sender: null,
      attempts: [],
      totalUsers: users.length,
      activeUsers: 0,
      ranked: false,
      note: 'No active users came back from LeadSquared, so there is no address that could be used as a sender.',
    };
  }

  // Ranking is a convenience, not a dependency: if Claude is unreachable we
  // still probe, just in the order LeadSquared returned.
  let order: LsqUser[] = active;
  const reasons = new Map<string, string>();
  let ranked = false;
  let rankError: string | null = null;
  try {
    const rankedList = await rankSenderCandidates({
      operatorEmail,
      candidates: active.map((u) => ({ email: u.email, firstName: u.firstName, lastName: u.lastName, role: u.role })),
    });
    const byEmail = new Map(active.map((u) => [u.email.toLowerCase(), u]));
    const seen = new Set<string>();
    const reordered: LsqUser[] = [];
    for (const r of rankedList) {
      const hit = byEmail.get(r.email.toLowerCase());
      if (hit && !seen.has(hit.email.toLowerCase())) {
        seen.add(hit.email.toLowerCase());
        reasons.set(hit.email.toLowerCase(), r.reason);
        reordered.push(hit);
      }
    }
    // Anything the ranker omitted still gets a turn, after the ranked ones.
    for (const u of active) if (!seen.has(u.email.toLowerCase())) reordered.push(u);
    if (reordered.length > 0) {
      order = reordered;
      ranked = true;
    }
  } catch (err) {
    // Recorded rather than swallowed: a silent ranking failure is what let
    // discovery quietly fall back to LeadSquared's arbitrary order.
    rankError = String(err instanceof Error ? err.message : err).slice(0, 160);
  }

  const attempts: SenderAttempt[] = [];
  for (const u of order.slice(0, MAX_PROBES)) {
    const probe = await probeSenderIdentity(u.email);
    attempts.push({ email: u.email, verdict: probe.verdict, detail: probe.detail, reason: reasons.get(u.email.toLowerCase()) });
    if (probe.verdict === 'valid') {
      return {
        sender: u.email,
        attempts,
        totalUsers: users.length,
        activeUsers: active.length,
        ranked,
        rankError,
        note: `LeadSquared accepted "${u.email}" as a sending identity after ${attempts.length} probe(s). No email was sent during discovery.`,
      };
    }
  }

  return {
    sender: null,
    attempts,
    totalUsers: users.length,
    activeUsers: active.length,
    ranked,
    rankError,
    note:
      `None of the ${attempts.length} highest-ranked active users was accepted as a sender. ` +
      `This usually means email sending is not provisioned on the account rather than that every user is wrong — ` +
      `check with LeadSquared that the account is cleared to send, then retry.`,
  };
}
