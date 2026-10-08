/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: {
    emailSuppression: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
    },
    appSetting: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

vi.mock('@/lib/integrationConfig', () => ({
  resolveIntegrationField: vi.fn(),
  saveIntegrationConfig: vi.fn(),
}));


import { db } from '@/lib/db';
import { resolveIntegrationField } from '@/lib/integrationConfig';
import {
  sendNetcoreEmail,
  isEmailSuppressed,
  addEmailToSuppression,
  removeEmailFromSuppression,
  getSuppressionList,
  testNetcoreConnection,
} from './netcore';

describe('Netcore Cloud Email Engine (lib/netcore.test.ts)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.NETCORE_API_KEY;
    process.env.NETCORE_FROM_EMAIL = 'events@updates.acme.com';
    vi.mocked(resolveIntegrationField).mockImplementation(async (_id,key) => key==='fromEmail'?'events@updates.acme.com':undefined);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('isEmailSuppressed, addEmailToSuppression, removeEmailFromSuppression', () => {
    it('returns null when email is not suppressed', async () => {
      vi.mocked(db.emailSuppression.findUnique).mockResolvedValueOnce(null as any);
      const res = await isEmailSuppressed('alice@example.com');
      expect(res).toBeNull();
      expect(db.emailSuppression.findUnique).toHaveBeenCalledWith({
        where: { email: 'alice@example.com' },
      });
    });

    it('returns suppression record when email is suppressed (case-insensitive)', async () => {
      const mockRecord = {
        id: 'supp_1',
        email: 'bob@example.com',
        reason: 'bounce',
        provider: 'netcore',
        detail: '550 5.1.1 User unknown',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      vi.mocked(db.emailSuppression.findUnique).mockResolvedValueOnce(mockRecord as any);
      const res = await isEmailSuppressed('BOB@EXAMPLE.COM');
      expect(res).toEqual(mockRecord);
      expect(db.emailSuppression.findUnique).toHaveBeenCalledWith({
        where: { email: 'bob@example.com' },
      });
    });

    it('adds email to suppression list via upsert', async () => {
      const mockUpserted = {
        id: 'supp_2',
        email: 'charlie@example.com',
        reason: 'unsubscribe',
        provider: 'manual',
        detail: 'Opted out by request',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      vi.mocked(db.emailSuppression.upsert).mockResolvedValueOnce(mockUpserted as any);
      const res = await addEmailToSuppression('charlie@example.com', 'unsubscribe', 'Opted out by request', 'manual');
      expect(res).toEqual(mockUpserted);
      expect(db.emailSuppression.upsert).toHaveBeenCalledWith({
        where: { email: 'charlie@example.com' },
        update: { reason: 'unsubscribe', detail: 'Opted out by request', provider: 'manual' },
        create: { email: 'charlie@example.com', reason: 'unsubscribe', detail: 'Opted out by request', provider: 'manual' },
      });
    });

    it('removes email from suppression list', async () => {
      vi.mocked(db.emailSuppression.delete).mockResolvedValueOnce({} as any);
      const res = await removeEmailFromSuppression('charlie@example.com');
      expect(res).toBe(true);
      expect(db.emailSuppression.delete).toHaveBeenCalledWith({
        where: { email: 'charlie@example.com' },
      });
    });

    it('returns false when removing non-existent email', async () => {
      vi.mocked(db.emailSuppression.delete).mockRejectedValueOnce(new Error('Record to delete does not exist'));
      const res = await removeEmailFromSuppression('nonexistent@example.com');
      expect(res).toBe(false);
    });

    it('getSuppressionList returns items, total, and counts', async () => {
      const items = [
        { id: '1', email: 'a@test.com', reason: 'bounce', provider: 'netcore', detail: null, createdAt: new Date(), updatedAt: new Date() },
      ];
      vi.mocked(db.emailSuppression.findMany).mockResolvedValueOnce(items as any);
      vi.mocked(db.emailSuppression.count).mockResolvedValueOnce(1);
      vi.mocked(db.emailSuppression.groupBy).mockResolvedValueOnce([
        { reason: 'bounce', _count: 1 } as any,
      ]);

      const res = await getSuppressionList({ page: 0, pageSize: 10 });
      expect(res.total).toBe(1);
      expect(res.items).toEqual(items);
      expect(res.counts.bounce).toBe(1);
      expect(res.counts.all).toBe(1);
    });

    it('scopes the per-reason counts to the active search term, not the whole table', async () => {
      // Regression test: groupBy previously ran with no `where` at all, so
      // typing a search narrowed "total"/items but left every reason pill
      // showing the unfiltered global count — internally inconsistent with
      // the "All (N)" figure shown right next to them.
      vi.mocked(db.emailSuppression.findMany).mockResolvedValueOnce([] as any);
      vi.mocked(db.emailSuppression.count).mockResolvedValueOnce(2);
      vi.mocked(db.emailSuppression.groupBy).mockResolvedValueOnce([
        { reason: 'bounce', _count: 2 } as any,
      ]);

      await getSuppressionList({ search: 'acme.com', page: 1, pageSize: 10 });

      expect(db.emailSuppression.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { email: { contains: 'acme.com', mode: 'insensitive' } },
        })
      );
    });
  });

  describe('sendNetcoreEmail', () => {
    it('throws error if recipient email is suppressed', async () => {
      vi.mocked(db.emailSuppression.findUnique).mockResolvedValueOnce({
        id: 'supp_1',
        email: 'blocked@test.com',
        reason: 'spam',
        provider: 'netcore',
        detail: 'Spam complaint registered',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      await expect(
        sendNetcoreEmail({
          to: 'blocked@test.com',
          subject: 'Hello',
          html: '<p>Test</p>',
        })
      ).rejects.toThrow(/suppression list \(spam\)/);
    });

    it('refuses mock credentials instead of simulating successful delivery',async()=>{vi.mocked(resolveIntegrationField).mockResolvedValue('mock_123');await expect(sendNetcoreEmail({to:'person@example.com',subject:'Invite',html:'Hi'})).rejects.toThrow('Netcore API key is not configured.');});

    it('throws rather than silently faking success when no API key is configured in live mode', async () => {
      // Regression test: this used to return {ok: true, simulated: true} even
      // in live mode, so a campaign with Netcore selected but never
      // configured looked like every send succeeded while none were ever
      // actually sent. Live mode must fail loudly instead, matching
      // lib/leadsquared.ts's convention for missing credentials.
      vi.mocked(resolveIntegrationField).mockResolvedValue(undefined);
      vi.mocked(db.emailSuppression.findUnique).mockResolvedValueOnce(null as any);

      await expect(
        sendNetcoreEmail({
          to: 'realprospect@target.com',
          subject: 'Webinar Invite',
          html: '<p>Join our session</p>',
        })
      ).rejects.toThrow(/Netcore API key is not configured/);
    });

    it('requires a real API key without any sandbox allowlist',async()=>{vi.mocked(resolveIntegrationField).mockResolvedValue(undefined);delete process.env.NETCORE_API_KEY;await expect(sendNetcoreEmail({to:'person@example.com',subject:'Invite',html:'Hi'})).rejects.toThrow('Netcore API key is not configured.');});

    it('makes live POST request to Netcore API when configured and live mode', async () => {
      vi.mocked(resolveIntegrationField).mockImplementation(async (_ig, key) => {
        if (key === 'apiKey') return 'live_test_api_key_12345';
        if (key === 'fromEmail') return 'events@updates.acme.com';
        if (key === 'fromName') return 'Webinar Events';
        return undefined;
      });
      vi.mocked(db.emailSuppression.findUnique).mockResolvedValueOnce(null as any);

      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          status: 'success',
          message: 'Email queued successfully',
          data: { message_id: 'nc_msg_98765' },
        }),
      });
      global.fetch = mockFetch;

      const res = await sendNetcoreEmail({
        to: 'realprospect@target.com',
        toName: 'Real Prospect',
        subject: 'Webinar Invite',
        html: '<p>Join our session</p>',
        text: 'Join our session',
        tags: ['campaign_c1', 'invite'],
      });

      expect(res.ok).toBe(true);
      expect(res.messageId).toBe('nc_msg_98765');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://emailapi.netcorecloud.net/v5/mail/send',
        expect.objectContaining({
          method: 'POST',
          headers: {
            api_key: 'live_test_api_key_12345',
            'Content-Type': 'application/json',
          },
        })
      );

      const sentBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(sentBody.content).toEqual([
        {
          type: 'html',
          value: '<p>Join our session</p>',
        },
      ]);
      // Verify Netcore v5 strictly rejects 'text' type in content array
      expect(sentBody.content.find((c: any) => c.type === 'text')).toBeUndefined();
    });

    it('falls back to formatted HTML when only plaintext is provided', async () => {
      vi.mocked(resolveIntegrationField).mockImplementation(async (_ig, key) => {
        if (key === 'apiKey') return 'live_test_api_key_12345';
        return undefined;
      });
      vi.mocked(db.emailSuppression.findUnique).mockResolvedValueOnce(null as any);

      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          status: 'success',
          data: { message_id: 'nc_msg_text_only' },
        }),
      });
      global.fetch = mockFetch;

      const res = await sendNetcoreEmail({
        to: 'plaintext@target.com',
        subject: 'Plaintext Fallback',
        html: '',
        text: 'Line 1\nLine 2',
      });

      expect(res.ok).toBe(true);
      const sentBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(sentBody.content).toHaveLength(1);
      expect(sentBody.content[0].type).toBe('html');
      expect(sentBody.content[0].value).toContain('Line 1<br/>Line 2');
      expect(sentBody.content.find((c: any) => c.type === 'text')).toBeUndefined();
    });

    it('handles Netcore API error array response cleanly', async () => {
      vi.mocked(resolveIntegrationField).mockImplementation(async (_ig, key) => {
        if (key === 'apiKey') return 'live_test_api_key_12345';
        return undefined;
      });
      vi.mocked(db.emailSuppression.findUnique).mockResolvedValueOnce(null as any);

      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => JSON.stringify([
          {
            message: 'invalid content type',
            field: 'content{type}',
            description: 'The content type should be either html or amp-content',
          },
        ]),
      });
      global.fetch = mockFetch;

      await expect(
        sendNetcoreEmail({
          to: 'realprospect@target.com',
          subject: 'Webinar Invite',
          html: '<p>Join our session</p>',
        })
      ).rejects.toThrow(/\[content\{type\}\] The content type should be either html or amp-content/);
    });

    it('handles Netcore API error response with descriptive message', async () => {
      vi.mocked(resolveIntegrationField).mockImplementation(async (_ig, key) => {
        if (key === 'apiKey') return 'live_test_api_key_12345';
        return undefined;
      });
      vi.mocked(db.emailSuppression.findUnique).mockResolvedValueOnce(null as any);

      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => JSON.stringify({
          error: { message: 'Invalid sender domain or SPF/DKIM missing' },
        }),
      });
      global.fetch = mockFetch;

      await expect(
        sendNetcoreEmail({
          to: 'realprospect@target.com',
          subject: 'Webinar Invite',
          html: '<p>Join our session</p>',
        })
      ).rejects.toThrow(/Invalid sender domain/);
    });
  });

  describe('testNetcoreConnection', () => {
    it('fails when API key is missing', async () => {
      vi.mocked(resolveIntegrationField).mockResolvedValue(undefined);
      const res = await testNetcoreConnection({});
      expect(res.ok).toBe(false);
      expect(res.detail).toContain('API Key is required');
    });

    it('rejects fake keys instead of reporting a simulated connection', async () => {
  global.fetch = vi.fn().mockRejectedValue(new Error('Invalid API key'));
  const res = await testNetcoreConnection({ apiKey: 'mock_test_key', fromEmail: 'events@acme.com' });
  expect(res.ok).toBe(false);
  expect(res.detail).not.toContain('Simulated');
});

    it('makes live validation call for live keys', async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ status: 'success' }),
        json: async () => ({ status: 'success', dkim: { valid: true } }),
      });
      global.fetch = mockFetch;

      const res = await testNetcoreConnection({
        apiKey: 'nc_real_api_key_abcdef',
        fromEmail: 'hello@updates.acme.com',
      });
      expect(res.ok).toBe(true);
      expect(res.detail).toContain('Connected to Netcore Cloud · Sender: hello@updates.acme.com');
    });

    it('auto-discovers verified domain and sets fromEmail when omitted', async () => {
      delete process.env.NETCORE_FROM_EMAIL;
      vi.mocked(resolveIntegrationField).mockResolvedValue(undefined);
      const mockFetch = vi.fn()
        // 1. fetchNetcoreVerifiedDomains calls /v6/domains
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ status: 'success', data: [{ domain: 'campaigns.acme.com', status: 'verified' }] }),
        })
        // 2. testNetcoreConnection verifies domain
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ status: 'success' }),
          json: async () => ({ status: 'success', dkim: { valid: true } }),
        });
      global.fetch = mockFetch;

      const res = await testNetcoreConnection({
        apiKey: 'nc_real_api_key_abcdef',
      });
      expect(res.ok).toBe(true);
      expect(res.autoDiscovered?.domain).toBe('campaigns.acme.com');
      expect(res.autoDiscovered?.fromEmail).toBe('events@campaigns.acme.com');
      expect(res.detail).toContain('events@campaigns.acme.com');
    });
  });
});
