import { db } from '@/lib/db';
import { normalizeLinkedInSlug } from '@/lib/linkedinUrl';
import { resolveIntegrationField } from '@/lib/integrationConfig';
import { enrichContactsViaApollo } from '@/lib/apolloVerify';

export interface LinkedInResolveResult {
  ok: boolean;
  totalContacts: number;
  alreadyHadProfile: number;
  resolvedFromExtras: number;
  resolvedFromApollo: number;
  fallbackToSearch: number;
  error?: string;
}

/**
 * Background resolver for LinkedIn profiles:
 * Sifts through contacts for a campaign, ensuring every contact has either:
 * 1. A verified normalized LinkedIn slug stored in `linkedinId`
 * 2. Or is clearly flagged for smart people search fallback.
 */
export async function runLinkedInProfileResolver(
  campaignId: string,
  options?: { maxLookups?: number }
): Promise<LinkedInResolveResult> {
  try {
    const contacts = await db.contact.findMany({
      where: { campaignId, approved: true },
      select: {
        id: true,
        name: true,
        title: true,
        account: true,
        linkedinId: true,
        extraFieldsJson: true,
      },
    });

    if (contacts.length === 0) {
      return {
        ok: true,
        totalContacts: 0,
        alreadyHadProfile: 0,
        resolvedFromExtras: 0,
        resolvedFromApollo: 0,
        fallbackToSearch: 0,
      };
    }

    let alreadyHadProfile = 0;
    let resolvedFromExtras = 0;
    let resolvedFromApollo = 0;

    const toUpdate: Array<{ id: string; linkedinId: string }> = [];
    const missingCandidates: Array<{ id: string; name: string; title: string; account: string }> = [];

    for (const c of contacts) {
      const existingSlug = normalizeLinkedInSlug(c.linkedinId);
      if (existingSlug) {
        alreadyHadProfile++;
        // If the stored value wasn't normalized yet, queue an update
        if (c.linkedinId !== existingSlug) {
          toUpdate.push({ id: c.id, linkedinId: existingSlug });
        }
        continue;
      }

      // Check extraFieldsJson for LeadSquared attributes
      let foundInExtras = false;
      if (c.extraFieldsJson) {
        try {
          const extras = JSON.parse(c.extraFieldsJson) as Record<string, string>;
          const raw =
            extras.mx_LinkedIn_Profile ||
            extras.mx_Linkedin_Profile ||
            extras.LinkedIn ||
            extras.LinkedInUrl ||
            extras.mx_LinkedIn_Url ||
            extras.mx_Linkedin_Url ||
            extras.mx_LinkedIn ||
            extras.mx_Linkedin;
          const slug = normalizeLinkedInSlug(raw);
          if (slug) {
            toUpdate.push({ id: c.id, linkedinId: slug });
            resolvedFromExtras++;
            foundInExtras = true;
          }
        } catch {
          /* ignore json parse failure */
        }
      }

      if (!foundInExtras) {
        missingCandidates.push({
          id: c.id,
          name: c.name,
          title: c.title || '',
          account: c.account,
        });
      }
    }

    // Attempt Apollo lookup if apiKey is configured and there are missing profiles
    const apolloApiKey = (await resolveIntegrationField('apollo', 'apiKey')) || process.env.APOLLO_API_KEY || '';
    if (apolloApiKey && missingCandidates.length > 0) {
      const maxBatch = options?.maxLookups ?? 25;
      const batch = missingCandidates.slice(0, maxBatch);
      const { results } = await enrichContactsViaApollo(batch, {
        apiKey: apolloApiKey,
        revealEmails: false,
      });

      for (const candidate of batch) {
        const enriched = results.get(candidate.id);
        if (enriched?.found && enriched.linkedinUrl) {
          const slug = normalizeLinkedInSlug(enriched.linkedinUrl);
          if (slug) {
            toUpdate.push({ id: candidate.id, linkedinId: slug });
            resolvedFromApollo++;
          }
        }
      }
    }

    // Persist all resolved updates
    if (toUpdate.length > 0) {
      await db.$transaction(
        toUpdate.map((u) =>
          db.contact.update({
            where: { id: u.id },
            data: { linkedinId: u.linkedinId },
          })
        )
      );
    }

    const fallbackToSearch = contacts.length - (alreadyHadProfile + resolvedFromExtras + resolvedFromApollo);

    return {
      ok: true,
      totalContacts: contacts.length,
      alreadyHadProfile,
      resolvedFromExtras,
      resolvedFromApollo,
      fallbackToSearch: Math.max(0, fallbackToSearch),
    };
  } catch (err) {
    return {
      ok: false,
      totalContacts: 0,
      alreadyHadProfile: 0,
      resolvedFromExtras: 0,
      resolvedFromApollo: 0,
      fallbackToSearch: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
