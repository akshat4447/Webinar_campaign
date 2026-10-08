/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: {
    campaign: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    contact: {
      findFirst: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    emailSuppression: {
      upsert: vi.fn(),
    },
    cadenceSend: {
      updateMany: vi.fn(),
    },
    appSetting: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
    },
  },
}));

vi.mock('@/lib/registerContact', () => ({
  registerContact: vi.fn(),
}));

vi.mock('@/lib/leadsquared', () => ({
  getLeadById: vi.fn(),
}));

import { db } from '@/lib/db';
import { registerContact } from '@/lib/registerContact';
import { POST, GET, HEAD } from './route';

const mockRegisterSuccess = {
  ok: true as const,
  alreadyRegistered: false,
  joinUrl: 'https://zoom.us/j/12345',
  campaignName: 'LeadSquared AI Webinar',
  campaignId: 'test-lsq-wh-campaign',
  scheduledAt: new Date('2026-10-15T14:00:00Z'),
  queued: 1,
};

const mockRegisterAlready = {
  ok: true as const,
  alreadyRegistered: true,
  joinUrl: 'https://zoom.us/j/12345',
  campaignName: 'LeadSquared AI Webinar',
  campaignId: 'test-lsq-wh-campaign',
  scheduledAt: new Date('2026-10-15T14:00:00Z'),
  queued: 0,
};

