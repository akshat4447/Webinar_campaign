import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  resolveContactRegistrationChannel,
  parseSelectedChannels,
  serializeSelectedChannels,
  DEFAULT_SELECTED_CHANNELS,
  CHANNEL_DEFINITIONS,
  type RegistrationChannelKey,
} from './registrationChannels';
import { getCampaignRegistrationChannels } from './registrationChannelsServer';

vi.mock('@/lib/db', () => ({
  db: {
    $queryRaw: vi.fn(),
    campaign: {
      findUnique: vi.fn(),
    },
    contact: {
      findMany: vi.fn(),
    },
    cadenceSend: {
      findMany: vi.fn(),
    },
  },
}));

import { db } from '@/lib/db';

describe('registrationChannels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('CHANNEL_DEFINITIONS & selections', () => {
    it('defines all 8 canonical channels', () => {
      const keys = Object.keys(CHANNEL_DEFINITIONS) as RegistrationChannelKey[];
      expect(keys).toHaveLength(8);
      expect(keys).toContain('email_campaign');
      expect(keys).toContain('whatsapp');
      expect(keys).toContain('linkedin');
      expect(keys).toContain('sdr_sales');
      expect(keys).toContain('third_parties');
      expect(keys).toContain('linkedin_event');
      expect(keys).toContain('website');
    });

    it('parses and serializes selectedChannels correctly', () => {
      expect(parseSelectedChannels(null)).toEqual(DEFAULT_SELECTED_CHANNELS);
      expect(parseSelectedChannels('')).toEqual(DEFAULT_SELECTED_CHANNELS);

      const custom = parseSelectedChannels('email_campaign,whatsapp,linkedin');
      expect(custom).toEqual(['email_campaign', 'whatsapp', 'linkedin']);

      const serialized = serializeSelectedChannels(['email_campaign', 'website']);
      expect(serialized).toBe('email_campaign,website');

      // Backward compatibility with legacy channel names
      expect(parseSelectedChannels('email,sms,framer')).toEqual(['email_campaign', 'sms', 'website']);
    });
  });

  describe('resolveContactRegistrationChannel', () => {
    it('correctly maps explicit source tags to canonical channels', () => {
      const sends = new Map();

      // Email Campaign
      expect(resolveContactRegistrationChannel({ id: '1', registrationSource: 'email_campaign' }, sends)).toBe('email_campaign');
      expect(resolveContactRegistrationChannel({ id: '2', registrationSource: 'netcore' }, sends)).toBe('email_campaign');
      expect(resolveContactRegistrationChannel({ id: '3', registrationSource: 'netcore_click' }, sends)).toBe('email_campaign');
      expect(resolveContactRegistrationChannel({ id: '4', registrationSource: 'email' }, sends)).toBe('email_campaign');

      // WhatsApp
      expect(resolveContactRegistrationChannel({ id: '5', registrationSource: 'whatsapp' }, sends)).toBe('whatsapp');
      expect(resolveContactRegistrationChannel({ id: '6', registrationSource: 'wa' }, sends)).toBe('whatsapp');

      // LinkedIn (Direct/InMail)
      expect(resolveContactRegistrationChannel({ id: '7', registrationSource: 'linkedin' }, sends)).toBe('linkedin');
      expect(resolveContactRegistrationChannel({ id: '8', registrationSource: 'inmail' }, sends)).toBe('linkedin');

      // SDR / Sales
      expect(resolveContactRegistrationChannel({ id: '9', registrationSource: 'sdr_sales' }, sends)).toBe('sdr_sales');
      expect(resolveContactRegistrationChannel({ id: '10', registrationSource: 'sales_rep' }, sends)).toBe('sdr_sales');
      expect(resolveContactRegistrationChannel({ id: '11', registrationSource: 'sms' }, sends)).toBe('sms');

      // Third-parties / Partners
      expect(resolveContactRegistrationChannel({ id: '12', registrationSource: 'third_parties' }, sends)).toBe('third_parties');
      expect(resolveContactRegistrationChannel({ id: '13', registrationSource: 'partner_newsletter' }, sends)).toBe('third_parties');
      expect(resolveContactRegistrationChannel({ id: '14', registrationSource: 'affiliate_link' }, sends)).toBe('third_parties');

      // LinkedIn Event Page
      expect(resolveContactRegistrationChannel({ id: '15', registrationSource: 'linkedin_event' }, sends)).toBe('linkedin_event');
      expect(resolveContactRegistrationChannel({ id: '16', registrationSource: 'linkedin_reg' }, sends)).toBe('linkedin_event');

      // Website / Organic
      expect(resolveContactRegistrationChannel({ id: '17', registrationSource: 'website' }, sends)).toBe('website');
      expect(resolveContactRegistrationChannel({ id: '18', registrationSource: 'framer' }, sends)).toBe('website');
      expect(resolveContactRegistrationChannel({ id: '19', registrationSource: 'landing_page' }, sends)).toBe('website');
    });

    it('falls back to CadenceSend steps when registrationSource is one_click', () => {
      const sends = new Map<string, Set<string>>([
        ['c_wa', new Set(['waInvite'])],
        ['c_sms', new Set(['smsInvite'])],
        ['c_li', new Set(['linkedin'])],
        ['c_em', new Set(['invite'])],
      ]);

      expect(resolveContactRegistrationChannel({ id: 'c_wa', registrationSource: 'one_click' }, sends)).toBe('whatsapp');
      expect(resolveContactRegistrationChannel({ id: 'c_sms', registrationSource: 'one_click' }, sends)).toBe('sms');
      expect(resolveContactRegistrationChannel({ id: 'c_li', registrationSource: 'one_click' }, sends)).toBe('linkedin');
      expect(resolveContactRegistrationChannel({ id: 'c_em', registrationSource: 'one_click' }, sends)).toBe('email_campaign');
    });

    it('defaults to email_campaign when one_click has no prior step sent', () => {
      const sends = new Map();
      expect(resolveContactRegistrationChannel({ id: 'c_blank', registrationSource: 'one_click' }, sends)).toBe('email_campaign');
    });
  });

  describe('getCampaignRegistrationChannels', () => {
    it('computes channel metrics, percentages, and filters by selectedChannels', async () => {
      const mockCampaign = {
        id: 'camp_123',
        name: 'Cloud AI Ops Webinar',
        registrationLink: null,
        oneClickSignup: true,
        zoomMeetingId: '987654321',
        zoomLink: 'https://zoom.us/j/987654321',
        registrations: 5,
        selectedChannels: 'email_campaign,whatsapp,linkedin,sdr_sales',
      };

      const mockContacts = [
        { id: 'c1', name: 'Alice', email: 'alice@a.com', phone: null, account: 'A Corp', title: 'VP', score: 90, registeredAt: new Date(), registrationSource: 'email_campaign', zoomJoinUrl: null },
        { id: 'c2', name: 'Bob', email: 'bob@b.com', phone: null, account: 'B Corp', title: 'CTO', score: 85, registeredAt: new Date(), registrationSource: 'email_campaign', zoomJoinUrl: null },
        { id: 'c3', name: 'Charlie', email: 'charlie@c.com', phone: '+919999999999', account: 'C Corp', title: 'Dir', score: 80, registeredAt: new Date(), registrationSource: 'whatsapp', zoomJoinUrl: null },
        { id: 'c4', name: 'David', email: 'david@d.com', phone: '+918888888888', account: 'D Corp', title: 'Lead', score: 75, registeredAt: new Date(), registrationSource: 'sdr_sales', zoomJoinUrl: null },
        { id: 'c5', name: 'Eve', email: 'eve@e.com', phone: null, account: 'E Corp', title: 'Head', score: 95, registeredAt: new Date(), registrationSource: 'linkedin', zoomJoinUrl: null },
      ];


      vi.mocked(db.campaign.findUnique).mockResolvedValue(mockCampaign as unknown as never);
      vi.mocked(db.$queryRaw).mockResolvedValueOnce(mockContacts.map(c=>({...c,channel:resolveContactRegistrationChannel(c,new Map()),channelCount:c.registrationSource==='email_campaign'?2:1}))).mockResolvedValueOnce([{stepKey:'invite',count:4},{stepKey:'waInvite',count:1},{stepKey:'smsInvite',count:1},{stepKey:'linkedin',count:1}]);

      const result = await getCampaignRegistrationChannels('camp_123');

      expect(result.totalRegistered).toBe(5);
      expect(result.selectedChannels).toEqual(['email_campaign', 'whatsapp', 'linkedin', 'sdr_sales']);

      const emailStat = result.channels.find((c) => c.key === 'email_campaign');
      const waStat = result.channels.find((c) => c.key === 'whatsapp');
      const sdrStat = result.channels.find((c) => c.key === 'sdr_sales');
      const liStat = result.channels.find((c) => c.key === 'linkedin');

      expect(emailStat).toBeDefined();
      expect(emailStat?.registeredCount).toBe(2);
      expect(emailStat?.pctOfTotal).toBe(40); // 2 of 5 = 40%
      expect(emailStat?.invitedCount).toBe(4);

      expect(waStat).toBeDefined();
      expect(waStat?.registeredCount).toBe(1);
      expect(waStat?.pctOfTotal).toBe(20);

      expect(sdrStat).toBeDefined();
      expect(sdrStat?.registeredCount).toBe(1);

      expect(liStat).toBeDefined();
      expect(liStat?.registeredCount).toBe(1);

      expect(result.topChannel?.key).toBe('email_campaign');
    });

    it('generates Framer channel tracking URLs for all 8 channels when campaign has registrationLink', async () => {
      const mockCampaign = {
        id: 'camp_framer',
        name: 'Framer Ops Webinar',
        registrationLink: 'https://webinar.leadsquared.com/opd-to-ipd-funnel',
        oneClickSignup: false,
        zoomMeetingId: null,
        zoomLink: null,
        registrations: 1,
        selectedChannels: 'email_campaign,whatsapp,linkedin,sdr_sales,third_parties,linkedin_event,website',
      };

      const mockContacts = [
        { id: 'c1', name: 'Frank', email: 'f@f.com', phone: null, account: 'F Corp', title: 'CEO', score: 99, registeredAt: new Date(), registrationSource: 'website', zoomJoinUrl: null },
      ];

      vi.mocked(db.campaign.findUnique).mockResolvedValue(mockCampaign as unknown as never);
      vi.mocked(db.$queryRaw).mockResolvedValueOnce(mockContacts.map(c=>({...c,channel:'website',channelCount:1}))).mockResolvedValueOnce([]);

      const result = await getCampaignRegistrationChannels('camp_framer', 'http://localhost:3000');

      const siteStat = result.channels.find((c) => c.key === 'website');
      expect(siteStat).toBeDefined();
      expect(siteStat?.registeredCount).toBe(1);

      const emailStat = result.channels.find((c) => c.key === 'email_campaign');
      expect(emailStat?.trackingUrl).toContain('utm_source=email_campaign');

      const waStat = result.channels.find((c) => c.key === 'whatsapp');
      expect(waStat?.trackingUrl).toContain('utm_source=whatsapp');

      const thirdStat = result.channels.find((c) => c.key === 'third_parties');
      expect(thirdStat?.trackingUrl).toContain('utm_source=third_parties');

      const liEventStat = result.channels.find((c) => c.key === 'linkedin_event');
      expect(liEventStat?.trackingUrl).toContain('utm_source=linkedin_event');
    });

    it('links to the hosted registration page, never the Zoom join URL, when Zoom is linked but Studio hosts registration', async () => {
      const mockCampaign = {
        id: 'camp_zoom',
        name: 'Zoom Webinar',
        registrationLink: null,
        registrationMode: 'zoom',
        oneClickSignup: true,
        zoomMeetingId: '987654321',
        zoomLink: 'https://us02web.zoom.us/w/987654321?tk=abc',
        registrations: 1,
        selectedChannels: 'email_campaign,whatsapp,linkedin,sdr_sales,third_parties,linkedin_event,website',
      };
      const mockContacts = [
        { id: 'c1', name: 'Grace', email: 'g@g.com', phone: null, account: 'G Corp', title: 'CTO', score: 90, registeredAt: new Date(), registrationSource: 'website', zoomJoinUrl: 'https://zoom.us/w/join' },
      ];

      vi.mocked(db.campaign.findUnique).mockResolvedValue(mockCampaign as unknown as never);
      vi.mocked(db.$queryRaw).mockResolvedValueOnce(mockContacts.map(c=>({...c,channel:'website',channelCount:1}))).mockResolvedValueOnce([]);

      const result = await getCampaignRegistrationChannels('camp_zoom', 'https://studio.example.com');

      for (const key of ['email_campaign', 'whatsapp', 'sdr_sales', 'third_parties', 'linkedin_event']) {
        const url = result.channels.find((c) => c.key === key)?.trackingUrl as string;
        expect(url).toBe(`https://studio.example.com/register/camp_zoom?c=${key}`);
        expect(url).not.toContain('zoom.us');
      }
    });
  });
});

it('keeps SMS distinct from sales and deduplicates aliases',()=>{
 expect(parseSelectedChannels('sms,sms,email,email_campaign')).toEqual(['sms','email_campaign']);
 expect(resolveContactRegistrationChannel({id:'sms',registrationSource:'text_message'},new Map())).toBe('sms');
 expect(resolveContactRegistrationChannel({id:'sales',registrationSource:'phone_call'},new Map())).toBe('sdr_sales');
});
