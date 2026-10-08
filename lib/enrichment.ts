import { db } from '@/lib/db';
import { enrichContacts } from '@/lib/claude';
import { upsertAttentionItem } from '@/lib/attentionItems';
import { resolveIntegrationField } from '@/lib/integrationConfig';
import { enrichContactsViaApollo, type ApolloEnrichedContact } from '@/lib/apolloVerify';

export interface EnrichmentFieldSelection {
  apolloEmail: boolean;
  apolloPhone: boolean;
  apolloTitle: boolean;
  claudePersona: boolean;
}

export const DEFAULT_FIELD_SELECTION: EnrichmentFieldSelection = {
  apolloEmail: true,
  apolloPhone: true,
  apolloTitle: true,
  claudePersona: true,
};

export interface EnrichmentScopeConfig {
  sampleOnly?: boolean;
  sampleSize?: number;
  contactIds?: string[];
  fields?: Partial<EnrichmentFieldSelection>;
}

export interface EnrichmentPreflightEstimate {
  totalContacts: number;
  missingEmail: number;
  missingPhone: number;
  missingTitle: number;
  uniqueAccounts: number;
  estimatedApolloCredits: number;
  estimatedClaudeTokens: number;
  integrations: {
    apollo: { configured: boolean };
    claude: { configured: boolean };
  };
}

export interface SampleEnrichmentPreview {
  id: string;
  name: string;
  account: string;
  before: {
    email: string | null;
    phone: string | null;
    title: string;
    vertical: string;
    personaNote: string | null;
  };
  after: {
    email: string | null;
    phone: string | null;
    title: string;
    vertical: string;
    personaNote: string | null;
    emailSimulated: boolean;
    emailVerified: boolean;
    enrichmentSource: string;
  };
}

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
  phonesFound?: number;
  titlesUpdated?: number;
  samplePreviews?: SampleEnrichmentPreview[];
  /** Set when Apollo itself could not be reached (bad key, rate limit), as
   *  opposed to Apollo being reached and simply having no match. The counts
   *  above look identical in both cases, so without this the UI cannot tell
   *  "Apollo has no data on these people" from "your API key is dead". */
  apolloApiError?: string;
  /** Count of Claude persona-inference batches (see enrichContacts) that
   *  returned no usable output this run — those contacts were left without a
   *  persona update. Distinct from a full Claude outage: some contacts may
   *  still have been enriched normally in other batches. */
  claudeFailedBatches?: number;
}

const COMPANY_SUFFIXES = /\b(inc|llc|ltd|limited|corp|corporation|co|company|group|holdings|technologies|technology|labs|plc|pvt|private|gmbh|sa|bv)\b/gi;

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
      return slug ? `${slug}.example` : null;
    })();
  if (!domain) return null;

  const local = parts.length === 1 ? parts[0].toLowerCase() : `${parts[0].toLowerCase()}.${parts[parts.length - 1].toLowerCase()}`;
  return `${local}@${domain}`;
}

function learnDomains(contacts: { account: string; email: string | null }[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const c of contacts) {
    if (!c.email || !c.email.includes('@')) continue;
    const key = c.account.trim().toLowerCase();
    if (!key || map.has(key)) continue;
    const domain = c.email.split('@')[1]?.trim().toLowerCase();
    if (!domain || /^(gmail|yahoo|hotmail|outlook|icloud|proton(mail)?)\./.test(domain)) continue;
    map.set(key, domain);
  }
  return map;
}

