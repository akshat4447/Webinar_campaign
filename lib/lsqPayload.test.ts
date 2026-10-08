import { describe, it, expect } from 'vitest';
import { assertValidActivities, assertValidLeadFields, formatLsqDateTime, isLsqDateTime, isValidLsqSchemaName, LsqPayloadError } from './lsqPayload';

describe('formatLsqDateTime', () => {
  it('formats UTC as YYYY-MM-DD HH:MM:SS with zero padding', () => {
    expect(formatLsqDateTime(new Date('2026-03-04T05:06:07Z'))).toBe('2026-03-04 05:06:07');
  });
  it('rejects an invalid date instead of emitting "NaN-NaN"', () => {
    expect(() => formatLsqDateTime(new Date('nope'))).toThrow();
  });
});

describe('isLsqDateTime', () => {
  it('accepts only the exact LeadSquared shape and real calendar dates', () => {
    expect(isLsqDateTime('2026-10-01 09:30:00')).toBe(true);
    expect(isLsqDateTime('2026-10-01T09:30:00Z')).toBe(false);
    expect(isLsqDateTime('2026-02-30 09:30:00')).toBe(false);
    expect(isLsqDateTime('01/10/2026')).toBe(false);
  });
});

describe('isValidLsqSchemaName', () => {
  it('accepts standard and mx_ custom names, rejects junk', () => {
    for (const ok of ['EmailAddress', 'FirstName', 'mx_Custom_1', 'mx_Zoom_Registered']) expect(isValidLsqSchemaName(ok)).toBe(true);
    for (const bad of ['', 'mx-bad', 'mx_', 'has space', '1abc', "x'; drop", 'mx_a.b']) expect(isValidLsqSchemaName(bad)).toBe(false);
  });
});

describe('assertValidLeadFields', () => {
  it('passes a normal lead', () => {
    expect(() => assertValidLeadFields([{ Attribute: 'EmailAddress', Value: 'a@b.com' }, { Attribute: 'mx_City', Value: 'Pune' }])).not.toThrow();
  });
  it('rejects an empty payload, bad names, non-string values, bad emails and malformed dates', () => {
    expect(() => assertValidLeadFields([])).toThrow(LsqPayloadError);
    expect(() => assertValidLeadFields([{ Attribute: 'bad name', Value: 'x' }])).toThrow(/attribute name/);
    expect(() => assertValidLeadFields([{ Attribute: 'FirstName', Value: 5 as unknown as string }])).toThrow(/must be a string/);
    expect(() => assertValidLeadFields([{ Attribute: 'EmailAddress', Value: 'not-an-email' }])).toThrow(/valid EmailAddress/);
    expect(() => assertValidLeadFields([{ Attribute: 'DOB', Value: '2026-10-01T00:00:00Z' }])).toThrow(/YYYY-MM-DD HH:MM:SS/);
  });
  it('allows an empty email value (field present but unset)', () => {
    expect(() => assertValidLeadFields([{ Attribute: 'EmailAddress', Value: '' }])).not.toThrow();
  });
});

describe('assertValidActivities', () => {
  const ok = { RelatedProspectId: 'p1', ActivityEvent: 205, ActivityNote: 'n', Fields: [{ SchemaName: 'mx_Custom_1', Value: 'x' }] };
  it('passes a valid activity', () => expect(() => assertValidActivities([ok])).not.toThrow());
  it('rejects a missing lead id, non-numeric event, or bad field name', () => {
    expect(() => assertValidActivities([{ ...ok, RelatedProspectId: '' }])).toThrow(/RelatedProspectId/);
    expect(() => assertValidActivities([{ ...ok, ActivityEvent: NaN }])).toThrow(/ActivityEvent/);
    expect(() => assertValidActivities([{ ...ok, Fields: [{ SchemaName: 'bad name', Value: 'x' }] }])).toThrow(/schema name/);
  });
});
