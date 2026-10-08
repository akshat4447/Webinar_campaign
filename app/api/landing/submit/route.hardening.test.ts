/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/db', () => ({
  db: { campaign: { findUnique: vi.fn() }, contact: { findFirst: vi.fn(), create: vi.fn(), findUnique: vi.fn().mockResolvedValue(null) } },
}));
vi.mock('@/lib/registration', () => ({ verifyRegistrationToken: vi.fn().mockReturnValue({ ok: false }), mintRegistrationToken: vi.fn().mockReturnValue('tok') }));
vi.mock('@/lib/registerContact', () => ({ registerContact: vi.fn(), scheduleRegistrationJobs: vi.fn(), registerContactTx: vi.fn(async (_tx: unknown, ...args: unknown[]) => (await import('@/lib/registerContact')).registerContact(...args as [string,string,string,Date?,{enforceAvailability?:boolean}?])) }));
vi.mock('@/lib/rateLimit', () => ({
  allowRequest: vi.fn().mockResolvedValue({ allowed: true, retryAfterSec: 1 }),
  clientIp: vi.fn().mockReturnValue('9.9.9.9'),
}));

import { db } from '@/lib/db';
import { verifyRegistrationToken } from '@/lib/registration';
import { registerContact } from '@/lib/registerContact';
import { allowRequest } from '@/lib/rateLimit';
import { POST } from './route';

const post = (body: unknown) =>
  new NextRequest('http://localhost:3000/api/landing/submit', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(allowRequest).mockResolvedValue({ allowed: true, retryAfterSec: 1 });
  (db.campaign.findUnique as any).mockResolvedValue({ id: 'c1', name: 'W', vertical: 'SaaS', scheduledAt: null, date: null });
  (db.contact.findFirst as any).mockResolvedValue({ id: 'ct1' });
  (registerContact as any).mockResolvedValue({ ok: true, alreadyRegistered: false, joinUrl: null, campaignName: 'W', campaignId: 'c1', scheduledAt: null, queued: 0 });
});

describe('POST /api/landing/submit — abuse hardening', () => {
  it('returns 429 with Retry-After when the IP is over its limit, before touching the database', async () => {
    vi.mocked(allowRequest).mockResolvedValueOnce({ allowed: false, retryAfterSec: 42 });
    const res = await POST(post({ campaignId: 'c1', email: 'a@b.co' }));
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('42');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(db.campaign.findUnique).not.toHaveBeenCalled();
  });

  it('returns 429 when one email is being hammered, and registers nothing', async () => {
    vi.mocked(allowRequest).mockResolvedValueOnce({ allowed: true, retryAfterSec: 1 }).mockResolvedValueOnce({ allowed: false, retryAfterSec: 300 });
    const res = await POST(post({ campaignId: 'c1', email: 'victim@x.com' }));
    expect(res.status).toBe(429);
    expect(registerContact).not.toHaveBeenCalled();
    expect(vi.mocked(allowRequest).mock.calls[1][0]).toMatchObject({ scope: 'landing-email', key: 'c1:victim@x.com' });
  });

  it('rejects malformed JSON with 400, not 500', async () => {
    expect((await POST(post('{oops'))).status).toBe(400);
  });

  it('rejects a malformed email with 400 and never creates a contact', async () => {
    const res = await POST(post({ campaignId: 'c1', email: 'not-an-email' }));
    expect(res.status).toBe(400);
    expect(db.contact.create).not.toHaveBeenCalled();
  });

  it('silently ignores a honeypot-filled submission (looks like success, does nothing)', async () => {
    const res = await POST(post({ campaignId: 'c1', email: 'bot@x.com', website: 'http://spam.example' }));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    expect(registerContact).not.toHaveBeenCalled();
    expect(db.contact.create).not.toHaveBeenCalled();
  });

  it('sanitises the source tag before it is stored as the registration source', async () => {
    await POST(post({ campaignId: 'c1', email: 'a@b.co', source: '<img onerror=x>' }));
    expect(registerContact).toHaveBeenCalledWith('c1', 'ct1', 'framer_landing_page', undefined, { enforceAvailability: true });
  });

  it('does not leak internal error details on a server failure', async () => {
    (db.campaign.findUnique as any).mockRejectedValueOnce(new Error('connection to 10.1.2.3:5432 refused'));
    const res = await POST(post({ campaignId: 'c1', email: 'a@b.co' }));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('10.1.2.3');
  });

  it('caps field lengths on auto-created contacts', async () => {
    (db.contact.findFirst as any).mockResolvedValueOnce(null);
    (db.contact.create as any).mockResolvedValueOnce({ id: 'new1' });
    await POST(post({ campaignId: 'c1', email: 'new@x.co', company: 'C'.repeat(5000) }));
    expect((db.contact.create as any).mock.calls[0][0].data.account).toHaveLength(200);
  });
});

describe('POST /api/landing/submit — closed webinars', () => {
  it('rejects an ended webinar before creating a contact',async()=>{
 vi.mocked(db.campaign.findUnique).mockResolvedValue({id:'c1',scheduledAt:new Date('2020-01-01')} as any);
 const res=await POST(post({campaignId:'c1',email:'late@x.co'}));
 expect(res.status).toBe(409);expect(await res.json()).toMatchObject({ok:false,reason:'ended'});
 expect(db.contact.create).not.toHaveBeenCalled();expect(registerContact).not.toHaveBeenCalled();
});

  it('asks registerContact to enforce availability on every public submission', async () => {
    await POST(post({ campaignId: 'c1', email: 'a@b.co' }));
    expect((registerContact as any).mock.calls[0][4]).toEqual({ enforceAvailability: true });
  });

  it('returns 400 for an unknown contact in a signed registration',async()=>{
 vi.mocked(verifyRegistrationToken).mockReturnValueOnce({ok:true,payload:{campaignId:'c1',contactId:'ct1',iat:1}});
 vi.mocked(registerContact).mockResolvedValueOnce({ok:false,reason:'unknown-contact'});
 expect((await POST(post({token:'valid'}))).status).toBe(400);
});
});

beforeEach(() => {
  (db as any).$queryRaw = vi.fn(async () => []);
  (db as any).$transaction = vi.fn(async (cb: any) => cb(db));
  (db.campaign as any).findUniqueOrThrow = vi.fn(async (args: any) => db.campaign.findUnique(args));
});
