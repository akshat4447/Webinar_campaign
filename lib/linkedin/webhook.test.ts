import { describe, it, expect } from 'vitest';
import { createHmac } from 'crypto';
import { verifyLinkedInSignature, parseLeadActionPayload, normalizeRegistrant } from './webhook';

const SECRET = 'smoketest-secret';

function sign(raw: string): string {
  return createHmac('sha256', SECRET).update(raw, 'utf8').digest('hex');
}

const createdPayload = {
  type: 'LEAD_ACTION',
  leadGenFormResponse: 'urn:li:leadGenFormResponse:1a2b3c-4',
  leadGenForm: 'urn:li:versionedLeadGenForm:(urn:li:leadGenForm:1, 1)',
  owner: { organization: 'urn:li:organization:123' },
  associatedEntity: { event: 'urn:li:event:456' },
  leadType: 'EVENT',
  leadAction: 'CREATED',
  occurredAt: 1756051200, // seconds — LinkedIn sends epoch seconds here
};

describe('verifyLinkedInSignature', () => {
  const body = JSON.stringify(createdPayload);

  it('accepts a correctly signed payload', () => {
    expect(verifyLinkedInSignature(body, SECRET, sign(body))).toBe(true);
  });

  it('is case-insensitive on the header hex and trims whitespace', () => {
    expect(verifyLinkedInSignature(body, SECRET, `  ${sign(body).toUpperCase()} `)).toBe(true);
  });

  it('rejects a tampered body', () => {
    const tampered = body.replace('CREATED', 'DELETED');
    expect(verifyLinkedInSignature(tampered, SECRET, sign(body))).toBe(false);
  });

  it('rejects the wrong secret and empty inputs', () => {
    expect(verifyLinkedInSignature(body, 'other-secret', sign(body))).toBe(false);
    expect(verifyLinkedInSignature('', SECRET, sign(''))).toBe(false);
    expect(verifyLinkedInSignature(body, SECRET, '')).toBe(false);
  });
});

describe('parseLeadActionPayload', () => {
  it('normalizes a CREATED notification (epoch seconds → ms)', () => {
    const parsed = parseLeadActionPayload(JSON.stringify(createdPayload));
    expect(parsed).toMatchObject({
      ok: true,
      responseUrn: 'urn:li:leadGenFormResponse:1a2b3c-4',
      eventUrn: 'urn:li:event:456',
      organizationUrn: 'urn:li:organization:123',
      leadAction: 'CREATED',
      occurredAtMs: 1756051200000,
    });
  });

  it('handles DELETED actions and ms-precision timestamps', () => {
    const parsed = parseLeadActionPayload(
      JSON.stringify({ ...createdPayload, leadAction: 'DELETED', occurredAt: 1756051200123 })
    );
    expect(parsed).toMatchObject({ ok: true, leadAction: 'DELETED', occurredAtMs: 1756051200123 });
  });

  it('returns malformed_json for non-JSON bodies', () => {
    expect(parseLeadActionPayload('<html>oops</html>')).toMatchObject({ ok: false, reason: 'malformed_json' });
    // Valid JSON but not an LEAD_ACTION object — politely ignorable (202).
    expect(parseLeadActionPayload('[1,2,3]')).toMatchObject({ ok: false, reason: 'ignored_type' });
    expect(parseLeadActionPayload('"just a string"')).toMatchObject({ ok: false, reason: 'malformed_json' });
  });

  it('politely ignores other webhook topics and lead types (202 territory)', () => {
    expect(parseLeadActionPayload(JSON.stringify({ type: 'ORGANIZATION_MEMBERSHIP' }))).toMatchObject({ ok: false, reason: 'ignored_type' });
    expect(parseLeadActionPayload(JSON.stringify({ ...createdPayload, leadType: 'SPONSORED' }))).toMatchObject({ ok: false, reason: 'ignored_type' });
  });

  it('flags unknown leadActions and missing required URNs as schema problems', () => {
    expect(parseLeadActionPayload(JSON.stringify({ ...createdPayload, leadAction: 'MAYBE' }))).toMatchObject({ ok: false, reason: 'schema_mismatch' });
    const noEvent = { ...createdPayload } as Record<string, unknown>;
    delete (noEvent.associatedEntity as unknown as Record<string, unknown>).event;
    expect(parseLeadActionPayload(JSON.stringify(noEvent))).toMatchObject({ ok: false, reason: 'missing_fields' });
  });
});

describe('normalizeRegistrant', () => {
  it('reads flat member fields first', () => {
    expect(
      normalizeRegistrant({ firstName: 'Rohan', lastName: 'Bhatt', emailAddress: 'Rohan@Acme.com', jobTitle: 'Head of Digital Lending', companyName: 'Acme Financial' })
    ).toEqual({ name: 'Rohan Bhatt', email: 'rohan@acme.com', title: 'Head of Digital Lending', company: 'Acme Financial' });
  });

  it('falls back to answers[] keyed by question labels, case-insensitively', () => {
    const raw = {
      answers: [
        { questionIdentifier: 'FULL_NAME', answerValue: 'Ananya Rao' },
        { questionLabel: "What's your email?", answer: 'Ananya@NorthwindHealth.io' },
        { questionIdentifier: 'jobTitle', answerValue: 'Director, Patient Engagement' },
        { questionLabel: 'Which company are you with?', answer: 'Northwind Health' },
      ],
    };
    expect(normalizeRegistrant(raw)).toEqual({
      name: 'Ananya Rao',
      email: 'ananya@northwindhealth.io',
      title: 'Director, Patient Engagement',
      company: 'Northwind Health',
    });
  });

  it('never throws on junk input', () => {
    expect(normalizeRegistrant(null)).toEqual({ name: '', email: '', title: '', company: '' });
    expect(normalizeRegistrant('nope')).toEqual({ name: '', email: '', title: '', company: '' });
    expect(normalizeRegistrant({ answers: [null, 42, {}] }).name).toBe('');
  });
});