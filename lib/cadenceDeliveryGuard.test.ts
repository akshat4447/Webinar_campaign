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

const claims = new Set<string>();
vi.mock('@/lib/idempotency', () => ({
  idemKey: (ns: string, ...p: unknown[]) => `${ns}:${p.join('|')}`,
  claimOnce: vi.fn(async (k: string) => (claims.has(k) ? false : (claims.add(k), true))),
  release: vi.fn(async (k: string) => void claims.delete(k)),
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
import { sendEmailToLead } from '@/lib/leadsquared';
import { processDueSends } from './cadence';

describe('Cadence delivery guard (at-most-once provider dispatch)', () => {
  const campaign = (provider: 'netcore' | 'leadsquared') => ({
    id: 'campaign_c1', name: 'AI Banking Webinar', date: 'Sep 25, 2026', emailProvider: provider, cadenceStatus: 'running',
    dailyLimit: 100, scheduleWindow: '09:00-18:00', simulatedNow: new Date('2026-09-20T10:00:00Z'), oneClickSignup: true,
    registrationLink: null, zoomLink: 'https://zoom.us/j/12345', speakers: [],
  });
  const contact = { id: 'contact_1', name: 'Priya Nair', email: 'priya@example.com', account: 'Acme Bank', phone: null, registeredAt: null, unsubscribedAt: null, lsqLeadId: 'lsq_lead_123' };
  const send = { id: 'send_1', campaignId: 'campaign_c1', stepKey: 'invite', status: 'processing', dueAt: new Date('2026-09-20T09:00:00Z'), contact };
  const template = { id: 'tpl_1', key: 'invite', label: 'Initial Invite', channel: 'email', subject: "You're invited: {{topic}}", body: 'Hi {{firstName}}, join us for {{topic}}. Link: {{link}}', hidden: false };

  function arm(provider: 'netcore' | 'leadsquared') {
    vi.mocked(db.campaign.findUniqueOrThrow).mockResolvedValue(campaign(provider) as any);
    let claimed = false;
    vi.mocked(db.$transaction).mockImplementation(async (cb: any) => {
      const candidates = claimed ? [] : [{ id: 'send_1' }];
      claimed = true;
      return cb({ cadenceSend: { findMany: vi.fn().mockResolvedValue(candidates), updateMany: vi.fn().mockResolvedValue({ count: candidates.length }) } });
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    claims.clear();
    vi.mocked(resolveStepTemplate).mockResolvedValue(template as any);
    vi.mocked(db.cadenceStep.findUnique).mockResolvedValue({ enabled: true, removedAt: null, group: 'Pre-registration' } as any);
    vi.mocked(db.personalizedMessage.findUnique).mockResolvedValue(null as any);
    vi.mocked(db.speaker.findMany).mockResolvedValue([] as any);
    vi.mocked(db.cadenceSend.count).mockResolvedValue(0);
    vi.mocked(db.cadenceSend.update).mockResolvedValue({} as any);
    vi.mocked(db.activityLogEntry.create).mockResolvedValue({} as any);
    vi.mocked(db.cadenceSend.findMany).mockResolvedValue([send] as any);
    vi.mocked(db.cadenceSend.findUnique).mockResolvedValue(send as any);
    vi.mocked(isEmailSuppressed).mockResolvedValue(null);
    vi.mocked(sendNetcoreEmail).mockResolvedValue({ ok: true, messageId: 'm1', sandboxed: false, simulated: false } as any);
    vi.mocked(sendEmailToLead).mockResolvedValue({ ID: '1', MemberCount: 1, TotalRecipient: 1 } as any);

    addReliabilityMocks(reliabilityDb);
});

  it('records confirmed provider acceptance after Netcore dispatch',async()=>{arm('netcore');const res=await processDueSends('campaign_c1');expect(res.sent).toBe(1);expect(db.deliveryAttempt.create).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({sendId:'send_1',campaignId:'campaign_c1'})}));expect(db.deliveryAttempt.update).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({status:'accepted'})}));});

  it('holds a prior unconfirmed dispatch without resending or marking it sent',async()=>{arm('netcore');vi.mocked(db.deliveryAttempt.create).mockRejectedValueOnce(Object.assign(new Error('Duplicate'),{code:'P2002'}));vi.mocked(db.deliveryAttempt.findUniqueOrThrow).mockResolvedValueOnce({status:'dispatching'} as any);const res=await processDueSends('campaign_c1');expect(sendNetcoreEmail).not.toHaveBeenCalled();expect(res.sent).toBe(0);expect(db.cadenceSend.update).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({status:'unknown'})}));});

  it('reconciles an accepted LeadSquared receipt without resending',async()=>{arm('leadsquared');vi.mocked(db.deliveryAttempt.create).mockRejectedValueOnce(Object.assign(new Error('Duplicate'),{code:'P2002'}));vi.mocked(db.deliveryAttempt.findUniqueOrThrow).mockResolvedValueOnce({status:'accepted',receiptJson:'{}'} as any);const res=await processDueSends('campaign_c1');expect(sendEmailToLead).not.toHaveBeenCalled();expect(res.sent).toBe(1);});

  it('retries only a proved rejection',async()=>{arm('netcore');vi.mocked(sendNetcoreEmail).mockRejectedValueOnce(new DeliveryRejectedError('Bad sender',400));expect((await processDueSends('campaign_c1')).failed).toBe(1);arm('netcore');expect((await processDueSends('campaign_c1')).sent).toBe(1);expect(sendNetcoreEmail).toHaveBeenCalledTimes(2);});
});

import { addReliabilityMocks } from '../test-support/reliabilityMocks';
import { db as reliabilityDb } from '@/lib/db';

vi.mock('@/lib/sendQuota', () => ({ quotaDay: (date: Date) => date.toISOString().slice(0,10), reserveSendQuota: vi.fn(async () => true), releaseSendQuota: vi.fn() }));
vi.mock('@/lib/lsqExclusions', () => ({ refreshLsqExclusions: vi.fn() }));
vi.mock('@/lib/launchReadiness', () => ({ assertLaunchReady: vi.fn() }));
import { DeliveryRejectedError } from '@/lib/deliveryGuard';
