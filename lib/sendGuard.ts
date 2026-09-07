export class UnverifiedRecipientError extends Error {
  constructor(email: string) {
    super(`${email} was inferred by enrichment, not supplied by the source data — verify it on the Scoring tab before sending. Guessed addresses can belong to people who never opted in.`);
    this.name = 'UnverifiedRecipientError';
  }
}

// SEND_MODE=sandbox (default) redirects every real send to a single allowlisted
// LeadSquared lead, regardless of the actual contact — so this demo can never
// reach a real prospect's inbox unless SEND_MODE is explicitly set to "live".
//
// Independently of send mode, an *inferred* address (emailSimulated, not yet
// human-verified) is refused outright: enrichment guesses addresses from a name
// plus a company, and those guesses can land on a real person who never opted in.
//
// `mode` is required, not defaulted from process.env here — the real send mode
// is DB-overridable (see getSendMode() below), so a caller must resolve it
// first and pass the result. A silent env-only fallback in this function once
// meant a future caller could reach live/sandbox behavior that disagreed with
// what Integrations actually has configured.
export function resolveRecipient(
  contact: { email: string | null; emailSimulated?: boolean; emailVerified?: boolean },
  mode: 'sandbox' | 'live'
): { email: string; sandboxed: boolean } {
  const allowlist = process.env.SEND_ALLOWLIST_LEAD_EMAIL;

  if (contact.emailSimulated && !contact.emailVerified) {
    throw new UnverifiedRecipientError(contact.email ?? 'This contact');
  }

  if (mode === 'live') {
    if (!contact.email) throw new Error('Contact has no email on file — cannot send live.');
    return { email: contact.email, sandboxed: false };
  }
  if (!allowlist) throw new Error('SEND_ALLOWLIST_LEAD_EMAIL is not set — required while SEND_MODE=sandbox.');
  return { email: allowlist, sandboxed: true };
}

export async function getSendMode(): Promise<'sandbox' | 'live'> {
  try {
    const { db } = await import('@/lib/db');
    const setting = await db.appSetting.findUnique({ where: { key: 'send_mode' } });
    if (setting?.value === 'live' || setting?.value === 'sandbox') return setting.value;
  } catch {
    /* fallback to env */
  }
  return process.env.SEND_MODE === 'live' ? 'live' : 'sandbox';
}

export async function saveSendMode(mode: 'sandbox' | 'live'): Promise<void> {
  const { db } = await import('@/lib/db');
  await db.appSetting.upsert({
    where: { key: 'send_mode' },
    create: { key: 'send_mode', value: mode },
    update: { value: mode },
  });
}

