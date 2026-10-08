import { describe, it, expect, vi, beforeEach } from 'vitest';
const ledger = vi.hoisted(() => new Map<string, Record<string, unknown>>());
vi.mock('@/lib/db', () => ({ db: { deliveryAttempt: {
  create: vi.fn(async ({ data }) => { if (ledger.has(data.key)) throw Object.assign(new Error('Duplicate'), { code: 'P2002' }); const row = { status: 'dispatching', ...data }; ledger.set(data.key, row); return row; }),
  findUniqueOrThrow: vi.fn(async ({ where }) => ledger.get(where.key)),
  update: vi.fn(async ({ where, data }) => { Object.assign(ledger.get(where.key)!, data); return ledger.get(where.key); }),
  updateMany: vi.fn(async ({ where, data }) => { const row = ledger.get(where.key); if (row?.status !== where.status) return { count: 0 }; Object.assign(row!, data); return { count: 1 }; }),
} } }));
import { db } from '@/lib/db';
import { deliverOnce, DeliveryRejectedError, DeliveryUnknownError } from './deliveryGuard';
beforeEach(() => { ledger.clear(); vi.clearAllMocks(); });
describe('Delivery outcomes', () => {
  it('persists the receipt and replays accepted results without dispatching again', async () => {
    const send = vi.fn(async () => ({ messageId: 'provider-id' }));
    expect(await deliverOnce('1', 'email', send)).toEqual({ duplicate: false, value: { messageId: 'provider-id' } });
    expect(await deliverOnce('1', 'email', send)).toEqual({ duplicate: true, value: { messageId: 'provider-id' } });
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('holds a timeout as unknown and refuses automatic retry', async () => {
    const send = vi.fn().mockRejectedValue(new Error('Connection dropped after submission'));
    await expect(deliverOnce('1','email',send)).rejects.toBeInstanceOf(DeliveryUnknownError);
    await expect(deliverOnce('1','email',send)).rejects.toBeInstanceOf(DeliveryUnknownError);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('allows retry after a proved rejection', async () => {
    const send = vi.fn().mockRejectedValueOnce(new DeliveryRejectedError('Invalid sender', 400)).mockResolvedValueOnce('accepted');
    await expect(deliverOnce('1','email',send)).rejects.toThrow('Invalid sender');
    expect(await deliverOnce('1','email',send)).toEqual({ duplicate: false, value: 'accepted' });
  });
  it('treats HTTP 503 as uncertain', async () => {
    await expect(deliverOnce('1','email',async () => { throw new DeliveryRejectedError('503', 503); })).rejects.toBeInstanceOf(DeliveryUnknownError);
  });
  it('fails closed when the ledger is unavailable', async () => {
    vi.mocked(db.deliveryAttempt.create).mockRejectedValueOnce(new Error('Database down'));
    const send = vi.fn(); await expect(deliverOnce('1','email',send)).rejects.toThrow('Database down'); expect(send).not.toHaveBeenCalled();
  });
  it('only dispatches once during simultaneous calls', async () => {
    const send = vi.fn(async () => 'ok');
    const results = await Promise.allSettled(Array.from({length:6}, () => deliverOnce('1','email',send)));
    expect(results.some(r => r.status === 'fulfilled')).toBe(true); expect(send).toHaveBeenCalledTimes(1);
  });
  it('records payload snapshots separately for each send and channel', async () => {
    const send = vi.fn(async () => 'ok');
    await deliverOnce('1','email',send,{campaignId:'c',payload:{recipient:'one@example.com',body:'Original'}});
    await deliverOnce('2','email',send); await deliverOnce('1','sms',send);
    expect(ledger.size).toBe(3); expect([...ledger.values()][0].payloadJson).toContain('Original');
  });
});
