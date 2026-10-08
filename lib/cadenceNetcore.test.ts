/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: {
    campaign: {
      findUniqueOrThrow: vi.fn(),
    },
    cadenceStep: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    cadenceSend: {
      count: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    personalizedMessage: {
      findUnique: vi.fn(),
    },
    speaker: {
      findMany: vi.fn(),
    },
    activityLogEntry: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/sendWindow', () => ({
  isWithinSendWindow: vi.fn().mockReturnValue(true),
}));

vi.mock('@/lib/messageTemplates', () => ({
  resolveStepTemplate: vi.fn(),
}));

vi.mock('@/lib/sendGuard', () => ({
  getSendMode: vi.fn().mockResolvedValue('live'),
  resolveRecipient: vi.fn((contact) => ({ email: contact.email, sandboxed: false })),
}));

vi.mock('@/lib/attentionItems', () => ({
  upsertAttentionItem: vi.fn(),
  resolveAttentionItems: vi.fn(),
}));

vi.mock('@/lib/channelDelivery', () => ({
  postSentActivityIfMapped: vi.fn(),
  deliverChannelMessage: vi.fn(),
}));

vi.mock('@/lib/netcore', () => ({
  sendNetcoreEmail: vi.fn(),
  isEmailSuppressed: vi.fn(),
}));

vi.mock('@/lib/leadsquared', () => ({
  createOrUpdateLead: vi.fn(),
  sendEmailToLead: vi.fn(),
  LeadSquaredError: class LeadSquaredError extends Error {},
}));

import { db } from '@/lib/db';
import { resolveStepTemplate } from '@/lib/messageTemplates';
import { sendNetcoreEmail, isEmailSuppressed } from '@/lib/netcore';
import { postSentActivityIfMapped } from '@/lib/channelDelivery';
import { sendEmailToLead } from '@/lib/leadsquared';
import { processDueSends } from './cadence';

