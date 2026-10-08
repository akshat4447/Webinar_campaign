import { DeliveryRejectedError } from '@/lib/deliveryGuard';
import { db } from './db';
import { resolveIntegrationField } from './integrationConfig';
import type { EmailSuppression } from './generated/prisma/client';

export interface NetcoreSendParams {
  to: string;
  originalRecipient?: string;
  toName?: string;
  subject: string;
  html: string;
  text?: string;
  tags?: string[];
  attributes?: Record<string, string>;
}

export interface NetcoreSendResult {
  ok: boolean;
  messageId: string;
  error?: string;
}

const NETCORE_API_URL = 'https://emailapi.netcorecloud.net/v5/mail/send';


export async function sendNetcoreEmail(params: NetcoreSendParams): Promise<NetcoreSendResult> {
  const apiKey = (await resolveIntegrationField('netcore', 'apiKey')) || process.env.NETCORE_API_KEY;
  const fromEmail = (await resolveIntegrationField('netcore', 'fromEmail')) || process.env.NETCORE_FROM_EMAIL;
  const fromName = (await resolveIntegrationField('netcore', 'fromName')) || process.env.NETCORE_FROM_NAME || 'Webinar Team';

  const recipientEmail = params.to;
  const subject = params.subject;

  // Pre-flight suppression check
  const suppressed = (await isEmailSuppressed(params.to)) || (recipientEmail !== params.to ? await isEmailSuppressed(recipientEmail) : null);
  if (suppressed) {
    throw new DeliveryRejectedError(`Recipient ${params.to} is in suppression list (${suppressed.reason}): ${suppressed.detail || 'Refused'}`);
  }

  if (!apiKey?.trim() || apiKey.startsWith('mock_')) throw new DeliveryRejectedError('Netcore API key is not configured.');
  if (!fromEmail || fromEmail.endsWith('.example.com')) throw new DeliveryRejectedError('Configure a verified Netcore From email.');

  const htmlContent =
    params.html && params.html.trim().length > 0
      ? params.html
      : params.text
        ? `<div style="font-family: sans-serif; white-space: pre-wrap; line-height: 1.6;">${params.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>')}</div>`
        : '<p></p>';

  const payload = {
    from: {
      email: fromEmail,
      name: fromName,
    },
    subject,
    content: [
      {
        type: 'html',
        value: htmlContent,
      },
    ],
    personalizations: [
      {
        to: [
          {
            email: recipientEmail,
            name: params.toName || recipientEmail.split('@')[0],
          },
        ],
        attributes: params.attributes || {},
      },
    ],
    settings: {
      open_track: true,
      click_track: true,
      unsubscribe_track: true,
    },
    tags: params.tags || ['webinar_campaign'],
  };

  const response = await fetch(NETCORE_API_URL, {
    method: 'POST',
    headers: {
      api_key: apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  });

  const rawText = await response.text();
  let json: NetcoreJson = {};
  try {
    json = JSON.parse(rawText);
  } catch {
    /* text output */
  }

  const isNetcoreError =
    !response.ok ||
    Array.isArray(json) ||
    (json && typeof json === 'object' && typeof json.message === 'string' && json.message.toLowerCase().includes('error'));

  if (isNetcoreError) {
    let errorMsg = '';
    if (Array.isArray(json)) {
      errorMsg = json
        .map((item: unknown) => {
          if (!item || typeof item !== 'object') return String(item);
          const e = item as { description?: string; message?: string; field?: string };
          const desc = e.description || e.message;
          const field = e.field ? `[${e.field}] ` : '';
          return desc ? `${field}${desc}` : JSON.stringify(item);
        })
        .join('; ');
    } else if (typeof json?.error === 'string') {
      errorMsg = json.error;
    } else if (typeof json?.error === 'object' && json?.error !== null) {
      errorMsg = (json.error as { message?: string }).message || JSON.stringify(json.error);
    } else if (typeof json?.message === 'string') {
      errorMsg = json.message;
    } else {
      errorMsg = rawText || `HTTP ${response.status}`;
    }
    throw new DeliveryRejectedError(`Netcore Email API rejected send to ${recipientEmail}: ${errorMsg}`, response.status);
  }

  const messageId = json.data?.message_id || '';
  return {
    ok: true,
    messageId,
  };
}

/** Loosely-typed shape of Netcore's JSON responses, which vary by endpoint. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type NetcoreJson = any;

/**
 * Fetches verified sending domains directly from Netcore API (v6 & v5 endpoints).
 */
export async function fetchNetcoreVerifiedDomains(apiKey: string): Promise<{ ok: boolean; domains: string[]; error?: string }> {
  const key = apiKey.trim();
  if (!key) {
    return { ok: false, domains: [], error: 'Netcore Email API Key is required.' };
  }


  const endpoints = [
    'https://emailapi.netcorecloud.net/v6/domains',
    'https://apieu.netcorecloud.net/v6/domains',
  ];

  let lastError = 'No verified domains found on this Netcore account.';

  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${key}`,
          api_key: key,
          'api-key': key,
          'Content-Type': 'application/json',
        },
        cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
      });

      if (res.status === 401 || res.status === 403) {
        lastError = `Netcore API Key is invalid or unauthorized (${res.status}). Ensure "Domain Read" permission is enabled on this API key.`;
        continue;
      }

      if (!res.ok) {
        continue;
      }

      const json = (await res.json().catch(() => ({}))) as NetcoreJson;
      const domains: string[] = [];

      const extract = (item: unknown) => {
        if (!item) return;
        if (typeof item === 'string' && item.includes('.')) {
          domains.push(item.toLowerCase());
        } else if (typeof item === 'object') {
          const o = item as Record<string, unknown>;
          const d = o.domain || o.domain_name || o.name || o.domainName;
          if (d && typeof d === 'string' && d.includes('.')) {
            domains.push(d.toLowerCase());
          }
        }
      };

      if (Array.isArray(json?.data)) {
        json.data.forEach(extract);
      } else if (Array.isArray(json?.domains)) {
        json.domains.forEach(extract);
      } else if (Array.isArray(json)) {
        json.forEach(extract);
      } else if (json?.data) {
        extract(json.data);
      }

      const unique = Array.from(new Set(domains));
      const sorted = unique.sort((a, b) => {
        const aSandbox = a.includes('sandbox') || a.includes('pepi');
        const bSandbox = b.includes('sandbox') || b.includes('pepi');
        if (aSandbox && !bSandbox) return 1;
        if (!aSandbox && bSandbox) return -1;
        return 0;
      });

      if (sorted.length > 0) {
        return { ok: true, domains: sorted };
      }
    } catch {
      // try next endpoint
    }
  }

  return { ok: false, domains: [], error: lastError };
}

/**
 * Validates Netcore API credentials and sender domain.
 * Automatically discovers verified domains if fromEmail is omitted!
 */
export async function testNetcoreConnection(fields?: Record<string, string>): Promise<{ ok: boolean; detail: string; autoDiscovered?: { domain: string; fromEmail: string; fromName: string } }> {
  const apiKey = fields?.apiKey || (await resolveIntegrationField('netcore', 'apiKey')) || process.env.NETCORE_API_KEY;
  let fromEmail = fields?.fromEmail || (await resolveIntegrationField('netcore', 'fromEmail')) || process.env.NETCORE_FROM_EMAIL;
  let domain = fields?.domain || (await resolveIntegrationField('netcore', 'domain')) || (fromEmail ? fromEmail.split('@')[1] : null);

  if (!apiKey) {
    return { ok: false, detail: 'Netcore Email API Key is required.' };
  }

  let autoDiscovered: { domain: string; fromEmail: string; fromName: string } | undefined = undefined;

  // Auto-fetch domain and fromEmail if missing
  if (!fromEmail || !fromEmail.includes('@')) {
    const discovery = await fetchNetcoreVerifiedDomains(apiKey);
    if (discovery.ok && discovery.domains.length > 0) {
      domain = discovery.domains[0];
      fromEmail = `events@${domain}`;
      const fromName = fields?.fromName || 'Webinar Team';
      autoDiscovered = { domain, fromEmail, fromName };

      const { saveIntegrationConfig } = await import('./integrationConfig');
      await saveIntegrationConfig('netcore', {
        ...(apiKey ? { apiKey } : {}),
        domain,
        fromEmail,
        fromName,
      });
    } else {
      return { ok: false, detail: discovery.error || 'A valid From Email address matching your sending domain is required.' };
    }
  }


  try {
    const verifyUrl = domain
      ? `https://emailapi.netcorecloud.net/v6/domains/${encodeURIComponent(domain)}`
      : 'https://emailapi.netcorecloud.net/v6/domains';

    // Probe Netcore Domain or API verification
    const res = await fetch(verifyUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        api_key: apiKey,
        'api-key': apiKey,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
    });

    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        detail: `Netcore API Key is invalid or unauthorized (HTTP ${res.status}). Ensure "Domain Read" permission is enabled on your API key in Netcore.`,
      };
    }

    if (res.status === 400) {
      const json = await res.json().catch(() => ({}));
      const msg = json.data || json.message || 'Domain is not registered in your Netcore account.';
      return { ok: false, detail: `Domain verification note: ${msg}` };
    }

    if (!res.ok) {
      return { ok: false, detail: `Netcore API returned HTTP ${res.status}: ${res.statusText || 'Verification failed'}` };
    }

    const domainData = await res.json().catch(() => ({}));
    const dkimValid = domainData?.dkim?.valid === true;

    return {
      ok: true,
      detail: `Connected to Netcore Cloud · Sender: ${fromEmail}${domain ? ` (Domain: ${domain}${dkimValid ? ' · DKIM verified' : ''})` : ''}`,
      autoDiscovered,
    };
  } catch (err) {
    return {
      ok: false,
      detail: `Could not reach Netcore API: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Remote Netcore Suppression Synchronization
// ---------------------------------------------------------------------------

/**
 * Syncs email to Netcore's remote suppression list if Suppression Read/Write permission is granted.
 */
export async function syncSuppressionToNetcore(email: string, reason: string): Promise<boolean> {
  const apiKey = (await resolveIntegrationField('netcore', 'apiKey')) || process.env.NETCORE_API_KEY;
  if (!apiKey || apiKey.startsWith('mock_')) return false;

  try {
    const res = await fetch('https://emailapi.netcorecloud.net/v5/suppression', {
      method: 'POST',
      headers: {
        api_key: apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, reason }),
      cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Removes email from Netcore's remote suppression list if Suppression Read/Write permission is granted.
 */
export async function syncSuppressionRemovalFromNetcore(email: string): Promise<boolean> {
  const apiKey = (await resolveIntegrationField('netcore', 'apiKey')) || process.env.NETCORE_API_KEY;
  if (!apiKey || apiKey.startsWith('mock_')) return false;

  try {
    const res = await fetch(`https://emailapi.netcorecloud.net/v5/suppression?email=${encodeURIComponent(email)}`, {
      method: 'DELETE',
      headers: {
        api_key: apiKey,
      },
      cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Suppression List Management
// ---------------------------------------------------------------------------

export async function isEmailSuppressed(email: string | null | undefined): Promise<EmailSuppression | null> {
  if (!email || typeof email !== 'string' || !email.trim()) return null;
  const normalized = email.trim().toLowerCase();
  return db.emailSuppression.findUnique({
    where: { email: normalized },
  });
}

export async function addEmailToSuppression(
  email: string,
  reason: 'bounce' | 'unsubscribe' | 'spam' | 'manual',
  detail?: string | null,
  provider = 'netcore'
): Promise<EmailSuppression> {
  if (!email || typeof email !== 'string' || !email.trim()) {
    throw new Error('Valid email address is required to add to suppression list');
  }
  const normalized = email.trim().toLowerCase();

  // Fire-and-forget sync to Netcore Cloud native suppression list if live key is present
  syncSuppressionToNetcore(normalized, reason).catch(() => {});

  return db.emailSuppression.upsert({
    where: { email: normalized },
    create: {
      email: normalized,
      reason,
      detail: detail ?? null,
      provider,
    },
    update: {
      reason,
      detail: detail ?? null,
      provider,
    },
  });
}

export async function removeEmailFromSuppression(email: string): Promise<boolean> {
  if (!email || typeof email !== 'string' || !email.trim()) return false;
  const normalized = email.trim().toLowerCase();

  // Fire-and-forget remote removal
  syncSuppressionRemovalFromNetcore(normalized).catch(() => {});

  try {
    await db.emailSuppression.delete({
      where: { email: normalized },
    });
    return true;
  } catch {
    return false;
  }
}

export async function getSuppressionList(options?: {
  search?: string;
  reason?: string;
  page?: number;
  pageSize?: number;
}): Promise<{
  items: EmailSuppression[];
  total: number;
  counts: Record<string, number>;
}> {
  const rawPage = options?.page ?? 1;
  const pageIndex = rawPage > 0 ? rawPage - 1 : 0;
  const pageSize = options?.pageSize ?? 25;
  const search = options?.search?.trim().toLowerCase();
  const reason = options?.reason && options.reason !== 'all' ? options.reason : undefined;

  const searchWhere = search ? { email: { contains: search, mode: 'insensitive' as const } } : {};
  const where = {
    ...(reason ? { reason } : {}),
    ...searchWhere,
  };

  const [items, total, allCounts] = await Promise.all([
    db.emailSuppression.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: pageIndex * pageSize,
      take: pageSize,
    }),
    db.emailSuppression.count({ where }),
    // Scoped to the search term (but not `reason` — each bucket needs its own
    // count regardless of which tab is active) so the per-reason pills stay
    // consistent with "All" instead of showing unfiltered global totals the
    // moment a search narrows the visible/total counts.
    db.emailSuppression.groupBy({
      by: ['reason'],
      where: searchWhere,
      _count: true,
    }),
  ]);

  const counts: Record<string, number> = { all: 0, bounce: 0, unsubscribe: 0, spam: 0, manual: 0 };
  for (const c of allCounts) {
    counts[c.reason] = c._count;
    counts.all += c._count;
  }

  return { items, total, counts };
}
