import { describe, it, expect } from 'vitest';
import {
  buildLandingPageUrl,
  buildChannelTrackingLinks,
  buildNormalChannelRegistrationLinks,
  generateFramerEmbedScript,
} from './landingPageServer';
import { verifyRegistrationToken } from './registration';
import { generateUniversalEmbedScript } from './landingPage';

describe('lib/landingPage', () => {
  const campaign = {
    id: 'camp_123',
    name: 'OPD to IPD Funnel Webinar',
    zoomMeetingId: '81234567891',
  };

  const contact = {
    id: 'cont_456',
    name: 'Dr. Ananya Roy',
    email: 'ananya@apollohospitals.com',
    phone: '+919876543210',
    account: 'Apollo Hospitals',
    title: 'Medical Director',
  };

  it('builds a rich dynamic landing page URL with tokens and UTM attribution', () => {
    const rawUrl = 'https://webinar.leadsquared.com/opd-to-ipd-funnel';
    const url = buildLandingPageUrl({
      landingPageUrl: rawUrl,
      campaign,
      contact,
      channel: 'email',
      apiOrigin: 'https://webinar.studio.io',
    });

    const parsed = new URL(url);
    expect(parsed.origin).toBe('https://webinar.leadsquared.com');
    expect(parsed.pathname).toBe('/opd-to-ipd-funnel');
    expect(parsed.searchParams.get('FirstName')).toBe('Dr.');
    expect(parsed.searchParams.get('LastName')).toBe('Ananya Roy');
    expect(parsed.searchParams.get('EmailAddress')).toBe('ananya@apollohospitals.com');
    expect(parsed.searchParams.get('Phone')).toBe('+919876543210');
    expect(parsed.searchParams.get('Company')).toBe('Apollo Hospitals');
    expect(parsed.searchParams.get('JobTitle')).toBe('Medical Director');
    expect(parsed.searchParams.get('campaignId')).toBe('camp_123');
    expect(parsed.searchParams.get('zoomId')).toBe('81234567891');
    expect(parsed.searchParams.get('source')).toBe('email');
    expect(parsed.searchParams.get('utm_source')).toBe('email');
    expect(parsed.searchParams.get('utm_medium')).toBe('outreach');
    expect(parsed.searchParams.get('utm_campaign')).toBe('opd-to-ipd-funnel-webinar');
    expect(parsed.searchParams.get('apiOrigin')).toBe('https://webinar.studio.io');

    // Token must be verifiable
    const token = parsed.searchParams.get('token');
    expect(token).toBeTruthy();
    const verified = verifyRegistrationToken(token!);
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.payload.campaignId).toBe('camp_123');
      expect(verified.payload.contactId).toBe('cont_456');
    }
  });

  it('preserves existing query parameters on the target URL', () => {
    const rawUrl = 'https://landing.framer.app/webinar?ref=partner&lang=en';
    const url = buildLandingPageUrl({
      landingPageUrl: rawUrl,
      campaign,
      contact,
      channel: 'whatsapp',
    });

    const parsed = new URL(url);
    expect(parsed.searchParams.get('ref')).toBe('partner');
    expect(parsed.searchParams.get('lang')).toBe('en');
    expect(parsed.searchParams.get('source')).toBe('whatsapp');
    expect(parsed.searchParams.get('FirstName')).toBe('Dr.');
  });

  it('generates multi-channel tracking links for preview', () => {
    const links = buildChannelTrackingLinks(
      'https://webinar.leadsquared.com/opd-to-ipd-funnel',
      campaign,
      contact
    );

    expect(links.email).toContain('source=email');
    expect(links.whatsapp).toContain('source=whatsapp');
    expect(links.sms).toContain('source=sms');
    expect(links.linkedin).toContain('source=linkedin');
  });

  it('generates a valid Framer embed script with configured defaults', () => {
    const script = generateFramerEmbedScript({
      apiOrigin: 'https://webinar.studio.io',
      campaignId: 'camp_123',
      zoomId: '81234567891',
    });

    expect(script).toContain('<script>');
    expect(script).toContain('camp_123');
    expect(script).toContain('81234567891');
    expect(script).toContain('https://webinar.studio.io');
    expect(script).toContain('/api/landing/submit');
    expect(script).toContain('navigator.sendBeacon');
    expect(script).toContain('setReactInputValue');
  });

  it('generates a Framer embed script with calendar integration and submit button auto-calendar', () => {
    const script = generateFramerEmbedScript({
      apiOrigin: 'https://webinar.studio.io',
      campaignId: 'camp_123',
      zoomId: '81234567891',
      webinarTitle: 'OPD to IPD Funnel Masterclass',
      scheduledAt: '2026-10-30T10:00:00.000Z',
      durationMinutes: 60,
      autoOpenGoogleCalendar: true,
    });

    expect(script).toContain('googleCalUrl');
    expect(script).toContain('outlookCalUrl');
    expect(script).toContain('https://calendar.google.com/calendar/render');
    expect(script).toContain('https://outlook.live.com/calendar/0/deeplink/compose');
    expect(script).not.toContain('window.open(googleCalUrl');
    expect(script).toContain('sessionStorage.setItem');
    expect(script).toContain('webinar_attendee');
  });

  it('generates normal channel-wise 1-click registration links with valid tokens and channel source parameters', () => {
    const normalLinks = buildNormalChannelRegistrationLinks(
      campaign,
      'contact_sample_999',
      'https://webinar.studio.io'
    );

    expect(normalLinks.email).toContain('https://webinar.studio.io/r/');
    expect(normalLinks.email).toContain('source=email');
    expect(normalLinks.whatsapp).toContain('source=whatsapp');
    expect(normalLinks.sms).toContain('source=sms');
    expect(normalLinks.linkedin).toContain('source=linkedin');

    // Extract and verify token
    const url = new URL(normalLinks.email);
    const token = url.pathname.replace('/r/', '');
    expect(token).toBeTruthy();
    const verified = verifyRegistrationToken(token);
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.payload.campaignId).toBe('camp_123');
      expect(verified.payload.contactId).toBe('contact_sample_999');
    }
  });
});

describe('embed script security', () => {
  it("never takes the API origin from the page URL (a crafted ?apiOrigin= would exfiltrate visitors' details)", () => {
    for (const platform of ['universal', 'framer', 'wordpress', 'leadsquared', 'webflow'] as const) {
      const script = generateUniversalEmbedScript({ apiOrigin: 'https://studio.example.com', platform });
      expect(script, platform).not.toMatch(/params\.get\(['"]apiOrigin['"]\)/);
      expect(script, platform).toContain('"https://studio.example.com"');
    }
  });
});
