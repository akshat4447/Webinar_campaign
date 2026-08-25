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

  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });

  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // some LSQ error responses aren't JSON — keep the raw text
  }

  if (!res.ok) {
    throw new LeadSquaredError(res.status, parsed, `LeadSquared ${method} ${path} failed: ${res.status} ${typeof parsed === 'string' ? parsed : JSON.stringify(parsed)}`);
  }
  return parsed as T;
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
  // SenderType "APICaller" has no mail-sending identity configured on some
  // accounts and 500s at the delivery layer even though the API call itself
  // validates fine. LSQ_SENDER_EMAIL (a real LeadSquared user's email in this
  // tenant) opts into "UserEmailAddress" instead, which has a real mailbox.
  const senderEmail = await resolveIntegrationField('lsq', 'senderEmail');
  return lsqFetch('/EmailMarketing.svc/SendEmailToLead', {
    method: 'POST',
    body: {
      SenderType: senderEmail ? 'UserEmailAddress' : 'APICaller',
      ...(senderEmail ? { Sender: senderEmail } : {}),
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
    },
  });
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
  const result = await lsqFetch<unknown>('/LeadManagement.svc/Leads.GetByEmailAddress', {
    query: { email },
  });
  // LSQ returns { Leads: [...] } here (unlike Lists.Get's bare array).
  const leads = (result as { Leads?: Array<{ LeadPropertyList: Array<{ Attribute: string; Value: string }> }> } | null)?.Leads ?? [];
  const first = leads[0];
  if (!first) return null;
  const row: RawLsqLead = {};
  for (const prop of first.LeadPropertyList) row[prop.Attribute] = prop.Value;
  return row;
}

/** Strategy A transport for SMS — endpoint comes from tenant config. */
export async function sendSmsToLeadDirect(params: { mobile: string; message: string }): Promise<unknown> {
  const path = await resolveField('lsq', 'smsEndpoint');
  if (!path) {
    throw new UnsupportedChannelError('No lsq.smsEndpoint configured — set it on the Integrations page or use the trigger strategy.');
  }
  return lsqFetch(path, {
    method: 'POST',
    body: { PhoneNumber: params.mobile, TextMessage: params.message },
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
