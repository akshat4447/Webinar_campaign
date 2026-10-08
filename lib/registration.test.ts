import { createHmac } from 'node:crypto';
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

  it('rejects a token whose contact was swapped', () => {
    // The whole point: a link is a bearer credential, so swapping the contact
    // id in the URL must not let you register somebody else.
    const t = mintRegistrationToken(CAMPAIGN, CONTACT);
    const [v, camp, , iat, sig] = t.split('.');
    expect(verifyRegistrationToken([v, camp, 'someone_else', iat, sig].join('.'))).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('rejects a token whose campaign or issue time was edited', () => {
    const t = mintRegistrationToken(CAMPAIGN, CONTACT);
    const [v, , contact, iat, sig] = t.split('.');
    expect(verifyRegistrationToken([v, 'other_campaign', contact, iat, sig].join('.'))).toEqual({ ok: false, reason: 'bad-signature' });
    expect(verifyRegistrationToken([v, CAMPAIGN, contact, (parseInt(iat, 36) + 999999).toString(36), sig].join('.'))).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('rejects a token whose signature was edited', () => {
    const t = mintRegistrationToken(CAMPAIGN, CONTACT);
    const head = t.split('.').slice(0, 4).join('.');
    expect(verifyRegistrationToken(`${head}.not-a-real-signature`)).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('is compact enough for a LinkedIn note: ids of real length stay under 90 characters', () => {
    const t = mintRegistrationToken('cmuxqggsl0030l5uf0g7f8khp', 'cmuxqggsl0031l5uf0g7f8abc');
    expect(t.length).toBeLessThan(90);
  });

  it('still accepts a v1 token that was already sent in a message', () => {
    // Shape of a v1 token minted before the compact format existed: v1.<base64url json>.<hmac>.
    const body = Buffer.from(JSON.stringify({ campaignId: CAMPAIGN, contactId: CONTACT, iat: Math.floor(Date.now() / 1000) })).toString('base64url');
    const secret = process.env.REGISTRATION_SECRET || process.env.LINKEDIN_CLIENT_SECRET || 'dev-only-insecure-secret';
    const sig = createHmac('sha256', secret).update(`v1.${body}`).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const r = verifyRegistrationToken(`v1.${body}.${sig}`);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.payload.contactId).toBe(CONTACT);
  });

  it('falls back to v1 for ids that contain the separator', () => {
    const t = mintRegistrationToken('camp.1', 'cont.2');
    expect(t.startsWith('v1.')).toBe(true);
    const r = verifyRegistrationToken(t);
    expect(r.ok && r.payload.contactId).toBe('cont.2');
  });

  it('rejects malformed input rather than throwing', () => {
    for (const bad of ['', 'nonsense', 'a.b', 'v2.body.sig', 'v2.a.b.c', 'v2.a.b.c.d.e', 'v1..', 'v1.!!!not-base64!!!.sig']) {
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

  it('appends source query parameter when channel is provided', () => {
    const url = registrationUrl('https://example.com', CAMPAIGN, CONTACT, 'linkedin');
    expect(url).toContain('?source=linkedin');
    const [pathPart, queryPart] = url.split('?');
    const token = pathPart.split('/r/')[1];
    expect(verifyRegistrationToken(token).ok).toBe(true);
    const params = new URLSearchParams(queryPart);
    expect(params.get('source')).toBe('linkedin');
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

