// Server-only. Never import this from a 'use client' component — it reads
// LSQ_ACCESS_KEY / LSQ_SECRET_KEY / LSQ_HOST from the environment (and, if saved
// on the Integrations page, from the DB — see resolveLsqConfig) and must not
// ship to the browser. Endpoints verified against https://apidocs.leadsquared.com/.

import { resolveIntegrationField, resolveIntegrationField as resolveField } from '@/lib/integrationConfig';

export class LeadSquaredError extends Error {
  constructor(
    public status: number,
    public body: unknown,
    message: string
  ) {
    super(message);
    this.name = 'LeadSquaredError';
  }
}

export interface LsqConfigOverride {
  accessKey?: string;
  secretKey?: string;
  host?: string;
}

// DB (Integrations page) wins over .env.local; an explicit override (the
// Integrations page's "Test connection", trying a value before it's saved)
// wins over both. Every real call path goes through this — save a new key
// from the UI and it takes effect everywhere immediately.
async function resolveLsqConfig(override?: LsqConfigOverride) {
  const accessKey = override?.accessKey || (await resolveIntegrationField('lsq', 'accessKey'));
  const secretKey = override?.secretKey || (await resolveIntegrationField('lsq', 'secretKey'));
  const rawHost = override?.host || (await resolveIntegrationField('lsq', 'host'));
  if (!accessKey || !secretKey) throw new Error('LeadSquared Access Key / Secret Key are not set — add them on the Integrations page or in .env.local');
  if (!rawHost) throw new Error('LeadSquared host is not set — add it on the Integrations page or in .env.local');
  // Accept either a bare host ("api-in21.leadsquared.com") or a full base URL
  // ("https://api-in21.leadsquared.com/v2/") — only the hostname is used.
  const host = rawHost.includes('://') ? new URL(rawHost).host : rawHost.replace(/\/.*$/, '');
  return { accessKey, secretKey, baseUrl: `https://${host}/v2` };
}

async function lsqFetch<T>(
  path: string,
  opts: { method?: 'GET' | 'POST' | 'PUT'; query?: Record<string, string>; body?: unknown } = {},
  override?: LsqConfigOverride
): Promise<T> {
  const { method = 'GET', query, body } = opts;
  const cfg = await resolveLsqConfig(override);
  const authQuery = `accessKey=${encodeURIComponent(cfg.accessKey)}&secretKey=${encodeURIComponent(cfg.secretKey)}`;
  const qs = new URLSearchParams(query).toString();
  const url = `${cfg.baseUrl}${path}?${authQuery}${qs ? `&${qs}` : ''}`;

  const MAX_RETRIES = 3;
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        cache: 'no-store',
      });

      // Handle 429 rate limits or transient 503 errors with exponential backoff
      if ((res.status === 429 || res.status === 503) && attempt < MAX_RETRIES) {
        const backoffMs = Math.pow(2, attempt) * 1000 + Math.floor(Math.random() * 500);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
        continue;
      }

      const text = await res.text();
      let parsed: unknown = text;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        // some LSQ error responses aren't JSON — keep the raw text
      }

      if (!res.ok) {
        throw new LeadSquaredError(
          res.status,
          parsed,
          `LeadSquared ${method} ${path} failed: ${res.status} ${typeof parsed === 'string' ? parsed : JSON.stringify(parsed)}`
        );
      }
      return parsed as T;
    } catch (err) {
      lastError = err;
      if (err instanceof LeadSquaredError && err.status !== 429 && err.status !== 503) {
        throw err;
      }
      if (attempt < MAX_RETRIES) {
        const backoffMs = Math.pow(2, attempt) * 1000 + Math.floor(Math.random() * 500);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`LeadSquared request failed after ${MAX_RETRIES} attempts.`);
}

// --- connectivity check -----------------------------------------------------

export async function getLeadsMetadata(override?: LsqConfigOverride) {
  return lsqFetch<Array<{ SchemaName: string; DisplayName: string; DataType: string }>>('/LeadManagement.svc/LeadsMetaData.Get', {}, override);
}

// --- leads -------------------------------------------------------------------

export interface LeadField {
  Attribute: string;
  Value: string;
}

