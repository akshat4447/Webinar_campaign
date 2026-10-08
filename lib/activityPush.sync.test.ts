import { describe, it, expect, vi, beforeEach } from 'vitest';

// In-memory idempotency ledger standing in for the AppSetting-backed one.
const claims = new Set<string>();
vi.mock('@/lib/idempotency', () => ({
  idemKey: (ns: string, ...parts: unknown[]) => `${ns}:${parts.join('|')}`,
  claimOnce: vi.fn(async (k: string) => (claims.has(k) ? false : (claims.add(k), true))),
  release: vi.fn(async (k: string) => void claims.delete(k)),
}));

const lsq = vi.hoisted(() => {
  class PartialActivityPushError extends Error {
    constructor(public pushed: number, public cause: unknown) {
      super('partial');
    }
  }
  return {
    PartialActivityPushError,
    bulkCreateOrUpdateLeads: vi.fn(),
    createOrUpdateLead: vi.fn(),
    createActivityType: vi.fn(),
    pushCustomActivities: vi.fn(),
  };
});
vi.mock('@/lib/leadsquared', () => lsq);

vi.mock('@/lib/attentionItems', () => ({ upsertAttentionItem: vi.fn() }));
vi.mock('@/lib/integrationConfig', () => ({
  resolveIntegrationField: vi.fn(async (_i: string, k: string) => (k === 'accessKey' ? 'AK' : k === 'secretKey' ? 'SK' : undefined)),
}));

const db = vi.hoisted(() => ({
  appSetting: { findUnique: vi.fn(), upsert: vi.fn() },
  campaign: { findUnique: vi.fn() },
  contact: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  activityLogEntry: { create: vi.fn() },
}));
vi.mock('@/lib/db', () => ({ db }));

import { pushEngagementActivities, postWebinarRegistrationActivity } from './activityPush';
import { trackInflight, zoomRegistrantKey } from './inflight';
import { upsertAttentionItem } from '@/lib/attentionItems';

const campaign = { id: 'c1', name: 'AI Webinar', date: 'Oct 1', scheduledAt: null, speakerName: 'Dr S', zoomLink: 'https://zoom.us/generic', registrationLink: null, speakers: [] };
const mkContact = (i: number, over: Record<string, unknown> = {}) => ({
  id: `ct${i}`, campaignId: 'c1', name: `User ${i} Surname`, email: `u${i}@x.com`, account: 'Acme', phone: null, lsqLeadId: null, zoomJoinUrl: null, zoomRegistrantId: null, ...over,
});

beforeEach(() => {
  claims.clear();
  vi.clearAllMocks();
  db.appSetting.findUnique.mockResolvedValue({ value: '205' }); // cached activity type ids
  db.campaign.findUnique.mockResolvedValue(campaign);
  db.contact.updateMany.mockResolvedValue({ count: 1 });
  lsq.pushCustomActivities.mockImplementation(async (a: unknown[]) => a.length);
  lsq.bulkCreateOrUpdateLeads.mockImplementation(async (leads: unknown[]) =>
    leads.map((_, i) => ({ RowNumber: i, LeadId: `L${i}`, LeadCreated: true, LeadUpdated: false, AffectedRows: 1 }))
  );
  lsq.createOrUpdateLead.mockResolvedValue({ Status: 'Success', Message: { Id: 'LEAD1', AffectedRows: 1 } });
  delete process.env.LSQ_ZOOM_REGISTERED_FIELD;
});

