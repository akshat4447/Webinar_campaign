/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: {
    campaign: {
      findUnique: vi.fn(),
    },
    contact: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock('@/lib/registration', () => ({
  verifyRegistrationToken: vi.fn(),
}));

import { db } from '@/lib/db';
import { verifyRegistrationToken } from '@/lib/registration';
import { GET } from '@/app/api/calendar/[campaignId]/route';
import {
  buildGoogleCalendarUrl,
  buildOutlookCalendarUrl,
  buildCalendarUrls,
  generateIcsFeed,
  formatCalendarUtcDate,
  escapeIcsText,
  resolveCalendarDates,
} from '@/lib/calendar';

const CAMPAIGN_ID = 'camp_ics_1';

function req(token?: string, email?: string) {
  let url = `http://localhost:3000/api/calendar/${CAMPAIGN_ID}`;
  const params = new URLSearchParams();
  if (token) params.set('t', token);
  if (email) params.set('email', email);
  const q = params.toString();
  if (q) url += `?${q}`;
  return new Request(url);
}

function ctx() {
  return { params: Promise.resolve({ campaignId: CAMPAIGN_ID }) } as any;
}

describe('Central Calendar Utility (lib/calendar.ts)', () => {
  describe('formatCalendarUtcDate & resolveCalendarDates', () => {
    it('formats UTC ISO basic date string without dashes, colons or milliseconds', () => {
      const d = new Date('2026-10-15T14:30:00.000Z');
      expect(formatCalendarUtcDate(d)).toBe('20261015T143000Z');
    });

    it('throws an error if an invalid date is passed to formatCalendarUtcDate', () => {
      expect(() => formatCalendarUtcDate(new Date('invalid-date'))).toThrow('Invalid Date');
    });

    it('resolves start and end dates with default 60 minute duration', () => {
      const start = new Date('2026-10-20T10:00:00.000Z');
      const { start: resolvedStart, end: resolvedEnd } = resolveCalendarDates(start);
      expect(resolvedStart.toISOString()).toBe('2026-10-20T10:00:00.000Z');
      expect(resolvedEnd.toISOString()).toBe('2026-10-20T11:00:00.000Z');
    });

    it('enforces that end date is after start date even if end date is before start', () => {
      const start = new Date('2026-10-20T10:00:00.000Z');
      const invalidEnd = new Date('2026-10-20T09:00:00.000Z');
      const { end } = resolveCalendarDates(start, invalidEnd, 45);
      expect(end.toISOString()).toBe('2026-10-20T10:45:00.000Z');
    });
  });

  describe('escapeIcsText', () => {
    it('properly escapes backslashes, semicolons, commas, and newlines per RFC 5545', () => {
      const text = 'Hello; world, how are you?\nLine 2 with \\ backslash.';
      const escaped = escapeIcsText(text);
      expect(escaped).toBe('Hello\\; world\\, how are you?\\nLine 2 with \\\\ backslash.');
    });

    it('handles empty or blank string without error', () => {
      expect(escapeIcsText('')).toBe('');
    });
  });

  describe('buildGoogleCalendarUrl', () => {
    it('builds a valid Google Calendar web link with action=TEMPLATE and UTC dates', () => {
      const url = buildGoogleCalendarUrl({
        title: 'Scaling Inpatient Care 2026',
        description: 'Deep dive into modern healthcare funnels.',
        location: 'https://zoom.us/w/987654321',
        startTime: new Date('2026-10-25T15:00:00.000Z'),
        speakers: [
          { name: 'Dr. Ramesh Gupta', title: 'VP of Surgery', company: 'Apollo Health' },
        ],
      });

      expect(url).toContain('https://calendar.google.com/calendar/render');
      expect(url).toContain('action=TEMPLATE');
      expect(url).toContain('text=Scaling+Inpatient+Care+2026');
      expect(url).toContain('dates=20261025T150000Z%2F20261025T160000Z');
      expect(url).toContain('location=https%3A%2F%2Fzoom.us%2Fw%2F987654321');
      expect(url).toContain('Dr.+Ramesh+Gupta');
      expect(url).toContain('Apollo+Health');
    });

    it('handles non-UTC timezone strings by standardizing to UTC in dates param', () => {
      // 2026-10-25 15:30:00 GMT+5:30 (IST) is 10:00:00 UTC
      const istString = '2026-10-25T15:30:00+05:30';
      const url = buildGoogleCalendarUrl({
        title: 'IST Webinar',
        startTime: istString,
      });

      expect(url).toContain('dates=20261025T100000Z%2F20261025T110000Z');
    });
  });

  describe('buildOutlookCalendarUrl', () => {
    it('builds an Outlook Live deep link for consumer accounts', () => {
      const url = buildOutlookCalendarUrl(
        {
          title: 'Quarterly Fintech Review',
          startTime: new Date('2026-11-10T14:00:00.000Z'),
          location: 'https://zoom.us/j/111222',
        },
        'live'
      );

      expect(url).toContain('https://outlook.live.com/calendar/0/deeplink/compose');
      expect(url).toContain('subject=Quarterly+Fintech+Review');
      expect(url).toContain('startdt=2026-11-10T14%3A00%3A00.000Z');
      expect(url).toContain('enddt=2026-11-10T15%3A00%3A00.000Z');
      expect(url).toContain('rru=addevent');
    });

    it('builds an Office 365 deep link for enterprise/work accounts', () => {
      const url = buildOutlookCalendarUrl(
        {
          title: 'Enterprise Architecture Workshop',
          startTime: new Date('2026-11-12T09:00:00.000Z'),
          location: 'https://zoom.us/j/333444',
        },
        'office'
      );

      expect(url).toContain('https://outlook.office.com/calendar/0/deeplink/compose');
      expect(url).toContain('subject=Enterprise+Architecture+Workshop');
      expect(url).toContain('startdt=2026-11-12T09%3A00%3A00.000Z');
      expect(url).toContain('enddt=2026-11-12T10%3A00%3A00.000Z');
    });
  });

  describe('buildCalendarUrls', () => {
    it('compiles all four calendar URLs into a single object', () => {
      const urls = buildCalendarUrls(
        {
          title: 'Product Keynote',
          startTime: new Date('2026-12-01T17:00:00.000Z'),
          campaignId: 'camp-999',
          token: 'signed-token-xyz',
        },
        'https://app.webinarstudio.com'
      );

      expect(urls.google).toContain('calendar.google.com');
      expect(urls.outlookLive).toContain('outlook.live.com');
      expect(urls.outlookOffice).toContain('outlook.office.com');
      expect(urls.ics).toBe('https://app.webinarstudio.com/api/calendar/camp-999?t=signed-token-xyz');
    });
  });

  describe('generateIcsFeed', () => {
    it('produces valid RFC 5545 VCALENDAR payload with VALARM reminder', () => {
      const ics = generateIcsFeed({
        title: 'Global Healthcare Summit; 2026',
        description: 'Session overview\nTopics covered.',
        location: 'https://zoom.us/j/999888',
        startTime: new Date('2026-10-05T12:00:00.000Z'),
        endTime: new Date('2026-10-05T13:00:00.000Z'),
        speakers: [{ name: 'Dr. Jane Smith', title: 'Director', company: 'HealthCorp' }],
        campaignId: 'camp-456',
      });

      expect(ics).toContain('BEGIN:VCALENDAR');
      expect(ics).toContain('VERSION:2.0');
      expect(ics).toContain('BEGIN:VEVENT');
      expect(ics).toContain('SUMMARY:Global Healthcare Summit\\; 2026');
      expect(ics).toContain('DTSTART:20261005T120000Z');
      expect(ics).toContain('DTEND:20261005T130000Z');
      expect(ics).toContain('LOCATION:https://zoom.us/j/999888');
      expect(ics).toContain('Dr. Jane Smith');
      expect(ics).toContain('HealthCorp');
      expect(ics).toContain('BEGIN:VALARM');
      expect(ics).toContain('TRIGGER:-PT15M');
      expect(ics).toContain('END:VALARM');
      expect(ics).toContain('END:VEVENT');
      expect(ics).toContain('END:VCALENDAR');
    });
  });
});

describe('Calendar (.ics) route handler (app/api/calendar/[campaignId]/route.ts)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyRegistrationToken).mockReturnValue({
      ok: true,
      payload: { campaignId: CAMPAIGN_ID, contactId: 'c1' },
    } as any);
  });

  it('rejects a request with no token and no registered email', async () => {
    const res1 = await GET(req(), ctx());
    expect(res1.status).toBe(404);

    vi.mocked(verifyRegistrationToken).mockReturnValueOnce({
      ok: true,
      payload: { campaignId: 'a-different-campaign', contactId: 'c1' },
    } as any);
    const res2 = await GET(req('sometoken'), ctx());
    expect(res2.status).toBe(404);
  });

  it('refuses calendar access from an email address alone',async()=>{const res=await GET(req(undefined,'registered@example.com'),ctx());expect(res.status).toBe(404);});

  it('rejects a campaign that no longer exists', async () => {
    vi.mocked(db.campaign.findUnique).mockResolvedValueOnce(null as any);
    const res = await GET(req('sometoken'), ctx());
    expect(res.status).toBe(404);
  });

  it('lists every speaker in DESCRIPTION, not just the primary one', async () => {
    vi.mocked(db.campaign.findUnique).mockResolvedValueOnce({
      id: CAMPAIGN_ID,
      name: 'AI in Lending',
      description: 'A deep dive on AI underwriting.',
      scheduledAt: new Date('2026-10-01T10:00:00.000Z'),
      date: 'Oct 1, 2026',
      zoomLink: 'https://zoom.us/j/12345',
      registrationLink: null,
      speakerName: 'Dr. Sarah Chen',
      speakerTitle: 'VP of AI',
      speakers: [
        { name: 'Dr. Sarah Chen', title: 'VP of AI', company: 'NeuralScale' },
        { name: 'Alex Rivera', title: 'Chief Risk Officer', company: 'FinCore' },
      ],
    } as any);

    const res = await GET(req('sometoken'), ctx());
    expect(res.status).toBe(200);
    const body = await res.text();

    expect(body).toContain('Dr. Sarah Chen');
    expect(body).toContain('NeuralScale');
    expect(body).toContain('Alex Rivera');
    expect(body).toContain('FinCore');
    expect(body).toContain('DTSTART:20261001T100000Z');
    expect(body).toContain('LOCATION:https://zoom.us/j/12345');
    expect(res.headers.get('Content-Type')).toContain('text/calendar');
  });

  it('falls back to the single legacy speaker when there is no Speaker roster', async () => {
    vi.mocked(db.campaign.findUnique).mockResolvedValueOnce({
      id: CAMPAIGN_ID,
      name: 'Legacy Webinar',
      description: 'A webinar from before multi-speaker support.',
      scheduledAt: new Date('2026-11-01T10:00:00.000Z'),
      date: 'Nov 1, 2026',
      zoomLink: 'https://zoom.us/j/999',
      registrationLink: null,
      speakerName: 'Jordan Lee',
      speakerTitle: 'Founder',
      speakers: [],
    } as any);

    const body = await (await GET(req('sometoken'), ctx())).text();
    expect(body).toContain('Jordan Lee');
    expect(body).toContain('Founder');
  });

  it('escapes RFC 5545 special characters (backslash, semicolon, comma, newline) instead of stripping them', async () => {
    vi.mocked(db.campaign.findUnique).mockResolvedValueOnce({
      id: CAMPAIGN_ID,
      name: 'FinTech & Lending: 2026 Strategy; Workshop',
      description: 'Line 1\nLine 2, with comma; and semicolon.',
      scheduledAt: new Date('2026-09-15T10:00:00.000Z'),
      date: 'Sep 15, 2026',
      zoomLink: 'https://zoom.us/j/111',
      registrationLink: null,
      speakerName: null,
      speakerTitle: null,
      speakers: [],
    } as any);

    const body = await (await GET(req('sometoken'), ctx())).text();
    expect(body).toContain('SUMMARY:FinTech & Lending: 2026 Strategy\\; Workshop');
    expect(body).toContain('Line 1\\nLine 2\\, with comma\\; and semicolon.');
  });
});

// This suite tests calendar rendering; attendee identity and private join URLs are exercised against Postgres.
vi.mock('@/lib/attendee', () => ({ getAttendee: async (token: string | null, campaignId: string) => {
  if (!token) return null;
  const verified = verifyRegistrationToken(token);
  if (!verified.ok || verified.payload.campaignId !== campaignId) return null;
  const campaign = await db.campaign.findUnique({where:{id:campaignId},include:{speakers:{orderBy:{order:'asc'}}}});
  return campaign ? {campaign,contact:{id:'c1'},joinUrl:campaign.zoomLink} : null;
} }));