export async function createOrUpdateLead(fields: LeadField[], searchBy: string = 'EmailAddress'): Promise<{ Status: string; Message: { Id: string; AffectedRows: number } }> {
  const hasSearchBy = fields.some((f) => f.Attribute === 'SearchBy');
  const body = hasSearchBy ? fields : [...fields, { Attribute: 'SearchBy', Value: searchBy }];
  return lsqFetch('/LeadManagement.svc/Lead.CreateOrUpdate', {
    method: 'POST',
    query: { postUpdatedLead: 'true' },
    body,
  });
}

export interface LsqList {
  ListId: string;
  ListName: string;
  ListDescription: string;
  ListType: string;
  MemberCount: number;
}

export async function getLists(): Promise<LsqList[]> {
  const result = await lsqFetch<LsqList[] | { message?: string }>('/LeadManagement.svc/Lists.Get');
  return Array.isArray(result) ? result : [];
}

export async function createEmptyList(name: string, description: string): Promise<string> {
  const result = await lsqFetch<{ Status: string; Message: { Id: string } }>('/LeadSegmentation.svc/CreateEmptyList', {
    method: 'POST',
    body: { Name: name, Description: description },
  });
  return result.Message.Id;
}

export async function addLeadsToStaticList(listId: string, leadIds: string[]): Promise<void> {
  for (let i = 0; i < leadIds.length; i += 25) {
    const chunk = leadIds.slice(i, i + 25);
    await lsqFetch('/LeadSegmentation.svc/AddLeadsToStaticList', { method: 'POST', body: { listId, leadIds: chunk } });
    if (i + 25 < leadIds.length) await sleep(200);
  }
}

export async function emptyStaticList(listId: string): Promise<void> {
  await lsqFetch<{ Status: string; Message: { Id: string } }>('/LeadSegmentation.svc/Lists/EmptyStaticList', {
    method: 'GET',
    query: { ListId: listId },
  });
}

export interface BulkLeadResult {
  RowNumber: number;
  LeadId: string;
  LeadCreated: boolean;
  LeadUpdated: boolean;
  AffectedRows: number;
  // Present instead of a real LeadId when this specific row failed — the bulk
  // endpoint reports per-row failures inline rather than throwing.
  ExceptionType?: string;
  ErrorMessage?: string;
}

// Each entry in `leads` is one lead's field list (must include a unique
// identifier — email or phone — plus SearchBy). Chunks to LSQ's 25-per-call cap.
// The returned RowNumber is normalized to a 0-based index into the original
// `leads` array (LSQ's own RowNumber is 1-based within each chunk).
export async function bulkCreateOrUpdateLeads(leads: LeadField[][]): Promise<BulkLeadResult[]> {
  const results: BulkLeadResult[] = [];
  for (let i = 0; i < leads.length; i += 25) {
    const chunk = leads.map((fields) => (fields.some((f) => f.Attribute === 'SearchBy') ? fields : [...fields, { Attribute: 'SearchBy', Value: 'EmailAddress' }])).slice(i, i + 25);
    const chunkResults = await lsqFetch<BulkLeadResult[]>('/LeadManagement.svc/Lead/Bulk/CreateOrUpdate', { method: 'POST', body: chunk });
    for (const r of chunkResults) results.push({ ...r, RowNumber: r.RowNumber - 1 + i });
    if (i + 25 < leads.length) await sleep(200);
  }
  return results;
}

const CONTACT_COLUMNS = ['ProspectID', 'FirstName', 'LastName', 'EmailAddress', 'Phone', 'Company', 'Designation'];

export interface RawLsqLead {
  [attribute: string]: string;
}

export async function getLeadsInList(listId: string, pageSize = 200): Promise<RawLsqLead[]> {
  const result = await lsqFetch<{ RecordCount: number; Leads: Array<{ LeadPropertyList: Array<{ Attribute: string; Value: string }> }> }>(
    '/LeadManagement.svc/Leads/Retrieve/BySearchParameter',
    {
      method: 'POST',
      body: {
        SearchParameters: { ListId: listId, RetrieveBehaviour: '0' },
        Columns: { Include_CSV: CONTACT_COLUMNS.join(',') },
        Sorting: { ColumnName: 'CreatedOn', Direction: '1' },
        Paging: { PageIndex: 1, PageSize: pageSize },
      },
    }
  );
  return (result.Leads ?? []).map((lead) => {
    const row: RawLsqLead = {};
    for (const prop of lead.LeadPropertyList) row[prop.Attribute] = prop.Value;
    return row;
  });
}