describe('pushEngagementActivities', () => {
  it('creates all missing leads in ONE batch call, not one request per contact', async () => {
    db.contact.findMany.mockResolvedValue([mkContact(1), mkContact(2), mkContact(3)]);
    const r = await pushEngagementActivities('c1', [1, 2, 3].map((i) => ({ contactId: `ct${i}`, stage: 'Attended' as const })));
    expect(lsq.bulkCreateOrUpdateLeads).toHaveBeenCalledTimes(1);
    expect(lsq.createOrUpdateLead).not.toHaveBeenCalled();
    expect(lsq.bulkCreateOrUpdateLeads.mock.calls[0][0]).toHaveLength(3);
    expect(r).toEqual({ pushed: 3, failed: 0, skipped: 0 });
  });

  it('sends FirstName and LastName separately', async () => {
    db.contact.findMany.mockResolvedValue([mkContact(1)]);
    await pushEngagementActivities('c1', [{ contactId: 'ct1', stage: 'No-show' }]);
    const fields = lsq.bulkCreateOrUpdateLeads.mock.calls[0][0][0];
    expect(fields).toContainEqual({ Attribute: 'FirstName', Value: 'User' });
    expect(fields).toContainEqual({ Attribute: 'LastName', Value: '1 Surname' });
  });

  it('skips contacts that already have a lead id (no lead upsert needed)', async () => {
    db.contact.findMany.mockResolvedValue([mkContact(1, { lsqLeadId: 'EXIST' })]);
    await pushEngagementActivities('c1', [{ contactId: 'ct1', stage: 'Attended' }]);
    expect(lsq.bulkCreateOrUpdateLeads).not.toHaveBeenCalled();
    expect(lsq.pushCustomActivities.mock.calls[0][0][0].RelatedProspectId).toBe('EXIST');
  });

  it('is idempotent: re-importing the same attendance posts nothing the second time', async () => {
    db.contact.findMany.mockResolvedValue([mkContact(1, { lsqLeadId: 'L' })]);
    const entries = [{ contactId: 'ct1', stage: 'Attended' as const }];
    expect(await pushEngagementActivities('c1', entries)).toEqual({ pushed: 1, failed: 0, skipped: 0 });
    expect(await pushEngagementActivities('c1', entries)).toEqual({ pushed: 0, failed: 0, skipped: 1 });
    expect(lsq.pushCustomActivities).toHaveBeenCalledTimes(1);
  });

  it('treats Attended and No-show as distinct activities for the same contact', async () => {
    db.contact.findMany.mockResolvedValue([mkContact(1, { lsqLeadId: 'L' })]);
    await pushEngagementActivities('c1', [{ contactId: 'ct1', stage: 'No-show' }]);
    const r = await pushEngagementActivities('c1', [{ contactId: 'ct1', stage: 'Attended' }]);
    expect(r.pushed).toBe(1);
  });

  it('releases claims and raises an attention item when the push fails outright, so a retry can post', async () => {
    db.contact.findMany.mockResolvedValue([mkContact(1, { lsqLeadId: 'L' })]);
    lsq.pushCustomActivities.mockRejectedValueOnce(new Error('LSQ down'));
    const r = await pushEngagementActivities('c1', [{ contactId: 'ct1', stage: 'Attended' }]);
    expect(r).toEqual({ pushed: 0, failed: 1, skipped: 0 });
    expect(upsertAttentionItem).toHaveBeenCalled();
    expect(claims.size).toBe(0);
    expect((await pushEngagementActivities('c1', [{ contactId: 'ct1', stage: 'Attended' }])).pushed).toBe(1);
  });

  it('on a partial failure keeps the claims of activities that landed and releases only the rest', async () => {
    db.contact.findMany.mockResolvedValue([mkContact(1, { lsqLeadId: 'A' }), mkContact(2, { lsqLeadId: 'B' }), mkContact(3, { lsqLeadId: 'C' })]);
    lsq.pushCustomActivities.mockRejectedValueOnce(new lsq.PartialActivityPushError(2, new Error('chunk 2 failed')));
    const r = await pushEngagementActivities('c1', [1, 2, 3].map((i) => ({ contactId: `ct${i}`, stage: 'Attended' as const })));
    expect(r).toEqual({ pushed: 2, failed: 1, skipped: 0 });
    expect([...claims].sort()).toEqual(['lsq-engagement:c1|ct1|Attended', 'lsq-engagement:c1|ct2|Attended']);
  });

  it('counts a row the bulk endpoint rejected as failed and releases only that claim', async () => {
    db.contact.findMany.mockResolvedValue([mkContact(1), mkContact(2)]);
    lsq.bulkCreateOrUpdateLeads.mockResolvedValueOnce([
      { RowNumber: 0, LeadId: 'L0', LeadCreated: true, LeadUpdated: false, AffectedRows: 1 },
      { RowNumber: 1, LeadId: '', LeadCreated: false, LeadUpdated: false, AffectedRows: 0, ExceptionType: 'MXInvalidInputException' },
    ]);
    const r = await pushEngagementActivities('c1', [1, 2].map((i) => ({ contactId: `ct${i}`, stage: 'Attended' as const })));
    expect(r).toEqual({ pushed: 1, failed: 1, skipped: 0 });
    expect([...claims]).toEqual(['lsq-engagement:c1|ct1|Attended']);
  });

  it('counts contacts without an email as failed without claiming anything', async () => {
    db.contact.findMany.mockResolvedValue([mkContact(1, { email: null })]);
    const r = await pushEngagementActivities('c1', [{ contactId: 'ct1', stage: 'Attended' }]);
    expect(r).toEqual({ pushed: 0, failed: 1, skipped: 0 });
    expect(claims.size).toBe(0);
  });

  it('handles a deleted campaign without throwing', async () => {
    db.campaign.findUnique.mockResolvedValue(null);
    expect(await pushEngagementActivities('gone', [{ contactId: 'ct1', stage: 'Attended' }])).toEqual({ pushed: 0, failed: 1, skipped: 0 });
  });
});