describe('LeadSquared Inbound Activity Webhook (/api/webhooks/leadsquared/activity)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('handles HEAD requests with 200 OK for LeadSquared verification', async () => {
    const res = await HEAD();
    expect(res.status).toBe(200);
  });

  it('handles GET requests with endpoint status and info', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.endpoint).toBe('/api/webhooks/leadsquared/activity');
  });

  it('processes single LeadSquared Automation "Call Webhook" registration and cancels pending outreach', async () => {
    vi.mocked(db.campaign.findUnique).mockResolvedValue({
      id: 'test-lsq-wh-campaign',
      name: 'LeadSquared AI Webinar',
    } as any);

    vi.mocked(db.contact.findFirst).mockResolvedValue({
      id: 'contact-lsq-1',
      campaignId: 'test-lsq-wh-campaign',
      email: 'prospect.lsq@enterprise.com',
      name: 'Prospect LSQ',
      lsqLeadId: 'lsq-lead-uuid-1234',
    } as any);

    vi.mocked(registerContact).mockResolvedValue(mockRegisterSuccess);

    const payload = {
      EmailAddress: 'prospect.lsq@enterprise.com',
      ProspectID: 'lsq-lead-uuid-1234',
      ActivityEvent: 3844,
      ActivityName: 'Webinar Registration',
      CampaignId: 'test-lsq-wh-campaign',
    };

    const req = new Request('http://localhost:3000/api/webhooks/leadsquared/activity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.ok).toBe(true);
    expect(data.newRegistrations).toBe(1);
    expect(data.results[0].status).toBe('registered');

    expect(registerContact).toHaveBeenCalledWith(
      'test-lsq-wh-campaign',
      'contact-lsq-1',
      'leadsquared',
      undefined
    );
  });

  it('processes batched array of activities from LeadActivity_Post_Create', async () => {
    vi.mocked(db.campaign.findUnique).mockResolvedValue({
      id: 'test-lsq-wh-campaign',
      name: 'LeadSquared AI Webinar',
    } as any);

    vi.mocked(db.contact.findFirst)
      .mockResolvedValueOnce({
        id: 'contact-lsq-1',
        campaignId: 'test-lsq-wh-campaign',
        email: 'prospect.lsq@enterprise.com',
        lsqLeadId: 'lsq-lead-uuid-1234',
      } as any)
      .mockResolvedValueOnce({
        id: 'contact-lsq-2',
        campaignId: 'test-lsq-wh-campaign',
        email: 'second.lead@enterprise.com',
        lsqLeadId: null,
      } as any);

    vi.mocked(registerContact).mockResolvedValue(mockRegisterSuccess);

    const payload = [
      {
        EmailAddress: 'prospect.lsq@enterprise.com',
        RelatedProspectId: 'lsq-lead-uuid-1234',
        CampaignId: 'test-lsq-wh-campaign',
      },
      {
        EmailAddress: 'second.lead@enterprise.com',
        CampaignId: 'test-lsq-wh-campaign',
      },
    ];

    const req = new Request('http://localhost:3000/api/webhooks/leadsquared/activity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.ok).toBe(true);
    expect(data.received).toBe(2);
    expect(data.newRegistrations).toBe(2);
    expect(registerContact).toHaveBeenCalledTimes(2);
  });

  it('resolves campaign and contact from LeadSquared custom Fields array schema', async () => {
    vi.mocked(db.campaign.findUnique).mockResolvedValue(null);
    vi.mocked(db.campaign.findFirst).mockResolvedValue({
      id: 'test-lsq-wh-campaign',
      name: 'LeadSquared AI Webinar',
    } as any);

    vi.mocked(db.contact.findFirst).mockResolvedValue({
      id: 'contact-lsq-1',
      campaignId: 'test-lsq-wh-campaign',
      email: 'prospect.lsq@enterprise.com',
      lsqLeadId: 'lsq-lead-uuid-1234',
    } as any);

    vi.mocked(registerContact).mockResolvedValue(mockRegisterSuccess);

    const payload = {
      RelatedProspectId: 'lsq-lead-uuid-1234',
      Fields: [
        { SchemaName: 'EmailAddress', Value: 'prospect.lsq@enterprise.com' },
        { SchemaName: 'mx_Custom_1', Value: 'LeadSquared AI Webinar' },
      ],
    };

    const req = new Request('http://localhost:3000/api/webhooks/leadsquared/activity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.ok).toBe(true);
    expect(data.newRegistrations).toBe(1);
    expect(data.results[0].status).toBe('registered');
  });

  it('is idempotent: duplicate webhook delivery does not re-register or duplicate reminders', async () => {
    vi.mocked(db.campaign.findUnique).mockResolvedValue({
      id: 'test-lsq-wh-campaign',
      name: 'LeadSquared AI Webinar',
    } as any);

    vi.mocked(db.contact.findFirst).mockResolvedValue({
      id: 'contact-lsq-1',
      campaignId: 'test-lsq-wh-campaign',
      email: 'prospect.lsq@enterprise.com',
      lsqLeadId: 'lsq-lead-uuid-1234',
    } as any);

    vi.mocked(registerContact)
      .mockResolvedValueOnce(mockRegisterSuccess)
      .mockResolvedValueOnce(mockRegisterAlready);

    const payload = {
      EmailAddress: 'prospect.lsq@enterprise.com',
      CampaignId: 'test-lsq-wh-campaign',
    };

    // First call
    const req1 = new Request('http://localhost:3000/api/webhooks/leadsquared/activity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const res1 = await POST(req1);
    const data1 = await res1.json();
    expect(data1.newRegistrations).toBe(1);

    // Duplicate call
    const req2 = new Request('http://localhost:3000/api/webhooks/leadsquared/activity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const res2 = await POST(req2);
    const data2 = await res2.json();

    expect(data2.newRegistrations).toBe(0);
    expect(data2.alreadyRegistered).toBe(1);
    expect(data2.results[0].status).toBe('already-registered');
  });

  it('processes opt-out / unsubscribe activity by adding to suppression and unapproving contact', async () => {
    vi.mocked(db.campaign.findUnique).mockResolvedValue({
      id: 'test-lsq-wh-campaign',
      name: 'LeadSquared AI Webinar',
    } as any);

    vi.mocked(db.contact.findFirst).mockResolvedValue({
      id: 'test-contact-1',
      campaignId: 'test-lsq-wh-campaign',
      email: 'prospect.lsq@enterprise.com',
      lsqLeadId: 'lead-lsq-999',
    } as any);

    vi.mocked(db.contact.update).mockResolvedValue({} as any);
    vi.mocked(db.emailSuppression.upsert).mockResolvedValue({} as any);
    vi.mocked(db.cadenceSend.updateMany).mockResolvedValue({ count: 1 } as any);

    const payload = {
      ActivityEvent: 201,
      ActivityEventName: 'Lead Opted Out',
      EmailAddress: 'prospect.lsq@enterprise.com',
      CampaignId: 'test-lsq-wh-campaign',
    };

    const req = new Request('http://localhost:3000/api/webhooks/leadsquared/activity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.results[0].status).toBe('suppressed');
  });

  it('auto-creates inbound contact and registers them when contact is not pre-imported', async () => {
    vi.mocked(db.campaign.findUnique).mockResolvedValue({
      id: 'test-lsq-wh-campaign',
      name: 'LeadSquared AI Webinar',
      vertical: 'Healthcare',
    } as any);

    // Contact not initially found in DB
    vi.mocked(db.contact.findFirst).mockResolvedValue(null);

    // Contact creation mock
    vi.mocked(db.contact.create).mockResolvedValue({
      id: 'new-inbound-contact-99',
      campaignId: 'test-lsq-wh-campaign',
      name: 'Dr. Jane Smith',
      email: 'dr.jane@apollohealth.org',
      lsqLeadId: 'lead-lsq-new-456',
    } as any);

    vi.mocked(registerContact).mockResolvedValue({
      ok: true,
      alreadyRegistered: false,
      joinUrl: 'https://zoom.us/j/99999',
      campaignName: 'LeadSquared AI Webinar',
      campaignId: 'test-lsq-wh-campaign',
      scheduledAt: new Date('2026-10-15T14:00:00Z'),
      queued: 2,
    });

    const payload = {
      EmailAddress: 'dr.jane@apollohealth.org',
      FirstName: 'Dr. Jane',
      LastName: 'Smith',
      Company: 'Apollo Health',
      JobTitle: 'Medical Director',
      ProspectID: 'lead-lsq-new-456',
      CampaignId: 'test-lsq-wh-campaign',
      ActivityName: 'Webinar Form Submitted',
    };

    const req = new Request('http://localhost:3000/api/webhooks/leadsquared/activity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.ok).toBe(true);
    expect(data.newRegistrations).toBe(1);
    expect(data.results[0].status).toBe('registered');

    expect(db.contact.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        campaignId: 'test-lsq-wh-campaign',
        email: 'dr.jane@apollohealth.org',
        name: 'Dr. Jane Smith',
        account: 'Apollo Health',
        title: 'Medical Director',
        score: null,
        approved: true,
        lsqLeadId: 'lead-lsq-new-456',
      }),
    });

    expect(registerContact).toHaveBeenCalledWith(
      'test-lsq-wh-campaign',
      'new-inbound-contact-99',
      'leadsquared',
      undefined
    );
  });
});
