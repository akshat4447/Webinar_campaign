import { describe, it, expect } from 'vitest';
import {
  buildChannelTrackingLinks,
  generateUniversalEmbedScript,
  type LandingPlatform,
} from '@/lib/landingPage';
import { parseZoomInput } from '@/lib/zoomParser';
import { CHANNEL_DEFINITIONS, DEFAULT_SELECTED_CHANNELS } from '@/lib/registrationChannels';

describe('LandingPageIntegrationCard Studio Logic', () => {
  const campaign = {
    id: 'camp_demo_studio_123',
    name: 'Healthcare Transformation Webinar',
    zoomMeetingId: '84920491823',
  };

  const landingPageUrl = 'https://webinar.leadsquared.com/healthcare-funnel';

  it('generates segregated links for all 8 channels under LeadSquared merge tag mode', () => {
    const links = buildChannelTrackingLinks(
      landingPageUrl,
      campaign,
      undefined,
      'https://studio.webinar.io',
      'leadsquared'
    );

    expect(links.email).toContain('source=email');
    expect(links.email).toContain('FirstName={{FirstName}}');
    expect(links.email).toContain('EmailAddress={{EmailAddress}}');
    expect(links.email).toContain('campaignId=camp_demo_studio_123');
    expect(links.email).toContain('zoomId=84920491823');

    expect(links.whatsapp).toContain('source=whatsapp');
    expect(links.whatsapp).toContain('FirstName={{FirstName}}');

    expect(links.sms).toContain('source=sms');
    expect(links.linkedin).toContain('source=linkedin');
    expect(links.linkedin_event).toContain('source=linkedin_event');
    expect(links.sdr_sales).toContain('source=sdr_sales');
    expect(links.third_parties).toContain('source=third_parties');
    expect(links.website).toContain('source=website');
  });

  it('generates segregated links for all channels under Netcore merge tag mode', () => {
    const links = buildChannelTrackingLinks(
      landingPageUrl,
      campaign,
      undefined,
      'https://studio.webinar.io',
      'netcore'
    );

    expect(links.email).toContain('source=email');
    expect(links.email).toContain('FirstName=[NAME]');
    expect(links.email).toContain('EmailAddress=[EMAIL]');
    expect(links.whatsapp).toContain('source=whatsapp');
    expect(links.whatsapp).toContain('Phone=[MOBILE]');
    expect(links.sms).toContain('source=sms');
    expect(links.linkedin).toContain('source=linkedin');
    expect(links.linkedin_event).toContain('source=linkedin_event');
  });

  it('generates multi-platform embed scripts tailored for Framer, WordPress, and LeadSquared', () => {
    const platforms: LandingPlatform[] = ['framer', 'wordpress', 'leadsquared', 'webflow', 'universal'];

    for (const plat of platforms) {
      const script = generateUniversalEmbedScript({
        campaignId: campaign.id,
        zoomId: campaign.zoomMeetingId,
        webinarTitle: campaign.name,
        scheduledAt: '2026-10-25T14:00:00Z',
        platform: plat,
        autoOpenGoogleCalendar: true,
      });

      expect(script).toContain('<script>');
      expect(script).toContain('camp_demo_studio_123');
      expect(script).toContain('84920491823');
      expect(script).toContain('setReactInputValue');
      expect(script).toContain('navigator.sendBeacon');
      expect(script).toContain('/api/landing/submit');
      expect(script).toContain('googleCalUrl');
      expect(script).not.toContain('window.open(googleCalUrl');

      if (plat === 'framer') {
        expect(script).toContain('Framer');
      } else if (plat === 'wordpress') {
        expect(script).toContain('WordPress');
      } else if (plat === 'leadsquared') {
        expect(script).toContain('LeadSquared');
      }
    }
  });

  it('correctly parses user pasted Zoom webinar registration links with WN_ slugs and numeric IDs', () => {
    const registrationUrl = 'https://us02web.zoom.us/webinar/register/WN_qR7xK9sTaBcDeFg';
    const parsedReg = parseZoomInput(registrationUrl);
    expect(parsedReg.isValid).toBe(true);
    expect(parsedReg.webinarId).toBe('WN_qR7xK9sTaBcDeFg');
    expect(parsedReg.registrationSlug).toBe('WN_qR7xK9sTaBcDeFg');
    expect(parsedReg.isRegistration).toBe(true);

    const joinUrl = 'https://zoom.us/w/84920491823?tk=998877';
    const parsedJoin = parseZoomInput(joinUrl);
    expect(parsedJoin.isValid).toBe(true);
    expect(parsedJoin.webinarId).toBe('84920491823');
    expect(parsedJoin.zoomId).toBe('84920491823');
    expect(parsedJoin.canonicalJoinUrl).toBe('https://zoom.us/w/84920491823');
  });

  it('guarantees all 8 channels have definitions with required UI attributes', () => {
    expect(DEFAULT_SELECTED_CHANNELS).toHaveLength(8);
    for (const ch of DEFAULT_SELECTED_CHANNELS) {
      const def = CHANNEL_DEFINITIONS[ch];
      expect(def).toBeDefined();
      expect(def.label).toBeTruthy();
      expect(def.icon).toBeTruthy();
      expect(def.color).toBeTruthy();
      expect(def.description).toBeTruthy();
    }
  });
});
