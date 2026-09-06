import { describe, expect, it } from 'vitest';
import {
  TOKEN_TTL_DAYS,
  ensureAbsoluteUrl,
  mintRegistrationToken,
  verifyRegistrationToken,
  registrationUrl,
} from './registration';

const CAMPAIGN = 'camp_123';
const CONTACT = 'cont_456';

describe('registration tokens', () => {
  it('round-trips the campaign and contact it was minted for', () => {
    const t = mintRegistrationToken(CAMPAIGN, CONTACT);
    const r = verifyRegistrationToken(t);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.payload.campaignId).toBe(CAMPAIGN);
      expect(r.payload.contactId).toBe(CONTACT);
    }
  });

  it('rejects a token whose payload was edited', () => {
    // The whole point: a link is a bearer credential, so swapping the contact
    // id in the URL must not let you register somebody else.
    const t = mintRegistrationToken(CAMPAIGN, CONTACT);
    const [v, body, sig] = t.split('.');
    const tampered = Buffer.from(
      JSON.stringify({ campaignId: CAMPAIGN, contactId: 'someone_else', iat: Math.floor(Date.now() / 1000) })
    ).toString('base64url');
    expect(body).not.toBe(tampered);
    expect(verifyRegistrationToken([v, tampered, sig].join('.'))).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('rejects a token whose signature was edited', () => {
    const t = mintRegistrationToken(CAMPAIGN, CONTACT);
    const [v, body] = t.split('.');
    expect(verifyRegistrationToken(`${v}.${body}.not-a-real-signature`)).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('rejects malformed input rather than throwing', () => {
    for (const bad of ['', 'nonsense', 'a.b', 'v2.body.sig', 'v1..', 'v1.!!!not-base64!!!.sig']) {
      const r = verifyRegistrationToken(bad);
      expect(r.ok).toBe(false);
    }
  });

  it('expires past the TTL and is still valid just inside it', () => {
    const minted = new Date('2026-01-01T00:00:00Z');
    const t = mintRegistrationToken(CAMPAIGN, CONTACT, minted);

    const justInside = new Date(minted.getTime() + (TOKEN_TTL_DAYS - 1) * 86400_000);
    expect(verifyRegistrationToken(t, justInside).ok).toBe(true);

    const justOutside = new Date(minted.getTime() + (TOKEN_TTL_DAYS + 1) * 86400_000);
    expect(verifyRegistrationToken(t, justOutside)).toEqual({ ok: false, reason: 'expired' });
  });

  it('gives different contacts different tokens', () => {
    const a = mintRegistrationToken(CAMPAIGN, 'contact_a');
    const b = mintRegistrationToken(CAMPAIGN, 'contact_b');
    expect(a).not.toBe(b);
  });

  it('builds a URL without a double slash when the origin has a trailing one', () => {
    const url = registrationUrl('https://example.com/', CAMPAIGN, CONTACT);
    expect(url.startsWith('https://example.com/r/')).toBe(true);
    expect(url).not.toContain('//r/');
  });

  it('verifies a token taken back out of its URL', () => {
    const url = registrationUrl('https://example.com', CAMPAIGN, CONTACT);
    const token = url.split('/r/')[1];
    expect(verifyRegistrationToken(token).ok).toBe(true);
  });
});

describe('ensureAbsoluteUrl', () => {
  it('adds https:// to a bare, scheme-less link — the stored/displayed format for a registration link', () => {
    expect(ensureAbsoluteUrl('lsq.co/w/my-webinar')).toBe('https://lsq.co/w/my-webinar');
  });

  it('leaves an already-absolute http(s) URL untouched', () => {
    expect(ensureAbsoluteUrl('https://zoom.us/j/123')).toBe('https://zoom.us/j/123');
    expect(ensureAbsoluteUrl('http://example.com')).toBe('http://example.com');
  });

  it('leaves any other real URL scheme untouched, not just http(s)', () => {
    expect(ensureAbsoluteUrl('zoommtg://zoom.us/join?id=123')).toBe('zoommtg://zoom.us/join?id=123');
  });

  it('rejects dangerous schemes and protocol-relative URLs', () => {
    expect(ensureAbsoluteUrl('javascript:alert(1)')).toBe('about:blank');
    expect(ensureAbsoluteUrl('data:text/html,<script>alert(1)</script>')).toBe('about:blank');
    expect(ensureAbsoluteUrl('vbscript:msgbox(1)')).toBe('about:blank');
    expect(ensureAbsoluteUrl('file:///etc/passwd')).toBe('about:blank');
    expect(ensureAbsoluteUrl('//evil.com/phish')).toBe('about:blank');
    expect(ensureAbsoluteUrl('')).toBe('about:blank');
  });
});

