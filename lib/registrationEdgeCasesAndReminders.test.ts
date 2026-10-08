/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: {
    campaign: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    contact: { findUnique: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn(), count: vi.fn() },
    cadenceStep: { findMany: vi.fn(), updateMany: vi.fn() },
    cadenceSend: { findMany: vi.fn(), updateMany: vi.fn(), createMany: vi.fn() },
    activityLogEntry: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/revalidate', () => ({
  revalidateCampaign: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/activityPush', () => ({
  postWebinarRegistrationActivity: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock('@/lib/lsqSuppression', () => ({
  syncContactToLsqSuppressionList: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock('@/lib/zoom/meetings', () => ({
  addZoomRegistrant: vi.fn().mockResolvedValue({ ok: true, joinUrl: 'https://zoom.us/w/pers?tk=123', registrantId: 'z_reg_1' }),
}));

vi.mock('@/lib/sendGuard', () => ({
  getSendMode: vi.fn().mockResolvedValue('sandbox'),
  resolveRecipient: vi.fn().mockImplementation((c) => ({ email: c.email, sandboxed: false })),
}));

vi.mock('@/lib/netcore', () => ({
  sendNetcoreEmail: vi.fn().mockResolvedValue({ success: true, messageId: 'netcore_remind_99' }),
}));

vi.mock('@/lib/channelDelivery', () => ({
  deliverChannelMessage: vi.fn().mockResolvedValue({ strategyUsed: 'direct', detail: 'Sent' }),
  postSentActivityIfMapped: vi.fn().mockResolvedValue({ posted: true }),
}));

vi.mock('@/lib/broadcast', () => ({ processBroadcastJob: vi.fn().mockResolvedValue({ ok:true, sentCount:0, failedCount:0, totalEligible:2, queuedCount:2, jobId:'broadcast-job', status:'pending' }) }));
import { db } from '@/lib/db';
import { registerContact } from '@/lib/registerContact';
import { broadcastWebinarReminderAction } from '@/lib/actions/broadcastReminder';
import { postWebinarRegistrationActivity } from '@/lib/activityPush';
import { isPreRegistrationOutreach, isPreWebinarReminder } from '@/lib/stepTrigger';

describe('Webinar Registration, Suppression List & Reminder Edge Cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (db as any).operationJob = { create: vi.fn().mockResolvedValue({id:'broadcast-job'}) };
    vi.useFakeTimers({toFake:['Date']});
    vi.setSystemTime(new Date('2026-10-20T10:00:00Z'));

    addReliabilityMocks(reliabilityDb);
});

  describe('Edge Case 1: Pre-Registration Outreach Cancellation & Dynamic Reminder Queueing', () => {
    it('cancels pending outreach sends and queues only future reminder countdown steps', async () => {
      const now = new Date('2026-10-20T10:00:00Z');
      const webinarDate = new Date('2026-10-21T10:00:00Z'); // 24h away

      const campaign = {
        id: 'c_launch_1',
        name: 'Enterprise AI Governance',
        zoomLink: 'https://zoom.us/j/gov100',
        registrationLink: null,
        scheduledAt: webinarDate,
        launchedAt: now,
        cadenceStatus: 'running',
        stopOnRegistration: true,
      };

      const contact = {
        id: 'ct_gov_1',
        campaignId: 'c_launch_1',
        name: 'Sarah Connor',
        email: 'sarah@skynet.com',
        phone: '+15550001',
        registeredAt: null,
      };

      vi.mocked(db.campaign.findUnique).mockResolvedValue(campaign as any);
      vi.mocked(db.contact.findUnique).mockResolvedValue(contact as any);

      // Pre-webinar reminder steps returned for running cadence
      const reminderSteps = [
        {
          id: 'step_remind_24h',
          campaignId: 'c_launch_1',
          key: 't1d',
          group: 'Attendee Reminders',
          channel: 'Email',
          trigger: 'launch',
          anchor: 'webinar',
          offsetValue: -1,
          offsetUnit: 'days',
          enabled: true,
          removedAt: null,
        },
        {
          id: 'step_remind_1h',
          campaignId: 'c_launch_1',
          key: 't1h',
          group: 'Attendee Reminders',
          channel: 'Email',
          trigger: 'launch',
          anchor: 'webinar',
          offsetValue: -1,
          offsetUnit: 'hours',
          enabled: true,
          removedAt: null,
        },
        {
          id: 'step_doors_open',
          campaignId: 'c_launch_1',
          key: 'doors_open',
          group: 'Attendee Reminders',
          channel: 'Email',
          trigger: 'launch',
          anchor: 'webinar',
          offsetValue: -15,
          offsetUnit: 'minutes',
          enabled: true,
          removedAt: null,
        },
        {
          id: 'step_past_t3',
          campaignId: 'c_launch_1',
          key: 't3',
          group: 'Attendee Reminders',
          channel: 'Email',
          trigger: 'launch',
          anchor: 'webinar',
          offsetValue: -3,
          offsetUnit: 'days', // Was 2 days ago!
          enabled: true,
          removedAt: null,
        },
      ];

      vi.mocked(db.cadenceStep.findMany).mockImplementation((async (args: any) => {
        if (args?.where?.trigger === 'registration') return [];
        return reminderSteps as any;
      }) as any);

      const txSendsCreated: any[] = [];
      const txSendsUpdated: any[] = [];

      const tx = {
        contact: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        $executeRaw: vi.fn().mockResolvedValue(1),
        cadenceStep: {
          findMany: vi.fn().mockImplementation(async (args: any) => args?.where?.trigger === 'registration' ? [] : args?.where?.OR ? reminderSteps : [
            { key: 'invite', group: 'Pre-registration', trigger: 'launch' },
            { key: 'nudge', group: 'Pre-registration', trigger: 'launch' },
            { key: 'final', group: 'Pre-registration', trigger: 'launch' },
            { key: 't1d', group: 'Attendee Reminders', trigger: 'launch' },
          ]),
        },
        cadenceSend: {
          updateMany: vi.fn().mockImplementation((query) => {
            txSendsUpdated.push(query);
            return { count: 2 };
          }),
          createMany: vi.fn().mockImplementation((query) => {
            txSendsCreated.push(...query.data);
            return { count: query.data.length };
          }),
        },
        activityLogEntry: { create: vi.fn().mockResolvedValue({}) },
      };

      vi.mocked(db.$transaction).mockImplementation(((cb: any) => cb(withTxDefaults(tx, db))) as any);

      const res = await registerContact('c_launch_1', 'ct_gov_1', 'one_click');

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.alreadyRegistered).toBe(false);
        // It should queue only future reminders (t1d, t1h, doors_open) and skip past t3
        expect(res.queued).toBe(3);
      }

      // Check outreach sends were cancelled
      expect(tx.cadenceSend.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            campaignId: 'c_launch_1',
            contactId: 'ct_gov_1',
            status: { in: ['queued', 'processing'] },
          }),
          data: expect.objectContaining({
            status: 'skipped',
            error: 'Contact registered — pre-registration outreach cancelled',
          }),
        })
      );

      // Verify the 3 queued future reminder steps
      const queuedKeys = txSendsCreated.map((s) => s.stepKey);
      expect(queuedKeys).toContain('t1d');
      expect(queuedKeys).toContain('t1h');
      expect(queuedKeys).toContain('doors_open');
      expect(queuedKeys).not.toContain('t3'); // Past reminder was not queued
    });
  });

  describe('Edge Case 2: Idempotency & Lost Concurrency Race', () => {
    it('returns alreadyRegistered without re-incrementing count or queuing sends on duplicate click', async () => {
      const campaign = {
        id: 'c_idemp_1',
        name: 'AI Banking',
        scheduledAt: new Date('2026-11-01'),
        stopOnRegistration: true,
      };

      const registeredContact = {
        id: 'ct_idemp_1',
        campaignId: 'c_idemp_1',
        name: 'Marcus Bell',
        email: 'marcus@bank.com',
        registeredAt: new Date('2026-10-15T09:00:00Z'),
      };

      vi.mocked(db.campaign.findUnique).mockResolvedValue(campaign as any);
      vi.mocked(db.contact.findUnique).mockResolvedValue(registeredContact as any);

      const res = await registerContact('c_idemp_1', 'ct_idemp_1', 'one_click');

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.alreadyRegistered).toBe(true);
        expect(res.queued).toBe(0);
      }
      expect(db.$transaction).toHaveBeenCalled();
    });

    it('safely handles concurrent race condition where updateMany matches 0 rows in transaction', async () => {
      const campaign = {
        id: 'c_race_1',
        name: 'Fintech Summit',
        scheduledAt: new Date('2026-11-01'),
        stopOnRegistration: true,
      };

      const contact = {
        id: 'ct_race_1',
        campaignId: 'c_race_1',
        name: 'Diana Prince',
        email: 'diana@amazon.com',
        registeredAt: null, // Passed top level check
      };

      vi.mocked(db.campaign.findUnique).mockResolvedValue(campaign as any);
      vi.mocked(db.contact.findUnique).mockResolvedValue(contact as any);

      // But another request committed just before our transaction!
      const tx = {
        contact: {
          updateMany: vi.fn().mockResolvedValue({ count: 0 }), // 0 updated
        },
        $executeRaw: vi.fn(),
        cadenceSend: { updateMany: vi.fn(), createMany: vi.fn() },
        activityLogEntry: { create: vi.fn() },
      };

      vi.mocked(db.$transaction).mockImplementation(((cb: any) => cb(withTxDefaults(tx, db))) as any);

      const res = await registerContact('c_race_1', 'ct_race_1', 'one_click');

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.alreadyRegistered).toBe(true);
        expect(res.queued).toBe(0);
      }
      expect(tx.$executeRaw).not.toHaveBeenCalled();
      expect(tx.cadenceSend.createMany).not.toHaveBeenCalled();
    });
  });

  describe('Edge Case 3: LeadSquared Webhook Registration & Suppression Sync Loop Prevention', () => {
    it('skips outbound activity push when source is leadsquared to prevent infinite webhook loops', async () => {
      const campaign = {
        id: 'c_lsq_1',
        name: 'Cloud Security',
        lsqSuppressionListId: 'list-1',
        scheduledAt: new Date('2026-11-01'),
        stopOnRegistration: true,
      };

      const contact = {
        id: 'ct_lsq_1',
        campaignId: 'c_lsq_1',
        name: 'Kavita Rao',
        email: 'kavita@cloud.org',
        registeredAt: null,
      };

      vi.mocked(db.campaign.findUnique).mockResolvedValue(campaign as any);
      vi.mocked(db.contact.findUnique).mockResolvedValue(contact as any);
      vi.mocked(db.cadenceStep.findMany).mockResolvedValue([]);

      const tx = {
        contact: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        $executeRaw: vi.fn().mockResolvedValue(1),
        cadenceStep: { findMany: vi.fn().mockResolvedValue([]) },
        cadenceSend: { updateMany: vi.fn().mockResolvedValue({ count: 0 }), createMany: vi.fn() },
        activityLogEntry: { create: vi.fn().mockResolvedValue({}) },
      };
      vi.mocked(db.$transaction).mockImplementation(((cb: any) => cb(withTxDefaults(tx, db))) as any);

      const res = await registerContact('c_lsq_1', 'ct_lsq_1', 'leadsquared');

      expect(res.ok).toBe(true);
      // Crucial: postWebinarRegistrationActivity must NOT be called for source === 'leadsquared'
      expect(postWebinarRegistrationActivity).not.toHaveBeenCalled();
      // But it MUST sync them to the LeadSquared suppression list!
      expect(db.registrationJob.createMany).toHaveBeenCalledWith(expect.objectContaining({data:expect.arrayContaining([expect.objectContaining({kind:'suppression'})])}));
    });
  });

  describe('Edge Case 4: On-Demand Broadcast Reminder to Registered Attendees (Suppression Audience)', () => {
    it('durably queues the selected registered recipients and reminder template', async () => {
 vi.mocked(db.campaign.findUnique).mockResolvedValue({id:'c_broad_1',name:'Scale Conf'} as any);
 vi.mocked(db.contact.findMany).mockResolvedValue([{id:'ct_reg_1'},{id:'ct_reg_2'}] as any);
 const res=await broadcastWebinarReminderAction('c_broad_1',{channel:'email',message:'Hi {{firstName}}, join with {{zoomLink}}.'});
 expect(res.ok).toBe(true);expect(res.queuedCount).toBe(2);
 expect((db as any).operationJob.create).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({payloadJson:expect.stringContaining('"contactIds":["ct_reg_1","ct_reg_2"]')})}));
});

    it('rejects broadcast send if no attendees are registered yet', async () => {
      vi.mocked(db.campaign.findUnique).mockResolvedValue({ id: 'c_empty', name: 'Empty Event' } as any);
      vi.mocked(db.contact.findMany).mockResolvedValue([]);

      const res = await broadcastWebinarReminderAction('c_empty', {
        channel: 'email',
        message: 'Reminder message',
      });

      expect(res.ok).toBe(false);
      expect(res.sentCount).toBe(0);
      expect(res.error).toContain('No registered attendees found');
    });
  });

  describe('Edge Case 5: Cadence Dispatch Safeguards and Outreach/Reminder Partitioning', () => {
    it('correctly partitions step keys into pre-registration outreach vs pre-webinar reminders', () => {
      // Outreach steps: must NEVER go to registered contacts
      expect(isPreRegistrationOutreach('invite')).toBe(true);
      expect(isPreRegistrationOutreach('nudge')).toBe(true);
      expect(isPreRegistrationOutreach('final')).toBe(true);
      expect(isPreRegistrationOutreach('smsInvite')).toBe(true);
      expect(isPreRegistrationOutreach('waInvite')).toBe(true);

      // Countdown reminders: must NEVER go to unregistered contacts
      expect(isPreWebinarReminder('t3')).toBe(true);
      expect(isPreWebinarReminder('t1d')).toBe(true);
      expect(isPreWebinarReminder('t1h')).toBe(true);
      expect(isPreWebinarReminder('sms')).toBe(true);
      expect(isPreWebinarReminder('doors_open')).toBe(true);

      // Negative checks
      expect(isPreRegistrationOutreach('t1d')).toBe(false);
      expect(isPreWebinarReminder('invite')).toBe(false);
    });
  });
});

import { addReliabilityMocks, withTxDefaults } from '../test-support/reliabilityMocks';
import { db as reliabilityDb } from '@/lib/db';

import { afterEach } from 'vitest';
afterEach(() => vi.useRealTimers());
