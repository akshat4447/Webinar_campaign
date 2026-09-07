import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: {
    campaign: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock('@/lib/cadence', () => ({
  processDueSends: vi.fn(),
}));

import { db } from '@/lib/db';
import { processDueSends } from '@/lib/cadence';
import { GET } from './route';

describe('/api/cron/cadence', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  it('rejects unauthorized requests when CRON_SECRET is set', async () => {
    process.env.CRON_SECRET = 'secret123';
    const req = new Request('http://localhost/api/cron/cadence', {
      headers: { authorization: 'Bearer wrong-secret' },
    });
    const res = await GET(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('Unauthorized');
  });

  it('allows authorized requests and processes running campaigns', async () => {
    process.env.CRON_SECRET = 'secret123';
    vi.mocked(db.campaign.findMany).mockResolvedValue([
      { id: 'c1', name: 'Webinar 1' },
      { id: 'c2', name: 'Webinar 2' },
    ] as unknown as Awaited<ReturnType<typeof db.campaign.findMany>>);

    vi.mocked(processDueSends).mockResolvedValueOnce({
      processed: 5,
      sent: 4,
      failed: 1,
      remaining: 0,
      dailyLimitReached: false,
      outsideSendWindow: false,
    });
    vi.mocked(processDueSends).mockResolvedValueOnce({
      processed: 2,
      sent: 2,
      failed: 0,
      remaining: 0,
      dailyLimitReached: false,
      outsideSendWindow: false,
    });

    const req = new Request('http://localhost/api/cron/cadence', {
      headers: { authorization: 'Bearer secret123' },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.checkedCampaigns).toBe(2);
    expect(json.processed).toBe(7);
    expect(json.sent).toBe(6);
    expect(json.failed).toBe(1);
    expect(db.campaign.findMany).toHaveBeenCalledWith({
      where: { cadenceStatus: 'running' },
      select: { id: true, name: true },
    });
  });
});