describe('Cadence Engine Dual Gateway & Netcore Routing (lib/cadence.ts)', () => {
  const mockCampaign = {
    id: 'campaign_c1',
    name: 'AI Banking Webinar',
    date: 'Sep 25, 2026',
    emailProvider: 'netcore',
    cadenceStatus: 'running',
    dailyLimit: 100,
    scheduleWindow: '09:00-18:00',
    simulatedNow: new Date('2026-09-20T10:00:00Z'),
    oneClickSignup: true,
    registrationLink: null,
    zoomLink: 'https://zoom.us/j/12345',
    speakers: [],
  };

  const mockContact = {
    id: 'contact_1',
    name: 'Priya Nair',
    email: 'priya@example.com',
    account: 'Acme Bank',
    phone: null,
    registeredAt: null,
    unsubscribedAt: null,
    lsqLeadId: 'lsq_lead_123',
  };

  const mockSend = {
    id: 'send_1',
    campaignId: 'campaign_c1',
    stepKey: 'invite',
    status: 'queued',
    dueAt: new Date('2026-09-20T09:00:00Z'),
    contact: mockContact,
  };

  const mockTemplate = {
    id: 'tpl_1',
    key: 'invite',
    label: 'Initial Invite',
    channel: 'email',
    subject: "You're invited: {{topic}}",
    body: 'Hi {{firstName}}, join us for {{topic}} on {{date}}. Link: {{link}}',
    hidden: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.campaign.findUniqueOrThrow).mockResolvedValue(mockCampaign as any);
    vi.mocked(resolveStepTemplate).mockResolvedValue(mockTemplate as any);
    vi.mocked(db.cadenceStep.findUnique).mockResolvedValue({ enabled: true, removedAt: null, group: 'Pre-registration' } as any);
    vi.mocked(db.personalizedMessage.findUnique).mockResolvedValue(null as any);
    vi.mocked(db.speaker.findMany).mockResolvedValue([] as any);
    vi.mocked(db.cadenceSend.count).mockResolvedValue(0);
    vi.mocked(db.cadenceSend.update).mockResolvedValue({} as any);
    vi.mocked(db.activityLogEntry.create).mockResolvedValue({} as any);

    // Setup transaction to return mockSend on first iteration, then empty to exit loop
    let claimed = false;
    vi.mocked(db.$transaction).mockImplementation(async (cb: any) => {
      const candidates = claimed ? [] : [{ id: 'send_1' }];
      claimed = true;
      return cb({
        cadenceSend: {
          findMany: vi.fn().mockResolvedValue(candidates),
          updateMany: vi.fn().mockResolvedValue({ count: candidates.length }),
        },
      });
    });

    vi.mocked(db.cadenceSend.findMany).mockResolvedValue([mockSend] as any);
    vi.mocked(db.cadenceSend.findUnique).mockImplementation(((async ({ where }: any) => {
      if (where.id === mockSend.id) {
        return { ...mockSend, status: 'processing' } as any;
      }
      return null;
    }) as any));

    addReliabilityMocks(reliabilityDb);
});

  it('routes email dispatch through sendNetcoreEmail when campaign.emailProvider is netcore', async () => {
    vi.mocked(isEmailSuppressed).mockResolvedValueOnce(null);
    vi.mocked(sendNetcoreEmail).mockResolvedValueOnce({
      ok: true,
      messageId: 'nc_msg_001',
    });

    const res = await processDueSends('campaign_c1');
    expect(res.sent).toBe(1);
    expect(res.failed).toBe(0);

    expect(sendNetcoreEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'priya@example.com',
        toName: 'Priya Nair',
        subject: expect.stringContaining('AI Banking Webinar'),
        tags: ['campaign_c1', 'invite'],
      })
    );
    expect(sendEmailToLead).not.toHaveBeenCalled();

    // Dual-logging to LeadSquared
    expect(postSentActivityIfMapped).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'email',
        lsqLeadId: 'lsq_lead_123',
        campaignName: 'AI Banking Webinar',
        stepKey: 'invite',
        note: expect.stringContaining('delivered via Netcore Cloud'),
      })
    );
  });

  it('skips send when recipient email is in EmailSuppression list', async () => {
    vi.mocked(isEmailSuppressed).mockResolvedValueOnce({
      id: 'supp_1',
      email: 'priya@example.com',
      reason: 'bounce',
      provider: 'netcore',
      detail: '550 5.1.1 User unknown',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await processDueSends('campaign_c1');
    expect(res.sent).toBe(0);
    expect(res.failed).toBe(0);
    expect(sendNetcoreEmail).not.toHaveBeenCalled();
    expect(sendEmailToLead).not.toHaveBeenCalled();

    expect(db.cadenceSend.update).toHaveBeenCalledWith({
      where: { id: 'send_1' },
      data: expect.objectContaining({
        status: 'skipped',
        error: expect.stringContaining('Email suppressed (bounce)'),
      }),
    });
  });

  it('skips send when contact has unsubscribedAt timestamp', async () => {
    vi.mocked(isEmailSuppressed).mockResolvedValueOnce(null);
    const unsubscribedContact = { ...mockContact, unsubscribedAt: new Date('2026-09-18T10:00:00Z') };
    const unsubSend = { ...mockSend, contact: unsubscribedContact, status: 'processing' };
    vi.mocked(db.cadenceSend.findMany).mockResolvedValue([unsubSend] as any);
    vi.mocked(db.cadenceSend.findUnique).mockResolvedValue(unsubSend as any);

    const res = await processDueSends('campaign_c1');
    expect(res.sent).toBe(0);
    expect(sendNetcoreEmail).not.toHaveBeenCalled();

    expect(db.cadenceSend.update).toHaveBeenCalledWith({
      where: { id: 'send_1' },
      data: expect.objectContaining({
        status: 'skipped',
        error: expect.stringContaining('Contact unsubscribed'),
      }),
    });
  });

  it('routes through LeadSquared sendEmailToLead when campaign.emailProvider is leadsquared', async () => {
    vi.mocked(db.campaign.findUniqueOrThrow).mockResolvedValue({
      ...mockCampaign,
      emailProvider: 'leadsquared',
    } as any);
    vi.mocked(isEmailSuppressed).mockResolvedValueOnce(null);
    vi.mocked(sendEmailToLead).mockResolvedValueOnce({} as any);

    const res = await processDueSends('campaign_c1');
    expect(res.sent).toBe(1);
    expect(sendEmailToLead).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientEmail: 'priya@example.com',
      })
    );
    expect(sendNetcoreEmail).not.toHaveBeenCalled();
  });

  it('aborts dispatch if send status was marked skipped in-flight by registration', async () => {
    vi.mocked(isEmailSuppressed).mockResolvedValueOnce(null);
    // Send was claimed into candidateIds, but findUnique finds it was transitioned to skipped (e.g. by registerContact)
    vi.mocked(db.cadenceSend.findUnique).mockResolvedValueOnce({
      ...mockSend,
      status: 'skipped',
    } as any);

    const res = await processDueSends('campaign_c1');
    expect(res.sent).toBe(0);
    expect(sendNetcoreEmail).not.toHaveBeenCalled();
    expect(sendEmailToLead).not.toHaveBeenCalled();
    // Verify it did not overwrite skipped with sent
    expect(db.cadenceSend.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'sent' }) })
    );
  });
});

import { addReliabilityMocks } from '../test-support/reliabilityMocks';
import { db as reliabilityDb } from '@/lib/db';

vi.mock('@/lib/sendQuota', () => ({ quotaDay: (date: Date) => date.toISOString().slice(0,10), reserveSendQuota: vi.fn(async () => true), releaseSendQuota: vi.fn() }));
vi.mock('@/lib/lsqExclusions', () => ({ refreshLsqExclusions: vi.fn() }));
vi.mock('@/lib/launchReadiness', () => ({ assertLaunchReady: vi.fn() }));
