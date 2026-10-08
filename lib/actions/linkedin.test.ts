import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  markLinkedInSendAction,
  getLinkedInToolEventsAction,
  getLinkedInToolQueueAction,
} from './linkedin';
import { db } from '@/lib/db';

vi.mock('@/lib/db', () => ({
  db: {
    contact: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
    },
    campaign: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    cadenceStep: {
      findMany: vi.fn(),
    },
    cadenceSend: {
      upsert: vi.fn(),
      findMany: vi.fn(),
      groupBy: vi.fn(),
    },
    personalizedMessage: {
      findMany: vi.fn(),
    },
    activityLogEntry: {
      create: vi.fn(),
    },
  },
}));

vi.mock('@/lib/revalidate', () => ({
  revalidateCampaign: vi.fn(),
}));

vi.mock('@/lib/sendGuard', () => ({
  getSendMode: vi.fn().mockResolvedValue('sandbox'),
}));

vi.mock('@/lib/integrationConfig', () => ({
  resolveIntegrationField: vi.fn().mockResolvedValue(''),
}));

vi.mock('@/lib/messageTemplates', () => ({
  resolveStepTemplate: vi.fn().mockResolvedValue({
    body: 'Hi {{firstName}} - Join us for {{topic}} on {{date}}! {{link}}',
  }),
}));

vi.mock('@/lib/speakers', () => ({
  formatSpeakersSummary: vi.fn().mockReturnValue('Dr. Jane Doe'),
}));

describe('markLinkedInSendAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fails if contact does not exist', async () => {
    vi.mocked(db.contact.findUnique).mockResolvedValue(null);
    const res = await markLinkedInSendAction('camp-1', 'non-existent', 'sent');
    expect(res.ok).toBe(false);
    expect(res.error).toBe('Contact no longer exists.');
  });

  it('upserts CadenceSend row as sent when confirmed', async () => {
    vi.mocked(db.contact.findUnique).mockResolvedValue({ id: 'c-1' } as unknown as Awaited<ReturnType<typeof db.contact.findUnique>>);
    vi.mocked(db.cadenceSend.upsert).mockResolvedValue({} as unknown as Awaited<ReturnType<typeof db.cadenceSend.upsert>>);

    const res = await markLinkedInSendAction('camp-1', 'c-1', 'sent');
    expect(res.ok).toBe(true);
    expect(db.cadenceSend.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          campaignId_contactId_stepKey: {
            campaignId: 'camp-1',
            contactId: 'c-1',
            stepKey: 'linkedin',
          },
        },
        update: expect.objectContaining({ status: 'sent' }),
      })
    );
  });
});

describe('getLinkedInToolEventsAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('aggregates event summaries with accurate send and pending counts', async () => {
    vi.mocked(db.campaign.findMany).mockResolvedValue([
      {
        id: 'camp-1',
        name: 'Healthcare AI Webinar',
        date: '2026-11-15T10:00:00Z',
        status: 'draft',
        cadenceStatus: 'idle',
      },
    ] as unknown as Awaited<ReturnType<typeof db.campaign.findMany>>);

    vi.mocked(db.cadenceStep.findMany).mockResolvedValue([
      { campaignId: 'camp-1' },
    ] as unknown as Awaited<ReturnType<typeof db.cadenceStep.findMany>>);

    vi.mocked(db.contact.groupBy).mockResolvedValue([
      { campaignId: 'camp-1', _count: 10 },
    ] as unknown as Awaited<ReturnType<typeof db.contact.groupBy>>);

    vi.mocked(db.cadenceSend.groupBy).mockResolvedValue([
      { campaignId: 'camp-1', status: 'sent', _count: 4 },
      { campaignId: 'camp-1', status: 'skipped', _count: 1 },
    ] as unknown as Awaited<ReturnType<typeof db.cadenceSend.groupBy>>);

    const res = await getLinkedInToolEventsAction();
    expect(res.ok).toBe(true);
    expect(res.events).toHaveLength(1);
    const ev = res.events[0];
    expect(ev.id).toBe('camp-1');
    expect(ev.name).toBe('Healthcare AI Webinar');
    expect(ev.hasLinkedInStep).toBe(true);
    expect(ev.totalApproved).toBe(10);
    expect(ev.sentCount).toBe(4);
    expect(ev.skippedCount).toBe(1);
    expect(ev.pendingCount).toBe(5);
    expect(ev.percentComplete).toBe(50);
  });
});

describe('getLinkedInToolQueueAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns formatted queue with AI drafts and resolved URLs', async () => {
    vi.mocked(db.campaign.findUnique).mockResolvedValue({
      id: 'camp-1',
      name: 'Cloud Tech',
      date: '2026-11-20',
      oneClickSignup: true,
      registrationLink: null,
      zoomLink: null,
      speakers: [],
    } as unknown as Awaited<ReturnType<typeof db.campaign.findUnique>>);

    vi.mocked(db.contact.findMany).mockResolvedValue([
      {
        id: 'c-1',
        name: 'Satya Nadella',
        title: 'CEO',
        account: 'Microsoft',
        score: 95,
        seniority: 'Executive',
        function: 'Management',
        linkedinId: 'satyanadella',
        linkedinCheckStatus: 'verified',
        linkedinCheckNote: 'Title verified via Apollo',
      },
    ] as unknown as Awaited<ReturnType<typeof db.contact.findMany>>);

    vi.mocked(db.personalizedMessage.findMany).mockResolvedValue([
      {
        contactId: 'c-1',
        body: 'Hi Satya - saw Microsoft leading on AI Cloud. Would love to have you at Cloud Tech: https://test.app/r/token?source=linkedin',
      },
    ] as unknown as Awaited<ReturnType<typeof db.personalizedMessage.findMany>>);

    vi.mocked(db.cadenceSend.findMany).mockResolvedValue([]);

    const res = await getLinkedInToolQueueAction('camp-1');
    expect(res.ok).toBe(true);
    expect(res.participants).toHaveLength(1);
    const p = res.participants[0];
    expect(p.name).toBe('Satya Nadella');
    expect(p.slug).toBe('satyanadella');
    expect(p.destinationKind).toBe('profile');
    expect(p.destinationUrl).toBe('https://www.linkedin.com/in/satyanadella');
    expect(p.status).toBe('pending');
    expect(p.personalized).toBe(true);
    expect(p.message).toContain('Hi Satya');
    expect(res.counts.total).toBe(1);
    expect(res.counts.pending).toBe(1);
    expect(res.counts.sent).toBe(0);
  });
});
