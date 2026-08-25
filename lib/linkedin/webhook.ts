// Pure LinkedIn Lead Sync webhook contract — HMAC verification and payload
// parsing. No I/O, so every branch is unit-tested against fixtures shaped
// like the real notification sample from LinkedIn's Lead Sync documentation:
//   { type:"LEAD_ACTION", leadType:"EVENT", leadAction:"CREATED",
//     leadGenFormResponse:"urn:li:leadGenFormResponse:…", owner:{organization},
//     associatedEntity:{event:"urn:li:event:…"}, occurredAt }

import { createHmac, timingSafeEqual } from 'crypto';

/** LinkedIn posts X-LI-Signature: hex(HMAC-SHA256(rawBody, clientSecret)). */
export function verifyLinkedInSignature(rawBody: string, clientSecret: string, signatureHex: string): boolean {
  if (!rawBody || !clientSecret || !signatureHex) return false;
  const expected = createHmac('sha256', clientSecret).update(rawBody, 'utf8').digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signatureHex.trim().toLowerCase(), 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export type ParsedLeadAction =
  | { ok: true; responseUrn: string; formUrn: string | null; eventUrn: string; organizationUrn: string | null; leadAction: 'CREATED' | 'DELETED'; occurredAtMs: number | null }
  | { ok: false; reason: 'malformed_json' | 'schema_mismatch' | 'ignored_type' | 'missing_fields'; detail: string };

export function parseLeadActionPayload(rawBody: string): ParsedLeadAction {
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return { ok: false, reason: 'malformed_json', detail: 'Body is not valid JSON.' };
  }
  if (typeof json !== 'object' || json === null) {
    return { ok: false, reason: 'malformed_json', detail: 'Body is not a JSON object.' };
  }
  const obj = json as Record<string, unknown>;

  if (obj.type !== 'LEAD_ACTION') {
    // Other webhook topics may share this endpoint someday — ignore politely
    // with 202 so LinkedIn doesn't retry something we will never handle.
    return { ok: false, reason: 'ignored_type', detail: `Unsupported webhook type "${String(obj.type)}".` };
  }
  if (obj.leadType !== 'EVENT') {
    return { ok: false, reason: 'ignored_type', detail: `Unsupported leadType "${String(obj.leadType)}" — only EVENT leads feed campaigns.` };
  }

  const leadActionRaw = String(obj.leadAction ?? '').toUpperCase();
  if (leadActionRaw !== 'CREATED' && leadActionRaw !== 'DELETED') {
    return { ok: false, reason: 'schema_mismatch', detail: `Unknown leadAction "${String(obj.leadAction)}".` };
  }

  const responseUrn = typeof obj.leadGenFormResponse === 'string' ? obj.leadGenFormResponse : '';
  const owner = (obj.owner ?? {}) as Record<string, unknown>;
  const assoc = (obj.associatedEntity ?? {}) as Record<string, unknown>;
  const eventUrn = typeof assoc.event === 'string' ? assoc.event : '';

  if (!responseUrn || !eventUrn) {
    return { ok: false, reason: 'missing_fields', detail: 'Notification is missing leadGenFormResponse or associatedEntity.event.' };
  }

  const occurredRaw = obj.occurredAt;
  let occurredAtMs: number | null = null;
  if (typeof occurredRaw === 'number' && Number.isFinite(occurredRaw)) {
    occurredAtMs = occurredRaw > 1e12 ? occurredRaw : occurredRaw * 1000; // seconds vs ms
  } else if (typeof occurredRaw === 'string' && occurredRaw) {
    const d = new Date(occurredRaw);
    if (!Number.isNaN(d.getTime())) occurredAtMs = d.getTime();
  }

  return {
    ok: true,
    responseUrn,
    formUrn: typeof obj.leadGenForm === 'string' ? obj.leadGenForm : null,
    eventUrn,
    organizationUrn: typeof owner.organization === 'string' ? owner.organization : null,
    leadAction: leadActionRaw,
    occurredAtMs,
  };
}

export interface NormalizedRegistrant {
  name: string;
  email: string;
  title: string;
  company: string;
}

function pickString(obj: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

/**
 * Pulls {name,email,title,company} out of whatever shape the lead-form
 * response endpoint returns. The exact projection has drifted across API
 * versions, so this matches defensively: flat member fields first, then an
 * answers[] array keyed by questionIdentifier/questionLabel/label, matching
 * labels case-insensitively ("EmailAddress", "email", "What's your email?"…).
 */
export function normalizeRegistrant(raw: unknown): NormalizedRegistrant {
  const out: NormalizedRegistrant = { name: '', email: '', title: '', company: '' };
  if (typeof raw !== 'object' || raw === null) return out;
  const obj = raw as Record<string, unknown>;

  const first = pickString(obj, ['firstName', 'FirstName', 'givenName']);
  const last = pickString(obj, ['lastName', 'LastName', 'familyName']);
  const flatName = pickString(obj, ['fullName', 'FullName', 'name']);
  out.name = [first, last].filter(Boolean).join(' ') || flatName;

  out.email = pickString(obj, ['email', 'emailAddress', 'Email', 'EMAIL_ADDRESS']).toLowerCase();
  out.title = pickString(obj, ['title', 'jobTitle', 'JobTitle', 'headline']);
  out.company = pickString(obj, ['company', 'companyName', 'organization', 'account']);

  const answers = obj.answers;
  if (Array.isArray(answers)) {
    for (const entry of answers) {
      if (typeof entry !== 'object' || entry === null) continue;
      const a = entry as Record<string, unknown>;
      const answer = pickString(a, ['answer', 'answerValue', 'value', 'answerV2']);
      if (!answer) continue;
      const label = pickString(a, ['questionIdentifier', 'identifier', 'questionLabel', 'label', 'id']).toLowerCase();

      if (!out.email && /mail/.test(label)) out.email = answer.toLowerCase();
      else if (!out.title && /(title|role|position)/.test(label)) out.title = answer;
      else if (!out.company && /(company|organization|employer|account)/.test(label)) out.company = answer;
      else if (!out.name && /(full|^fn$|^ln$|first|last)/.test(label)) out.name = [out.name, answer].filter(Boolean).join(' ');
    }
  }

  return out;
}