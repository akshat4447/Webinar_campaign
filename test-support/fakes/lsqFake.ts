// A local, in-process fake of the LeadSquared (LSQ) REST API, for deep / edge-case
// integration tests of lib/leadsquared.ts over REAL HTTP, without a real tenant.
//
// Point the app at it with `process.env.LSQ_API_BASE_URL = fake.url` (the URL
// already includes the `/v2` prefix) and any non-empty accessKey / secretKey.
//
// Node built-ins only. No `any`. See test-support/fakes/README.md.

import http from 'node:http';
import type { AddressInfo } from 'node:net';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface FakeLead {
  id: string;
  /** Attribute -> value, exactly as written (ProspectID / CreatedOn / ModifiedOn are derived, not stored here). */
  fields: Record<string, string>;
  createdOn: string;
  modifiedOn: string;
}

export interface FakeActivityTypeField {
  SchemaName: string;
  DisplayName: string;
  DataType: string;
}

export interface FakeActivityType {
  id: number;
  name: string;
  description: string;
  direction: number;
  fields: FakeActivityTypeField[];
}

export interface FakeActivity {
  id: string;
  relatedProspectId: string;
  activityEvent: number;
  activityNote: string;
  fields: Array<{ SchemaName: string; Value: string }>;
  createdOn: string;
}

export interface FakeList {
  id: string;
  name: string;
  description: string;
  type: 'Static';
  /** Lead ids, insertion-ordered, no duplicates. */
  members: string[];
}

export interface FakeSentEmail {
  id: string;
  senderType: string;
  sender: string | null;
  recipientType: string;
  recipient: string;
  subject: string;
  contentHtml: string;
  contentText: string;
  emailCategory: string | null;
  includeEmailFooter: boolean;
  ts: number;
}

export interface FakeWebhook {
  id: string;
  description: string;
  url: string;
  method: string;
  contentType: string;
  webhookEvent: string;
  raw: Record<string, unknown>;
}

export interface FakeUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  /** LSQ convention: 0 = active, anything else = inactive. Only active users may be a UserEmailAddress sender. */
  statusCode: number;
}

export interface FakeRequestLogEntry {
  method: string;
  /** Path relative to the `/v2` base, e.g. `/LeadManagement.svc/Lists.Get`. Raw path if outside `/v2`. */
  path: string;
  /** Query parameters, with accessKey / secretKey removed. */
  query: Record<string, string>;
  /** Parsed JSON body, the raw string if it was not JSON, or null if empty. */
  body: unknown;
  ts: number;
  /** HTTP status actually written (undefined if the connection was dropped). */
  status?: number;
  /** True when a fault rule intercepted this request. */
  faulted?: boolean;
}

export interface FaultRule {
  /**
   * Which requests the rule applies to: a string is matched as a SUBSTRING of the path
   * relative to `/v2` (e.g. `SendEmailToLead`); a RegExp is tested against that path.
   * Omitted = every path.
   */
  match?: string | RegExp;
  /** HTTP method filter (case-insensitive). Omitted = any. */
  method?: string;
  /** How many matching requests the rule consumes. Default 1. */
  times?: number | 'forever';
  /**
   * HTTP status to answer with. If omitted (and not dropConnection / mailDelivery) the
   * request is only delayed by `delayMs` and then handled normally.
   */
  status?: number;
  /** Response body: string = sent raw (text/plain); anything else = JSON. Default: the status text. */
  body?: unknown;
  headers?: Record<string, string>;
  /** Wait this long before answering / dropping / handling (slow-response tests). */
  delayMs?: number;
  /** Destroy the socket without writing a response. */
  dropConnection?: boolean;
  /**
   * SendEmailToLead only: let the sender + recipient validation pass, then answer
   * HTTP 500 MXMailDeliveryException (the account-level "LSQ refused to deliver" failure).
   */
  mailDelivery?: boolean;
}

export interface FaultState {
  rule: FaultRule;
  /** Remaining matches (Infinity for 'forever'). */
  remaining: number;
  /** How many requests this rule has intercepted so far. */
  hits: number;
}

export interface FakeLsqOptions {
  /** 0 / omitted = ephemeral port. */
  port?: number;
  /** If set, requests must carry exactly this accessKey. Default: any non-empty value is accepted. */
  accessKey?: string;
  /** If set, requests must carry exactly this secretKey. Default: any non-empty value is accepted. */
  secretKey?: string;
  /** Custom (mx_…) lead attributes that EXIST on the tenant. Default: none. */
  customFields?: string[];
  /** Emails of ACTIVE users (valid UserEmailAddress senders). Default: ['sender@example.com']. */
  activeUsers?: string[];
  /** Emails of users that exist but are inactive (listed by Users.Get, rejected as sender). */
  inactiveUsers?: string[];
  /** Whether SenderType 'APICaller' is accepted. Default true. */
  apiCallerEnabled?: boolean;
  /** Reject activities whose ActivityEvent is not a known activity type. Default false. */
  strictActivityTypes?: boolean;
}

