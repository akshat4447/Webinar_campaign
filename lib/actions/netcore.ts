'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import {
  getSuppressionList,
  addEmailToSuppression,
  removeEmailFromSuppression,
  isEmailSuppressed,
} from '@/lib/netcore';

const DEFAULT_EMAIL_PROVIDER_KEY = 'default_email_provider';

export async function getSuppressionListAction(options?: {
  search?: string;
  reason?: string;
  page?: number;
  pageSize?: number;
}) {
  return getSuppressionList(options);
}

// Deliberately simple (not full RFC 5322) — just enough to reject `a@`, `@b`,
// `x@y` (no dot in the domain), which `.includes('@')` alone let through and
// which then never match a real Contact's normalized email.
const BASIC_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function addSuppressionAction(
  email: string,
  reason: 'bounce' | 'unsubscribe' | 'spam' | 'manual',
  detail?: string
) {
  if (!email || !BASIC_EMAIL_RE.test(email.trim())) {
    return { ok: false, error: 'A valid email address is required.' };
  }
  try {
    const item = await addEmailToSuppression(email, reason, detail, 'manual');
    revalidatePath('/integrations');
    return { ok: true, item };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function removeSuppressionAction(email: string) {
  try {
    const success = await removeEmailFromSuppression(email);
    // Only clear the block when a row was actually removed — this ran
    // unconditionally before, so removing a stale/typo'd email that didn't
    // match any suppression row still silently re-enabled sending to every
    // Contact with that address across every campaign.
    if (success) {
      await db.contact.updateMany({
        where: { email: { equals: email.trim().toLowerCase(), mode: 'insensitive' } },
        data: { unsubscribedAt: null },
      });
    }
    revalidatePath('/integrations');
    return { ok: success };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function checkEmailSuppressionAction(email: string) {
  const item = await isEmailSuppressed(email);
  return { suppressed: !!item, item };
}

export async function getDefaultEmailProviderAction(): Promise<'leadsquared' | 'netcore'> {
  try {
    const setting = await db.appSetting.findUnique({ where: { key: DEFAULT_EMAIL_PROVIDER_KEY } });
    if (setting?.value === 'netcore' || setting?.value === 'leadsquared') {
      return setting.value;
    }
  } catch {
    /* fallback to default */
  }
  return (process.env.DEFAULT_EMAIL_PROVIDER as 'leadsquared' | 'netcore') || 'leadsquared';
}

export async function setDefaultEmailProviderAction(
  provider: 'leadsquared' | 'netcore'
): Promise<{ ok: boolean; provider: 'leadsquared' | 'netcore' }> {
  await db.appSetting.upsert({
    where: { key: DEFAULT_EMAIL_PROVIDER_KEY },
    create: { key: DEFAULT_EMAIL_PROVIDER_KEY, value: provider },
    update: { value: provider },
  });
  revalidatePath('/integrations');
  return { ok: true, provider };
}

/**
 * Connects to Netcore API to discover verified domains and auto-configure a valid From Email address.
 */
export async function discoverNetcoreSenderAction(apiKeyOverride?: string): Promise<{
  ok: boolean;
  domain?: string;
  fromEmail?: string;
  fromName?: string;
  allDomains?: string[];
  error?: string;
}> {
  const { resolveIntegrationField, saveIntegrationConfig } = await import('@/lib/integrationConfig');
  const apiKey = apiKeyOverride || (await resolveIntegrationField('netcore', 'apiKey')) || process.env.NETCORE_API_KEY;

  if (!apiKey || apiKey.trim() === '') {
    return { ok: false, error: 'Netcore Email API Key is required to auto-fetch verified domains.' };
  }

  const { fetchNetcoreVerifiedDomains } = await import('@/lib/netcore');
  const res = await fetchNetcoreVerifiedDomains(apiKey);
  if (!res.ok || res.domains.length === 0) {
    return { ok: false, error: res.error || 'No verified domains found in this Netcore account.' };
  }

  const primaryDomain = res.domains[0];
  const suggestedEmail = `events@${primaryDomain}`;
  const suggestedName = 'Webinar Team';

  await saveIntegrationConfig('netcore', {
    ...(apiKeyOverride ? { apiKey: apiKeyOverride } : {}),
    domain: primaryDomain,
    fromEmail: suggestedEmail,
    fromName: suggestedName,
  });

  revalidatePath('/integrations');

  return {
    ok: true,
    domain: primaryDomain,
    fromEmail: suggestedEmail,
    fromName: suggestedName,
    allDomains: res.domains,
  };
}
