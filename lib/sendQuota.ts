import { db } from '@/lib/db';
import { randomUUID } from 'node:crypto';
export function quotaDay(now: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone || 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export async function reserveSendQuota(campaignId: string, day: string, limit: number, observedSent: number, reservationKey: string = randomUUID()): Promise<boolean> {
  return db.$transaction(async tx => {
    await tx.$executeRaw`INSERT INTO "SendQuotaReservation" ("key", "campaignId", "day", "status") VALUES (${reservationKey}, ${campaignId}, ${day}, 'released') ON CONFLICT DO NOTHING`;
    const rows = await tx.$queryRaw<{ status: string }[]>`SELECT "status" FROM "SendQuotaReservation" WHERE "key" = ${reservationKey} FOR UPDATE`;
    if (rows[0]?.status === 'reserved') return true;
    if (observedSent >= limit) return false;
    const budget = await tx.$queryRaw<{ used: number }[]>`INSERT INTO "DailySendBudget" ("campaignId", "day", "used") VALUES (${campaignId}, ${day}, ${observedSent + 1})
      ON CONFLICT ("campaignId", "day") DO UPDATE SET "used" = GREATEST("DailySendBudget"."used", ${observedSent}) + 1
      WHERE GREATEST("DailySendBudget"."used", ${observedSent}) < ${limit} RETURNING "used"`;
    if (!budget.length) return false;
    await tx.sendQuotaReservation.update({ where: { key: reservationKey }, data: { status: 'reserved', day } });
    return true;
  });
}
export async function releaseSendQuota(campaignId: string, day: string, reservationKey?: string) {
  await db.$transaction(async tx => {
    if (reservationKey) {
      const rows = await tx.$queryRaw<{ day: string; status: string }[]>`SELECT "day", "status" FROM "SendQuotaReservation" WHERE "key" = ${reservationKey} FOR UPDATE`;
      if (rows[0]?.status !== 'reserved') return;
      day = rows[0].day;
      await tx.sendQuotaReservation.update({ where: { key: reservationKey }, data: { status: 'released' } });
    }
    await tx.dailySendBudget.updateMany({ where: { campaignId, day, used: { gt: 0 } }, data: { used: { decrement: 1 } } });
  });
}
