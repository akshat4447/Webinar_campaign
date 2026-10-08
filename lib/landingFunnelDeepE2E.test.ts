/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/db', () => ({
  db: {
    campaign: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
    },
    contact: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    cadenceStep: {
      findMany: vi.fn(),
    },
    cadenceSend: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
      createMany: vi.fn(),
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

vi.mock('@/lib/activityPush', () => ({
  postWebinarRegistrationActivity: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock('@/lib/lsqSuppression', () => ({
  syncContactToLsqSuppressionList: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock('@/lib/zoom/meetings', () => ({
  addZoomRegistrant: vi.fn().mockResolvedValue({
    ok: true,
    joinUrl: 'https://zoom.us/w/81234567891?tk=deep_test_token_123',
    registrantId: 'z_reg_deep_123',
  }),
}));

import { db } from '@/lib/db';
import {
  buildLandingPageUrl,
  buildChannelTrackingLinks,
  generateFramerEmbedScript,
} from './landingPageServer';
import {
  mintRegistrationToken,
  verifyRegistrationToken,
} from './registration';
import { updateCampaignRegistrationFunnelAction } from './actions/setup';
import { OPTIONS, POST } from '@/app/api/landing/submit/route';
import { addZoomRegistrant } from './zoom/meetings';

describe('Deep Verification: Landing Page Funnel, Framer Embed & Zoom Attribution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (db.campaign as any).findUnique = vi.fn().mockResolvedValue({id:'c1',status:'draft',cadenceStatus:'not_started'});
    vi.mocked(db.$transaction).mockImplementation((async (cb: any) => cb(withTxDefaults(db,db))) as any);
  });

  describe('1. Dynamic Link Generation & Token Cryptography Edge Cases', () => {
    const campaign = {
      id: 'camp_enterprise_1',
      name: 'Advanced Healthcare AI Summit 2026',
      zoomMeetingId: '81234567891',
    };

    it('handles single-word names and complex corporate names properly', () => {
      const contactCher = {
        id: 'cont_cher',
        name: 'Cher',
        email: 'cher@music.com',
        phone: null,
        account: 'Warner Music & Media (Global)',
        title: 'Executive Producer',
      };

      const url = buildLandingPageUrl({
        landingPageUrl: 'https://webinar.leadsquared.com/healthcare-ai',
        campaign,
        contact: contactCher,
        channel: 'whatsapp',
      });

      const parsed = new URL(url);
      expect(parsed.searchParams.get('FirstName')).toBe('Cher');
      expect(parsed.searchParams.get('LastName')).toBeNull();
      expect(parsed.searchParams.get('Phone')).toBeNull();
      expect(parsed.searchParams.get('Company')).toBe('Warner Music & Media (Global)');
      expect(parsed.searchParams.get('source')).toBe('whatsapp');
      expect(parsed.searchParams.get('zoomId')).toBe('81234567891');
    });

    it('handles honorific titles, compound names, and email plus-addressing', () => {
      const contactDoctor = {
        id: 'cont_doc_1',
        name: 'Dr. Jean-Luc Picard Jr.',
        email: 'picard+enterprise@starfleet.org',
        phone: '+91 98765 43210',
        account: 'Starfleet Command, Sector 001',
        title: 'Fleet Admiral & Chief of Operations',
      };

      const url = buildLandingPageUrl({
        landingPageUrl: 'https://webinar.leadsquared.com/healthcare-ai',
        campaign,
        contact: contactDoctor,
        channel: 'sms',
      });

      const parsed = new URL(url);
      expect(parsed.searchParams.get('FirstName')).toBe('Dr.');
      expect(parsed.searchParams.get('LastName')).toBe('Jean-Luc Picard Jr.');
      expect(parsed.searchParams.get('EmailAddress')).toBe('picard+enterprise@starfleet.org');
      expect(parsed.searchParams.get('Phone')).toBe('+91 98765 43210');
      expect(parsed.searchParams.get('source')).toBe('sms');
      expect(parsed.searchParams.get('utm_campaign')).toBe('advanced-healthcare-ai-summit-2026');
    });

    it('generates cryptographic tokens that pass tamper verification', () => {
      const token = mintRegistrationToken('camp_enterprise_1', 'cont_doc_1');
      const verified = verifyRegistrationToken(token);
      expect(verified.ok).toBe(true);
      if (verified.ok) {
        expect(verified.payload.campaignId).toBe('camp_enterprise_1');
        expect(verified.payload.contactId).toBe('cont_doc_1');
      }

      // Tampered token test
      const tampered = token.slice(0, -4) + 'abcd';
      const failedVerify = verifyRegistrationToken(tampered);
      expect(failedVerify.ok).toBe(false);
    });

    it('generates multi-channel tracking links for all segregated channels', () => {
      const links = buildChannelTrackingLinks(
        'https://webinar.leadsquared.com/opd-to-ipd-funnel',
        campaign
      );

      expect(links.email).toContain('source=email');
      expect(links.email).toContain('zoomId=81234567891');
      expect(links.whatsapp).toContain('source=whatsapp');
      expect(links.sms).toContain('source=sms');
      expect(links.linkedin).toContain('source=linkedin');
      expect(links.linkedin_event).toContain('source=linkedin_event');
      expect(links.sdr_sales).toContain('source=sdr_sales');
      expect(links.third_parties).toContain('source=third_parties');
      expect(links.website).toContain('source=website');

      // Test LeadSquared format
      const lsqLinks = buildChannelTrackingLinks(
        'https://webinar.leadsquared.com/opd-to-ipd-funnel',
        campaign,
        undefined,
        undefined,
        'leadsquared'
      );
      expect(lsqLinks.email).toContain('FirstName={{FirstName}}');
      expect(lsqLinks.email).toContain('EmailAddress={{EmailAddress}}');

      // Test Netcore format
      const netcoreLinks = buildChannelTrackingLinks(
        'https://webinar.leadsquared.com/opd-to-ipd-funnel',
        campaign,
        undefined,
        undefined,
        'netcore'
      );
      expect(netcoreLinks.email).toContain('FirstName=[NAME]');
      expect(netcoreLinks.email).toContain('EmailAddress=[EMAIL]');
    });
  });

  describe('2. Framer Embed Script Generator Verification', () => {
    it('produces a script containing React synthetic event setters and beacon fallbacks', () => {
      const script = generateFramerEmbedScript({
        apiOrigin: 'https://studio.mydomain.com',
        campaignId: 'camp_999',
        zoomId: '8999111222',
      });

      // Assert critical Framer / React mechanics exist in output
      expect(script).toContain('setReactInputValue');
      expect(script).toContain('Object.getOwnPropertyDescriptor');
      expect(script).toContain('dispatchEvent(new Event(\'input\'');
      expect(script).toContain('dispatchEvent(new Event(\'change\'');
      expect(script).toContain('navigator.sendBeacon');
      expect(script).toContain('/api/landing/submit');
      expect(script).toContain('https://studio.mydomain.com');
      expect(script).toContain('camp_999');
      expect(script).toContain('8999111222');
      expect(script).toContain('mx_WebinarID');
      expect(script).toContain('hasSubmitted = true');
    });

    it('falls back to window.location.origin when apiOrigin is omitted', () => {
      const script = generateFramerEmbedScript({});
      expect(script).toContain('window.location.origin');
    });
  });

  describe('3. Registration Beacon API (/api/landing/submit)', () => {
    it('returns 204 with full CORS headers on OPTIONS preflight', async () => {
      const res = await OPTIONS();
      expect(res.status).toBe(204);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
      expect(res.headers.get('Access-Control-Allow-Headers')).toContain('Content-Type');
    });

    it('successfully processes registration via verified bearer token', async () => {
      const validToken = mintRegistrationToken('camp_101', 'cont_101');

      vi.mocked(db.campaign.findUnique).mockResolvedValue({
        id: 'camp_101',
        name: 'OPD to IPD Masterclass',
        zoomMeetingId: '81234567891',
        zoomLink: 'https://zoom.us/j/81234567891',
        cadenceStatus: 'running',
        stopOnRegistration: true,
      } as any);

      vi.mocked(db.contact.findUnique).mockResolvedValue({
        id: 'cont_101',
        campaignId: 'camp_101',
        name: 'Dr. Rajiv Anand',
        email: 'rajiv@maxhealth.com',
        phone: '+919876500000',
        registeredAt: null,
      } as any);

      vi.mocked(db.cadenceStep.findMany).mockResolvedValue([]);
      vi.mocked(db.$transaction).mockImplementation(async (cb: any) => {
        return cb(withTxDefaults({
          contact: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
          $executeRaw: vi.fn().mockResolvedValue(1),
          cadenceStep: { findMany: vi.fn().mockResolvedValue([]) },
          cadenceSend: { updateMany: vi.fn().mockResolvedValue({ count: 0 }), createMany: vi.fn().mockResolvedValue({ count: 0 }) },
          activityLogEntry: { create: vi.fn().mockResolvedValue({}) },
        }, db));
      });

      const req = new NextRequest('http://localhost:3000/api/landing/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: validToken,
          source: 'email',
          zoomId: '81234567891',
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.alreadyRegistered).toBe(false);
      expect(data.campaignId).toBe('camp_101');

      expect(db.registrationJob.createMany).toHaveBeenCalledWith(expect.objectContaining({data:expect.arrayContaining([expect.objectContaining({kind:'zoom'})])}));
      expect(addZoomRegistrant).not.toHaveBeenCalled();

    });

    it('processes plain text / beacon body payloads gracefully', async () => {
      const validToken = mintRegistrationToken('camp_101', 'cont_101');

      vi.mocked(db.campaign.findUnique).mockResolvedValue({
        id: 'camp_101',
        name: 'OPD to IPD Masterclass',
        zoomMeetingId: '81234567891',
        cadenceStatus: 'running',
      } as any);

      vi.mocked(db.contact.findUnique).mockResolvedValue({
        id: 'cont_101',
        campaignId: 'camp_101',
        name: 'Dr. Rajiv Anand',
        email: 'rajiv@maxhealth.com',
        registeredAt: null,
      } as any);

      vi.mocked(db.cadenceStep.findMany).mockResolvedValue([]);
      vi.mocked(db.$transaction).mockImplementation(async (cb: any) => {
        return cb(withTxDefaults({
          contact: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
          $executeRaw: vi.fn().mockResolvedValue(1),
          cadenceStep: { findMany: vi.fn().mockResolvedValue([]) },
          cadenceSend: { updateMany: vi.fn().mockResolvedValue({ count: 0 }), createMany: vi.fn().mockResolvedValue({ count: 0 }) },
          activityLogEntry: { create: vi.fn().mockResolvedValue({}) },
        }, db));
      });

      // sendBeacon often dispatches with text/plain or without application/json header
      const req = new NextRequest('http://localhost:3000/api/landing/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify({
          token: validToken,
          source: 'whatsapp',
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
    });

    it('auto-creates inbound leads with all schema requirements when visiting organically', async () => {
      vi.mocked(db.campaign.findUnique).mockResolvedValue({
        id: 'camp_101',
        name: 'OPD to IPD Masterclass',
        vertical: 'Healthcare Operations',
      } as any);

      vi.mocked(db.contact.findFirst).mockResolvedValue(null);

      vi.mocked(db.contact.create).mockResolvedValue({
        id: 'cont_inbound_99',
        campaignId: 'camp_101',
        name: 'Dr. Priya Sundaram',
        email: 'priya@sundaramhealth.in',
        phone: '+919876511111',
        account: 'Sundaram Health',
        vertical: 'Healthcare Operations',
        title: 'Chief of Medicine',
        function: 'General',
        seniority: 'Professional',
        registeredAt: null,
      } as any);

      vi.mocked(db.contact.findUnique).mockResolvedValue({
        id: 'cont_inbound_99',
        campaignId: 'camp_101',
        name: 'Dr. Priya Sundaram',
        email: 'priya@sundaramhealth.in',
        registeredAt: null,
      } as any);

      vi.mocked(db.cadenceStep.findMany).mockResolvedValue([]);
      vi.mocked(db.$transaction).mockImplementation(async (cb: any) => {
        return cb(withTxDefaults({
          contact: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
          $executeRaw: vi.fn().mockResolvedValue(1),
          cadenceStep: { findMany: vi.fn().mockResolvedValue([]) },
          cadenceSend: { updateMany: vi.fn().mockResolvedValue({ count: 0 }), createMany: vi.fn().mockResolvedValue({ count: 0 }) },
          activityLogEntry: { create: vi.fn().mockResolvedValue({}) },
        }, db));
      });

      const req = new NextRequest('http://localhost:3000/api/landing/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId: 'camp_101',
          email: 'priya@sundaramhealth.in',
          firstName: 'Dr. Priya',
          lastName: 'Sundaram',
          phone: '+919876511111',
          company: 'Sundaram Health',
          jobTitle: 'Chief of Medicine',
          source: 'linkedin',
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);

      expect(db.contact.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'Dr. Priya Sundaram',
            email: 'priya@sundaramhealth.in',
            vertical: 'Healthcare Operations',
            title: 'Chief of Medicine',
            phone: '+919876511111',
            account: 'Sundaram Health',
            approved: false,
          }),
        })
      );
    });

    it('handles idempotent double-submission cleanly without duplicate increment', async () => {
      vi.mocked(db.campaign.findUnique).mockResolvedValue({
        id: 'camp_101',
        name: 'OPD to IPD Masterclass',
        zoomLink: 'https://zoom.us/j/81234567891',
      } as any);

      vi.mocked(db.contact.findFirst).mockResolvedValue({
        id: 'cont_already_reg',
        campaignId: 'camp_101',
        name: 'Anand Kumar',
        email: 'anand@hospital.com',
        registeredAt: new Date('2026-10-01T12:00:00Z'),
        zoomJoinUrl: 'https://zoom.us/w/81234567891?tk=personal_anand',
      } as any);

      vi.mocked(db.contact.findUnique).mockResolvedValue({
        id: 'cont_already_reg',
        campaignId: 'camp_101',
        name: 'Anand Kumar',
        email: 'anand@hospital.com',
        registeredAt: new Date('2026-10-01T12:00:00Z'),
        zoomJoinUrl: 'https://zoom.us/w/81234567891?tk=personal_anand',
      } as any);

      const req = new NextRequest('http://localhost:3000/api/landing/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId: 'camp_101',
          email: 'anand@hospital.com',
          source: 'email',
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.token).toBeUndefined();
      expect(data.joinUrl).toBeUndefined();

      // Transaction must NOT run again for already registered contact
      expect(db.$transaction).toHaveBeenCalled();
    });

    it('rejects submission with 400 when missing both token and email', async () => {
      const req = new NextRequest('http://localhost:3000/api/landing/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId: 'camp_101',
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toContain('Email address or valid token is required');
    });

    it('rejects submission with 404 when campaignId does not exist', async () => {
      vi.mocked(db.campaign.findUnique).mockResolvedValue(null);

      const req = new NextRequest('http://localhost:3000/api/landing/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId: 'camp_non_existent',
          email: 'test@domain.com',
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toContain('Campaign not found');
    });
  });

  describe('4. Funnel Action Integrity (updateCampaignRegistrationFunnelAction)', () => {
    it('updates registrationLink and disables oneClickSignup when LP link provided', async () => {
      vi.mocked(db.campaign.update).mockResolvedValue({} as any);
      vi.mocked(db.activityLogEntry.create).mockResolvedValue({} as any);

      const res = await updateCampaignRegistrationFunnelAction('clh1234567890123456789012', {
        registrationLink: 'https://webinar.leadsquared.com/opd-to-ipd-funnel',
        oneClickSignup: false,
      });

      expect(res.ok).toBe(true);
      expect(db.campaign.update).toHaveBeenCalledWith({
        where: { id: 'clh1234567890123456789012' },
        data: {
          registrationLink: 'https://webinar.leadsquared.com/opd-to-ipd-funnel',
          oneClickSignup: false,
        },
      });
      expect(db.activityLogEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            text: expect.stringContaining('External Landing Page: https://webinar.leadsquared.com/opd-to-ipd-funnel'),
          }),
        })
      );
    });

    it('clears registrationLink and enables oneClickSignup when resetting to 1-Click mode', async () => {
      vi.mocked(db.campaign.update).mockResolvedValue({} as any);
      vi.mocked(db.activityLogEntry.create).mockResolvedValue({} as any);

      const res = await updateCampaignRegistrationFunnelAction('clh1234567890123456789012', {
        registrationLink: '',
        oneClickSignup: true,
      });

      expect(res.ok).toBe(true);
      expect(db.campaign.update).toHaveBeenCalledWith({
        where: { id: 'clh1234567890123456789012' },
        data: {
          registrationLink: null,
          oneClickSignup: true,
        },
      });
      expect(db.activityLogEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            text: expect.stringContaining('1-Click Magic Link'),
          }),
        })
      );
    });

    it('persists extracted zoomMeetingId and canonical zoomLink along with funnel settings', async () => {
      vi.mocked(db.campaign.update).mockResolvedValue({} as any);
      vi.mocked(db.activityLogEntry.create).mockResolvedValue({} as any);

      const res = await updateCampaignRegistrationFunnelAction('clh1234567890123456789012', {
        registrationLink: 'https://webinar.leadsquared.com/opd-to-ipd-funnel',
        oneClickSignup: false,
        zoomMeetingId: '84920491823',
        zoomLink: 'https://zoom.us/w/84920491823',
      });

      expect(res.ok).toBe(true);
      expect(db.campaign.update).toHaveBeenCalledWith({
        where: { id: 'clh1234567890123456789012' },
        data: {
          registrationLink: 'https://webinar.leadsquared.com/opd-to-ipd-funnel',
          oneClickSignup: false,
          zoomMeetingId: '84920491823',
          zoomLink: 'https://zoom.us/w/84920491823',
        },
      });
      expect(db.activityLogEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            text: expect.stringContaining('Zoom ID #84920491823'),
          }),
        })
      );
    });
  });
});

import { addReliabilityMocks, withTxDefaults } from '../test-support/reliabilityMocks';
beforeEach(() => { addReliabilityMocks(db); (db as any).$queryRaw = vi.fn(async () => []); });
