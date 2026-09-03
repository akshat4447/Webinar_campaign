'use server';

// Channel mix — bulk enable/disable of every step belonging to a channel, so
// "send via all channels" (or dropping one) is a single decision instead of
// toggling steps one by one.
import { db } from '@/lib/db';
import { revalidateCampaign } from '@/lib/revalidate';
import { normalizeChannel } from '@/lib/channels';

export type MixChannel = 'email' | 'linkedin' | 'sms' | 'whatsapp';

export async function getChannelMixAction(campaignId: string): Promise<Record<MixChannel, { enabled: number; total: number }>> {
  const steps = await db.cadenceStep.findMany({ where: { campaignId, removedAt: null }, select: { channel: true, enabled: true } });
  const mix: Record<MixChannel, { enabled: number; total: number }> = {
    email: { enabled: 0, total: 0 },
    linkedin: { enabled: 0, total: 0 },
    sms: { enabled: 0, total: 0 },
    whatsapp: { enabled: 0, total: 0 },
  };
  for (const s of steps) {
    const ch = normalizeChannel(s.channel);
    if (!mix[ch]) continue;
    mix[ch].total++;
    if (s.enabled) mix[ch].enabled++;
  }
  return mix;
}

export async function setChannelEnabledAction(campaignId: string, channel: MixChannel, enabled: boolean): Promise<{ ok: boolean; updated?: number; parked?: number }> {
  const steps = await db.cadenceStep.findMany({ where: { campaignId, removedAt: null }, select: { id: true, key: true, channel: true } });
  const ids: string[] = [];
  const keys: string[] = [];
  for (const s of steps) {
    if (normalizeChannel(s.channel) === channel) {
      ids.push(s.id);
      keys.push(s.key);
    }
  }
  const result = await db.cadenceStep.updateMany({ where: { id: { in: ids } }, data: { enabled } });
  // Switching a channel off mid-flight parks its queued-but-unsent rows so the
  // tick can't send them after the operator said stop.
  let parked = 0;
  if (!enabled && keys.length > 0) {
    const res = await db.cadenceSend.updateMany({
      where: { campaignId, status: 'queued', stepKey: { in: keys } },
      data: { status: 'skipped', error: `${channel.toUpperCase()} channel was disabled` },
    });
    parked = res.count;
  }
  await db.activityLogEntry.create({
    data: {
      campaignId,
      text: `${channel.toUpperCase()} channel ${enabled ? 'enabled' : 'disabled'} — ${result.count} step(s) updated${parked ? `, ${parked} queued send(s) parked` : ''}`,
      dot: enabled ? 'var(--success-500)' : 'var(--warning-700)',
    },
  });
  revalidateCampaign(campaignId);
  return { ok: true, updated: result.count, parked };
}