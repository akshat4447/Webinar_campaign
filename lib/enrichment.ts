import { db } from '@/lib/db';
import { enrichContacts } from '@/lib/claude';
import { upsertAttentionItem } from '@/lib/attentionItems';

export interface EnrichmentResult {
  ok: boolean;
  error?: string;
  personasEnriched?: number;
  emailsInferred?: number;
  couldNotEnrich?: number;
}

const COMPANY_SUFFIXES = /\b(inc|llc|ltd|limited|corp|corporation|co|company|group|holdings|technologies|technology|labs|plc|pvt|private|gmbh|sa|bv)\b/gi;

// Apollo-style pattern guess: firstname.lastname at the company's known domain.
// Prefers a domain observed on a real colleague's address at the same account —
// which is how the real thing works, and avoids minting a domain that might
// belong to someone else. This is INFERRED, not sourced: the caller stores it
// with emailSimulated=true so the send path blocks it until a human verifies.
function inferEmail(name: string, account: string, knownDomains: Map<string, string>): string | null {
  const parts = name
    .replace(/[^a-zA-Z\s]/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return null;

  const observed = knownDomains.get(account.trim().toLowerCase());
  const domain =
    observed ??
    (() => {
      const slug = account
        .replace(COMPANY_SUFFIXES, '')
        .replace(/[^a-zA-Z0-9\s]/g, '')
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean)
        .join('');
      // No colleague to learn the pattern from — fall back to a reserved TLD
      // rather than guessing a live domain we have no evidence for.
      return slug ? `${slug}.example` : null;
    })();
  if (!domain) return null;

  const local = parts.length === 1 ? parts[0].toLowerCase() : `${parts[0].toLowerCase()}.${parts[parts.length - 1].toLowerCase()}`;
  return `${local}@${domain}`;
}

// account (lowercased) -> email domain, learned from contacts that already have one.
function learnDomains(contacts: { account: string; email: string | null }[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const c of contacts) {
    if (!c.email || !c.email.includes('@')) continue;
    const key = c.account.trim().toLowerCase();
    if (!key || map.has(key)) continue;
    const domain = c.email.split('@')[1]?.trim().toLowerCase();
    // Skip free-mail domains — they say nothing about the company's pattern.
    if (!domain || /^(gmail|yahoo|hotmail|outlook|icloud|proton(mail)?)\./.test(domain)) continue;
    map.set(key, domain);
  }
  return map;
}

function hasUsableEmail(email: string | null): boolean {
  return !!email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function runEnrichment(campaignId: string): Promise<EnrichmentResult> {
  const campaign = await db.campaign.findUniqueOrThrow({ where: { id: campaignId } });
  const contacts = await db.contact.findMany({ where: { campaignId } });
  if (contacts.length === 0) return { ok: false, error: 'No contacts imported yet — import a list on Setup first.' };

  try {
    // --- Claude: real inference on firmographics + persona (all contacts) ---
    const enriched = await enrichContacts(
      campaign.name,
      contacts.map((c) => ({ id: c.id, name: c.name, title: c.title, account: c.account, vertical: c.vertical }))
    );
    // Key by id and ignore anything that doesn't match a real contact — the model
    // occasionally returns a stray extra row, and the applied count should reflect
    // contacts actually updated, not raw response length.
    const validIds = new Set(contacts.map((c) => c.id));
    const byId = new Map(enriched.filter((e) => validIds.has(e.id)).map((e) => [e.id, e]));

    // --- Apollo (simulated): fill gaps in contact details ---
    let emailsInferred = 0;
    let couldNotEnrich = 0;
    const knownDomains = learnDomains(contacts);

    const updates = contacts.map((c) => {
      const e = byId.get(c.id);
      const inferredEmail = hasUsableEmail(c.email) ? null : inferEmail(c.name, c.account, knownDomains);
      if (!hasUsableEmail(c.email) && !inferredEmail) couldNotEnrich++;
      if (inferredEmail) emailsInferred++;

      return db.contact.update({
        where: { id: c.id },
        data: {
          vertical: e?.vertical ?? c.vertical,
          function: e?.function ?? c.function,
          seniority: e?.seniority ?? c.seniority,
          personaNote: e?.personaNote ?? c.personaNote,
          enrichedAt: new Date(),
          enrichmentSource: inferredEmail ? 'Apollo + Claude' : 'Claude',
          ...(inferredEmail ? { email: inferredEmail, emailSimulated: true, emailVerified: false, missingInfo: false } : {}),
        },
      });
    });

    await db.$transaction(updates);

    await db.activityLogEntry.createMany({
      data: [
        { campaignId, text: `Claude enriched ${byId.size} contacts — normalized function/seniority, inferred vertical, wrote persona notes`, dot: 'var(--accent-500)' },
        {
          campaignId,
          text: `Apollo inferred ${emailsInferred} missing email${emailsInferred === 1 ? '' : 's'} — flagged as unverified, held back from sending until a human approves`,
          dot: emailsInferred ? 'var(--warning-700)' : 'var(--success-500)',
        },
        ...(couldNotEnrich > 0
          ? [{ campaignId, text: `${couldNotEnrich} contact${couldNotEnrich === 1 ? '' : 's'} too sparse to enrich — no company or name to work from`, dot: 'var(--warning-700)' }]
          : []),
      ],
    });

    return { ok: true, personasEnriched: byId.size, emailsInferred, couldNotEnrich };
  } catch (err) {
    await upsertAttentionItem(campaignId, {
      icon: 'ErrorProperty1Outline',
      color: 'error',
      title: 'Enrichment failed',
      detail: String(err).slice(0, 300),
      actionsCsv: 'retry',
    });
    return { ok: false, error: String(err) };
  }
}

export async function verifyInferredEmails(campaignId: string): Promise<number> {
  const result = await db.contact.updateMany({
    where: { campaignId, emailSimulated: true, emailVerified: false },
    data: { emailVerified: true },
  });
  if (result.count > 0) {
    await db.activityLogEntry.create({
      data: { campaignId, text: `${result.count} Apollo-inferred email${result.count === 1 ? '' : 's'} verified by a human — now eligible to send`, dot: 'var(--success-500)' },
    });
  }
  return result.count;
}
