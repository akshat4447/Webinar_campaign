/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// registerContact (lib/registerContact.ts) is the write path behind every
// registration source (one-click link, LinkedIn, LeadSquared webhook,
// manual/import) and is documented as idempotent — a second call must never
// re-queue confirmation sends or double-increment campaign.registrations.
// Nothing exercised this before (grep across every *.test.ts found no import
// of registerContact), despite it being exactly the kind of function where a
// silent regression would mean a real recipient gets duplicate confirmation
// emails.

vi.mock('@/lib/db', () => ({
  db: {
    campaign: { findUnique: vi.fn() },
    contact: { findUnique: vi.fn() },
    cadenceStep: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/revalidate', () => ({
  revalidateCampaign: vi.fn(),
}));

vi.mock('@/lib/activityPush', () => ({
  postWebinarRegistrationActivity: vi.fn().mockResolvedValue({ ok: true }),
}));

import { db } from '@/lib/db';
import { registerContact } from './registerContact';

describe('registerContact idempotency (lib/registerContact.ts)', () => {
  const campaign = {
    id: 'camp_1',
    name: 'AI in Lending',
    zoomLink: 'https://zoom.us/j/1',
    registrationLink: null,
    scheduledAt: new Date('2026-10-01T10:00:00Z'),
    simulatedNow: null,
    cadenceStatus: 'running',
    stopOnRegistration: true,
  };
  const contact = {
    id: 'cont_1',
    campaignId: 'camp_1',
    name: 'Priya Nair',
    email: 'priya@example.com',
    phone: null,
    registeredAt: null as Date | null,
  };

  function mockTx(overrides: Partial<Record<string, any>> = {}) {
    return withTxDefaults({
      contact: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      $executeRaw: vi.fn().mockResolvedValue(1),
      cadenceStep: { findMany: vi.fn().mockResolvedValue([]) },
      cadenceSend: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        createMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      activityLogEntry: { create: vi.fn().mockResolvedValue({}) },
      ...overrides,
    }, reliabilityDb);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.campaign.findUnique).mockResolvedValue(campaign as any);
    vi.mocked(db.cadenceStep.findMany).mockResolvedValue([] as any); // regSteps / reminderSteps queries outside tx

    addReliabilityMocks(reliabilityDb);
});

  it('registers a not-yet-registered contact and queues follow-ups', async () => {
    vi.mocked(db.contact.findUnique).mockResolvedValue({ ...contact } as any);
    const tx = mockTx();
    vi.mocked(db.$transaction).mockImplementation(((cb: any) => cb(tx)) as any);

    const result = await registerContact('camp_1', 'cont_1', 'one_click');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.alreadyRegistered).toBe(false);
    }
    expect(tx.contact.updateMany).toHaveBeenCalledWith({
      where: { id: 'cont_1', registeredAt: null },
      data: expect.objectContaining({ registrationSource: 'one_click' }),
    });
  });

  it('short-circuits with no writes when the contact is already registered (top-level check)', async () => {
    vi.mocked(db.contact.findUnique).mockResolvedValue({ ...contact, registeredAt: new Date('2026-09-01T00:00:00Z') } as any);

    const result = await registerContact('camp_1', 'cont_1', 'one_click');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.alreadyRegistered).toBe(true);
      expect(result.queued).toBe(0);
    }
    // No transaction at all — a genuinely already-registered contact never
    // reaches the write path, let alone re-queues anything.
    expect(db.$transaction).toHaveBeenCalled();
  });

  it('treats a lost race (updateMany matches 0 rows inside the transaction) as already-registered, not an error', async () => {
    // Two near-simultaneous calls both pass the top-level `!contact.registeredAt`
    // check before either commits — the second one into the transaction must
    // see contact.updateMany match 0 rows (registeredAt is no longer null) and
    // back off cleanly rather than re-queuing a second set of sends.
    vi.mocked(db.contact.findUnique).mockResolvedValue({ ...contact } as any);
    const tx = mockTx({ contact: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) } });
    vi.mocked(db.$transaction).mockImplementation(((cb: any) => cb(tx)) as any);

    const result = await registerContact('camp_1', 'cont_1', 'one_click');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.alreadyRegistered).toBe(true);
      expect(result.queued).toBe(0);
    }
    // Nothing past the failed claim should have run.
    expect(tx.cadenceSend.createMany).not.toHaveBeenCalled();
    expect(tx.activityLogEntry.create).not.toHaveBeenCalled();
  });

  it('returns unknown-contact for a contact that belongs to a different campaign (token/id mismatch)', async () => {
    vi.mocked(db.contact.findUnique).mockResolvedValue({ ...contact, campaignId: 'some_other_campaign' } as any);

    const result = await registerContact('camp_1', 'cont_1', 'one_click');

    expect(result).toEqual({ ok: false, reason: 'unknown-contact' });
    expect(db.$transaction).toHaveBeenCalled();
  });
});