// --- custom activity push-back ------------------------------------------------

export async function createActivityType(name: string, fields: { schemaName: string; displayName: string }[]): Promise<number> {
  const result = await lsqFetch<{ Status: string; Message: { Id: number } }>('/ProspectActivity.svc/CreateType', {
    method: 'POST',
    body: {
      ActivityEventName: name,
      Description: `Created by Webinar Campaign Agent`,
      Direction: 1,
      ShowInActivityGrid: 1,
      Fields: fields.map((f, i) => ({ SchemaName: f.schemaName, DisplayName: f.displayName, DataType: 'String', IsMandatory: false, ShowInForm: true, Sequence: i + 1 })),
    },
  });
  return result.Message.Id;
}

export interface CustomActivity {
  RelatedProspectId: string;
  ActivityEvent: number;
  ActivityNote: string;
  Fields?: { SchemaName: string; Value: string }[];
}

export async function pushCustomActivities(activities: CustomActivity[]): Promise<void> {
  for (let i = 0; i < activities.length; i += 25) {
    const chunk = activities.slice(i, i + 25);
    await lsqFetch('/ProspectActivity.svc/Bulk/CustomActivity/Add/ByLeadId', { method: 'POST', body: chunk });
    if (i + 25 < activities.length) await sleep(250);
  }
}

// --- users & sender identity ----------------------------------------------------

export interface LsqUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  /** LSQ uses StatusCode 0 for an active user. */
  active: boolean;
}

/** Every user on the account — the candidate pool for a sending identity. */
export async function listUsers(): Promise<LsqUser[]> {
  const rows = await lsqFetch<Array<Record<string, unknown>>>('/UserManagement.svc/Users.Get');
  if (!Array.isArray(rows)) return [];
  return rows
    .map((u) => ({
      id: String(u.UserId ?? u.ID ?? ''),
      email: String(u.EmailAddress ?? ''),
      firstName: String(u.FirstName ?? ''),
      lastName: String(u.LastName ?? ''),
      role: String(u.Role ?? ''),
      active: Number(u.StatusCode ?? 0) === 0,
    }))
    .filter((u) => u.email.includes('@'));
}

export type SenderProbe = { verdict: 'valid' | 'invalid' | 'error'; detail: string };

/**
 * Answers "would LeadSquared accept this address as a From identity?" WITHOUT
 * sending any email.
 *
 * The trick: LSQ validates the sender before it attempts delivery, so aiming at
 * a deliberately undeliverable recipient separates the two failure modes.
 * `example.invalid` is an IANA-reserved TLD that can never resolve, so no
 * message can escape even in principle.
 *   • sender rejected  → "Invalid Sender details."
 *   • sender accepted  → "No lead found with RecipientType: LeadEmailAddress…"
 * That second error is the success signal: validation passed and LSQ only then
 * discovered it had nobody to deliver to.
 */
export async function probeSenderIdentity(senderEmail: string): Promise<SenderProbe> {
  await throttle();
  try {
    await lsqFetch('/EmailMarketing.svc/SendEmailToLead', {
      method: 'POST',
      body: {
        SenderType: 'UserEmailAddress',
        Sender: senderEmail,
        RecipientType: 'LeadEmailAddress',
        Recipient: 'sender-validation-probe@example.invalid',
        EmailType: 'Html',
        Subject: 'sender validation probe',
        ContentHTML: '<p>probe</p>',
        ContentText: 'probe',
      },
    });
    // Reaching here would mean LSQ accepted an undeliverable recipient, which
    // it never has. Treat as valid rather than inventing a failure.
    return { verdict: 'valid', detail: 'Accepted (unexpectedly returned success).' };
  } catch (err) {
    const raw = err instanceof LeadSquaredError ? `${typeof err.body === 'string' ? err.body : JSON.stringify(err.body ?? {})}` : String(err);
    const msg = raw.match(/"ExceptionMessage"\s*:\s*"([^"]+)"/)?.[1] ?? raw.slice(0, 160);
    if (/No lead found/i.test(msg)) return { verdict: 'valid', detail: msg };
    if (/Invalid Sender/i.test(msg)) return { verdict: 'invalid', detail: msg };
    return { verdict: 'error', detail: msg };
  }
}

