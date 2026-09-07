import { describe, it, expect, vi } from 'vitest';

const appSettingsStore = new Map<string, string>();

vi.mock('@/lib/db', () => ({
  db: {
    appSetting: {
      findUnique: vi.fn(async ({ where }: { where: { key: string } }) => {
        const val = appSettingsStore.get(where.key);
        return val !== undefined ? { key: where.key, value: val } : null;
      }),
      upsert: vi.fn(async ({ where, create, update }: { where: { key: string }; create: { key: string; value: string }; update: { value: string } }) => {
        const val = update?.value ?? create?.value;
        appSettingsStore.set(where.key, val);
        return { key: where.key, value: val };
      }),
    },
  },
}));

import { getChannelDeliveryMode, setChannelDeliveryMode, executeDirectSend } from './channelDelivery';

describe('Channel Delivery Two-Mode System', () => {
  it('defaults to trigger mode when unset', async () => {
    const mode = await getChannelDeliveryMode('sms');
    expect(['trigger', 'direct']).toContain(mode);
  });

  it('sets and gets delivery mode cleanly', async () => {
    await setChannelDeliveryMode('sms', 'trigger');
    expect(await getChannelDeliveryMode('sms')).toBe('trigger');

    await setChannelDeliveryMode('sms', 'direct');
    expect(await getChannelDeliveryMode('sms')).toBe('direct');

    // Reset to trigger (primary)
    await setChannelDeliveryMode('sms', 'trigger');
    expect(await getChannelDeliveryMode('sms')).toBe('trigger');
  });

  it('rejects executeDirectSend if endpoint is not an HTTP URL', async () => {
    await expect(
      executeDirectSend({
        channel: 'sms',
        endpoint: 'invalid-url',
        phone: '+919123443870',
        message: 'Hello test',
      })
    ).rejects.toThrow(/must be a valid HTTP\/HTTPS URL/);
  });

  it('rejects executeDirectSend if endpoint is empty', async () => {
    await expect(
      executeDirectSend({
        channel: 'whatsapp',
        endpoint: '',
        phone: '+919123443870',
        message: 'Hello test',
      })
    ).rejects.toThrow(/must be a valid HTTP\/HTTPS URL/);
  });

  it('sanitizes curly quotes and em-dashes into standard GSM-7 characters for SMS', async () => {
    const { sanitizeGsm7 } = await import('./channelDelivery');
    const input = '“Don’t miss this webinar — it’s live…”';
    const output = sanitizeGsm7(input);
    expect(output).toBe('"Don\'t miss this webinar - it\'s live..."');
  });
});