export interface FakeLsqState {
  /** Leads keyed by ProspectID. */
  leads: Map<string, FakeLead>;
  /** The same lead objects keyed by lower-cased EmailAddress. */
  leadsByEmail: Map<string, FakeLead>;
  activities: FakeActivity[];
  activityTypes: FakeActivityType[];
  /** Lists keyed by ListId. */
  lists: Map<string, FakeList>;
  sentEmails: FakeSentEmail[];
  webhooks: FakeWebhook[];
  users: FakeUser[];
  requestLog: FakeRequestLogEntry[];
  faults: FaultState[];
  /** Mutable tenant config; changes take effect immediately. */
  config: {
    customFields: string[];
    apiCallerEnabled: boolean;
    strictActivityTypes: boolean;
  };
}

export interface FakeLsq {
  /** Base URL including the `/v2` prefix, e.g. `http://127.0.0.1:54321/v2`. */
  url: string;
  port: number;
  state: FakeLsqState;
  /** Appends a fault rule. Rules are consumed in the order they were added. */
  setFault(rule: FaultRule): void;
  clearFaults(): void;
  /** Wipes all data, faults and the request log, and restores the options the fake was started with. */
  reset(): void;
  /** Convenience: logged requests whose path matches (same matching as FaultRule.match). */
  requestsTo(match: string | RegExp, method?: string): FakeRequestLogEntry[];
  /** Test helper: inserts a lead directly (bypasses the API). */
  seedLead(fields: Record<string, string>): FakeLead;
  /** Test helper: inserts a static list directly. */
  seedList(name: string, memberIds?: string[], description?: string): FakeList;
  stop(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const STANDARD_FIELDS: ReadonlyArray<{ SchemaName: string; DisplayName: string; DataType: string }> = [
  { SchemaName: 'ProspectID', DisplayName: 'Lead Id', DataType: 'Guid' },
  { SchemaName: 'FirstName', DisplayName: 'First Name', DataType: 'String' },
  { SchemaName: 'LastName', DisplayName: 'Last Name', DataType: 'String' },
  { SchemaName: 'EmailAddress', DisplayName: 'Email', DataType: 'Email' },
  { SchemaName: 'Company', DisplayName: 'Company', DataType: 'String' },
  { SchemaName: 'JobTitle', DisplayName: 'Job Title', DataType: 'String' },
  { SchemaName: 'Designation', DisplayName: 'Designation', DataType: 'String' },
  { SchemaName: 'Phone', DisplayName: 'Phone', DataType: 'Phone' },
  { SchemaName: 'Mobile', DisplayName: 'Mobile', DataType: 'Phone' },
  { SchemaName: 'Source', DisplayName: 'Source', DataType: 'String' },
  { SchemaName: 'SourceCampaign', DisplayName: 'Source Campaign', DataType: 'String' },
  { SchemaName: 'Notes', DisplayName: 'Notes', DataType: 'String' },
  { SchemaName: 'Website', DisplayName: 'Website', DataType: 'String' },
  { SchemaName: 'Address1', DisplayName: 'Address 1', DataType: 'String' },
  { SchemaName: 'Address2', DisplayName: 'Address 2', DataType: 'String' },
  { SchemaName: 'City', DisplayName: 'City', DataType: 'String' },
  { SchemaName: 'State', DisplayName: 'State', DataType: 'String' },
  { SchemaName: 'Country', DisplayName: 'Country', DataType: 'String' },
  { SchemaName: 'ZipCode', DisplayName: 'Zip Code', DataType: 'String' },
  { SchemaName: 'DOB', DisplayName: 'Date of Birth', DataType: 'Date' },
  { SchemaName: 'OwnerId', DisplayName: 'Owner', DataType: 'Guid' },
  { SchemaName: 'ProspectStage', DisplayName: 'Stage', DataType: 'String' },
  { SchemaName: 'Score', DisplayName: 'Score', DataType: 'Number' },
  { SchemaName: 'CreatedOn', DisplayName: 'Created On', DataType: 'DateTime' },
  { SchemaName: 'ModifiedOn', DisplayName: 'Modified On', DataType: 'DateTime' },
];
const STANDARD_NAMES: ReadonlySet<string> = new Set(STANDARD_FIELDS.map((f) => f.SchemaName));
/** Derived attributes: readable, but a write to them is ignored. */
const DERIVED_NAMES: ReadonlySet<string> = new Set(['ProspectID', 'CreatedOn', 'ModifiedOn']);
const SEARCH_BY_ATTRIBUTES: ReadonlySet<string> = new Set(['EmailAddress', 'Phone', 'Mobile', 'ProspectID']);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_BULK_LEADS = 25;
const MAX_BODY_BYTES = 8 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

function isRecord(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Thrown by handlers; becomes an HTTP response. */
class ApiError extends Error {
  constructor(
    public status: number,
    public payload: unknown
  ) {
    super(typeof payload === 'string' ? payload : JSON.stringify(payload));
  }
}

/** LSQ reports application errors as HTTP 500 + an `MX…Exception` body. */
const mxError = (type: string, message: string, status = 500): ApiError => new ApiError(status, { ExceptionType: type, ExceptionMessage: message });

const nowLsq = (): string => new Date().toISOString().slice(0, 19).replace('T', ' ');
const guid = (prefix: number, n: number): string => `${prefix.toString(16).padStart(8, '0')}-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

function ruleMatchesPath(rule: FaultRule, path: string): boolean {
  const m = rule.match;
  if (m === undefined) return true;
  if (typeof m === 'string') return path.includes(m);
  m.lastIndex = 0;
  return m.test(path);
}

interface HandlerCtx {
  query: Record<string, string>;
  body: unknown;
  /** Path relative to /v2. */
  path: string;
}
type HandlerResult = { status?: number; body: unknown };
type Handler = (ctx: HandlerCtx) => HandlerResult;

// ---------------------------------------------------------------------------
// The fake
// ---------------------------------------------------------------------------

export async function startFakeLsq(opts: FakeLsqOptions = {}): Promise<FakeLsq> {
  const BASE = '/v2';

  const state: FakeLsqState = {
    leads: new Map(),
    leadsByEmail: new Map(),
    activities: [],
    activityTypes: [],
    lists: new Map(),
    sentEmails: [],
    webhooks: [],
    users: [],
    requestLog: [],
    faults: [],
    config: { customFields: [], apiCallerEnabled: true, strictActivityTypes: false },
  };

  let leadSeq = 0;
  let listSeq = 0;
  let activitySeq = 0;
  let activityTypeSeq = 200;
  let emailSeq = 0;
  let webhookSeq = 0;
  let userSeq = 0;

  function seedUsers(): void {
    const active = opts.activeUsers ?? ['sender@example.com'];
    const inactive = opts.inactiveUsers ?? [];
    const add = (email: string, statusCode: number): void => {
      userSeq++;
      const local = email.split('@')[0] ?? 'user';
      state.users.push({
        id: guid(3, userSeq),
        email,
        firstName: local.charAt(0).toUpperCase() + local.slice(1),
        lastName: 'User',
        role: 'Administrator',
        statusCode,
      });
    };
    for (const e of active) add(e, 0);
    for (const e of inactive) add(e, 1);
  }

  function resetState(): void {
    state.leads.clear();
    state.leadsByEmail.clear();
    state.activities.length = 0;
    state.activityTypes.length = 0;
    state.lists.clear();
    state.sentEmails.length = 0;
    state.webhooks.length = 0;
    state.users.length = 0;
    state.requestLog.length = 0;
    state.faults.length = 0;
    state.config.customFields = [...(opts.customFields ?? [])];
    state.config.apiCallerEnabled = opts.apiCallerEnabled ?? true;
    state.config.strictActivityTypes = opts.strictActivityTypes ?? false;
    leadSeq = 0;
    listSeq = 0;
    activitySeq = 0;
    activityTypeSeq = 200;
    emailSeq = 0;
    webhookSeq = 0;
    userSeq = 0;
    seedUsers();
  }
  resetState();

  // ----- leads -------------------------------------------------------------

  const isKnownAttribute = (name: string): boolean => STANDARD_NAMES.has(name) || state.config.customFields.includes(name);

  interface ParsedLeadPayload {
    pairs: Array<[string, string]>;
    searchBy: string;
  }

  function parseLeadPayload(raw: unknown): ParsedLeadPayload {
    if (!Array.isArray(raw) || raw.length === 0) throw mxError('MXInvalidInputException', 'Lead payload must be a non-empty array of {Attribute, Value}.');
    const pairs: Array<[string, string]> = [];
    let searchBy = 'EmailAddress';
    for (const item of raw) {
      if (!isRecord(item) || typeof item.Attribute !== 'string' || item.Attribute === '') {
        throw mxError('MXInvalidInputException', 'Each lead field must be an object with a string Attribute.');
      }
      const v = item.Value;
      const value = v === null || v === undefined ? '' : typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : null;
      if (value === null) throw mxError('MXInvalidInputException', `Value for "${item.Attribute}" must be a scalar.`);
      if (item.Attribute === 'SearchBy') searchBy = value;
      else pairs.push([item.Attribute, value]);
    }
    return { pairs, searchBy };
  }

  function findLeadBy(attr: string, value: string): FakeLead | undefined {
    if (attr === 'ProspectID') return state.leads.get(value);
    if (attr === 'EmailAddress') return state.leadsByEmail.get(value.toLowerCase());
    for (const lead of state.leads.values()) if (lead.fields[attr] === value) return lead;
    return undefined;
  }

  function upsertLead(raw: unknown): { lead: FakeLead; created: boolean } {
    const { pairs, searchBy } = parseLeadPayload(raw);
    const unknown = [...new Set(pairs.map(([a]) => a).filter((a) => !isKnownAttribute(a)))];
    if (unknown.length > 0) throw mxError('MXUnknownAttributeException', `Attribute(s) does not exist - ${unknown.join(', ')}.`);
    if (!SEARCH_BY_ATTRIBUTES.has(searchBy)) throw mxError('MXInvalidInputException', `Unsupported SearchBy attribute "${searchBy}".`);

    const values = new Map<string, string>();
    for (const [a, v] of pairs) values.set(a, v);

    const email = values.get('EmailAddress');
    if (email && !EMAIL_RE.test(email)) throw mxError('MXInvalidInputException', `Invalid EmailAddress - ${email}.`);

    const key = values.get(searchBy);
    if (!key) throw mxError('MXMandatoryAttributeMissingException', `A value for the SearchBy attribute "${searchBy}" is required.`);

    let lead = findLeadBy(searchBy, key);
    if (!lead && searchBy === 'ProspectID') throw mxError('MXInvalidInputException', `Lead with ProspectID ${key} does not exist.`);

    // A changed email must not collide with a different lead.
    if (email) {
      const holder = state.leadsByEmail.get(email.toLowerCase());
      if (holder && holder !== lead) throw mxError('MXDuplicateEntryException', `A lead with EmailAddress ${email} already exists.`);
    }

    const created = !lead;
    const ts = nowLsq();
    if (!lead) {
      leadSeq++;
      lead = { id: guid(1, leadSeq), fields: {}, createdOn: ts, modifiedOn: ts };
      state.leads.set(lead.id, lead);
    }
    const oldEmail = lead.fields.EmailAddress;
    for (const [a, v] of values) if (!DERIVED_NAMES.has(a)) lead.fields[a] = v;
    lead.modifiedOn = ts;
    if (oldEmail && oldEmail.toLowerCase() !== (lead.fields.EmailAddress ?? '').toLowerCase()) state.leadsByEmail.delete(oldEmail.toLowerCase());
    if (lead.fields.EmailAddress) state.leadsByEmail.set(lead.fields.EmailAddress.toLowerCase(), lead);
    return { lead, created };
  }

  const flatLead = (lead: FakeLead): Json => ({
    ProspectID: lead.id,
    ...lead.fields,
    CreatedOn: lead.createdOn,
    ModifiedOn: lead.modifiedOn,
  });

  // ----- handlers ----------------------------------------------------------

  const ok = (body: unknown): HandlerResult => ({ body });

  const handlers = new Map<string, Partial<Record<'GET' | 'POST', Handler>>>();
  const route = (path: string, method: 'GET' | 'POST', fn: Handler): void => {
    const entry = handlers.get(path) ?? {};
    entry[method] = fn;
    handlers.set(path, entry);
  };

  // --- metadata
  route('/LeadManagement.svc/LeadsMetaData.Get', 'GET', () =>
    ok([...STANDARD_FIELDS, ...state.config.customFields.map((n) => ({ SchemaName: n, DisplayName: n.replace(/^mx_/, '').replace(/_/g, ' '), DataType: 'String' }))])
  );

  // --- leads
  route('/LeadManagement.svc/Lead.CreateOrUpdate', 'POST', ({ body }) => {
    const { lead } = upsertLead(body);
    return ok({ Status: 'Success', Message: { Id: lead.id, AffectedRows: 1 } });
  });

  route('/LeadManagement.svc/Lead/Bulk/CreateOrUpdate', 'POST', ({ body }) => {
    if (!Array.isArray(body) || body.length === 0) throw mxError('MXInvalidInputException', 'Body must be a non-empty array of lead field arrays.', 400);
    if (body.length > MAX_BULK_LEADS) throw mxError('MXInvalidInputException', `A bulk call accepts at most ${MAX_BULK_LEADS} leads; got ${body.length}.`, 400);
    const results = body.map((row: unknown, i: number) => {
      try {
        const { lead, created } = upsertLead(row);
        return { RowNumber: i + 1, LeadId: lead.id, LeadCreated: created, LeadUpdated: !created, AffectedRows: 1 };
      } catch (err) {
        if (err instanceof ApiError && isRecord(err.payload)) {
          return {
            RowNumber: i + 1,
            LeadId: '',
            LeadCreated: false,
            LeadUpdated: false,
            AffectedRows: 0,
            ExceptionType: String(err.payload.ExceptionType ?? 'MXException'),
            ErrorMessage: String(err.payload.ExceptionMessage ?? ''),
          };
        }
        throw err;
      }
    });
    return ok(results);
  });

  route('/LeadManagement.svc/Leads.GetByEmailAddress', 'GET', ({ query }) => {
    const email = query.emailaddress;
    if (!email) throw mxError('MXMandatoryAttributeMissingException', 'emailaddress is required.');
    const lead = state.leadsByEmail.get(email.toLowerCase());
    return ok(lead ? [flatLead(lead)] : []);
  });

  route('/LeadManagement.svc/Leads.GetById', 'GET', ({ query }) => {
    const id = query.id;
    if (!id) throw mxError('MXMandatoryAttributeMissingException', 'id is required.');
    const lead = state.leads.get(id);
    return ok(lead ? [flatLead(lead)] : []);
  });

  route('/LeadManagement.svc/Leads/Retrieve/BySearchParameter', 'POST', ({ body }) => {
    if (!isRecord(body)) throw mxError('MXInvalidInputException', 'Body must be an object.');
    const params = isRecord(body.SearchParameters) ? body.SearchParameters : {};
    const listId = typeof params.ListId === 'string' ? params.ListId : '';
    const paging = isRecord(body.Paging) ? body.Paging : {};
    const pageIndex = Math.max(1, Number(paging.PageIndex ?? 1) || 1);
    const pageSize = Math.max(1, Number(paging.PageSize ?? 25) || 25);
    const cols = isRecord(body.Columns) && typeof body.Columns.Include_CSV === 'string' ? body.Columns.Include_CSV.split(',').map((c) => c.trim()).filter(Boolean) : null;

    const list = state.lists.get(listId);
    const memberIds = list ? list.members : [];
    const page = memberIds.slice((pageIndex - 1) * pageSize, pageIndex * pageSize);
    const Leads = page.flatMap((id) => {
      const lead = state.leads.get(id);
      if (!lead) return [];
      const flat = flatLead(lead);
      const names = cols ?? Object.keys(flat);
      // Columns that are not part of the schema (and not on the lead) are ignored; schema
      // columns the lead has no value for come back as null — as LSQ does.
      const LeadPropertyList = names
        .filter((n) => n in flat || isKnownAttribute(n))
        .map((n) => ({ Attribute: n, Value: n in flat ? flat[n] : null }));
      return [{ LeadPropertyList }];
    });
    return ok({ RecordCount: memberIds.length, Leads });
  });

  // --- lists
  const listRow = (l: FakeList): Json => ({ ListId: l.id, ListName: l.name, ListDescription: l.description, ListType: l.type, MemberCount: l.members.length });

  route('/LeadManagement.svc/Lists.Get', 'GET', () => ok([...state.lists.values()].map(listRow)));

  route('/LeadSegmentation.svc/CreateEmptyList', 'POST', ({ body }) => {
    if (!isRecord(body) || typeof body.Name !== 'string' || body.Name.trim() === '') throw mxError('MXMandatoryAttributeMissingException', 'List Name is required.');
    const name = body.Name.trim();
    for (const l of state.lists.values()) {
      if (l.name.toLowerCase() === name.toLowerCase()) throw mxError('MXDuplicateEntryException', `A list with the name '${name}' already exists.`);
    }
    const list = createList(name, typeof body.Description === 'string' ? body.Description : '');
    return ok({ Status: 'Success', Message: { Id: list.id } });
  });

  route('/LeadSegmentation.svc/AddLeadsToStaticList', 'POST', ({ body }) => {
    if (!isRecord(body) || typeof body.listId !== 'string' || !Array.isArray(body.leadIds)) {
      throw mxError('MXMandatoryAttributeMissingException', 'listId and leadIds are required.');
    }
    const list = state.lists.get(body.listId);
    if (!list) throw mxError('MXInvalidInputException', `List ${body.listId} does not exist.`);
    const ids = body.leadIds.map((x: unknown) => String(x));
    const missing = ids.filter((id) => !state.leads.has(id));
    // All-or-nothing: nothing is added if any id is unknown.
    if (missing.length > 0) throw mxError('MXInvalidInputException', `Records not associated with List: ${missing.join(', ')}`);
    let added = 0;
    for (const id of ids) {
      if (!list.members.includes(id)) {
        list.members.push(id);
        added++;
      }
    }
    return ok({ Status: 'Success', Message: { Id: list.id, AffectedRows: added } });
  });

  route('/LeadSegmentation.svc/Lists/EmptyStaticList', 'GET', ({ query }) => {
    const id = query.ListId;
    if (!id) throw mxError('MXMandatoryAttributeMissingException', 'ListId is required.');
    const list = state.lists.get(id);
    if (!list) throw mxError('MXInvalidInputException', `List ${id} does not exist.`);
    list.members.length = 0;
    return ok({ Status: 'Success', Message: { Id: list.id } });
  });

  function createList(name: string, description: string): FakeList {
    listSeq++;
    const list: FakeList = { id: guid(2, listSeq), name, description, type: 'Static', members: [] };
    state.lists.set(list.id, list);
    return list;
  }

  // --- activity types & activities
  const typeRow = (t: FakeActivityType): Json => ({ Id: t.id, ActivityEvent: t.id, ActivityTypeName: t.name, Description: t.description, Direction: t.direction });

  route('/ProspectActivity.svc/CreateType', 'POST', ({ body }) => {
    if (!isRecord(body) || typeof body.ActivityEventName !== 'string' || body.ActivityEventName.trim() === '') {
      throw mxError('MXMandatoryAttributeMissingException', 'ActivityEventName is required.');
    }
    const name = body.ActivityEventName.trim();
    if (state.activityTypes.some((t) => t.name.toLowerCase() === name.toLowerCase())) {
      throw mxError('MXDuplicateEntryException', `An activity type named '${name}' already exists.`);
    }
    const fields: FakeActivityTypeField[] = (Array.isArray(body.Fields) ? body.Fields : []).filter(isRecord).map((f) => ({
      SchemaName: String(f.SchemaName ?? ''),
      DisplayName: String(f.DisplayName ?? ''),
      DataType: String(f.DataType ?? 'String'),
    }));
    const type: FakeActivityType = {
      id: activityTypeSeq++,
      name,
      description: typeof body.Description === 'string' ? body.Description : '',
      direction: Number(body.Direction ?? 0) || 0,
      fields,
    };
    state.activityTypes.push(type);
    return ok({ Status: 'Success', Message: { Id: type.id } });
  });

  route('/ProspectActivity.svc/ActivityTypes.Get', 'GET', () => ok(state.activityTypes.map(typeRow)));

  route('/ProspectActivity.svc/ActivityType.Get', 'GET', ({ query }) => {
    const id = Number(query.ActivityEvent);
    const type = state.activityTypes.find((t) => t.id === id);
    if (!type) throw mxError('MXInvalidInputException', `Activity type ${query.ActivityEvent ?? ''} does not exist.`);
    return ok({ ...typeRow(type), Fields: type.fields });
  });

  route('/ProspectActivity.svc/Bulk/CustomActivity/Add/ByLeadId', 'POST', ({ body }) => {
    if (!Array.isArray(body) || body.length === 0) throw mxError('MXInvalidInputException', 'Body must be a non-empty array of activities.');
    const parsed: Array<Omit<FakeActivity, 'id' | 'createdOn'>> = [];
    for (const item of body) {
      if (!isRecord(item)) throw mxError('MXInvalidInputException', 'Each activity must be an object.');
      const pid = item.RelatedProspectId;
      if (typeof pid !== 'string' || pid === '') throw mxError('MXMandatoryAttributeMissingException', 'RelatedProspectId is required.');
      if (!state.leads.has(pid)) throw mxError('MXInvalidInputException', `Invalid RelatedProspectId: ${pid}. Lead does not exist.`);
      const ev = Number(item.ActivityEvent);
      if (!Number.isFinite(ev)) throw mxError('MXInvalidInputException', 'ActivityEvent must be a number.');
      if (state.config.strictActivityTypes && !state.activityTypes.some((t) => t.id === ev)) {
        throw mxError('MXInvalidInputException', `Invalid ActivityEvent: ${ev}.`);
      }
      parsed.push({
        relatedProspectId: pid,
        activityEvent: ev,
        activityNote: typeof item.ActivityNote === 'string' ? item.ActivityNote : '',
        fields: (Array.isArray(item.Fields) ? item.Fields : []).filter(isRecord).map((f) => ({ SchemaName: String(f.SchemaName ?? ''), Value: String(f.Value ?? '') })),
      });
    }
    // All-or-nothing: stored only once every row validated.
    const ts = nowLsq();
    for (const p of parsed) {
      activitySeq++;
      state.activities.push({ id: guid(4, activitySeq), createdOn: ts, ...p });
    }
    return ok({ Status: 'Success', Message: { Count: parsed.length } });
  });

  // --- email
  route('/EmailMarketing.svc/SendEmailToLead', 'POST', ({ body, path }) => {
    if (!isRecord(body)) throw mxError('MXInvalidInputException', 'Body must be an object.');
    const senderType = typeof body.SenderType === 'string' ? body.SenderType : '';
    const sender = typeof body.Sender === 'string' && body.Sender !== '' ? body.Sender : null;
    if (senderType === 'UserEmailAddress') {
      const user = sender ? state.users.find((u) => u.email.toLowerCase() === sender.toLowerCase()) : undefined;
      if (!user || user.statusCode !== 0) throw mxError('MXMandatoryAttributeMissingException', 'Invalid Sender details.');
    } else if (senderType === 'APICaller') {
      if (!state.config.apiCallerEnabled) throw mxError('MXMandatoryAttributeMissingException', 'Invalid Sender details.');
    } else {
      throw mxError('MXMandatoryAttributeMissingException', 'Invalid Sender details.');
    }

    const recipientType = typeof body.RecipientType === 'string' ? body.RecipientType : '';
    const recipient = typeof body.Recipient === 'string' ? body.Recipient : '';
    const found = recipientType === 'LeadEmailAddress' && recipient ? state.leadsByEmail.get(recipient.toLowerCase()) : undefined;
    if (!found) throw mxError('MXInvalidInputException', `No lead found with RecipientType: ${recipientType} and Recipient: ${recipient}`);
    if (typeof body.Subject !== 'string' || body.Subject === '') throw mxError('MXMandatoryAttributeMissingException', 'Subject is required.');

    if (takeFault('POST', path, (r) => r.mailDelivery === true)) {
      throw mxError('MXMailDeliveryException', 'Email could not be delivered. Please contact support.');
    }

    emailSeq++;
    const id = guid(5, emailSeq);
    state.sentEmails.push({
      id,
      senderType,
      sender,
      recipientType,
      recipient,
      subject: body.Subject,
      contentHtml: typeof body.ContentHTML === 'string' ? body.ContentHTML : '',
      contentText: typeof body.ContentText === 'string' ? body.ContentText : '',
      emailCategory: typeof body.EmailCategory === 'string' ? body.EmailCategory : null,
      includeEmailFooter: body.IncludeEmailFooter === true,
      ts: Date.now(),
    });
    return ok({ ID: id, MemberCount: 1, TotalRecipient: 1 });
  });

  route('/UserManagement.svc/Users.Get', 'GET', () =>
    ok(state.users.map((u) => ({ UserId: u.id, EmailAddress: u.email, FirstName: u.firstName, LastName: u.lastName, Role: u.role, StatusCode: u.statusCode })))
  );

  // --- webhooks
  route('/Webhook.svc/Create', 'POST', ({ body }) => {
    if (!isRecord(body) || typeof body.URL !== 'string' || body.URL === '') throw mxError('MXMandatoryAttributeMissingException', 'URL is required.');
    webhookSeq++;
    const wh: FakeWebhook = {
      id: `wh_${webhookSeq}`,
      description: typeof body.Description === 'string' ? body.Description : '',
      url: body.URL,
      method: typeof body.Method === 'string' ? body.Method : 'POST',
      contentType: typeof body.ContentType === 'string' ? body.ContentType : 'application/json',
      webhookEvent: String(body.WebhookEvent ?? ''),
      raw: body,
    };
    state.webhooks.push(wh);
    return ok({ Status: 'Success', Message: { Id: wh.id } });
  });

  // ----- faults ------------------------------------------------------------

  /** Finds and consumes the first live rule matching this request (and `predicate`). */
  function takeFault(method: string, path: string, predicate: (rule: FaultRule) => boolean): FaultRule | null {
    for (const fs of state.faults) {
      if (fs.remaining <= 0) continue;
      const r = fs.rule;
      if (r.method && r.method.toUpperCase() !== method) continue;
      if (!ruleMatchesPath(r, path)) continue;
      if (!predicate(r)) continue;
      fs.remaining--;
      fs.hits++;
      return r;
    }
    return null;
  }

  // ----- HTTP plumbing -----------------------------------------------------

  const sockets = new Set<import('node:net').Socket>();

  function readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      req.on('data', (c: Buffer) => {
        size += c.length;
        if (size > MAX_BODY_BYTES) {
          reject(new ApiError(413, { ExceptionType: 'MXInvalidInputException', ExceptionMessage: 'Request body too large.' }));
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
      req.on('aborted', () => reject(new Error('aborted')));
    });
  }

  function write(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}, entry?: FakeRequestLogEntry): void {
    if (res.destroyed || res.writableEnded) return;
    const isText = typeof body === 'string';
    const payload = body === undefined ? '' : isText ? body : JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': isText ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(payload), ...headers });
    res.end(payload);
    if (entry) entry.status = status;
  }

  /** Resolves after `ms`, or immediately if the connection goes away first. */
  function wait(ms: number, res: http.ServerResponse): Promise<void> {
    return new Promise((resolve) => {
      const done = (): void => {
        clearTimeout(timer);
        res.off('close', done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      res.on('close', done);
    });
  }

  function authenticate(query: URLSearchParams): void {
    const ak = query.get('accessKey');
    const sk = query.get('secretKey');
    const badAccess = !ak || (opts.accessKey !== undefined && ak !== opts.accessKey);
    const badSecret = !sk || (opts.secretKey !== undefined && sk !== opts.secretKey);
    if (badAccess || badSecret) {
      throw new ApiError(401, { Status: 'Error', ExceptionType: 'MXAuthenticationException', ExceptionMessage: 'Invalid or missing accessKey / secretKey.' });
    }
  }

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const method = (req.method ?? 'GET').toUpperCase();
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    let rawBody = '';
    try {
      rawBody = await readBody(req);
    } catch {
      if (!res.destroyed && !res.headersSent) write(res, 413, { ExceptionType: 'MXInvalidInputException', ExceptionMessage: 'Request body too large.' });
      return;
    }

    let parsedBody: unknown = null;
    let bodyIsJson = true;
    if (rawBody !== '') {
      try {
        parsedBody = JSON.parse(rawBody);
      } catch {
        parsedBody = rawBody;
        bodyIsJson = false;
      }
    }

    const underBase = url.pathname === BASE || url.pathname.startsWith(`${BASE}/`);
    const path = (underBase ? url.pathname.slice(BASE.length) : url.pathname).replace(/\/+$/, '') || '/';
    const query: Record<string, string> = {};
    for (const [k, v] of url.searchParams) if (k !== 'accessKey' && k !== 'secretKey') query[k] = v;
    const entry: FakeRequestLogEntry = { method, path, query, body: parsedBody, ts: Date.now() };
    state.requestLog.push(entry);

    // Fault injection runs first, like a flaky gateway in front of LSQ.
    const fault = takeFault(method, path, (r) => !r.mailDelivery);
    if (fault) {
      entry.faulted = true;
      if (fault.delayMs) await wait(fault.delayMs, res);
      if (res.destroyed) return;
      if (fault.dropConnection) {
        res.socket?.destroy();
        return;
      }
      if (fault.status !== undefined) {
        const body = fault.body !== undefined ? fault.body : (http.STATUS_CODES[fault.status] ?? 'Error');
        write(res, fault.status, body, fault.headers, entry);
        return;
      }
      // delay-only fault: fall through to normal handling
    }

    try {
      if (!underBase) throw new ApiError(404, { Status: 'Error', ExceptionType: 'MXNotFoundException', ExceptionMessage: `No such path ${url.pathname}. Expected the ${BASE} prefix.` });
      authenticate(url.searchParams);
      const entryHandlers = handlers.get(path);
      if (!entryHandlers) throw new ApiError(404, { Status: 'Error', ExceptionType: 'MXNotFoundException', ExceptionMessage: `Unknown endpoint ${path}.` });
      const handler = method === 'GET' ? entryHandlers.GET : method === 'POST' ? entryHandlers.POST : undefined;
      if (!handler) {
        throw new ApiError(405, { Status: 'Error', ExceptionType: 'MXMethodNotAllowedException', ExceptionMessage: `${method} is not allowed on ${path}.` });
      }
      if (method === 'POST' && !bodyIsJson) throw mxError('MXInvalidInputException', 'Request body is not valid JSON.', 400);
      const result = handler({ query, body: parsedBody, path });
      write(res, result.status ?? 200, result.body, {}, entry);
    } catch (err) {
      if (err instanceof ApiError) write(res, err.status, err.payload, {}, entry);
      else write(res, 500, { ExceptionType: 'MXFakeInternalError', ExceptionMessage: err instanceof Error ? err.message : String(err) }, {}, entry);
    }
  }

  const server = http.createServer((req, res) => {
    void handle(req, res);
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port ?? 0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const port = (server.address() as AddressInfo).port;

  let stopped = false;
  return {
    url: `http://127.0.0.1:${port}${BASE}`,
    port,
    state,
    setFault(rule) {
      const times = rule.times ?? 1;
      state.faults.push({ rule, remaining: times === 'forever' ? Infinity : times, hits: 0 });
    },
    clearFaults() {
      state.faults.length = 0;
    },
    reset: resetState,
    requestsTo(match, method) {
      const probe: FaultRule = { match, method };
      return state.requestLog.filter((r) => ruleMatchesPath(probe, r.path) && (!method || r.method === method.toUpperCase()));
    },
    seedLead(fields) {
      const entries = Object.entries(fields);
      if (!fields.EmailAddress && !fields.Phone && !fields.Mobile) throw new Error('seedLead needs EmailAddress, Phone or Mobile');
      const payload = [...entries.map(([Attribute, Value]) => ({ Attribute, Value })), { Attribute: 'SearchBy', Value: fields.EmailAddress ? 'EmailAddress' : fields.Phone ? 'Phone' : 'Mobile' }];
      return upsertLead(payload).lead;
    },
    seedList(name, memberIds = [], description = '') {
      const list = createList(name, description);
      list.members.push(...memberIds);
      return list;
    },
    async stop() {
      if (stopped) return;
      stopped = true;
      for (const s of sockets) s.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