describe('postWebinarRegistrationActivity', () => {
  beforeEach(() => {
    db.contact.findUnique.mockResolvedValue(mkContact(1));
  });

  it('posts once per (campaign, contact): a webhook redelivery is a no-op', async () => {
    const first = await postWebinarRegistrationActivity('c1', 'ct1', 'email');
    const second = await postWebinarRegistrationActivity('c1', 'ct1', 'email');
    expect(first.ok && !first.skipped).toBe(true);
    expect(second).toMatchObject({ ok: true, skipped: true, duplicate: true });
    expect(lsq.pushCustomActivities).toHaveBeenCalledTimes(1);
  });

  it('releases the claim on failure so the next attempt can post', async () => {
    lsq.pushCustomActivities.mockRejectedValueOnce(new Error('503'));
    expect((await postWebinarRegistrationActivity('c1', 'ct1', 'email')).ok).toBe(false);
    expect(claims.size).toBe(0);
    expect((await postWebinarRegistrationActivity('c1', 'ct1', 'email')).ok).toBe(true);
  });

  it("waits for the in-flight Zoom sync and records the contact's PERSONAL join link", async () => {
    let finishZoom!: () => void;
    const zoom = new Promise<void>((res) => (finishZoom = res)).then(() => {
      db.contact.findUnique.mockResolvedValue(mkContact(1, { zoomJoinUrl: 'https://zoom.us/w/123?tk=PERSONAL', zoomRegistrantId: 'r1' }));
    });
    trackInflight(zoomRegistrantKey('ct1'), zoom);

    const pending = postWebinarRegistrationActivity('c1', 'ct1', 'email');
    await new Promise((r) => setTimeout(r, 20));
    expect(lsq.pushCustomActivities).not.toHaveBeenCalled(); // still waiting on Zoom
    finishZoom();
    await pending;

    const activity = lsq.pushCustomActivities.mock.calls[0][0][0];
    expect(activity.Fields.find((f: { SchemaName: string }) => f.SchemaName === 'mx_Custom_4').Value).toBe('https://zoom.us/w/123?tk=PERSONAL');
  });

  it('falls back to the generic link when the contact has no personal one', async () => {
    await postWebinarRegistrationActivity('c1', 'ct1', 'email');
    const f = lsq.pushCustomActivities.mock.calls[0][0][0].Fields;
    expect(f.find((x: { SchemaName: string }) => x.SchemaName === 'mx_Custom_4').Value).toBe('https://zoom.us/generic');
  });

  it('writes the registration time in LeadSquared format, not ISO-8601', async () => {
    await postWebinarRegistrationActivity('c1', 'ct1', 'email');
    const f = lsq.pushCustomActivities.mock.calls[0][0][0].Fields;
    expect(f.find((x: { SchemaName: string }) => x.SchemaName === 'mx_Custom_6').Value).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('sets the Zoom-registered flag ONLY when a field name is configured and the contact has a Zoom registration', async () => {
    db.contact.findUnique.mockResolvedValue(mkContact(1, { lsqLeadId: 'EXIST', zoomRegistrantId: 'r1', zoomJoinUrl: 'https://zoom.us/w/1?tk=a' }));
    await postWebinarRegistrationActivity('c1', 'ct1', 'email');
    expect(lsq.createOrUpdateLead).not.toHaveBeenCalled(); // not configured -> never invent a field

    claims.clear();
    process.env.LSQ_ZOOM_REGISTERED_FIELD = 'mx_Zoom_Registered';
    await postWebinarRegistrationActivity('c1', 'ct1', 'email');
    expect(lsq.createOrUpdateLead.mock.calls[0][0]).toContainEqual({ Attribute: 'mx_Zoom_Registered', Value: 'true' });
  });

  it('ignores an invalid configured flag name rather than sending it to LeadSquared', async () => {
    process.env.LSQ_ZOOM_REGISTERED_FIELD = 'not a field!';
    db.contact.findUnique.mockResolvedValue(mkContact(1, { zoomRegistrantId: 'r1' }));
    await postWebinarRegistrationActivity('c1', 'ct1', 'email');
    const sent = lsq.createOrUpdateLead.mock.calls[0][0] as Array<{ Attribute: string }>;
    expect(sent.some((f) => f.Attribute === 'not a field!')).toBe(false);
  });
});
