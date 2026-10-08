/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/db', () => ({
  db: {
    campaign: { findUnique: vi.fn() },
    contact: { findFirst: vi.fn(), create: vi.fn(), findUnique: vi.fn().mockResolvedValue(null) },
  },
}));

vi.mock('@/lib/registration', () => ({
  verifyRegistrationToken: vi.fn(),
  mintRegistrationToken: vi.fn().mockReturnValue('mock-signed-token'),
}));

vi.mock('@/lib/registerContact', () => ({
  registerContact: vi.fn(), scheduleRegistrationJobs: vi.fn(), registerContactTx: vi.fn(async (_tx: unknown, ...args: unknown[]) => (await import('@/lib/registerContact')).registerContact(...args as [string,string,string,Date?,{enforceAvailability?:boolean}?])),
}));

import { db } from '@/lib/db';
import { verifyRegistrationToken } from '@/lib/registration';
import { registerContact } from '@/lib/registerContact';
import { OPTIONS, POST } from './route';

describe('POST /api/landing/submit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('handles OPTIONS pre-flight request with CORS headers', async () => {
    const res = await OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
  });

  it('registers contact via valid cryptographic token', async () => {
    (verifyRegistrationToken as any).mockReturnValue({
      ok: true,
      payload: { campaignId: 'camp-123', contactId: 'cont-456' },
    });

    (db.campaign.findUnique as any).mockResolvedValue({
      id: 'camp-123',
      name: 'OPD to IPD Funnel',
      zoomMeetingId: '81234567891',
    });

    (registerContact as any).mockResolvedValue({
      ok: true,
      alreadyRegistered: false,
      joinUrl: 'https://zoom.us/w/81234567891?tk=xyz',
      campaignName: 'OPD to IPD Funnel',
      campaignId: 'camp-123',
      scheduledAt: new Date(),
      queued: 2,
    });

    const req = new NextRequest('http://localhost:3000/api/landing/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: 'v1.valid.token',
        source: 'framer_landing_page',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.alreadyRegistered).toBe(false);
    expect(data.joinUrl).toContain('zoom.us');

    expect(registerContact).toHaveBeenCalledWith(
      'camp-123',
      'cont-456',
      'framer_landing_page',
      undefined,
      { enforceAvailability: true }
    );
  });

  it('registers contact via matching email when token is missing', async () => {
    (db.campaign.findUnique as any).mockResolvedValue({
      id: 'camp-123',
      name: 'OPD to IPD Funnel',
    });

    (db.contact.findFirst as any).mockResolvedValue({
      id: 'cont-999',
      campaignId: 'camp-123',
      email: 'pooja@healthplus.in',
    });

    (registerContact as any).mockResolvedValue({
      ok: true,
      alreadyRegistered: false,
      joinUrl: 'https://example.com/join',
      campaignName: 'OPD to IPD Funnel',
      campaignId: 'camp-123',
      scheduledAt: new Date(),
      queued: 1,
    });

    const req = new NextRequest('http://localhost:3000/api/landing/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        campaignId: 'camp-123',
        email: 'pooja@healthplus.in',
        source: 'email',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(registerContact).toHaveBeenCalledWith('camp-123', 'cont-999', 'email', undefined, { enforceAvailability: true });
  });

  it('auto-creates inbound contact if not previously in database', async () => {
    (db.campaign.findUnique as any).mockResolvedValue({
      id: 'camp-123',
      name: 'OPD to IPD Funnel',
    });

    (db.contact.findFirst as any).mockResolvedValue(null);

    (db.contact.create as any).mockResolvedValue({
      id: 'cont-created',
      campaignId: 'camp-123',
      email: 'newuser@healthplus.in',
      name: 'Dr. Rahul Verma',
    });

    (registerContact as any).mockResolvedValue({
      ok: true,
      alreadyRegistered: false,
      joinUrl: 'https://example.com/join',
      campaignName: 'OPD to IPD Funnel',
      campaignId: 'camp-123',
      scheduledAt: new Date(),
      queued: 1,
    });

    const req = new NextRequest('http://localhost:3000/api/landing/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        campaignId: 'camp-123',
        email: 'newuser@healthplus.in',
        firstName: 'Dr. Rahul',
        lastName: 'Verma',
        phone: '+919876543210',
        company: 'Apollo Care',
        source: 'whatsapp',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);

    expect(db.contact.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'newuser@healthplus.in',
          name: 'Dr. Rahul Verma',
          phone: '+919876543210',
          account: 'Apollo Care',
        }),
      })
    );

    expect(registerContact).toHaveBeenCalledWith('camp-123', 'cont-created', 'whatsapp', undefined, { enforceAvailability: true });
  });

  it('returns 400 when neither token nor email is provided', async () => {
    const req = new NextRequest('http://localhost:3000/api/landing/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.ok).toBe(false);
  });
});

beforeEach(() => {
  (db as any).$queryRaw = vi.fn(async () => []);
  (db as any).$transaction = vi.fn(async (cb: any) => cb(db));
  (db.campaign as any).findUniqueOrThrow = vi.fn(async (args: any) => db.campaign.findUnique(args));
});
