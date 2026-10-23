import { beforeEach, it, expect, vi } from 'vitest';
vi.mock('@/lib/workerTick', () => ({ runWorkerTick: vi.fn() }));
import { runWorkerTick } from '@/lib/workerTick';
import { GET } from './route';

const secret = 'isolated-scheduler-secret-with-more-than-32-characters';
const request = (authorization?: string) => new Request('http://localhost/api/cron/cadence', { headers: authorization ? { authorization } : {} });
beforeEach(() => { vi.stubEnv('CRON_SECRET', secret); vi.clearAllMocks(); });

it.each([undefined, 'Bearer wrong', 'Basic abc', `Bearer ${secret}extra`])('rejects unauthorized scheduler calls before any worker side effect (%s)', async authorization => {
  expect((await GET(request(authorization))).status).toBe(401);
  expect(runWorkerTick).not.toHaveBeenCalled();
});
it('fails closed when a persistent scheduler secret is missing or weak', async () => {
  for (const value of ['', 'short']) {
    vi.stubEnv('CRON_SECRET', value);
    expect((await GET(request(`Bearer ${secret}`))).status).toBe(503);
  }
  expect(runWorkerTick).not.toHaveBeenCalled();
});
it('runs the leased worker for an authenticated scheduler', async () => {
  vi.mocked(runWorkerTick).mockResolvedValueOnce({ ok: true, skipped: 'Another worker holds the lease.' });
  const result = await GET(request(`Bearer ${secret}`));
  expect(result.status).toBe(200);
  expect(result.headers.get('cache-control')).toBe('no-store');
  expect(runWorkerTick).toHaveBeenCalledTimes(1);
});
it('reports failures without disclosing database/provider error details', async () => {
  vi.mocked(runWorkerTick).mockRejectedValueOnce(new Error('private database details'));
  const result = await GET(request(`Bearer ${secret}`));
  expect(result.status).toBe(500);
  expect(await result.json()).toEqual({ ok: false, error: 'Worker tick failed.' });
});