// --- email sending -------------------------------------------------------------

export interface SendEmailParams {
  recipientEmail: string;
  subject: string;
  contentHtml: string;
  contentText: string;
  emailCategory?: string;
}

// LSQ rate limit is 25 calls / 5 seconds; a fixed 220ms gap keeps every caller under that
// without needing a shared token-bucket for a single-instance demo app.
let lastSendAt = 0;
async function throttle() {
  const wait = lastSendAt + 220 - Date.now();
  if (wait > 0) await sleep(wait);
  lastSendAt = Date.now();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function sendEmailToLead(params: SendEmailParams): Promise<{ ID: string; MemberCount: number; TotalRecipient: number }> {
  await throttle();
  // Two sender identities exist on LSQ accounts, and either can be the broken
  // one depending on tenant configuration:
  //   UserEmailAddress — sends as a real LSQ user (needs the configured email
  //                      to be the EXACT address of an active user)
  //   APICaller        — sends as the API user's identity (works only where an
  //                      admin has configured that identity)
  // MXMandatoryAttributeMissingException "Invalid Sender details" means the
  // chosen identity isn't recognised, so we automatically retry with the other
  // one before surfacing a precise, actionable error.
  const senderEmail = await resolveIntegrationField('lsq', 'senderEmail');
  const strategies: Array<{ type: 'UserEmailAddress' | 'APICaller'; sender?: string }> = senderEmail
    ? [
        { type: 'UserEmailAddress', sender: senderEmail },
        { type: 'APICaller' },
      ]
    : [{ type: 'APICaller' }];

  const buildBody = (s: { type: 'UserEmailAddress' | 'APICaller'; sender?: string }) => ({
    SenderType: s.type,
    ...(s.type === 'UserEmailAddress' && s.sender ? { Sender: s.sender } : {}),
    RecipientType: 'LeadEmailAddress',
    Recipient: params.recipientEmail,
    EmailType: 'Html',
    Subject: params.subject,
    ContentHTML: params.contentHtml,
    ContentText: params.contentText,
    IncludeEmailFooter: true,
    // EmailCategory must reference a category that already exists in the
    // LeadSquared account's settings — an invented value 500s. Omit unless
    // the caller passes one known to exist.
    ...(params.emailCategory ? { EmailCategory: params.emailCategory } : {}),
  });

  let lastRaw = '';
  for (const s of strategies) {
    try {
      return await lsqFetch<{ ID: string; MemberCount: number; TotalRecipient: number }>('/EmailMarketing.svc/SendEmailToLead', {
        method: 'POST',
        body: buildBody(s),
      });
    } catch (err) {
      // err.body is a PARSED object — String() on it yields "[object Object]",
      // which made every pattern below fail to match. That silently disabled
      // the dual-identity retry AND produced sender-blaming errors for
      // failures that had nothing to do with the sender.
      lastRaw = err instanceof LeadSquaredError ? `${err.status} ${typeof err.body === 'string' ? err.body : JSON.stringify(err.body ?? {})}` : String(err);

      // A delivery rejection is NOT a sender problem: the identity was accepted
      // and LeadSquared refused to deliver. Retrying the other identity cannot
      // help, so surface it immediately with the causes that actually apply.
      if (/MailDelivery/i.test(lastRaw)) {
        throw new Error(
          `LeadSquared accepted the sender but refused to DELIVER to ${params.recipientEmail} (MXMailDeliveryException). ` +
            `This is an account-level mail restriction, not a code or sender problem — check, in LSQ: ` +
            `(1) Settings → Billing and Usage for remaining email credits, ` +
            `(2) a verified sending domain, and (3) DKIM/SPF records. Raw: ${lastRaw.slice(0, 200)}`
        );
      }

      // Only a sender-identity rejection justifies retrying with the other
      // identity — anything else (rate limit, recipient missing) must surface.
      if (!/Invalid Sender|MandatoryAttributeMissing/i.test(lastRaw)) throw err;
    }
  }

  throw new Error(
    senderEmail
      ? `LeadSquared rejected BOTH sender identities ("${senderEmail}" and APICaller). In LSQ → Settings → Users, confirm "${senderEmail}" is an ACTIVE user with email sending enabled, or clear the Sender email field to use APICaller after configuring that identity with LSQ support. Raw: ${lastRaw.slice(0, 200)}`
      : `LeadSquared rejected the APICaller sender identity. Set LSQ_SENDER_EMAIL (or Integrations → LeadSquared → Sender email) to the exact email of an ACTIVE LeadSquared user — that becomes the verified From address. Raw: ${lastRaw.slice(0, 200)}`
  );
}

// --- SMS / WhatsApp channels ---------------------------------------------------
// Two delivery strategies exist for these channels (see lib/channelDelivery.ts):
//   direct  — this module calls a LeadSquared send endpoint per lead. The exact
//             path differs per tenant (SMS gateways / WhatsApp add-ons are
//             account-level features), so it is CONFIG (lsq.smsEndpoint /
//             lsq.waEndpoint on the Integrations page), not a constant.
//   trigger — the default. A custom activity is pushed on the lead; an LSQ
//             Automation program sends through LSQ's own compliant gateway,
//             inheriting DND scrubbing, sender IDs and Meta-approved templates.

export class UnsupportedChannelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedChannelError';
  }
}

