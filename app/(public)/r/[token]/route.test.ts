/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/registration', () => ({
  verifyRegistrationToken: vi.fn(),
  mintRegistrationToken: vi.fn().mockReturnValue('minted-token'),
  ensureAbsoluteUrl: vi.fn((url: string) => url.startsWith('http') ? url : `https://${url}`),
}));

vi.mock('@/lib/registerContact', () => ({
  registerContact: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    campaign: { findUnique: vi.fn().mockResolvedValue(null) },
    contact: { findUnique: vi.fn().mockResolvedValue(null) },
  },
}));

import { verifyRegistrationToken, ensureAbsoluteUrl } from '@/lib/registration';
import { registerContact } from '@/lib/registerContact';
import { db } from '@/lib/db';
import { GET } from './route';

describe('One-Click Registration Route Handler (app/r/[token]/route.ts)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('redirects to /r/result with status if token verification fails', async () => {
    vi.mocked(verifyRegistrationToken).mockReturnValueOnce({
      ok: false,
      reason: 'bad-signature',
    });

    const req = new Request('https://webinar.example.com/r/tampered_token');
    const ctx = { params: Promise.resolve({ token: 'tampered_token' }) } as any;

    const res = await GET(req, ctx);

    expect(res.status).toBe(307);
    const location = res.headers.get('location');
    expect(location).toBe('https://webinar.example.com/r/result?status=bad-signature');
    expect(registerContact).not.toHaveBeenCalled();
  });

  it('redirects to /r/result with error status if registerContact fails', async () => {
    vi.mocked(verifyRegistrationToken).mockReturnValueOnce({
      ok: true,
      payload: { campaignId: 'c1', contactId: 'ct1', iat: 123456 },
    });

    vi.mocked(registerContact).mockResolvedValueOnce({
      ok: false,
      reason: 'unknown-campaign',
    });

    const req = new Request('https://webinar.example.com/r/valid_token');
    const ctx = { params: Promise.resolve({ token: 'valid_token' }) } as any;

    const res = await GET(req, ctx);

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://webinar.example.com/r/result?status=unknown-campaign');
  });

  it('registers contact and redirects to attendee hub with autoCal=1 on first click', async () => {
    vi.mocked(verifyRegistrationToken).mockReturnValueOnce({
      ok: true,
      payload: { campaignId: 'c1', contactId: 'ct1', iat: 123456 },
    });

    const futureDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000); // 2 days later
    vi.mocked(registerContact).mockResolvedValueOnce({
      ok: true,
      alreadyRegistered: false,
      joinUrl: 'https://zoom.us/j/123456',
      campaignName: 'AI Scaling Webinar',
      campaignId: 'c1',
      scheduledAt: futureDate,
      queued: 2,
    });

    const req = new Request('https://webinar.example.com/r/valid_token');
    const ctx = { params: Promise.resolve({ token: 'valid_token' }) } as any;

    const res = await GET(req, ctx);

    expect(registerContact).toHaveBeenCalledWith('c1', 'ct1', 'one_click', undefined, { enforceAvailability: true });
    expect(res.status).toBe(307);
    const location = res.headers.get('location');
    expect(location).toBe('https://webinar.example.com/r/result?status=registered&t=valid_token&autoCal=1');
  });

  it('redirects with status=already and no autoCal on repeat click (idempotent)', async () => {
    vi.mocked(verifyRegistrationToken).mockReturnValueOnce({
      ok: true,
      payload: { campaignId: 'c1', contactId: 'ct1', iat: 123456 },
    });

    const futureDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    vi.mocked(registerContact).mockResolvedValueOnce({
      ok: true,
      alreadyRegistered: true,
      joinUrl: 'https://zoom.us/j/123456',
      campaignName: 'AI Scaling Webinar',
      campaignId: 'c1',
      scheduledAt: futureDate,
      queued: 0,
    });

    const req = new Request('https://webinar.example.com/r/valid_token');
    const ctx = { params: Promise.resolve({ token: 'valid_token' }) } as any;

    const res = await GET(req, ctx);

    expect(res.status).toBe(307);
    const location = res.headers.get('location');
    expect(location).toBe('https://webinar.example.com/r/result?status=already&t=valid_token');
    expect(location).not.toContain('autoCal=1');
  });

  it('redirects directly to Zoom meeting room if session is starting within 15 minutes', async () => {
    vi.mocked(verifyRegistrationToken).mockReturnValueOnce({
      ok: true,
      payload: { campaignId: 'c1', contactId: 'ct1', iat: 123456 },
    });

    const startingSoon = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes from now
    vi.mocked(registerContact).mockResolvedValueOnce({
      ok: true,
      alreadyRegistered: false,
      joinUrl: 'https://zoom.us/j/999888',
      campaignName: 'Live Now Webinar',
      campaignId: 'c1',
      scheduledAt: startingSoon,
      queued: 1,
    });

    const req = new Request('https://webinar.example.com/r/live_token');
    const ctx = { params: Promise.resolve({ token: 'live_token' }) } as any;

    const res = await GET(req, ctx);

    expect(ensureAbsoluteUrl).toHaveBeenCalledWith('https://zoom.us/j/999888');
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://zoom.us/j/999888');
  });
});

describe('short links for external landing pages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('redirects to the full landing URL instead of registering', async () => {
    vi.mocked(verifyRegistrationToken).mockReturnValueOnce({ ok: true, payload: { campaignId: 'c1', contactId: 'ct1', iat: 1 } });
    vi.mocked(db.campaign.findUnique).mockResolvedValueOnce({
      id: 'c1', name: 'AI Lending', zoomMeetingId: null, registrationMode: 'external',
      registrationLink: 'https://webinar.example.com/go', oneClickSignup: false, landingPrefill: false,
    } as any);
    vi.mocked(db.contact.findUnique).mockResolvedValueOnce({ id: 'ct1', campaignId: 'c1', name: 'Priya N', email: 'p@x.com', phone: null, account: 'Acme', title: 'VP' } as any);

    const res = await GET(new Request('https://studio.example.com/r/tok?source=linkedin'), { params: Promise.resolve({ token: 'tok' }) } as any);

    expect(res.status).toBe(307);
    const loc = new URL(res.headers.get('location') as string);
    expect(loc.origin + loc.pathname).toBe('https://webinar.example.com/go');
    expect(loc.searchParams.get('utm_source')).toBe('linkedin');
    expect(loc.searchParams.get('campaignId')).toBe('c1');
    expect(res.headers.get('location')).not.toContain('Priya');
    expect(registerContact).not.toHaveBeenCalled();
  });

  it('does not expand a token that belongs to a contact of another webinar', async () => {
    vi.mocked(verifyRegistrationToken).mockReturnValueOnce({ ok: true, payload: { campaignId: 'c1', contactId: 'ct9', iat: 1 } });
    vi.mocked(db.campaign.findUnique).mockResolvedValueOnce({ id: 'c1', name: 'x', zoomMeetingId: null, registrationMode: 'external', registrationLink: 'https://a.example/', oneClickSignup: false, landingPrefill: false } as any);
    vi.mocked(db.contact.findUnique).mockResolvedValueOnce({ id: 'ct9', campaignId: 'OTHER', name: 'N', email: null, phone: null, account: null, title: null } as any);
    vi.mocked(registerContact).mockResolvedValueOnce({ ok: false, reason: 'unknown-contact' } as any);

    const res = await GET(new Request('https://studio.example.com/r/tok'), { params: Promise.resolve({ token: 'tok' }) } as any);
    expect(res.headers.get('location')).toContain('/r/result');
  });
});
