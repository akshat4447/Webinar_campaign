// Server-only. Never import this from a 'use client' component — it reads
// LSQ_ACCESS_KEY / LSQ_SECRET_KEY / LSQ_HOST from the environment (and, if saved
// on the Integrations page, from the DB — see resolveLsqConfig) and must not
// ship to the browser. Endpoints verified against https://apidocs.leadsquared.com/.

import { resolveIntegrationField } from '@/lib/integrationConfig';
import { retryDelayMs, sleep } from '@/lib/retry';
import { assertValidLeadFields, assertValidActivities } from '@/lib/lsqPayload';

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
  let accessKey = override?.accessKey || (await resolveIntegrationField('lsq', 'accessKey'));
  if (accessKey) accessKey = accessKey.replace(/\\/g, '');
  const secretKey = override?.secretKey || (await resolveIntegrationField('lsq', 'secretKey'));
  const rawHost = override?.host || (await resolveIntegrationField('lsq', 'host'));
  if (!accessKey || !secretKey) throw new Error('LeadSquared Access Key / Secret Key are not set — add them on the Integrations page or in .env.local');
  if (!rawHost) throw new Error('LeadSquared host is not set — add it on the Integrations page or in .env.local');
  // Test hook: point every LeadSquared call at the local fake LeadSquared server
  // (test-support/fakes/lsqFake.ts). Unset in every real environment.
  const baseOverride = process.env.LSQ_API_BASE_URL?.trim();
  if (baseOverride) return { accessKey, secretKey, baseUrl: baseOverride.replace(/\/+$/, '') };
  // Accept either a bare host ("api-in21.leadsquared.com") or a full base URL
  // ("https://api-in21.leadsquared.com/v2/") — only the hostname is used.
  const host = rawHost.includes('://') ? new URL(rawHost).host : rawHost.replace(/\/.*$/, '');
  return { accessKey, secretKey, baseUrl: `https://${host}/v2` };
}

const LSQ_REQUEST_TIMEOUT_MS = 30_000;
const LSQ_MAX_ATTEMPTS = 4;

/**
 * LeadSquared reports application-level failures (bad field, missing
 * attribute, invalid sender) as HTTP 500 with an `MX…Exception` body. Those are
 * deterministic — replaying them only burns the rate limit — so a 500 is
 * treated as transient only when it carries no such exception type.
 */
function isApplicationError(body: unknown): boolean {
  if (body && typeof body === 'object') {
    const type = (body as { ExceptionType?: unknown }).ExceptionType;
    if (typeof type === 'string' && /^MX|Exception$/i.test(type)) return true;
  }
  return typeof body === 'string' && /"ExceptionType"\s*:\s*"MX/i.test(body);
}

/** Whether a response/error is worth replaying. `idempotent` = replaying cannot double-apply. */
export function isRetryableLsqFailure(status: number | null, body: unknown, idempotent: boolean): boolean {
  if (status === null) return idempotent; // network error / timeout: the request may have been processed
  if (status === 429) return true; // explicit rate-limit rejection
  if (status === 503) return idempotent; // acceptance may be ambiguous for writes
  if (status >= 500 && !isApplicationError(body)) return idempotent;
  return false;
}

