import { db } from '@/lib/db';
import { enrichContacts } from '@/lib/claude';
import { upsertAttentionItem } from '@/lib/attentionItems';
import { resolveIntegrationField } from '@/lib/integrationConfig';
import { enrichContactsViaApollo, type ApolloEnrichedContact } from '@/lib/apolloVerify';
import { searchCompanyWeb, DEFAULT_ACTOR_ID } from '@/lib/apify';

export interface EnrichmentResult {
  ok: boolean;
  error?: string;
  personasEnriched?: number;
  /** Real Apollo people/match hits — a sourced email, not a guess. */
  emailsFoundReal?: number;
  /** Local pattern-guess fallback — used only when Apollo has no match for
   *  a contact, or isn't configured at all. Always held back from sending
   *  until a human verifies it (Contact.emailSimulated). */
  emailsInferred?: number;
  couldNotEnrich?: number;
}

const COMPANY_SUFFIXES = /\b(inc|llc|ltd|limited|corp|corporation|co|company|group|holdings|technologies|technology|labs|plc|pvt|private|gmbh|sa|bv)\b/gi;

// Local pattern guess: firstname.lastname at the company's known domain.
// Prefers a domain observed on a real colleague's address at the same account —
// which is how the real thing works, and avoids minting a domain that might
// belong to someone else. This is ONLY the fallback for when Apollo (below)
// genuinely has no match, or isn't configured — never a substitute for it.
// It's INFERRED, not sourced: the caller stores it with emailSimulated=true
// so the send path blocks it until a human verifies.
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
    // --- Apify (real, if configured): one live web search per unique
    // company, grounding Claude's inference below in an actual external
    // signal instead of guessing blind from name/title/account alone. ---
    const apifyToken = await resolveIntegrationField('apify', 'apiToken');
    const apifyActorId = (await resolveIntegrationField('apify', 'actorId')) || DEFAULT_ACTOR_ID;
    const webContextByAccount = new Map<string, string>();
    let companiesGrounded = 0;
    let apifyError: string | null = null;

    if (apifyToken) {
      const uniqueAccounts = [...new Set(contacts.map((c) => c.account?.trim()).filter((a): a is string => !!a && a.toLowerCase() !== 'unassigned'))];
      for (const account of uniqueAccounts) {
        try {
          const result = await searchCompanyWeb(account, apifyToken, apifyActorId);
          if (result) {
            webContextByAccount.set(account, [result.title, result.description].filter(Boolean).join(' — '));
            companiesGrounded++;
          }
        } catch (err) {
          // One Actor failure (bad token, wrong Actor id, exhausted plan) means
          // every subsequent call fails the same way — stop burning quota.
          apifyError = String(err instanceof Error ? err.message : err).slice(0, 200);
          break;
        }
      }
    }

    // --- Claude: real inference on firmographics + persona (all contacts) ---
    const enriched = await enrichContacts(
      campaign.name,
      contacts.map((c) => ({
        id: c.id,
        name: c.name,
        title: c.title,
        account: c.account,
        vertical: c.vertical,
        webContext: c.account ? (webContextByAccount.get(c.account.trim()) ?? null) : null,
      }))
    );
    // Key by id and ignore anything that doesn't match a real contact — the model
    // occasionally returns a stray extra row, and the applied count should reflect
    // contacts actually updated, not raw response length.
    const validIds = new Set(contacts.map((c) => c.id));
    const byId = new Map(enriched.filter((e) => validIds.has(e.id)).map((e) => [e.id, e]));

    // --- Apollo (real, if configured): fill missing emails via a genuine
    // people/match call. Only contacts still missing a usable email even
    // ask Apollo — no point spending API calls confirming what we already have. ---
    const apolloKey = await resolveIntegrationField('apollo', 'apiKey');
    const needingEmail = contacts.filter((c) => !hasUsableEmail(c.email));
    let apolloResults = new Map<string, ApolloEnrichedContact>();
    if (apolloKey && needingEmail.length > 0) {
      const { results } = await enrichContactsViaApollo(
        needingEmail.map((c) => ({ id: c.id, name: c.name, title: c.title, account: c.account })),
        { apiKey: apolloKey }
      );
      apolloResults = results;
    }

    let emailsFoundReal = 0;
    let emailsInferred = 0;
    let couldNotEnrich = 0;
    const knownDomains = learnDomains(contacts);

    const updates = contacts.map((c) => {
      const e = byId.get(c.id);
      let newEmail: string | null = null;
      let emailSimulated = false;
      let emailVerified = false;

      if (!hasUsableEmail(c.email)) {
        const apolloMatch = apolloResults.get(c.id);
        if (apolloMatch?.found && apolloMatch.email) {
          // Real, sourced data from Apollo — not a guess, so it doesn't need
          // the human-verification gate a pattern guess does.
          newEmail = apolloMatch.email;
          emailSimulated = false;
          emailVerified = true;
          emailsFoundReal++;
        } else {
          const guessed = inferEmail(c.name, c.account, knownDomains);
          if (guessed) {
            newEmail = guessed;
            emailSimulated = true;
            emailVerified = false;
            emailsInferred++;
          } else {
            couldNotEnrich++;
          }
        }
      }

      return db.contact.update({
        where: { id: c.id },
        data: {
          vertical: e?.vertical ?? c.vertical,
          function: e?.function ?? c.function,
          seniority: e?.seniority ?? c.seniority,
          personaNote: e?.personaNote ?? c.personaNote,
          enrichedAt: new Date(),
          enrichmentSource: newEmail ? (emailSimulated ? 'Apollo(guess) + Claude' : 'Apollo + Claude') : 'Claude',
          ...(newEmail ? { email: newEmail, emailSimulated, emailVerified, missingInfo: false } : {}),
        },
      });
    });

    await db.$transaction(updates);

    const logLines: { campaignId: string; text: string; dot: string }[] = [
      {
        campaignId,
        text: `Claude enriched ${byId.size} contacts — normalized function/seniority, inferred vertical, wrote persona notes${
          companiesGrounded > 0 ? ` (grounded with real web context for ${companiesGrounded} compan${companiesGrounded === 1 ? 'y' : 'ies'} via Apify)` : ''
        }`,
        dot: 'var(--accent-500)',
      },
    ];
    if (apolloKey) {
      logLines.push({
        campaignId,
        text: `Apollo found ${emailsFoundReal} real email${emailsFoundReal === 1 ? '' : 's'}${
          emailsInferred > 0 ? ` — guessed ${emailsInferred} more (unverified) where Apollo had no match` : ''
        }`,
        dot: emailsFoundReal > 0 ? 'var(--success-500)' : 'var(--warning-700)',
      });
    } else if (emailsInferred > 0) {
      logLines.push({
        campaignId,
        text: `Guessed ${emailsInferred} missing email${emailsInferred === 1 ? '' : 's'} — flagged as unverified, held back from sending until a human approves. Connect Apollo on Integrations for real matches instead of guesses.`,
        dot: 'var(--warning-700)',
      });
    }
    if (couldNotEnrich > 0) {
      logLines.push({
        campaignId,
        text: `${couldNotEnrich} contact${couldNotEnrich === 1 ? '' : 's'} too sparse to enrich — no company or name to work from`,
        dot: 'var(--warning-700)',
      });
    }
    if (apifyError) {
      logLines.push({ campaignId, text: `Apify company-context lookup failed: ${apifyError}`, dot: 'var(--danger-500)' });
    }

    await db.activityLogEntry.createMany({ data: logLines });

    return { ok: true, personasEnriched: byId.size, emailsFoundReal, emailsInferred, couldNotEnrich };
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