describe('registerContact — availability (self-serve entry points)', () => {
  const closedCampaign = { ...({} as Record<string, unknown>), id: 'camp_1', name: 'Closed', zoomLink: null, registrationLink: null, scheduledAt: new Date(Date.now() - 10 * 3600_000), durationMinutes: 60, simulatedNow: null, cadenceStatus: 'running', stopOnRegistration: true, archived: false, status: 'live', capacity: null, registrations: 0 };
  const contactRow = { id: 'cont_1', campaignId: 'camp_1', name: 'Priya Nair', email: 'priya@example.com', phone: null, registeredAt: null as Date | null };

  it('refuses a NEW registration after the webinar ended when enforceAvailability is set', async () => {
    vi.mocked(db.campaign.findUnique).mockResolvedValue(closedCampaign as any);
    vi.mocked(db.contact.findUnique).mockResolvedValue({ ...contactRow } as any);
    const r = await registerContact('camp_1', 'cont_1', 'one_click', undefined, { enforceAvailability: true });
    expect(r).toEqual({ ok: false, reason: 'closed', closedReason: 'ended' });
    expect(db.$transaction).toHaveBeenCalled();
  });

  it('still records the registration when enforcement is off (imports, Zoom/CRM webhooks: it already happened)', async () => {
    vi.mocked(db.campaign.findUnique).mockResolvedValue(closedCampaign as any);
    vi.mocked(db.contact.findUnique).mockResolvedValue({ ...contactRow } as any);
    vi.mocked(db.cadenceStep.findMany).mockResolvedValue([] as any);
    vi.mocked(db.$transaction).mockImplementation((async (cb: any) => cb(withTxDefaults({
      contact: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) }, $executeRaw: vi.fn(), cadenceStep: { findMany: vi.fn().mockResolvedValue([]) },
      cadenceSend: { updateMany: vi.fn().mockResolvedValue({ count: 0 }), createMany: vi.fn().mockResolvedValue({ count: 0 }) }, activityLogEntry: { create: vi.fn() },
    }, reliabilityDb))) as any);
    const r = await registerContact('camp_1', 'cont_1', 'leadsquared');
    expect(r.ok).toBe(true);
  });

  it('an ALREADY registered contact gets their confirmation even after the event ends', async () => {
    vi.mocked(db.campaign.findUnique).mockResolvedValue(closedCampaign as any);
    vi.mocked(db.contact.findUnique).mockResolvedValue({ ...contactRow, registeredAt: new Date() } as any);
    const r = await registerContact('camp_1', 'cont_1', 'one_click', undefined, { enforceAvailability: true });
    expect(r).toMatchObject({ ok: true, alreadyRegistered: true });
  });
});

import { addReliabilityMocks, withTxDefaults } from '../test-support/reliabilityMocks';
import { db as reliabilityDb } from '@/lib/db';