function hasUsableEmail(email: string | null): boolean {
  return !!email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function getEnrichmentPreflight(
  campaignId: string,
  fieldsPatch?: Partial<EnrichmentFieldSelection>
): Promise<EnrichmentPreflightEstimate> {
  const fields: EnrichmentFieldSelection = { ...DEFAULT_FIELD_SELECTION, ...fieldsPatch };
  const contacts = await db.contact.findMany({
    where: { campaignId },
    select: { id: true, email: true, phone: true, title: true, account: true },
  });

  const totalContacts = contacts.length;
  const missingEmail = contacts.filter((c) => !hasUsableEmail(c.email)).length;
  const missingPhone = contacts.filter((c) => !c.phone || c.phone.trim().length === 0).length;
  const missingTitle = contacts.filter((c) => !c.title || c.title === '—' || c.title.trim().length === 0).length;
  const uniqueAccounts = new Set(
    contacts.map((c) => c.account?.trim().toLowerCase()).filter((a): a is string => !!a && a !== 'unassigned')
  ).size;

  const apolloKey = await resolveIntegrationField('apollo', 'apiKey');
  const claudeKey = await resolveIntegrationField('claude', 'apiKey');

  let estimatedApolloCredits = 0;
  if (fields.apolloEmail || fields.apolloPhone || fields.apolloTitle) {
    const needingApollo = contacts.filter(
      (c) =>
        (fields.apolloEmail && !hasUsableEmail(c.email)) ||
        (fields.apolloPhone && (!c.phone || c.phone.trim().length === 0)) ||
        (fields.apolloTitle && (!c.title || c.title === '—'))
    ).length;
    estimatedApolloCredits = needingApollo;
  }

  const estimatedClaudeTokens = fields.claudePersona ? totalContacts * 150 : 0;

  return {
    totalContacts,
    missingEmail,
    missingPhone,
    missingTitle,
    uniqueAccounts,
    estimatedApolloCredits,
    estimatedClaudeTokens,
    integrations: {
      apollo: { configured: !!apolloKey },
      claude: { configured: !!claudeKey },
    },
  };
}

export async function runEnrichment(
  campaignId: string,
  config?: EnrichmentScopeConfig
): Promise<EnrichmentResult> {
  const fields: EnrichmentFieldSelection = { ...DEFAULT_FIELD_SELECTION, ...config?.fields };
  const campaign = await db.campaign.findUniqueOrThrow({ where: { id: campaignId } });
  let contacts = await db.contact.findMany({ where: { campaignId } });
  if (contacts.length === 0) return { ok: false, error: 'No contacts imported yet — import a contact list on the Audience tab first.' };

  // If specific contact IDs requested:
  if (config?.contactIds && config.contactIds.length > 0) {
    const filterIds = new Set(config.contactIds);
    contacts = contacts.filter((c) => filterIds.has(c.id));
  } else if (config?.sampleOnly) {
    // Pick 3-5 representative sample contacts, prioritizing those with gaps
    const sampleSize = config.sampleSize || 3;
    const withGaps = contacts.filter((c) => !hasUsableEmail(c.email) || !c.title || c.title === '—');
    const rest = contacts.filter((c) => hasUsableEmail(c.email) && c.title && c.title !== '—');
    contacts = [...withGaps, ...rest].slice(0, sampleSize);
  }

  const sampleBeforeMap = new Map<string, SampleEnrichmentPreview['before']>();
  if (config?.sampleOnly) {
    for (const c of contacts) {
      sampleBeforeMap.set(c.id, {
        email: c.email,
        phone: c.phone,
        title: c.title,
        vertical: c.vertical,
        personaNote: c.personaNote,
      });
    }
  }

  try {
    // 1. Claude Persona Inference
    const byId = new Map<string, { vertical?: string; function?: string; seniority?: string; personaNote?: string }>();
    let claudeFailedBatches = 0;
    if (fields.claudePersona) {
      const { results: enriched, failedBatches } = await enrichContacts(
        campaign.name,
        contacts.map((c) => ({
          id: c.id,
          name: c.name,
          title: c.title,
          account: c.account,
          vertical: c.vertical,
          webContext: null,
        }))
      );
      claudeFailedBatches = failedBatches;
      const validIds = new Set(contacts.map((c) => c.id));
      for (const e of enriched) {
        if (validIds.has(e.id)) byId.set(e.id, e);
      }
    }

    // 3. Apollo Match
    const apolloKey = await resolveIntegrationField('apollo', 'apiKey');
    let apolloResults = new Map<string, ApolloEnrichedContact>();

    const needingApollo = contacts.filter(
      (c) =>
        (fields.apolloEmail && !hasUsableEmail(c.email)) ||
        (fields.apolloPhone && (!c.phone || c.phone.trim().length === 0)) ||
        (fields.apolloTitle && (!c.title || c.title === '—'))
    );

    let apolloApiError: string | undefined;
    if (apolloKey && needingApollo.length > 0 && (fields.apolloEmail || fields.apolloPhone || fields.apolloTitle)) {
      const { results, apiError } = await enrichContactsViaApollo(
        needingApollo.map((c) => ({ id: c.id, name: c.name, title: c.title, account: c.account })),
        // Only pay for Apollo's separately-billed email reveal when the
        // operator actually asked for emails in the moderation modal.
        { apiKey: apolloKey, revealEmails: fields.apolloEmail }
      );
      apolloResults = results;
      apolloApiError = apiError;
    }

    let emailsFoundReal = 0;
    let emailsInferred = 0;
    let phonesFound = 0;
    let titlesUpdated = 0;
    let couldNotEnrich = 0;
    const knownDomains = learnDomains(contacts);

    const samplePreviews: SampleEnrichmentPreview[] = [];

    const updates = contacts.map((c) => {
      const e = byId.get(c.id);
      let newEmail: string | null = null;
      let emailSimulated = false;
      let emailVerified = false;

      const apolloMatch = apolloResults.get(c.id);

      if (fields.apolloEmail && !hasUsableEmail(c.email)) {
        if (apolloMatch?.found && apolloMatch.email) {
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

      let newPhone: string | null = null;
      if (fields.apolloPhone && (!c.phone || c.phone.trim().length === 0) && apolloMatch?.phone) {
        newPhone = apolloMatch.phone;
        phonesFound++;
      }

      let newTitle: string | null = null;
      if (fields.apolloTitle && (!c.title || c.title === '—') && apolloMatch?.title) {
        newTitle = apolloMatch.title;
        titlesUpdated++;
      }

      let newLinkedin: string | null = null;
      if ((!c.linkedinId || c.linkedinId.trim().length === 0) && apolloMatch?.linkedinUrl) {
        newLinkedin = apolloMatch.linkedinUrl;
      }

      // Whether Apollo was actually queried and returned an outcome (a match
      // or a confirmed non-match) for THIS contact — as opposed to Apollo
      // never having been consulted for them at all (no key configured, the
      // field wasn't requested, or the call was skipped after an earlier
      // rate limit elsewhere in the batch).
      const apolloConsulted = apolloResults.has(c.id);

      // Each part only appears when that source actually ran for this contact —
      // previously "+ Claude" was appended whenever an email was set even if
      // the operator had deselected the Claude persona field, mislabeling
      // provenance for anyone auditing where a value came from. Likewise a
      // guessed email used to read "Apollo(guess)" even when Apollo was never
      // configured or consulted for this contact — the guess there is purely
      // local pattern inference (inferEmail), not anything Apollo did.
      const apolloPart = newEmail
        ? emailSimulated
          ? apolloConsulted ? 'Apollo(guess)' : 'Local(guess)'
          : 'Apollo'
        : newPhone || newTitle || newLinkedin ? 'Apollo' : null;
      // 'Claude' only appears when Claude actually returned a persona result
      // for THIS contact (byId.has) — not merely because the persona field
      // was requested for the run. A dropped batch (see enrichContacts) can
      // leave a contact out of Claude's response even when claudePersona was
      // selected, and this contact must not be mislabeled as Claude-enriched.
      const claudePart = byId.has(c.id) ? 'Claude' : null;
      const enrichmentSource =
        [apolloPart, claudePart].filter(Boolean).join(' + ') || 'Local';

      const updateData = {
        ...(fields.claudePersona
          ? {
              vertical: e?.vertical ?? c.vertical,
              function: e?.function ?? c.function,
              seniority: e?.seniority ?? c.seniority,
              personaNote: e?.personaNote ?? c.personaNote,
            }
          : {}),
        enrichedAt: new Date(),
        enrichmentSource,
        ...(newEmail ? { email: newEmail, emailSimulated, emailVerified, missingInfo: false } : {}),
        ...(newPhone ? { phone: newPhone } : {}),
        ...(newTitle ? { title: newTitle } : {}),
        ...(newLinkedin ? { linkedinId: newLinkedin } : {}),
      };

      if (config?.sampleOnly && sampleBeforeMap.has(c.id)) {
        samplePreviews.push({
          id: c.id,
          name: c.name,
          account: c.account,
          before: sampleBeforeMap.get(c.id)!,
          after: {
            email: newEmail ?? c.email,
            phone: newPhone ?? c.phone,
            title: newTitle ?? c.title,
            vertical: (fields.claudePersona ? e?.vertical : null) ?? c.vertical,
            personaNote: (fields.claudePersona ? e?.personaNote : null) ?? c.personaNote,
            emailSimulated,
            emailVerified,
            enrichmentSource,
          },
        });
      }

      return db.contact.update({
        where: { id: c.id },
        data: updateData,
      });
    });

    // Sample mode's whole point is a look-before-you-leap preview — the real
    // Apollo/Claude calls above already ran (that's what makes the
    // preview trustworthy), but nothing gets written and no activity log
    // entries appear until the operator runs the real thing. Previously this
    // write ran unconditionally, so "Test on 3 Sample Contacts" permanently
    // mutated those 3 real contacts and was never actually a dry run.
    if (config?.sampleOnly) {
      return {
        ok: true,
        personasEnriched: byId.size,
        emailsFoundReal,
        emailsInferred,
        couldNotEnrich,
        phonesFound,
        titlesUpdated,
        samplePreviews,
        claudeFailedBatches,
      };
    }

    // Chunk updates into batches of 50 to prevent Prisma transaction timeout on large contact lists
    const DB_CHUNK_SIZE = 50;
    for (let i = 0; i < updates.length; i += DB_CHUNK_SIZE) {
      await db.$transaction(updates.slice(i, i + DB_CHUNK_SIZE));
    }

    const logLines: { campaignId: string; text: string; dot: string }[] = [];
    if (fields.claudePersona && byId.size > 0) {
      logLines.push({
        campaignId,
        text: `Claude enriched ${byId.size} contacts — normalized function/seniority, inferred vertical, wrote persona notes`,
        dot: 'var(--accent-500)',
      });
    }
    if (apolloApiError) {
      // Without this the run read as "Apollo found 0 real emails — guessed 500
      // more where Apollo had no match", which is indistinguishable from Apollo
      // genuinely having no data. Apollo was never successfully reached at all,
      // and that's a credential the operator has to go fix.
      logLines.push({
        campaignId,
        text: `Apollo enrichment did not run: ${apolloApiError}${
          emailsInferred > 0 ? ` ${emailsInferred} email(s) fell back to a pattern guess and stay unverified until a human approves them.` : ''
        }`,
        dot: 'var(--danger-500)',
      });
    } else if (apolloKey && (fields.apolloEmail || fields.apolloPhone || fields.apolloTitle)) {
      logLines.push({
        campaignId,
        text: `Apollo found ${emailsFoundReal} real email(s), ${phonesFound} phone(s), ${titlesUpdated} title update(s)${
          emailsInferred > 0 ? ` — guessed ${emailsInferred} more email(s) where Apollo had no match` : ''
        }`,
        dot: emailsFoundReal > 0 || phonesFound > 0 ? 'var(--success-500)' : 'var(--warning-700)',
      });
    } else if (emailsInferred > 0) {
      logLines.push({
        campaignId,
        text: `Guessed ${emailsInferred} missing email${emailsInferred === 1 ? '' : 's'} — flagged as unverified, held back from sending until a human approves.`,
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
    if (claudeFailedBatches > 0) {
      // A dropped batch used to just vanish silently — those contacts kept
      // whatever persona data they had before, with nothing telling the
      // operator some of the run's output never came back.
      logLines.push({
        campaignId,
        text: `Claude persona enrichment: ${claudeFailedBatches} batch${claudeFailedBatches === 1 ? '' : 'es'} returned no usable output — some contacts were left without a persona update this run.`,
        dot: 'var(--warning-700)',
      });
    }

    if (logLines.length > 0) {
      await db.activityLogEntry.createMany({ data: logLines });
    }

    if (apolloApiError) {
      await upsertAttentionItem(campaignId, {
        icon: 'ErrorProperty1Outline',
        color: 'error',
        title: 'Apollo enrichment could not run',
        detail: apolloApiError,
        actionsCsv: 'fix',
      });
    }
    if (claudeFailedBatches > 0) {
      await upsertAttentionItem(campaignId, {
        icon: 'ErrorProperty1Outline',
        color: 'warning',
        title: 'Claude persona enrichment incomplete',
        detail: `${claudeFailedBatches} batch${claudeFailedBatches === 1 ? '' : 'es'} of contacts got no usable output from Claude — re-run enrichment to retry them.`,
        actionsCsv: 'retry',
      });
    }

    return {
      ok: true,
      personasEnriched: byId.size,
      emailsFoundReal,
      emailsInferred,
      couldNotEnrich,
      phonesFound,
      titlesUpdated,
      apolloApiError,
      claudeFailedBatches,
    };
  } catch (err) {
    await upsertAttentionItem(campaignId, {
      icon: 'ErrorProperty1Outline',
      color: 'error',
      title: 'Enrichment failed',
      detail: String(err).slice(0, 600),
      actionsCsv: 'retry',
    });
    return { ok: false, error: String(err) };
  }
}

export async function runEnrichmentSample(
  campaignId: string,
  sampleSize: number = 3,
  fieldsPatch?: Partial<EnrichmentFieldSelection>
): Promise<{ ok: boolean; error?: string; samples?: SampleEnrichmentPreview[] }> {
  const result = await runEnrichment(campaignId, {
    sampleOnly: true,
    sampleSize,
    fields: fieldsPatch,
  });
  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  return { ok: true, samples: result.samplePreviews };
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