async function lsqFetch<T>(
  path: string,
  opts: {
    method?: 'GET' | 'POST' | 'PUT';
    query?: Record<string, string>;
    body?: unknown;
    /**
     * True when replaying the call cannot double-apply (reads, upserts keyed by
     * SearchBy, set-membership writes). Defaults to true for GET and false for
     * anything else — a blindly replayed POST that already landed would, for
     * example, post a custom activity twice.
     */
    idempotent?: boolean;
  } = {},
  override?: LsqConfigOverride
): Promise<T> {
  const { method = 'GET', query, body } = opts;
  const idempotent = opts.idempotent ?? method === 'GET';
  const cfg = await resolveLsqConfig(override);
  const authQuery = `accessKey=${encodeURIComponent(cfg.accessKey)}&secretKey=${encodeURIComponent(cfg.secretKey)}`;
  const qs = new URLSearchParams(query).toString();
  const sep = path.includes('?') ? '&' : '?';
  const url = `${cfg.baseUrl}${path}${sep}${authQuery}${qs ? `&${qs}` : ''}`;

  let lastError: unknown;

  for (let attempt = 0; attempt < LSQ_MAX_ATTEMPTS; attempt++) {
    const isLast = attempt === LSQ_MAX_ATTEMPTS - 1;
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        cache: 'no-store',
        signal: AbortSignal.timeout(LSQ_REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      lastError = err;
      if (!isLast && isRetryableLsqFailure(null, null, idempotent)) {
        await sleep(retryDelayMs(attempt));
        continue;
      }
      throw new Error(`LeadSquared ${method} ${path} failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // some LSQ error responses aren't JSON — keep the raw text
    }

    if (res.ok) {
      if (parsed && typeof parsed === 'object' && /^(error|failed|failure)$/i.test(String((parsed as {Status?:unknown}).Status ?? ''))) throw new LeadSquaredError(400,parsed,`LeadSquared rejected ${path}: ${JSON.stringify(parsed)}`);
      return parsed as T;
    }

    lastError = new LeadSquaredError(
      res.status,
      parsed,
      `LeadSquared ${method} ${path} failed: ${res.status} ${typeof parsed === 'string' ? parsed : JSON.stringify(parsed)}`
    );
    if (!isLast && isRetryableLsqFailure(res.status, parsed, idempotent)) {
      await sleep(retryDelayMs(attempt, res.headers.get('retry-after')));
      continue;
    }
    throw lastError;
  }

  throw lastError instanceof Error ? lastError : new Error(`LeadSquared request failed after ${LSQ_MAX_ATTEMPTS} attempts.`);
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

// --- tenant field discovery ---------------------------------------------------------------------
// LeadSquared rejects a WHOLE lead (HTTP 500 MXUnknownAttributeException) if even one custom
// attribute does not exist in the tenant. The app writes optional enrichment fields (ICP score,
// seniority, function), so on a tenant that has not created them every sync used to fail outright.
// Custom (`mx_*`) attributes are therefore checked against the tenant's own schema first; unknown
// ones are skipped and reported, never sent. Standard attributes are left alone. If the schema
// cannot be fetched, fields are sent unchanged (the pre-existing behaviour) rather than dropped.

const SCHEMA_TTL_MS = 5 * 60 * 1000;
let schemaCache: { key: string; at: number; names: Set<string> } | null = null;
const droppedSeen = new Set<string>();

// Test seam: `undefined` = use the real tenant schema; a Set / null forces what discovery returns.
let schemaOverride: Set<string> | null | undefined;
export function setLeadSchemaOverrideForTests(v: Set<string> | null | undefined): void {
  schemaOverride = v;
}

export function resetLeadSchemaCache(): void {
  schemaCache = null;
  schemaOverride = undefined;
  droppedSeen.clear();
}

/** Custom attribute names that exist in the tenant (lower-cased for comparison), or null if unknown. */
export async function getTenantCustomFieldNames(): Promise<Set<string> | null> {
  if (schemaOverride !== undefined) return schemaOverride;
  try {
    const cfg = await resolveLsqConfig();
    const key = `${cfg.baseUrl}|${cfg.accessKey}`;
    if (schemaCache && schemaCache.key === key && Date.now() - schemaCache.at < SCHEMA_TTL_MS) return schemaCache.names;
    const meta = await lsqFetch<Array<{ SchemaName: string }>>('/LeadManagement.svc/LeadsMetaData.Get', {});
    if (!Array.isArray(meta) || meta.length === 0) return null;
    const names = new Set(meta.map((m) => String(m.SchemaName).toLowerCase()));
    schemaCache = { key, at: Date.now(), names };
    return names;
  } catch {
    return null;
  }
}

/** Splits `fields` into those safe to send and the unknown custom attributes that must be skipped. */
export function splitUnknownCustomFields(fields: LeadField[], known: Set<string> | null): { kept: LeadField[]; dropped: string[] } {
  if (!known) return { kept: fields, dropped: [] };
  const kept: LeadField[] = [];
  const dropped: string[] = [];
  for (const f of fields) {
    if (/^mx_/i.test(f.Attribute) && !known.has(f.Attribute.toLowerCase())) dropped.push(f.Attribute);
    else kept.push(f);
  }
  return { kept, dropped };
}

/** Custom fields skipped since the last call (deduplicated) — for a one-line "create these fields" notice. */
export function takeSkippedCustomFields(): string[] {
  const out = [...droppedSeen];
  droppedSeen.clear();
  return out;
}

async function withKnownFields(fields: LeadField[]): Promise<LeadField[]> {
  const { kept, dropped } = splitUnknownCustomFields(fields, await getTenantCustomFieldNames());
  for (const d of dropped) droppedSeen.add(d);
  return kept;
}

export async function createOrUpdateLead(fields: LeadField[], searchBy: string = 'EmailAddress'): Promise<{ Status: string; Message: { Id: string; AffectedRows: number } }> {
  assertValidLeadFields(fields);
  const sendable = await withKnownFields(fields);
  const hasSearchBy = sendable.some((f) => f.Attribute === 'SearchBy');
  const body = hasSearchBy ? sendable : [...sendable, { Attribute: 'SearchBy', Value: searchBy }];
  // Upsert keyed on SearchBy: replaying it cannot create a second lead.
  return lsqFetch('/LeadManagement.svc/Lead.CreateOrUpdate', {
    method: 'POST',
    query: { postUpdatedLead: 'true' },
    body,
    idempotent: true,
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
  const result = await lsqFetch<LsqList[] | { Status?: string; Message?: LsqList[] }>('/LeadManagement.svc/Lists.Get');
  if (Array.isArray(result)) return result;
  if (result && typeof result === 'object' && Array.isArray((result as { Message?: LsqList[] }).Message)) {
    return (result as { Message: LsqList[] }).Message;
  }
  return [];
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
    // Adding to a static list is set-membership: replaying is harmless.
    await lsqFetch('/LeadSegmentation.svc/AddLeadsToStaticList', { method: 'POST', body: { listId, leadIds: chunk }, idempotent: true });
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
// The returned RowNumber is a 0-based index into the original `leads` array
// (LSQ's own RowNumber is 1-based within each chunk), and the result array is
// dense: result[i] always describes leads[i].
//
// A lead that fails local validation (malformed email, bad attribute name) is
// reported as that row's failure and NOT sent — one bad CSV row must not sink
// the other 24 in its chunk, let alone the whole import.
export async function bulkCreateOrUpdateLeads(leads: LeadField[][]): Promise<BulkLeadResult[]> {
  const results: BulkLeadResult[] = new Array(leads.length);
  const failRow = (i: number, ExceptionType: string, ErrorMessage: string): BulkLeadResult => ({
    RowNumber: i,
    LeadId: '',
    LeadCreated: false,
    LeadUpdated: false,
    AffectedRows: 0,
    ExceptionType,
    ErrorMessage,
  });

  const known = await getTenantCustomFieldNames();
  const prepared: LeadField[][] = [];
  const validIdx: number[] = [];
  leads.forEach((fields, i) => {
    try {
      assertValidLeadFields(fields);
      const { kept, dropped } = splitUnknownCustomFields(fields, known);
      for (const d of dropped) droppedSeen.add(d);
      prepared[i] = kept;
      validIdx.push(i);
    } catch (err) {
      results[i] = failRow(i, 'LsqPayloadError', err instanceof Error ? err.message : String(err));
    }
  });

  for (let i = 0; i < validIdx.length; i += 25) {
    const idxChunk = validIdx.slice(i, i + 25);
    const chunk = idxChunk.map((idx) => {
      const fields = prepared[idx];
      return fields.some((f) => f.Attribute === 'SearchBy') ? fields : [...fields, { Attribute: 'SearchBy', Value: 'EmailAddress' }];
    });
    // Upsert keyed on SearchBy — safe to replay.
    const chunkResults = await lsqFetch<BulkLeadResult[]>('/LeadManagement.svc/Lead/Bulk/CreateOrUpdate', { method: 'POST', body: chunk, idempotent: true });
    for (const r of chunkResults) {
      const original = idxChunk[r.RowNumber - 1];
      if (original !== undefined) results[original] = { ...r, RowNumber: original };
    }
    if (i + 25 < validIdx.length) await sleep(200);
  }

  // Anything LeadSquared did not answer for is a failure, never a silent hole.
  for (let i = 0; i < results.length; i++) {
    if (!results[i]) results[i] = failRow(i, 'MissingResult', 'LeadSquared returned no result for this row.');
  }
  return results;
}

const CANDIDATE_LINKEDIN_COLUMNS = [
  'mx_LinkedIn_Profile',
  'mx_Linkedin_Profile',
  'LinkedIn',
  'LinkedInUrl',
  'mx_LinkedIn_Url',
  'mx_Linkedin_Url',
  'mx_LinkedIn',
  'mx_Linkedin',
];

const CONTACT_COLUMNS = [
  'ProspectID',
  'FirstName',
  'LastName',
  'EmailAddress',
  'Phone',
  'Company',
  'Designation',
  ...CANDIDATE_LINKEDIN_COLUMNS,
];

export interface RawLsqLead {
  [attribute: string]: string;
}

export async function getLeadsInList(listId: string, pageSize = 200, maxLeads = 2000): Promise<RawLsqLead[]> {
  const allRows: RawLsqLead[] = [];
  let pageIndex = 1;

  while (allRows.length < maxLeads) {
    const result = await lsqFetch<{ RecordCount: number; Leads: Array<{ LeadPropertyList: Array<{ Attribute: string; Value: string }> }> }>(
      '/LeadManagement.svc/Leads/Retrieve/BySearchParameter',
      {
        method: 'POST',
        body: {
          SearchParameters: { ListId: listId, RetrieveBehaviour: '0' },
          Columns: { Include_CSV: CONTACT_COLUMNS.join(',') },
          Sorting: { ColumnName: 'CreatedOn', Direction: '1' },
          Paging: { PageIndex: pageIndex, PageSize: pageSize },
        },
      }
    );

    const leads = result.Leads ?? [];
    if (leads.length === 0) break;

    for (const lead of leads) {
      const row: RawLsqLead = {};
      for (const prop of lead.LeadPropertyList) row[prop.Attribute] = prop.Value;
      allRows.push(row);
      if (allRows.length >= maxLeads) break;
    }

    if (leads.length < pageSize || allRows.length >= (result.RecordCount ?? 0)) {
      break;
    }

    pageIndex++;
    await sleep(150);
  }

  return allRows;
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

/** Thrown when a later chunk fails after earlier ones were already accepted. */
export class PartialActivityPushError extends Error {
  constructor(
    /** Activities (from the start of the input array) LeadSquared already accepted. */
    public pushed: number,
    public cause: unknown,
    public acceptedIndices: number[] = Array.from({length:pushed},(_,i)=>i)
  ) {
    super(`LeadSquared accepted ${pushed} activities before failing: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'PartialActivityPushError';
  }
}

/**
 * Posts custom activities in chunks of 25. NOT idempotent at the LeadSquared
 * level (a replay posts a duplicate), so the caller must guard each activity
 * with the idempotency ledger (lib/idempotency.ts) — and this call reports
 * exactly how many were accepted if a later chunk fails, so the caller can
 * release only the claims that did not land.
 */
export async function pushCustomActivities(activities: CustomActivity[]): Promise<number> {
  assertValidActivities(activities);
  const acceptedIndices:number[]=[];
  for (let i = 0; i < activities.length; i += 25) {
    const chunk = activities.slice(i,i+25);
    try {
      const result=await lsqFetch<{Response?:Array<{RowNumber?:number;ActivityCreated?:boolean;ProspectActivityId?:string;ExceptionMessage?:string}>;Status?:string;Message?:{Count?:number}}>('/ProspectActivity.svc/Bulk/CustomActivity/Add/ByLeadId',{method:'POST',body:chunk,idempotent:false});
      if(Array.isArray(result?.Response)){
        const rows=result.Response;
        const rowMap=new Map(rows.map(row=>[row.RowNumber,row]));
        if(rowMap.size!==chunk.length || rows.length!==chunk.length || !chunk.every((_,index)=>rowMap.has(index+1)))throw new Error('LeadSquared returned incomplete activity receipts; outcome is uncertain.');
        const rejected:string[]=[];
        for(let index=0;index<chunk.length;index++){
          const row=rowMap.get(index+1)!;
          if(row.ActivityCreated===true && row.ProspectActivityId)acceptedIndices.push(i+index);
          else if(row.ActivityCreated===false)rejected.push(row.ExceptionMessage||`Activity row ${index+1} was rejected.`);
          else throw new Error('LeadSquared activity response has no creation proof; outcome is uncertain.');
        }
        if(rejected.length)throw new LeadSquaredError(400,rows,rejected.join('; '));
      }else if(result?.Status==='Success' && result.Message?.Count===chunk.length){
        acceptedIndices.push(...chunk.map((_,index)=>i+index));
      }else throw new Error('LeadSquared response contains no activity creation receipts; outcome is uncertain.');
    }catch(error){if(acceptedIndices.length)throw new PartialActivityPushError(acceptedIndices.length,error,acceptedIndices);throw error;}
    if(i+25<activities.length)await sleep(250);
  }
  const pushed=acceptedIndices.length;
  return pushed;
}

/**
 * Register an activity webhook programmatically in LeadSquared.
 * Posts to /v2/Webhook.svc/Create so LeadSquared will notify this app
 * whenever a lead activity is created (e.g. registration on form/landing page).
 */
export async function registerLeadSquaredWebhook(
  url: string,
  description: string = 'Webinar Campaign Studio Registration Activity Sync'
): Promise<{ ok: boolean; webhookId?: string; message: string }> {
  try {
    const result = await lsqFetch<{ Status?: string; Message?: { Id?: string } | string; ExceptionType?: string }>('/Webhook.svc/Create', {
      method: 'POST',
      body: {
        Description: description,
        URL: url,
        Method: 'POST',
        ContentType: 'application/json',
        WebhookEvent: '2', // LeadActivity_Post_Create
        IsSpecificLandingPage: false,
        NotifyOnFailure: true,
      },
    });

    const msg = result?.Message;
    const webhookId = typeof msg === 'object' && msg ? String(msg.Id || '') : String(msg || '');
    return {
      ok: true,
      webhookId: webhookId || undefined,
      message: `Webhook registered successfully in LeadSquared${webhookId ? ` (ID: ${webhookId})` : ''}`,
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
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
  try {
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
  } catch {
    return [];
  }
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

/** GET a single lead by LeadId (ProspectId) */
export async function getLeadById(leadId: string): Promise<RawLsqLead | null> {
  const result = await lsqFetch<unknown>('/LeadManagement.svc/Leads.GetById', {
    query: { id: leadId },
  });

  const rows: unknown[] = Array.isArray(result)
    ? result
    : ((result as { Leads?: unknown[] } | null)?.Leads ?? (result && typeof result === 'object' ? [result] : []));
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

/** Read-only despite the provider's POST transport; bounded, paginated activity audit. */
export async function getLeadActivities(leadId: string, offset = 0, activityEvent?: number): Promise<Record<string, unknown>[]> {
  if (!leadId || !Number.isSafeInteger(offset) || offset < 0) throw new Error('Valid lead ID and activity page are required.');
  const result = await lsqFetch<unknown>('/ProspectActivity.svc/Retrieve', {
    method: 'POST', query: { leadId }, idempotent: true,
    body: { ...(activityEvent ? { Parameter: { ActivityEvent: activityEvent } } : {}), Paging: { Offset: String(offset), RowCount: '100' } },
  });
  const rows = Array.isArray(result) ? result : (result as { Activities?: unknown[]; ProspectActivities?: unknown[] } | null)?.Activities ?? (result as { ProspectActivities?: unknown[] } | null)?.ProspectActivities;
  if (!Array.isArray(rows)) throw new Error('LeadSquared returned an unrecognized activity response.');
  return rows.filter((row): row is Record<string, unknown> => !!row && typeof row === 'object');
}

/** Strategy A transport for SMS — endpoint comes from tenant config. */
export async function sendSmsToLeadDirect(params: {
  mobile: string;
  message: string;
  dltTemplateId?: string | null;
  senderId?: string | null;
}): Promise<unknown> {
  const path = await resolveIntegrationField('lsq', 'smsEndpoint');
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
  const path = await resolveIntegrationField('lsq', 'waEndpoint');
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
    `/ProspectActivity.svc/CustomActivity/GetActivitySetting?code=${id}`,
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
