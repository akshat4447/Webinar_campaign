/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: {
    campaign: {
      findUniqueOrThrow: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
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
      createMany: vi.fn(),
    },
    contact: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    emailSuppression: {
      findMany: vi.fn(),
      count: vi.fn(),
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

vi.mock('@/lib/revalidate', () => ({
  revalidateCampaign: vi.fn(),
}));

vi.mock('@/lib/netcore', () => ({
  isEmailSuppressed: vi.fn(),
  sendNetcoreEmail: vi.fn(),
}));

vi.mock('@/lib/leadsquared', () => ({
  createOrUpdateLead: vi.fn().mockResolvedValue({ Message: { Id: 'lsq_1' } }),
  sendEmailToLead: vi.fn().mockResolvedValue({ ok: true }),
  LeadSquaredError: class LeadSquaredError extends Error {},
}));

vi.mock('@/lib/sendGuard', () => ({
  getSendMode: vi.fn().mockResolvedValue('live'),
  resolveRecipient: vi.fn((contact) => ({ email: contact.email, sandboxed: false })),
}));

vi.mock('@/lib/sendWindow', () => ({
  isWithinSendWindow: vi.fn().mockReturnValue(true),
}));

vi.mock('@/lib/attentionItems', () => ({
  upsertAttentionItem: vi.fn(),
  resolveAttentionItems: vi.fn(),
}));

vi.mock('@/lib/messageTemplates', () => ({
  resolveStepTemplate: vi.fn(),
}));

import { db } from '@/lib/db';
import { updateCadenceAutomationRuleAction } from '@/lib/actions/schedule';
import { processDueSends } from '@/lib/cadence';
import { registerContact } from '@/lib/registerContact';
import { isEmailSuppressed } from '@/lib/netcore';
import { resolveStepTemplate } from '@/lib/messageTemplates';

describe('Cadence Automation Rules', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    addReliabilityMocks(reliabilityDb);
});

  describe('updateCadenceAutomationRuleAction', () => {
    beforeEach(() => { vi.mocked(db.campaign.findUniqueOrThrow).mockResolvedValue({status:'live',archived:false} as any); });
    it('updates stopOnRegistration and reconciles pending sends when enabled', async () => {
      vi.mocked(db.campaign.update).mockResolvedValueOnce({ id: 'c1', stopOnRegistration: true } as any);
      vi.mocked(db.contact.findMany).mockResolvedValueOnce([{ id: 'contact-reg-1' }] as any);
      vi.mocked(db.cadenceStep.findMany).mockResolvedValueOnce([
        { key: 'invite', group: 'Pre-registration' },
        { key: 'nudge', group: 'Pre-registration' },
      ] as any);
      vi.mocked(db.cadenceSend.updateMany).mockResolvedValueOnce({ count: 3 } as any);

      const res = await updateCadenceAutomationRuleAction('c1', 'stopOnRegistration', true);

      expect(res.ok).toBe(true);
      expect(res.rule).toBe('stopOnRegistration');
      expect(res.enabled).toBe(true);
      expect(res.reconciledSendsCount).toBe(3);
      expect(db.campaign.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { stopOnRegistration: true },
      });
      expect(db.cadenceSend.updateMany).toHaveBeenCalledWith({
        where: {
          campaignId: 'c1',
          contactId: { in: ['contact-reg-1'] },
          stepKey: { in: expect.arrayContaining(['invite', 'nudge', 'final']) },
          status: { in: ['queued', 'processing'] },
        },
        data: {
          status: 'skipped',
          error: 'Rule enabled: Stop when a contact registers — pending outreach cancelled',
        },
      });
      expect(db.activityLogEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            campaignId: 'c1',
            text: expect.stringContaining('3 pending send(s) cancelled'),
          }),
        })
      );
    });

    it('updates stopOnDecline and reconciles pending sends for unsubscribed contacts', async () => {
      vi.mocked(db.campaign.update).mockResolvedValueOnce({ id: 'c1', stopOnDecline: true } as any);
      vi.mocked(db.contact.findMany).mockResolvedValueOnce([{ id: 'contact-unsub-1' }] as any);
      vi.mocked(db.cadenceSend.updateMany).mockResolvedValueOnce({ count: 5 } as any);

      const res = await updateCadenceAutomationRuleAction('c1', 'stopOnDecline', true);

      expect(res.ok).toBe(true);
      expect(res.reconciledSendsCount).toBe(5);
      expect(db.cadenceSend.updateMany).toHaveBeenCalledWith({
        where: {
          campaignId: 'c1',
          contactId: { in: ['contact-unsub-1'] },
          status: { in: ['queued', 'processing'] },
        },
        data: {
          status: 'skipped',
          error: 'Rule enabled: Stop when a contact declines — pending touches cancelled',
        },
      });
    });

    it('updates suppressionPreflight and reconciles sends matching EmailSuppression', async () => {
      vi.mocked(db.campaign.update).mockResolvedValueOnce({ id: 'c1', suppressionPreflight: true } as any);
      vi.mocked(db.emailSuppression.findMany).mockResolvedValueOnce([{ email: 'blocked@domain.com' }] as any);
      vi.mocked(db.contact.findMany).mockResolvedValueOnce([{ id: 'contact-suppressed-1' }] as any);
      vi.mocked(db.cadenceSend.updateMany).mockResolvedValueOnce({ count: 2 } as any);

      const res = await updateCadenceAutomationRuleAction('c1', 'suppressionPreflight', true);

      expect(res.ok).toBe(true);
      expect(res.reconciledSendsCount).toBe(2);
      expect(db.cadenceSend.updateMany).toHaveBeenCalledWith({
        where: {
          campaignId: 'c1',
          contactId: { in: ['contact-suppressed-1'] },
          status: { in: ['queued', 'processing'] },
        },
        data: {
          status: 'skipped',
          error: 'Rule enabled: Suppression pre-flight filtering — address on suppression list',
        },
      });
    });

    it('rejects invalid rule keys', async () => {
      const res = await updateCadenceAutomationRuleAction('c1', 'invalidRule' as any, true);
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/Invalid automation rule/);
    });
  });

  describe('Runtime Enforcement in processDueSends', () => {
    const baseCampaign = {
      id: 'c1',
      name: 'Automation Webinar',
      date: '2026-10-01',
      scheduledAt: new Date('2026-10-01T10:00:00Z'),
      scheduleWindow: '00:00-23:59',
      dailyLimit: 100,
      cadenceStatus: 'running',
      speakerName: 'Dr. Jane',
      emailProvider: 'leadsquared',
      registrationLink: 'https://example.com/webinar',
      zoomLink: 'https://zoom.us/j/12345',
      oneClickSignup: true,
      stopOnRegistration: true,
      stopOnDecline: true,
      suppressionPreflight: true,
    };

    function setupClaimTransaction(sendId: string) {
      let claimed = false;
      vi.mocked(db.$transaction).mockImplementation(async (cb: any) => {
        const candidates = claimed ? [] : [{ id: sendId }];
        claimed = true;
        return cb(withTxDefaults({
          cadenceSend: {
            findMany: vi.fn().mockResolvedValue(candidates),
            updateMany: vi.fn().mockResolvedValue({ count: candidates.length }),
          },
        }, reliabilityDb));
      });
    }

    it('skips pre-registration outreach when stopOnRegistration is true and contact is registered', async () => {
      vi.mocked(db.campaign.findUniqueOrThrow).mockResolvedValueOnce({
        ...baseCampaign,
        stopOnRegistration: true,
      } as any);
      vi.mocked(db.speaker.findMany).mockResolvedValueOnce([]);
      vi.mocked(db.cadenceSend.count).mockResolvedValue(0);

      setupClaimTransaction('send-1');

      const mockSend = {
        id: 'send-1',
        campaignId: 'c1',
        contactId: 'cnt-1',
        stepKey: 'invite',
        status: 'processing',
        contact: {
          id: 'cnt-1',
          name: 'Alice',
          email: 'alice@example.com',
          registeredAt: new Date('2026-09-15T12:00:00Z'),
          unsubscribedAt: null,
        },
      };

      vi.mocked(db.cadenceSend.findMany).mockResolvedValueOnce([mockSend] as any);
      vi.mocked(db.cadenceSend.findUnique).mockResolvedValueOnce(mockSend as any);
      vi.mocked(db.cadenceStep.findUnique).mockResolvedValue({
        key: 'invite',
        group: 'Pre-registration',
        enabled: true,
        removedAt: null,
      } as any);

      const result = await processDueSends('c1');

      expect(result.processed).toBe(1);
      expect(result.sent).toBe(0);
      expect(db.cadenceSend.update).toHaveBeenCalledWith({
        where: { id: 'send-1' },
        data: expect.objectContaining({
          status: 'skipped',
          error: 'Contact already registered — pre-registration outreach skipped',
        }),
      });
    });

    it('bypasses pre-registration skip when stopOnRegistration is false', async () => {
      vi.mocked(db.campaign.findUniqueOrThrow).mockResolvedValueOnce({
        ...baseCampaign,
        stopOnRegistration: false, // Turned OFF
      } as any);
      vi.mocked(db.speaker.findMany).mockResolvedValueOnce([]);
      vi.mocked(db.cadenceSend.count).mockResolvedValue(0);

      setupClaimTransaction('send-2');

      const mockSend = {
        id: 'send-2',
        campaignId: 'c1',
        contactId: 'cnt-2',
        stepKey: 'invite',
        status: 'processing',
        contact: {
          id: 'cnt-2',
          name: 'Bob',
          email: 'bob@example.com',
          registeredAt: new Date('2026-09-15T12:00:00Z'),
          unsubscribedAt: null,
          lsqLeadId: 'lead-2',
        },
      };

      vi.mocked(db.cadenceSend.findMany).mockResolvedValueOnce([mockSend] as any);
      vi.mocked(db.cadenceSend.findUnique).mockResolvedValueOnce(mockSend as any);
      vi.mocked(db.cadenceStep.findUnique).mockResolvedValue({
        key: 'invite',
        group: 'Pre-registration',
        enabled: true,
        removedAt: null,
      } as any);

      vi.mocked(resolveStepTemplate).mockResolvedValueOnce({
        id: 'tpl-1',
        label: 'Invitation Email',
        channel: 'email',
        body: 'Join our webinar! {{link}}',
        subject: 'You are invited',
      } as any);

      vi.mocked(isEmailSuppressed).mockResolvedValueOnce(null);

      const result = await processDueSends('c1');

      expect(result.processed).toBe(1);
      expect(result.sent).toBe(1);
      expect(db.cadenceSend.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'send-2' },
          data: expect.objectContaining({ status: 'sent' }),
        })
      );
    });

    it('skips send when suppressionPreflight is true and email is in suppression list', async () => {
      vi.mocked(db.campaign.findUniqueOrThrow).mockResolvedValueOnce({
        ...baseCampaign,
        suppressionPreflight: true,
      } as any);
      vi.mocked(db.speaker.findMany).mockResolvedValueOnce([]);
      vi.mocked(db.cadenceSend.count).mockResolvedValue(0);

      setupClaimTransaction('send-3');

      const mockSend = {
        id: 'send-3',
        campaignId: 'c1',
        contactId: 'cnt-3',
        stepKey: 'invite',
        status: 'processing',
        contact: {
          id: 'cnt-3',
          name: 'Charlie',
          email: 'charlie@suppressed.com',
          registeredAt: null,
          unsubscribedAt: null,
        },
      };

      vi.mocked(db.cadenceSend.findMany).mockResolvedValueOnce([mockSend] as any);
      vi.mocked(db.cadenceSend.findUnique).mockResolvedValueOnce(mockSend as any);
      vi.mocked(db.cadenceStep.findUnique).mockResolvedValue({
        key: 'invite',
        group: 'Pre-registration',
        enabled: true,
        removedAt: null,
      } as any);

      vi.mocked(resolveStepTemplate).mockResolvedValueOnce({
        id: 'tpl-1',
        label: 'Invitation Email',
        channel: 'email',
        body: 'Join our webinar! {{link}}',
        subject: 'You are invited',
      } as any);

      vi.mocked(isEmailSuppressed).mockResolvedValueOnce({
        id: 'sup-1',
        email: 'charlie@suppressed.com',
        reason: 'hardbounce',
        detail: 'User unknown',
      } as any);

      const result = await processDueSends('c1');

      expect(result.processed).toBe(1);
      expect(result.sent).toBe(0);
      expect(db.cadenceSend.update).toHaveBeenCalledWith({
        where: { id: 'send-3' },
        data: expect.objectContaining({
          status: 'skipped',
          error: expect.stringContaining('Email suppressed (hardbounce)'),
        }),
      });
    });

    it('keeps mandatory suppression checks when optional preflight is disabled', async () => {
      vi.mocked(db.campaign.findUniqueOrThrow).mockResolvedValueOnce({
        ...baseCampaign,
        suppressionPreflight: false, // Disabled
      } as any);
      vi.mocked(db.speaker.findMany).mockResolvedValueOnce([]);
      vi.mocked(db.cadenceSend.count).mockResolvedValue(0);

      setupClaimTransaction('send-4');

      const mockSend = {
        id: 'send-4',
        campaignId: 'c1',
        contactId: 'cnt-4',
        stepKey: 'invite',
        status: 'processing',
        contact: {
          id: 'cnt-4',
          name: 'Dave',
          email: 'dave@example.com',
          registeredAt: null,
          unsubscribedAt: null,
          lsqLeadId: 'lead-4',
        },
      };

      vi.mocked(db.cadenceSend.findMany).mockResolvedValueOnce([mockSend] as any);
      vi.mocked(db.cadenceSend.findUnique).mockResolvedValueOnce(mockSend as any);
      vi.mocked(db.cadenceStep.findUnique).mockResolvedValue({
        key: 'invite',
        group: 'Pre-registration',
        enabled: true,
        removedAt: null,
      } as any);

      vi.mocked(resolveStepTemplate).mockResolvedValueOnce({
        id: 'tpl-1',
        label: 'Invitation Email',
        channel: 'email',
        body: 'Join our webinar! {{link}}',
        subject: 'You are invited',
      } as any);

      const result = await processDueSends('c1');

      expect(isEmailSuppressed).toHaveBeenCalled();
      expect(result.sent).toBe(1);
    });

    it('skips send when stopOnDecline is true and contact has unsubscribedAt', async () => {
      vi.mocked(db.campaign.findUniqueOrThrow).mockResolvedValueOnce({
        ...baseCampaign,
        stopOnDecline: true,
      } as any);
      vi.mocked(db.speaker.findMany).mockResolvedValueOnce([]);
      vi.mocked(db.cadenceSend.count).mockResolvedValue(0);

      setupClaimTransaction('send-5');

      const mockSend = {
        id: 'send-5',
        campaignId: 'c1',
        contactId: 'cnt-5',
        stepKey: 'invite',
        status: 'processing',
        contact: {
          id: 'cnt-5',
          name: 'Eve',
          email: 'eve@example.com',
          registeredAt: null,
          unsubscribedAt: new Date('2026-09-10T10:00:00Z'),
        },
      };

      vi.mocked(db.cadenceSend.findMany).mockResolvedValueOnce([mockSend] as any);
      vi.mocked(db.cadenceSend.findUnique).mockResolvedValueOnce(mockSend as any);
      vi.mocked(db.cadenceStep.findUnique).mockResolvedValue({
        key: 'invite',
        group: 'Pre-registration',
        enabled: true,
        removedAt: null,
      } as any);

      vi.mocked(resolveStepTemplate).mockResolvedValueOnce({
        id: 'tpl-1',
        label: 'Invitation Email',
        channel: 'email',
        body: 'Join our webinar! {{link}}',
        subject: 'You are invited',
      } as any);

      vi.mocked(isEmailSuppressed).mockResolvedValueOnce(null);

      const result = await processDueSends('c1');

      expect(result.processed).toBe(1);
      expect(result.sent).toBe(0);
      expect(db.cadenceSend.update).toHaveBeenCalledWith({
        where: { id: 'send-5' },
        data: expect.objectContaining({
          status: 'skipped',
          error: 'Contact unsubscribed — send skipped',
        }),
      });
    });
  });

  describe('registerContact honoring stopOnRegistration', () => {
    it('cancels pending outreach when stopOnRegistration is true', async () => {
      vi.mocked(db.campaign.findUnique).mockResolvedValueOnce({
        id: 'c1',
        name: 'Webinar',
        stopOnRegistration: true,
        scheduledAt: new Date('2026-10-01'),
        cadenceStatus: 'running',
      } as any);
      vi.mocked(db.contact.findUnique).mockResolvedValueOnce({
        id: 'cnt-1',
        campaignId: 'c1',
        registeredAt: null,
      } as any);
      vi.mocked(db.cadenceStep.findMany).mockResolvedValue([]);

      let txOutreachCancelled = false;
      vi.mocked(db.$transaction).mockImplementationOnce(async (cb: any) => {
        const tx = {
          contact: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
          cadenceStep: { findMany: vi.fn().mockResolvedValue([{ key: 'invite', group: 'Pre-registration' }]) },
          cadenceSend: {
            updateMany: vi.fn().mockImplementation(() => {
              txOutreachCancelled = true;
              return { count: 2 };
            }),
            createMany: vi.fn().mockResolvedValue({ count: 0 }),
          },
          activityLogEntry: { create: vi.fn().mockResolvedValue({}) },
          $executeRaw: vi.fn().mockResolvedValue(1),
        };
        return cb(withTxDefaults(tx, reliabilityDb));
      });

      const res = await registerContact('c1', 'cnt-1', 'one_click');

      expect(res.ok).toBe(true);
      expect(txOutreachCancelled).toBe(true);
    });

    it('does not cancel pending outreach when stopOnRegistration is false', async () => {
      let txOutreachCancelled = false;
      vi.mocked(db.campaign.findUnique).mockResolvedValueOnce({
        id: 'c1',
        name: 'Webinar',
        stopOnRegistration: false, // Disabled
        scheduledAt: new Date('2026-10-01'),
        cadenceStatus: 'running',
      } as any);
      vi.mocked(db.contact.findUnique).mockResolvedValueOnce({
        id: 'cnt-2',
        campaignId: 'c1',
        registeredAt: null,
      } as any);
      vi.mocked(db.cadenceStep.findMany).mockResolvedValue([]);

      vi.mocked(db.$transaction).mockImplementationOnce(async (cb: any) => {
        const tx = {
          contact: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
          cadenceStep: { findMany: vi.fn().mockResolvedValue([]) },
          cadenceSend: {
            updateMany: vi.fn().mockImplementation(() => {
              txOutreachCancelled = true;
              return { count: 0 };
            }),
            createMany: vi.fn().mockResolvedValue({ count: 0 }),
          },
          activityLogEntry: { create: vi.fn().mockResolvedValue({}) },
          $executeRaw: vi.fn().mockResolvedValue(1),
        };
        return cb(withTxDefaults(tx, reliabilityDb));
      });

      const res = await registerContact('c1', 'cnt-2', 'one_click');

      expect(res.ok).toBe(true);
      expect(txOutreachCancelled).toBe(false);
    });
  });
});

import { addReliabilityMocks, withTxDefaults } from '../test-support/reliabilityMocks';
import { db as reliabilityDb } from '@/lib/db';

vi.mock('@/lib/sendQuota', () => ({ quotaDay: (date: Date) => date.toISOString().slice(0,10), reserveSendQuota: vi.fn(async () => true), releaseSendQuota: vi.fn() }));
vi.mock('@/lib/lsqExclusions', () => ({ refreshLsqExclusions: vi.fn() }));
vi.mock('@/lib/launchReadiness', () => ({ assertLaunchReady: vi.fn() }));
