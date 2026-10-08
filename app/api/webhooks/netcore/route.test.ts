/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: {
    contact: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    cadenceSend: {
      updateMany: vi.fn(),
    },
    activityLogEntry: {
      create: vi.fn(),
    },
  },
}));

vi.mock('@/lib/integrationConfig', () => ({
  resolveIntegrationField: vi.fn(),
}));

vi.mock('@/lib/registration', () => ({
  verifyRegistrationToken: vi.fn(),
}));

vi.mock('@/lib/registerContact', () => ({
  registerContact: vi.fn(),
}));

vi.mock('@/lib/netcore', () => ({
  addEmailToSuppression: vi.fn(),
}));

import { db } from '@/lib/db';
import { resolveIntegrationField } from '@/lib/integrationConfig';
import { verifyRegistrationToken } from '@/lib/registration';
import { registerContact } from '@/lib/registerContact';
import { addEmailToSuppression } from '@/lib/netcore';
import { POST, GET, HEAD } from './route';

describe('Netcore Webhook Endpoint (/api/webhooks/netcore)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('handles HEAD requests with 200 OK', async () => {
    const res = await HEAD();
    expect(res.status).toBe(200);
  });

  it('handles GET requests with active endpoint metadata', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe('active');
    expect(json.endpoint).toBe('/api/webhooks/netcore');
  });

  it('returns 400 for malformed JSON in POST', async () => {
    vi.mocked(resolveIntegrationField).mockResolvedValue(undefined);
    const req = new Request('http://localhost:3000/api/webhooks/netcore', {
      method: 'POST',
      body: 'invalid-json{{{',
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error).toContain('Malformed JSON');
  });

  it('rejects with 401 when webhook secret is configured but invalid', async () => {
    vi.mocked(resolveIntegrationField).mockResolvedValue('super_secret_nc_token');
    const req = new Request('http://localhost:3000/api/webhooks/netcore', {
      method: 'POST',
      body: JSON.stringify([{ EVENT: 'click' }]),
      headers: { 'Content-Type': 'application/json', 'x-netcore-secret': 'wrong_secret' },
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error).toContain('Unauthorized');
  });

  it('accepts request when webhook secret matches via query param or header', async () => {
    vi.mocked(resolveIntegrationField).mockResolvedValue('super_secret_nc_token');
    const req = new Request('http://localhost:3000/api/webhooks/netcore?secret=super_secret_nc_token', {
      method: 'POST',
      body: JSON.stringify([]),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.processed).toBe(0);
  });

  it('processes click event on registration link and registers contact', async () => {
    vi.mocked(resolveIntegrationField).mockResolvedValue(undefined);
    vi.mocked(verifyRegistrationToken).mockReturnValueOnce({
      ok: true,
      payload: { campaignId: 'c_test_1', contactId: 'ct_test_1', iat: 1789500000 },
    });
    vi.mocked(registerContact).mockResolvedValueOnce({
      ok: true,
      alreadyRegistered: false,
      joinUrl: 'https://zoom.us/j/11111',
      campaignName: 'AI in Lending',
      campaignId: 'c_test_1',
      scheduledAt: new Date(),
      queued: 1,
    });
    vi.mocked(db.activityLogEntry.create).mockResolvedValueOnce({} as any);

    const payload = [
      {
        TRANSID: 101,
        EVENT: 'click',
        EMAIL: 'attendee@company.com',
        URL: 'https://example.com/r/valid_signed_token_123',
        TIMESTAMP: 1789500000,
      },
    ];

    const req = new Request('http://localhost:3000/api/webhooks/netcore', {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.registered).toBe(1);
    expect(verifyRegistrationToken).toHaveBeenCalledWith('valid_signed_token_123');
    expect(registerContact).toHaveBeenCalledWith('c_test_1', 'ct_test_1', 'netcore_click');
    expect(db.activityLogEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          campaignId: 'c_test_1',
          text: expect.stringContaining('Netcore click-to-register'),
        }),
      })
    );
  });

  it('processes hardbounce event: suppresses email and cancels pending sends', async () => {
    vi.mocked(resolveIntegrationField).mockResolvedValue(undefined);
    vi.mocked(addEmailToSuppression).mockResolvedValueOnce({} as any);
    vi.mocked(db.contact.findMany).mockResolvedValueOnce([
      { id: 'contact_bad_1', campaignId: 'c1' },
    ] as any);
    vi.mocked(db.cadenceSend.updateMany).mockResolvedValueOnce({ count: 2 } as any);

    const payload = [
      {
        TRANSID: 102,
        EVENT: 'hardbounce',
        EMAIL: 'badmailbox@invalid.com',
        REASON: '550 5.1.1 User unknown',
        TIMESTAMP: 1789500010,
      },
    ];

    const req = new Request('http://localhost:3000/api/webhooks/netcore', {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.suppressed).toBe(1);
    expect(addEmailToSuppression).toHaveBeenCalledWith(
      'badmailbox@invalid.com',
      'bounce',
      '550 5.1.1 User unknown',
      'netcore'
    );
    expect(db.cadenceSend.updateMany).toHaveBeenCalledWith({
      where: { contactId: { in: ['contact_bad_1'] }, status: { in: ['queued', 'processing'] } },
      data: { status: 'failed', claimedAt: null, error: 'Hard bounce: 550 5.1.1 User unknown' },
    });
  });

  it('processes unsub and spam events: adds to suppression and sets approved=false', async () => {
    vi.mocked(resolveIntegrationField).mockResolvedValue(undefined);
    vi.mocked(addEmailToSuppression).mockResolvedValue({} as any);
    vi.mocked(db.contact.updateMany).mockResolvedValue({ count: 1 } as any);

    const payload = [
      {
        TRANSID: 103,
        EVENT: 'unsub',
        EMAIL: 'optout@example.com',
        TIMESTAMP: 1789500020,
      },
      {
        TRANSID: 104,
        EVENT: 'spam',
        EMAIL: 'complainant@example.com',
        REASON: 'Marked as spam in Gmail',
        TIMESTAMP: 1789500030,
      },
    ];

    const req = new Request('http://localhost:3000/api/webhooks/netcore', {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.suppressed).toBe(2);
    expect(addEmailToSuppression).toHaveBeenCalledWith(
      'optout@example.com',
      'unsubscribe',
      'Netcore unsub event',
      'netcore'
    );
    expect(addEmailToSuppression).toHaveBeenCalledWith(
      'complainant@example.com',
      'spam',
      'Marked as spam in Gmail',
      'netcore'
    );
    expect(db.contact.updateMany).toHaveBeenCalledTimes(2);
    expect(db.contact.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ approved: false }),
      })
    );
  });
});
