// Pure validation / formatting for LeadSquared payloads. No I/O.
//
// Fails fast with a precise message instead of letting LeadSquared answer a
// whole batch with an opaque 500 because one attribute name or value was wrong.

/** LeadSquared date-time fields take `YYYY-MM-DD HH:MM:SS` (UTC). */
export function formatLsqDateTime(date: Date): string {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) throw new Error('formatLsqDateTime: invalid Date');
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}-${p(date.getUTCMonth() + 1)}-${p(date.getUTCDate())} ${p(date.getUTCHours())}:${p(date.getUTCMinutes())}:${p(date.getUTCSeconds())}`;
}

const LSQ_DATETIME_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
export function isLsqDateTime(value: string): boolean {
  if (!LSQ_DATETIME_RE.test(value)) return false;
  const d = new Date(value.replace(' ', 'T') + 'Z');
  return !Number.isNaN(d.getTime()) && formatLsqDateTime(d) === value;
}

/** Custom schema names are `mx_` + word characters; standard ones are plain identifiers. */
const SCHEMA_NAME_RE = /^(mx_[A-Za-z0-9_]+|[A-Za-z][A-Za-z0-9]*)$/;
export function isValidLsqSchemaName(name: string): boolean {
  return SCHEMA_NAME_RE.test(name);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class LsqPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LsqPayloadError';
  }
}

/** Attributes whose value must be a LeadSquared date-time when present. */
const DATE_ATTRIBUTES = new Set(['DOB', 'CreatedOn', 'ModifiedOn', 'ActivityDateTime']);

export function assertValidLeadFields(fields: ReadonlyArray<{ Attribute: string; Value: string }>): void {
  if (!Array.isArray(fields) || fields.length === 0) throw new LsqPayloadError('Lead payload has no fields.');
  for (const f of fields) {
    if (!f || typeof f.Attribute !== 'string' || !isValidLsqSchemaName(f.Attribute)) {
      throw new LsqPayloadError(`Invalid LeadSquared attribute name: ${JSON.stringify(f?.Attribute)}.`);
    }
    if (typeof f.Value !== 'string') throw new LsqPayloadError(`Value for "${f.Attribute}" must be a string.`);
    if (f.Attribute === 'EmailAddress' && f.Value && !EMAIL_RE.test(f.Value)) {
      throw new LsqPayloadError(`"${f.Value}" is not a valid EmailAddress.`);
    }
    if (DATE_ATTRIBUTES.has(f.Attribute) && f.Value && !isLsqDateTime(f.Value)) {
      throw new LsqPayloadError(`"${f.Attribute}" must be formatted YYYY-MM-DD HH:MM:SS, got "${f.Value}".`);
    }
  }
}

export function assertValidActivities(
  activities: ReadonlyArray<{ RelatedProspectId: string; ActivityEvent: number; ActivityNote: string; Fields?: ReadonlyArray<{ SchemaName: string; Value: string }> }>
): void {
  for (const a of activities) {
    if (!a.RelatedProspectId) throw new LsqPayloadError('Activity is missing RelatedProspectId.');
    if (!Number.isFinite(a.ActivityEvent)) throw new LsqPayloadError('Activity has no numeric ActivityEvent.');
    for (const f of a.Fields ?? []) {
      if (!isValidLsqSchemaName(f.SchemaName)) throw new LsqPayloadError(`Invalid activity field schema name: ${JSON.stringify(f.SchemaName)}.`);
      if (typeof f.Value !== 'string') throw new LsqPayloadError(`Activity field "${f.SchemaName}" must be a string.`);
    }
  }
}
