import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: {
    campaign: {
      findFirst: vi.fn(),
    },
    contact: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('@/lib/registerContact', () => ({
  registerContact: vi.fn().mockResolvedValue({ ok: true, queued: 1 }),
}));

vi.mock('@/lib/integrationConfig', () => ({
  resolveIntegrationField: vi.fn().mockResolvedValue('test_secret'),
}));

vi.mock('@/lib/idempotency', () => ({
  claimOnce: vi.fn().mockResolvedValue(true),
  release: vi.fn().mockResolvedValue(undefined),
  idemKey: (...parts: unknown[]) => parts.join('|'),
}));

vi.mock('@/lib/zoomEnded', () => ({
  markMeetingEnded: vi.fn().mockResolvedValue(undefined),
}));

import { POST } from './route';
import { db } from '@/lib/db';
import { registerContact } from '@/lib/registerContact';
import type { Campaign, Contact } from '@/lib/generated/prisma/client';
import { NextRequest } from 'next/server';
import { resolveIntegrationField } from '@/lib/integrationConfig';
import { claimOnce, release } from '@/lib/idempotency';
import { markMeetingEnded } from '@/lib/zoomEnded';
import { computeZoomSignature } from '@/lib/zoom/webhookSecurity';

const SECRET = 'test_secret';

/** A request signed the way Zoom signs it. */
function signed(body: unknown, opts: { secret?: string; timestamp?: string; headers?: Record<string, string> } = {}) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const timestamp = opts.timestamp ?? String(Math.floor(Date.now() / 1000));
  return new NextRequest('http://localhost:3000/api/webhooks/zoom', {
    method: 'POST',
    body: raw,
    headers: {
      'x-zm-request-timestamp': timestamp,
      'x-zm-signature': computeZoomSignature(opts.secret ?? SECRET, timestamp, raw),
      ...(opts.headers ?? {}),
    },
  });
}

