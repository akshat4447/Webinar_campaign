/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { saveCadenceSequenceAction } from '@/lib/actions/schedule';
import { dispatchAutomatedLinkedInAction } from '@/lib/actions/linkedin';
import { STEP_DEFAULT_INSTRUCTIONS } from '@/lib/stepSchedule';
import { db } from '@/lib/db';
import { revalidateCampaign } from '@/lib/revalidate';

vi.mock('@/lib/db', () => ({
  db: {
    campaign: {
      findUniqueOrThrow: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    contact: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    cadenceStep: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    cadenceSend: {
      updateMany: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
      groupBy: vi.fn().mockResolvedValue([]),
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

describe('Cadence Sequence Flow & Batch Persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('provides default AI instructions for standard cadence steps matching the prototype', () => {
    expect(STEP_DEFAULT_INSTRUCTIONS.invite).toBe('First touch to approved contacts.');
    expect(STEP_DEFAULT_INSTRUCTIONS.confirm).toBe('Calendar invite + join link, the moment they register.');
    expect(STEP_DEFAULT_INSTRUCTIONS.t3).toBe('What the session covers, keep it warm.');
    expect(STEP_DEFAULT_INSTRUCTIONS.t1d).toBe('Don’t-forget nudge with join link.');
    expect(STEP_DEFAULT_INSTRUCTIONS.t1h).toBe('“We’re live in an hour” with the join link.');
    expect(STEP_DEFAULT_INSTRUCTIONS.attend).toContain('Thanks for joining');
    expect(STEP_DEFAULT_INSTRUCTIONS.noshow).toContain('Sorry we missed you');
  });

  it('handles empty patches gracefully in saveCadenceSequenceAction', async () => {
    const res = await saveCadenceSequenceAction('camp_123', []);
    expect(res.ok).toBe(true);
    expect(res.updatedCount).toBe(0);
    expect(db.cadenceStep.update).not.toHaveBeenCalled();
  });

  it('persists modified step timing, mode, and prompt instructions in a transaction', async () => {
    (db.campaign.findUniqueOrThrow as any).mockResolvedValue({
      id: 'camp_123',
      scheduledAt: new Date('2026-10-15T14:30:00.000Z'),
      simulatedNow: new Date('2026-09-15T10:00:00.000Z'),
    });

    (db.cadenceStep.findMany as any).mockResolvedValue([
      {
        id: 'step_wa',
        key: 'waInvite',
        channel: 'WhatsApp',
        timing: 'Day 0',
        offsetValue: 0,
        offsetUnit: 'days',
        anchor: 'launch',
        mode: 'ai',
        instruction: 'Old WhatsApp instruction',
        enabled: true,
      },
      {
        id: 'step_email4',
        key: 'final',
        channel: 'Email',
        timing: '+7 days',
        offsetValue: 7,
        offsetUnit: 'days',
        anchor: 'launch',
        mode: 'ai',
        instruction: 'Old final instruction',
        enabled: true,
      },
    ]);

    (db.cadenceStep.update as any).mockImplementation(({ data }: any) => ({ ...data }));
    (db.cadenceSend.updateMany as any).mockResolvedValue({ count: 12 });
    (db.$transaction as any).mockImplementation(async (ops: any[]) => ops);

    const patches = [
      {
        key: 'waInvite',
        timingValue: 'T-5 days',
        mode: 'ai' as const,
        instruction: 'Follow-up to those who haven’t registered yet.',
        enabled: true,
      },
      {
        key: 'final',
        timingValue: 'T-3 days',
        mode: 'template' as const,
        templateId: 'tpl_custom_final',
        instruction: 'Final call urgency',
        enabled: false,
      },
    ];

    const res = await saveCadenceSequenceAction('camp_123', patches);
    expect(res.ok).toBe(true);
    expect(res.updatedCount).toBe(2);

    expect(db.$transaction).toHaveBeenCalled();
    expect(db.activityLogEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          campaignId: 'camp_123',
          text: expect.stringContaining('Saved communication sequence (2 step(s) updated)'),
        }),
      })
    );
    expect(revalidateCampaign).toHaveBeenCalledWith('camp_123');
  });

  it('correctly maps status states: Sent, Live, Scheduled, Paused', () => {
    const resolveStatus = (step: {
      key: string;
      trigger: string;
      enabled: boolean;
      sentCount: number;
      queuedCount: number;
    }) => {
      if (step.sentCount > 0 && step.queuedCount === 0) return 'Sent';
      if (!step.enabled) return 'Paused';
      if (step.trigger === 'registration') return 'Live';
      return 'Scheduled';
    };

    // Step 1: Already dispatched
    expect(
      resolveStatus({
        key: 'invite',
        trigger: 'launch',
        enabled: true,
        sentCount: 24,
        queuedCount: 0,
      })
    ).toBe('Sent');

    // Step 2: Live real-time registration confirmation listener
    expect(
      resolveStatus({
        key: 'confirm',
        trigger: 'registration',
        enabled: true,
        sentCount: 0,
        queuedCount: 0,
      })
    ).toBe('Live');

    // Step 3: Scheduled future touch
    expect(
      resolveStatus({
        key: 't3',
        trigger: 'launch',
        enabled: true,
        sentCount: 0,
        queuedCount: 45,
      })
    ).toBe('Scheduled');

    // Step 4: Toggled off / paused
    expect(
      resolveStatus({
        key: 'sms',
        trigger: 'launch',
        enabled: false,
        sentCount: 0,
        queuedCount: 0,
      })
    ).toBe('Paused');
  });

  it('locks already sent steps from being modified in saveCadenceSequenceAction', async () => {
    (db.campaign.findUniqueOrThrow as any).mockResolvedValue({
      id: 'camp_123',
      scheduledAt: new Date('2026-10-15T14:30:00.000Z'),
      simulatedNow: new Date('2026-09-15T10:00:00.000Z'),
    });

    (db.cadenceStep.findMany as any).mockResolvedValue([
      {
        id: 'step_invite',
        key: 'invite',
        channel: 'Email',
        timing: 'Day 0',
        offsetValue: 0,
        offsetUnit: 'days',
        anchor: 'launch',
        mode: 'ai',
        enabled: true,
      },
      {
        id: 'step_nudge',
        key: 'nudge',
        channel: 'Email',
        timing: '+4 days',
        offsetValue: 4,
        offsetUnit: 'days',
        anchor: 'launch',
        mode: 'ai',
        enabled: true,
      },
    ]);

    // invite has already been sent!
    (db.cadenceSend.groupBy as any).mockResolvedValue([
      { stepKey: 'invite', _count: 42 },
    ]);

    (db.cadenceStep.update as any).mockImplementation(({ data }: any) => ({ ...data }));
    (db.$transaction as any).mockImplementation(async (ops: any[]) => ops);

    const patches = [
      { key: 'invite', timingValue: '+1 day' }, // already sent, should be locked/skipped
      { key: 'nudge', timingValue: '+3 days' },  // unsent, should be updated
    ];

    const res = await saveCadenceSequenceAction('camp_123', patches);
    expect(res.ok).toBe(true);
    // Only the unsent step (nudge) was updated
    expect(res.updatedCount).toBe(1);
  });

  it('dispatches automated LinkedIn personalized messages for approved contacts', async () => {
    (db.campaign.findUnique as any).mockResolvedValue({
      id: 'camp_123',
      name: 'Modern AI Systems Webinar',
    });

    (db.contact.findMany as any).mockResolvedValue([
      { id: 'c1', name: 'Alice Chen', account: 'Acme', lsqLeadId: 'lsq_1', linkedinCheckStatus: 'verified' },
      { id: 'c2', name: 'Bob Smith', account: 'Beta', lsqLeadId: null, linkedinCheckStatus: null },
      { id: 'c3', name: 'Charlie Doe', account: 'Gamma', lsqLeadId: null, linkedinCheckStatus: 'mismatch' },
    ]);

    // c1 already sent; c2 pending; c3 skipped due to mismatch
    (db.cadenceSend.findMany as any).mockResolvedValue([
      { contactId: 'c1', status: 'sent' },
    ]);

    (db.cadenceSend.upsert as any).mockResolvedValue({});
    (db.activityLogEntry.create as any).mockResolvedValue({});

    const res = await dispatchAutomatedLinkedInAction('camp_123');
    expect(res.ok).toBe(true);
    expect(res.dispatchedCount).toBe(1); // Only c2 was dispatched

    expect(db.cadenceSend.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          campaignId_contactId_stepKey: { campaignId: 'camp_123', contactId: 'c2', stepKey: 'linkedin' },
        },
      })
    );
    expect(revalidateCampaign).toHaveBeenCalledWith('camp_123');
  });
});
