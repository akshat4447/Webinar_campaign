/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: {
    contact: {findMany: vi.fn().mockResolvedValue([])},
    $queryRaw: vi.fn().mockResolvedValue([]),
    campaign: {
      findUniqueOrThrow: vi.fn(),
    },
  },
}));

vi.mock('@/lib/leadsquared', () => ({
  createOrUpdateLead: vi.fn(),
}));

vi.mock('@/lib/channelDelivery', () => ({
  deliverChannelMessage: vi.fn(),
  sandboxTargetPhone: vi.fn(),
}));

vi.mock('@/lib/netcore', () => ({
  sendNetcoreEmail: vi.fn(),
  isEmailSuppressed: vi.fn(),
}));

vi.mock('@/lib/sendGuard', () => ({
  getSendMode: vi.fn(),
  resolveRecipient: vi.fn(),
}));

vi.mock('@/lib/lsqExclusions',()=>({refreshLsqExclusions:vi.fn()}));
import { db } from '@/lib/db';
import { sendNetcoreEmail, isEmailSuppressed } from '@/lib/netcore';
import { deliverChannelMessage } from '@/lib/channelDelivery';
import { resolveRecipient } from '@/lib/sendGuard';
import { sendTestMessageAction } from './testSend';

describe('sendTestMessageAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default every test to live mode with a clean, unsuppressed, passthrough
    // recipient — the specific sandbox/suppression tests below override these.
    (isEmailSuppressed as any).mockResolvedValue(null);
    (resolveRecipient as any).mockImplementation((contact: { email: string }) => ({ email: contact.email, sandboxed: false }));
  });

  it('rejects empty recipient', async () => {
    (db.campaign.findUniqueOrThrow as any).mockResolvedValue({
      name: 'AI in Enterprise',
    });

    const res = await sendTestMessageAction({
      campaignId: 'camp-1',
      channel: 'email',
      recipient: '   ',
      body: 'Hello world',
    });

    expect(res.ok).toBe(false);
    expect(res.error).toContain('Recipient address or phone number is required');
  });

  it('dispatches test email via Netcore Cloud', async () => {
    (db.campaign.findUniqueOrThrow as any).mockResolvedValue({
      name: 'Cloud Scale Webinar',
    });
    (sendNetcoreEmail as any).mockResolvedValue({ ok: true, messageId: 'netcore-msg-123' });

    const res = await sendTestMessageAction({
      campaignId: 'camp-2',
      channel: 'email',
      recipient: 'netcore_test@example.com',
      subject: 'Cloud Scale Invitation',
      body: 'Deep dive into cloud scalability.',
    });

    expect(res.ok).toBe(true);
    expect(res.detail).toContain('via Netcore Cloud to netcore_test@example.com');
    expect(res.detail).toContain('netcore-msg-123');
    expect(sendNetcoreEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'netcore_test@example.com',
        subject: '[TEST PREVIEW] Cloud Scale Invitation',
        tags: ['test_preview'],
      })
    );
  });

  it('fails gracefully if Netcore delivery throws or fails', async () => {
    (db.campaign.findUniqueOrThrow as any).mockResolvedValue({
      name: 'Cloud Scale Webinar',
    });
    (sendNetcoreEmail as any).mockRejectedValue(new Error('Netcore API key is not configured'));

    const res = await sendTestMessageAction({
      campaignId: 'camp-2',
      channel: 'email',
      recipient: 'netcore_test@example.com',
      body: 'Deep dive into cloud scalability.',
    });

    expect(res.ok).toBe(false);
    expect(res.error).toContain('Netcore API key is not configured');
  });

  it('dispatches test SMS to normalized phone number', async () => {
    (db.campaign.findUniqueOrThrow as any).mockResolvedValue({
      name: 'Mobile Marketing 101',
    });
    (deliverChannelMessage as any).mockResolvedValue({ ok: true, detail: 'SMS dispatched' });

    const res = await sendTestMessageAction({
      campaignId: 'camp-3',
      channel: 'sms',
      recipient: '+919876543210',
      body: 'SMS test message',
    });

    expect(res.ok).toBe(true);
    expect(res.detail).toContain('Test SMS sent to +919876543210');
    expect(deliverChannelMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'sms',
        phone: '+919876543210',
      })
    );
  });

  // Regression tests: a "test send" is still a real message through a real
  // provider — it must not become a way to reach an arbitrary real address
  // while the app's global SEND_MODE is sandbox, or bypass the suppression
  // list the same way every other send path is required to check.
  describe('safety gates', () => {
    it('dispatches a preview to the explicitly entered email',async()=>{(db.campaign.findUniqueOrThrow as any).mockResolvedValue({name:'Webinar'});(sendNetcoreEmail as any).mockResolvedValue({ok:true,messageId:'m1'});const res=await sendTestMessageAction({campaignId:'camp-1',channel:'email',recipient:'chosen@example.com',body:'Join our webinar.'});expect(res.ok).toBe(true);expect(sendNetcoreEmail).toHaveBeenCalledWith(expect.objectContaining({to:'chosen@example.com'}));});

    it('refuses a test email to a suppressed address', async () => {
      (db.campaign.findUniqueOrThrow as any).mockResolvedValue({
        name: 'AI in Enterprise',
        });
      (isEmailSuppressed as any).mockResolvedValue({ reason: 'bounce', detail: 'Hard bounce' });

      const res = await sendTestMessageAction({
        campaignId: 'camp-1',
        channel: 'email',
        recipient: 'bounced@example.com',
        body: 'Join us for this webinar.',
      });

      expect(res.ok).toBe(false);
      expect(res.error).toContain('suppression list');
      });

    it('dispatches a preview to the explicitly entered phone',async()=>{(db.campaign.findUniqueOrThrow as any).mockResolvedValue({name:'Webinar'});(deliverChannelMessage as any).mockResolvedValue({strategyUsed:'direct',detail:'accepted'});const res=await sendTestMessageAction({campaignId:'camp-1',channel:'sms',recipient:'+919876543210',body:'Join our webinar.'});expect(res.ok).toBe(true);expect(deliverChannelMessage).toHaveBeenCalledWith(expect.objectContaining({phone:'+919876543210'}));});
  });
});
