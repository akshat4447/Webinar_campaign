import { db } from '@/lib/db';
import { idemKey } from '@/lib/idempotency';
export class DeliveryUnknownError extends Error {
  constructor(message: string) { super(message); this.name = 'DeliveryUnknownError'; }
}
export class DeliveryRejectedError extends Error {
  constructor(message: string, readonly status?: number) { super(message); this.name = 'DeliveryRejectedError'; }
}
export type DeliveryOutcome<T> = { duplicate: true; value?: T } | { duplicate: false; value: T };
/** A claim is not delivery proof. Only a proved rejection permits automatic replay. */
export async function deliverOnce<T>(sendId: string, kind: string, deliver: () => Promise<T>, metadata?: { campaignId?: string; payload?: unknown }): Promise<DeliveryOutcome<T>> {
  const key = idemKey('delivery', sendId, kind);
  try {
    await db.deliveryAttempt.create({ data: { key, sendId, provider: kind, campaignId: metadata?.campaignId, payloadJson: metadata?.payload === undefined ? undefined : JSON.stringify(metadata.payload) } });
  } catch (error) {
    if ((error as { code?: string }).code !== 'P2002') throw error;
    const existing = await db.deliveryAttempt.findUniqueOrThrow({ where: { key } });
    if (existing.status === 'accepted') return { duplicate: true, value: existing.receiptJson ? JSON.parse(existing.receiptJson) as T : undefined };
    if (existing.status !== 'failed') {
      if (existing.status === 'dispatching' && existing.startedAt < new Date(Date.now() - 120_000)) await db.deliveryAttempt.updateMany({where:{key,status:'dispatching'},data:{status:'unknown',error:'Worker stopped before recording a provider outcome.'}});
      throw new DeliveryUnknownError('An earlier attempt has no confirmed outcome. Check the provider before retrying.');
    }
    const claimed = await db.deliveryAttempt.updateMany({ where: { key, status: 'failed' }, data: { status: 'dispatching', startedAt: new Date(), finishedAt: null, error: null } });
    if (!claimed.count) throw new DeliveryUnknownError('Another worker is dispatching this message.');
  }
  try {
    const value = await deliver();
    await db.deliveryAttempt.update({ where: { key }, data: { status: 'accepted', finishedAt: new Date(), receiptJson: JSON.stringify(value ?? null), error: null } });
    return { duplicate: false, value };
  } catch (error) {
    const status = (error as { status?: number }).status;
    const rejected = (error instanceof DeliveryRejectedError && (status === undefined || status < 500)) || (typeof status === 'number' && status >= 400 && status < 500);
    const message = error instanceof Error ? error.message : String(error);
    await db.deliveryAttempt.update({ where: { key }, data: { status: rejected ? 'failed' : 'unknown', finishedAt: new Date(), error: message.slice(0, 600) } }).catch(() => undefined);
    if (!rejected) throw new DeliveryUnknownError(`Provider outcome is uncertain: ${message}`);
    throw error;
  }
}
