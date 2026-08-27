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

// The other half of upsertAttentionItem, which was missing: retract a card once
// the thing it warns about has actually succeeded. Without this, only the manual
// Dismiss in Control Center ever cleared a card, so a fixed problem kept warning
// indefinitely — a card would still be demanding "add a Phone in LeadSquared"
// after the phone was added and the send had gone out.
//
// Matched by exact title, the same key upsertAttentionItem dedupes on, so a
// success retracts precisely the card its own failure would have raised.
export async function resolveAttentionItems(campaignId: string, titles: string[]) {
  if (titles.length === 0) return;
  await db.attentionItem.updateMany({
    where: { campaignId, title: { in: titles }, resolvedAt: null },
    data: { resolvedAt: new Date() },
  });
}