describe('Zoom Webhook Endpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('validates endpoint URL challenge (CRC check)', async () => {
    const req = signed({
      event: 'endpoint.url_validation',
      payload: {
        plainToken: 'zoom_challenge_token_123',
      },
    });

    const res = await POST(req);
    const json = await res.json();

    expect(json.plainToken).toBe('zoom_challenge_token_123');
    expect(json.encryptedToken).toBeDefined();
    expect(typeof json.encryptedToken).toBe('string');
  });

  it('handles webinar.registration_created for existing contact', async () => {
    vi.mocked(db.campaign.findFirst).mockResolvedValue({
      id: 'c_test_zoom',
      zoomMeetingId: '81234567890',
    } as unknown as Campaign);

    vi.mocked(db.contact.findFirst).mockResolvedValue({
      id: 'ct_zoom_1',
      email: 'attendee@example.com',
    } as unknown as Contact);

    const req = signed({
        event: 'webinar.registration_created',
        payload: {
          object: {
            id: '81234567890',
            registrant: {
              email: 'attendee@example.com',
              first_name: 'Jane',
              last_name: 'Doe',
              join_url: 'https://us06web.zoom.us/w/81234567890?tk=test_token',
              create_time: '2026-10-06T10:00:00Z',
            },
          },
        },
      });

    const res = await POST(req);
    const json = await res.json();

    expect(json.ok).toBe(true);
    expect(registerContact).toHaveBeenCalledWith(
      'c_test_zoom',
      'ct_zoom_1',
      'zoom',
      expect.any(Date)
    );
    expect(db.contact.update).toHaveBeenCalledWith({
      where: { id: 'ct_zoom_1' },
      data: expect.objectContaining({
        zoomJoinUrl: 'https://us06web.zoom.us/w/81234567890?tk=test_token',
      }),
    });
  });

  it('auto-creates contact record for organic direct Zoom registrant', async () => {
    vi.mocked(db.campaign.findFirst).mockResolvedValue({
      id: 'c_test_zoom',
      zoomMeetingId: '81234567890',
      vertical: 'SaaS',
    } as unknown as Campaign);

    vi.mocked(db.contact.findFirst).mockResolvedValue(null);
    vi.mocked(db.contact.create).mockResolvedValue({
      id: 'ct_new_zoom',
      email: 'organic@example.com',
    } as unknown as Contact);

    const req = signed({
        event: 'meeting.registration_created',
        payload: {
          object: {
            id: '81234567890',
            registrant: {
              email: 'organic@example.com',
              first_name: 'Sam',
              last_name: 'Altman',
              org: 'OpenAI',
              job_title: 'CEO',
              join_url: 'https://us06web.zoom.us/j/81234567890?tk=sam_token',
            },
          },
        },
      });

    const res = await POST(req);
    const json = await res.json();

    expect(json.ok).toBe(true);
    expect(db.contact.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        campaignId: 'c_test_zoom',
        email: 'organic@example.com',
        name: 'Sam Altman',
        source: 'Zoom',
      }),
    });
    expect(registerContact).toHaveBeenCalledWith(
      'c_test_zoom',
      'ct_new_zoom',
      'zoom',
      expect.any(Date)
    );
  });

  describe('authentication', () => {
    const regEvent = {
      event: 'webinar.registration_created',
      event_ts: 1,
      payload: { object: { id: '81234567890', registrant: { email: 'a@b.com' } } },
    };

    it('rejects an unsigned request with 401 and touches nothing', async () => {
      const req = new NextRequest('http://localhost:3000/api/webhooks/zoom', { method: 'POST', body: JSON.stringify(regEvent) });
      const res = await POST(req);
      expect(res.status).toBe(401);
      expect(registerContact).not.toHaveBeenCalled();
      expect(db.campaign.findFirst).not.toHaveBeenCalled();
    });

    it('rejects a request signed with the wrong secret', async () => {
      const res = await POST(signed(regEvent, { secret: 'attacker' }));
      expect(res.status).toBe(401);
      expect(registerContact).not.toHaveBeenCalled();
    });

    it('rejects a replayed (stale) request', async () => {
      const res = await POST(signed(regEvent, { timestamp: String(Math.floor(Date.now() / 1000) - 3600) }));
      expect(res.status).toBe(401);
    });

    it('refuses everything — including the CRC challenge — when no secret is configured', async () => {
      vi.mocked(resolveIntegrationField).mockResolvedValueOnce(undefined);
      const res = await POST(signed({ event: 'endpoint.url_validation', payload: { plainToken: 'x' } }));
      expect(res.status).toBe(401);
    });

    it('returns 400 (not 500) for a signed but malformed JSON body', async () => {
      const res = await POST(signed('{not json'));
      expect(res.status).toBe(400);
    });
  });

  describe('deduplication and failure handling', () => {
    const regEvent = {
      event: 'webinar.registration_created',
      event_ts: 42,
      payload: { object: { id: '81234567890', registrant: { id: 'r1', email: 'a@b.com' } } },
    };

    it('acknowledges a duplicate delivery without processing it again', async () => {
      vi.mocked(claimOnce).mockResolvedValueOnce(false);
      const res = await POST(signed(regEvent));
      const json = await res.json();
      expect(json).toEqual({ ok: true, duplicate: true });
      expect(registerContact).not.toHaveBeenCalled();
    });

    it('releases the claim and returns 500 when processing fails, so Zoom redelivers', async () => {
      vi.mocked(db.campaign.findFirst).mockRejectedValueOnce(new Error('db down'));
      const res = await POST(signed(regEvent));
      expect(res.status).toBe(500);
      expect(release).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(await res.json())).not.toContain('db down');
    });
  });

  describe('meeting.ended', () => {
    it('records the end for the linked campaign so attendance is imported promptly', async () => {
      vi.mocked(db.campaign.findFirst).mockResolvedValue({ id: 'c_test_zoom', zoomMeetingId: '81234567890' } as unknown as Campaign);
      const res = await POST(signed({ event: 'meeting.ended', event_ts: 1_800_000_000_000, payload: { object: { id: '81234567890' } } }));
      expect((await res.json()).ended).toBe('c_test_zoom');
      expect(markMeetingEnded).toHaveBeenCalledWith('c_test_zoom', new Date(1_800_000_000_000));
    });

    it('ignores an ended event for a meeting that is not linked to any campaign', async () => {
      vi.mocked(db.campaign.findFirst).mockResolvedValue(null);
      const res = await POST(signed({ event: 'webinar.ended', event_ts: 2, payload: { object: { id: '999' } } }));
      expect((await res.json()).note).toMatch(/No matching campaign/);
      expect(markMeetingEnded).not.toHaveBeenCalled();
    });
  });

  it('ignores unrelated signed events', async () => {
    const res = await POST(signed({ event: 'meeting.participant_joined', event_ts: 3, payload: { object: { id: '1' } } }));
    expect((await res.json()).ignored).toBe('meeting.participant_joined');
  });
});
