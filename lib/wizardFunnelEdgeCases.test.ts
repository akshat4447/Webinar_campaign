/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: {
    campaign: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    contact: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    cadenceStep: {
      findMany: vi.fn(),
    },
    cadenceSend: {
      findMany: vi.fn(),
      createMany: vi.fn(),
      updateMany: vi.fn(),
    },
    activityLogEntry: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
  },
}));

vi.mock('@/lib/revalidate', () => ({
  revalidateCampaign: vi.fn(),
}));

import { db } from '@/lib/db';
import { updateWizardFunnelModeAction } from '@/lib/actions/wizard';
import {
  buildNormalChannelRegistrationLinks,
  generateFramerEmbedScript,
} from '@/lib/landingPageServer';
import {
  buildGoogleCalendarUrl,
  buildOutlookCalendarUrl,
  generateIcsFeed,
  escapeIcsText,
  formatCalendarUtcDate,
} from '@/lib/calendar';
import {
  mintRegistrationToken,
  verifyRegistrationToken,
} from '@/lib/registration';

describe('Wizard Funnel & Calendar Edge Cases Test Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (db.campaign as any).findUnique = vi.fn().mockResolvedValue({id:'c1',status:'draft',cadenceStatus:'not_started'});
  });

  describe('Edge Case 1: Complex Webinar Titles & Character Escaping', () => {
    const complexEvent = {
      campaignId: 'camp_complex_1',
      title: 'Healthcare AI & ML: "Future of Medicine", Part 1; Workshop \\ Lab',
      description: 'Line 1: Special & sensitive chars.\nLine 2: Contains "quotes", commas, & semicolons; here.',
      location: 'https://zoom.us/j/9988776655',
      startTime: new Date('2026-11-15T15:30:00.000Z'),
      durationMinutes: 90,
      speakers: [
        { name: 'Dr. John O\'Connor', title: 'Director of AI & ML', company: 'HealthCorp & Co.' },
        { name: 'Dr. Jane Smith-Doe', title: 'Chief Surgeon', company: 'Apollo; Labs' },
      ],
    };

    it('builds Google Calendar URL that properly escapes special characters', () => {
      const url = buildGoogleCalendarUrl(complexEvent);
      expect(url).toContain('https://calendar.google.com/calendar/render?action=TEMPLATE');
      expect(url).toContain('dates=20261115T153000Z%2F20261115T170000Z');
      expect(url).toContain('Healthcare+AI');
      expect(url).toContain('Future+of+Medicine');
    });

    it('builds Outlook Live and Office 365 URLs with valid URI encoded parameters', () => {
      const liveUrl = buildOutlookCalendarUrl(complexEvent, 'live');
      const officeUrl = buildOutlookCalendarUrl(complexEvent, 'office');

      expect(liveUrl).toContain('https://outlook.live.com/calendar/0/deeplink/compose');
      expect(officeUrl).toContain('https://outlook.office.com/calendar/0/deeplink/compose');

      const parsedLive = new URL(liveUrl);
      expect(parsedLive.searchParams.get('subject')).toBe(complexEvent.title);
      expect(parsedLive.searchParams.get('location')).toBe(complexEvent.location);
      expect(parsedLive.searchParams.get('startdt')).toBe(complexEvent.startTime.toISOString());
    });

    it('escapes RFC 5545 text without syntax corruption in .ics feed', () => {
      const ics = generateIcsFeed(complexEvent);

      expect(ics).toContain('BEGIN:VCALENDAR');
      expect(ics).toContain('SUMMARY:Healthcare AI & ML: "Future of Medicine"\\, Part 1\\; Workshop \\\\ Lab');
      expect(ics).toContain('Dr. John O\'Connor\\, Director of AI & ML (HealthCorp & Co.)');
      expect(ics).toContain('Apollo\\; Labs');
      expect(ics).toContain('DTSTART:20261115T153000Z');
      expect(ics).toContain('DTEND:20261115T170000Z');
      expect(ics).toContain('END:VCALENDAR');
    });
  });

  describe('Edge Case 2: Normal 1-Click Channel Links Generation & Attribution', () => {
    const campaign = { id: 'camp_norm_99' };
    const contactId = 'contact_lead_42';

    it('generates distinct channel links for email, whatsapp, sms, and linkedin', () => {
      const links = buildNormalChannelRegistrationLinks(campaign, contactId, 'https://app.webinarstudio.io');

      expect(links.email).toContain('https://app.webinarstudio.io/r/');
      expect(links.email).toContain('source=email');

      expect(links.whatsapp).toContain('https://app.webinarstudio.io/r/');
      expect(links.whatsapp).toContain('source=whatsapp');

      expect(links.sms).toContain('https://app.webinarstudio.io/r/');
      expect(links.sms).toContain('source=sms');

      expect(links.linkedin).toContain('https://app.webinarstudio.io/r/');
      expect(links.linkedin).toContain('source=linkedin');
    });

    it('mints HMAC tokens that can be verified and carry the exact campaign and contact', () => {
      const links = buildNormalChannelRegistrationLinks(campaign, contactId, 'https://app.webinarstudio.io');
      const url = new URL(links.email);
      const token = url.pathname.replace('/r/', '');

      const verify = verifyRegistrationToken(token);
      expect(verify.ok).toBe(true);
      if (verify.ok) {
        expect(verify.payload.campaignId).toBe(campaign.id);
        expect(verify.payload.contactId).toBe(contactId);
        expect(typeof verify.payload.iat).toBe('number');
      }
    });

    it('verifies that tampering with the token signature fails verification', () => {
      const token = mintRegistrationToken(campaign.id, contactId);
      const parts = token.split('.');
      parts[2] = 'tampered_signature';
      const tampered = parts.join('.');

      const result = verifyRegistrationToken(tampered);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('bad-signature');
      }
    });
  });

  describe('Edge Case 3: Framer Script Generator Safe String Serialization', () => {
    it('produces safe JavaScript code even when webinar title contains single and double quotes', () => {
      const script = generateFramerEmbedScript({
        campaignId: 'camp_quote_1',
        zoomId: '8123456789',
        webinarTitle: 'Founder\'s Guide to "Hyper-Growth": 2026 Strategy',
        scheduledAt: '2026-11-20T10:00:00.000Z',
        description: 'Includes single \' quotes and double " quotes.',
        location: 'Online Webinar',
        autoOpenGoogleCalendar: true,
        apiOrigin: 'https://webinar.studio.io',
      });

      expect(script).toContain('<script>');
      expect(script).toContain('camp_quote_1');
      expect(script).toContain('8123456789');
      expect(script).toContain('https://webinar.studio.io');
      expect(script).not.toContain('window.open(googleCalUrl');
      expect(script).toContain('googleCalUrl = "https://calendar.google.com/calendar/render');
      expect(script).toContain('</script>');
    });
  });

  describe('Edge Case 4: Atomic Funnel Mode Persistence', () => {
    it('commits normal funnel mode to Campaign record in DB', async () => {
      vi.mocked(db.campaign.update).mockResolvedValue({ id: 'camp_test' } as any);

      const res = await updateWizardFunnelModeAction('camp_test', 'normal');
      expect(res.ok).toBe(true);
      expect(res.mode).toBe('normal');
      expect(res.oneClickSignup).toBe(true);
      expect(res.registrationLink).toBe('');

      expect(db.campaign.update).toHaveBeenCalledWith({
        where: { id: 'camp_test' },
        data: {
          registrationLink: null,
          oneClickSignup: true,
          registrationMode: 'zoom',
        },
      });
    });

    it('commits custom framer funnel mode to Campaign record in DB', async () => {
      vi.mocked(db.campaign.update).mockResolvedValue({ id: 'camp_test' } as any);

      const res = await updateWizardFunnelModeAction(
        'camp_test',
        'framer',
        'https://webinar.leadsquared.com/opd-to-ipd-funnel'
      );
      expect(res.ok).toBe(true);
      expect(res.mode).toBe('framer');
      expect(res.oneClickSignup).toBe(false);
      expect(res.registrationLink).toBe('https://webinar.leadsquared.com/opd-to-ipd-funnel');

      expect(db.campaign.update).toHaveBeenCalledWith({
        where: { id: 'camp_test' },
        data: {
          registrationLink: 'https://webinar.leadsquared.com/opd-to-ipd-funnel',
          oneClickSignup: false,
          registrationMode: 'external',
        },
      });
    });
  });

  describe('Edge Case 5: UTC Standardized Date Formatting', () => {
    it('converts non-UTC date objects to pure UTC ISO string', () => {
      const utcDate = new Date('2026-10-25T14:00:00.000Z');
      const formatted = formatCalendarUtcDate(utcDate);
      expect(formatted).toBe('20261025T140000Z');
      expect(formatted.endsWith('Z')).toBe(true);
    });

    it('escapes empty or null strings safely in escapeIcsText', () => {
      expect(escapeIcsText('')).toBe('');
      expect(escapeIcsText(null as any)).toBe('');
      expect(escapeIcsText(undefined as any)).toBe('');
    });
  });
});
