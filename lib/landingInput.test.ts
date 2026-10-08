import { describe, it, expect } from 'vitest';
import { cleanSource, cleanText, parseLandingPayload } from './landingInput';

describe('cleanText', () => {
  it('trims, strips control characters and caps length; non-strings become empty', () => {
    expect(cleanText('  Ann\u0000\nLee  ', 50)).toBe('Ann  Lee');
    expect(cleanText('x'.repeat(500), 10)).toHaveLength(10);
    expect(cleanText(42, 10)).toBe('');
    expect(cleanText(null, 10)).toBe('');
  });
});

describe('cleanSource', () => {
  it('keeps short slugs, lowercased', () => expect(cleanSource('LinkedIn_Event')).toBe('linkedin_event'));
  it('falls back to the default for junk, markup or overlong values', () => {
    for (const bad of ['<script>', 'a b', '', 'x'.repeat(100), '-lead', 42, undefined]) expect(cleanSource(bad)).toBe('framer_landing_page');
  });
});

describe('parseLandingPayload', () => {
  it('accepts a normal submission and normalises the email', () => {
    const r = parseLandingPayload({ campaignId: 'c1', email: '  Pooja@HealthPlus.in ', firstName: 'Pooja', source: 'email' });
    expect(r.ok && r.data).toMatchObject({ campaignId: 'c1', email: 'pooja@healthplus.in', firstName: 'Pooja', source: 'email', honeypotTripped: false });
  });

  it('allows a missing email (token flow) but rejects a malformed one', () => {
    expect(parseLandingPayload({ token: 't' }).ok).toBe(true);
    for (const bad of ['nope', 'a@b', 'a b@c.com', 'a@b@c.com', '<x@y.com>', 'x@y.c']) {
      expect(parseLandingPayload({ email: bad })).toEqual({ ok: false, error: 'A valid email address is required' });
    }
  });

  it('rejects non-object bodies', () => {
    for (const bad of [null, 'str', 5, [], undefined]) expect(parseLandingPayload(bad).ok).toBe(false);
  });

  it('caps every free-text field so a hostile payload cannot bloat the database', () => {
    const r = parseLandingPayload({ email: 'a@b.co', firstName: 'f'.repeat(999), company: 'c'.repeat(999), jobTitle: 'j'.repeat(999), phone: '9'.repeat(999) });
    expect(r.ok && [r.data.firstName.length, r.data.company.length, r.data.jobTitle.length, r.data.phone.length]).toEqual([100, 200, 200, 32]);
  });

  it('flags the honeypot only when it was actually filled', () => {
    expect((parseLandingPayload({ email: 'a@b.co', website: 'http://spam' }) as { data: { honeypotTripped: boolean } }).data.honeypotTripped).toBe(true);
    expect((parseLandingPayload({ email: 'a@b.co', website: '   ' }) as { data: { honeypotTripped: boolean } }).data.honeypotTripped).toBe(false);
  });
});
