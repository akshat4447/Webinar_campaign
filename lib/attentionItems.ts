import { db } from '@/lib/db';

// Upsert-by-title so repeated failures of the same underlying thing (a retry
// against a still-broken send, a still-misconfigured LSQ list, etc.) update
// one card instead of piling up a new one on every attempt.
export async function upsertAttentionItem(
  campaignId: string,
  item: { icon: string; color: string; title: string; detail: string; actionsCsv: string }
) {
  const existing = await db.attentionItem.findFirst({ where: { campaignId, title: item.title, resolvedAt: null } });
  if (existing) {
    await db.attentionItem.update({ where: { id: existing.id }, data: { detail: item.detail, createdAt: new Date() } });
  } else {
    await db.attentionItem.create({ data: { campaignId, ...item } });
  }
}