/** GET a single lead by email — used to resolve the sandbox allowlist phone. */
export async function getLeadByEmailAddress(email: string): Promise<RawLsqLead | null> {
  // Two details verified against the live API, both previously wrong here:
  //  • the query parameter is `emailaddress`, not `email` — with the wrong name
  //    LSQ answers 200 with an empty array, so every lookup silently "found
  //    nothing" for leads that plainly existed;
  //  • the response is a BARE ARRAY of flat lead objects, not
  //    { Leads: [{ LeadPropertyList }] }.
  // The Attribute/Value shape is still handled below because other retrieve
  // endpoints on this API do return it.
  const result = await lsqFetch<unknown>('/LeadManagement.svc/Leads.GetByEmailAddress', {
    query: { emailaddress: email },
  });

  const rows: unknown[] = Array.isArray(result)
    ? result
    : ((result as { Leads?: unknown[] } | null)?.Leads ?? []);
  const first = rows[0];
  if (!first || typeof first !== 'object') return null;

  const obj = first as Record<string, unknown>;
  if (Array.isArray(obj.LeadPropertyList)) {
    const row: RawLsqLead = {};
    for (const prop of obj.LeadPropertyList as Array<{ Attribute: string; Value: string }>) row[prop.Attribute] = prop.Value;
    return row;
  }

  const row: RawLsqLead = {};
  for (const [k, v] of Object.entries(obj)) row[k] = v == null ? '' : String(v);
  return row;
}

/** Strategy A transport for SMS — endpoint comes from tenant config. */
export async function sendSmsToLeadDirect(params: {
  mobile: string;
  message: string;
  dltTemplateId?: string | null;
  senderId?: string | null;
}): Promise<unknown> {
  const path = await resolveField('lsq', 'smsEndpoint');
  if (!path) {
    throw new UnsupportedChannelError('No lsq.smsEndpoint configured — set it on the Integrations page or use the trigger strategy.');
  }
  const body: Record<string, unknown> = { PhoneNumber: params.mobile, TextMessage: params.message };
  if (params.dltTemplateId) body.DltTemplateId = params.dltTemplateId;
  if (params.senderId) body.SenderId = params.senderId;
  return lsqFetch(path, {
    method: 'POST',
    body,
  });
}

/** Strategy A transport for WhatsApp — same config story as SMS. */
export async function sendWhatsappDirect(params: { mobile: string; message: string }): Promise<unknown> {
  const path = await resolveField('lsq', 'waEndpoint');
  if (!path) {
    throw new UnsupportedChannelError('No lsq.waEndpoint configured — WhatsApp sends run through the trigger strategy.');
  }
  return lsqFetch(path, {
    method: 'POST',
    body: { PhoneNumber: params.mobile, Message: params.message },
  });
}

// --- activity type discovery (for manual/auto mapping) -------------------------

export interface LsqActivityType {
  id: number;
  name: string;
}

export interface ActivityTypesResult {
  types: LsqActivityType[];
  /** Which candidate path actually answered — null when every one failed. */
  sourcePath: string | null;
  /** One line per failed candidate, so a total failure is diagnosable instead of silent. */
  attempts: string[];
}

/**
 * Lists the account's activity types. LSQ exposes this under slightly
 * different paths across versions/API generations, so we probe the known
 * candidates (GET first, then empty-body POST) and normalize the winner.
 *
 * Returns the probe outcome rather than a bare array: an empty list used to be
 * indistinguishable from "every endpoint failed", which made the Activity
 * mapping card look like it had loaded when it had actually found nothing.
 */
export async function listActivityTypes(): Promise<ActivityTypesResult> {
  const candidates = [
    '/ProspectActivity.svc/ActivityTypes.Get',
    '/ProspectActivity.svc/Types.Get',
    '/ProspectActivity.svc/ActivityTypes',
    '/ProspectActivity.svc/Types',
  ];
  const attempts: string[] = [];
  for (const path of candidates) {
    for (const method of ['GET', 'POST'] as const) {
      try {
        const res = await lsqFetch<unknown>(path, method === 'POST' ? { method: 'POST', body: {} } : {});
        const arr = Array.isArray(res)
          ? res
          : ((res as { ActivityTypes?: unknown[]; Types?: unknown[]; Data?: unknown[] } | null)?.ActivityTypes ??
            (res as { Types?: unknown[] } | null)?.Types ??
            (res as { Data?: unknown[] } | null)?.Data ??
            []);
        if (!Array.isArray(arr) || (arr.length === 0 && method === 'GET')) {
          attempts.push(`${method} ${path} → no array in response`);
          continue;
        }
        const out: LsqActivityType[] = [];
        for (const t of arr as Array<Record<string, unknown>>) {
          const id = Number(t.ActivityEvent ?? t.Id ?? t.ActivityTypeId ?? NaN);
          const name = String(t.ActivityTypeName ?? t.Name ?? t.ActivityEventName ?? '');
          if (Number.isFinite(id) && name) out.push({ id, name });
        }
        if (out.length > 0) {
          out.sort((a, b) => a.name.localeCompare(b.name));
          return { types: out, sourcePath: `${method} ${path}`, attempts };
        }
        attempts.push(`${method} ${path} → ${arr.length} rows but none had a usable id+name`);
      } catch (err) {
        attempts.push(`${method} ${path} → ${err instanceof Error ? err.message.slice(0, 120) : String(err).slice(0, 120)}`);
      }
    }
  }
  return { types: [], sourcePath: null, attempts };
}

/** Details (incl. custom field schema names) for one activity type. */
export async function getActivityTypeDetails(
  id: number
): Promise<{ name: string; fields: Array<{ schemaName: string; displayName: string }> } | null> {
  const candidates = [
    `/ProspectActivity.svc/ActivityType.Get?ActivityEvent=${id}`,
    `/ProspectActivity.svc/ActivityTypeDetails.Get?ActivityEvent=${id}`,
    `/ProspectActivity.svc/Types/${id}`,
  ];
  for (const path of candidates) {
    for (const method of ['GET', 'POST'] as const) {
      try {
        const res = await lsqFetch<unknown>(path, method === 'POST' ? { method: 'POST', body: {} } : {});
        const obj = (res ?? {}) as Record<string, unknown>;
        const name = String(obj.ActivityTypeName ?? obj.Name ?? obj.ActivityEventName ?? '');
        const rawFields =
          (obj.Fields as Array<Record<string, unknown>> | undefined) ??
          (obj.fields as Array<Record<string, unknown>> | undefined) ??
          [];
        if (!name && rawFields.length === 0) continue;
        return {
          name,
          fields: rawFields.map((f) => ({
            schemaName: String(f.SchemaName ?? f.schemaName ?? ''),
            displayName: String(f.DisplayName ?? f.displayName ?? f.Label ?? ''),
          })),
        };
      } catch {
        /* try next candidate */
      }
    }
  }
  return null;
}
