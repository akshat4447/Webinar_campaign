import { describe, it, expect } from 'vitest';
import { computeRegistrationReadiness, type ReadinessInput } from './registrationReadiness';
import type { LandingReport } from './landingVerify';

const NOW = new Date('2026-10-07T10:00:00Z');
const base = (over: Partial<ReadinessInput> = {}, camp: Partial<ReadinessInput['campaign']> = {}): ReadinessInput => ({
  campaign: { id: 'c1', name: 'W', status: 'draft', scheduledAt: new Date('2026-10-21T09:30:00Z'), durationMinutes: 60, registrationMode: 'zoom', oneClickSignup: true, zoomMeetingId: '123', zoomEventType: 'meeting', lsqSuppressionListId: 'list-1', ...camp },
  appOrigin: 'https://studio.example.com',
  zoom: { connected: true, health: { registrationEnabled: true, kind: 'meeting' }, webhookSecretSet: true },
  lsqConfigured: true,
  now: NOW,
  ...over,
});
const get = (r: ReturnType<typeof computeRegistrationReadiness>, id: string) => r.checks.find((c) => c.id === id);

describe('computeRegistrationReadiness — fully configured', () => {
  it('is ready with no warnings', () => {
    const r = computeRegistrationReadiness(base());
    expect(r.ready).toBe(true);
    expect(r.counts).toEqual({ pass: r.checks.length, warn: 0, fail: 0 });
    expect(r.mode).toBe('zoom');
  });
});

describe('event checks', () => {
  it('fails with no date; warns for a past date; fails when registration is closed', () => {
    expect(get(computeRegistrationReadiness(base({}, { scheduledAt: null })), 'date')?.status).toBe('fail');
    expect(get(computeRegistrationReadiness(base({}, { scheduledAt: new Date('2026-09-01T00:00:00Z') })), 'date')?.status).toBe('warn');
    const closed = computeRegistrationReadiness(base({}, { scheduledAt: new Date('2026-09-01T00:00:00Z') }));
    expect(get(closed, 'open')?.status).toBe('fail');
    expect(closed.ready).toBe(false);
  });
  it('fails when the webinar is full, with a capacity fix', () => {
    const r = computeRegistrationReadiness(base({}, { capacity: 10, registrations: 10 }));
    expect(get(r, 'open')).toMatchObject({ status: 'fail', fix: expect.stringMatching(/capacity/i) });
  });
});

describe('public address', () => {
  it('warns for localhost / http / private origins, passes for a public https origin', () => {
    for (const o of ['http://localhost:3000', 'https://localhost', 'http://studio.example.com', 'https://192.168.1.5', '']) {
      expect(get(computeRegistrationReadiness(base({ appOrigin: o })), 'origin')?.status, o).toBe('warn');
    }
    expect(get(computeRegistrationReadiness(base()), 'origin')?.status).toBe('pass');
  });
  it('a warning alone never blocks launch', () => {
    expect(computeRegistrationReadiness(base({ appOrigin: 'http://localhost:3000' })).ready).toBe(true);
  });
});

describe('zoom mode', () => {
  it('proves an invite link is generated and verifies', () => {
    expect(get(computeRegistrationReadiness(base()), 'invite-link')?.status).toBe('pass');
    expect(get(computeRegistrationReadiness(base({}, { oneClickSignup: false })), 'invite-link')?.detail).toMatch(/hosted registration form/);
  });
});

describe('external landing page mode', () => {
  const ext = { registrationMode: 'external', registrationLink: 'https://lp.example.com/w' };
  const report = (overall: LandingReport['overall'], checks: LandingReport['checks'] = []): LandingReport => ({ url: 'u', finalUrl: 'u', status: 200, title: null, platform: 'unknown', embeddable: true, checks, overall });

  it('without a landing URL it degrades to zoom mode (so the link still works)', () => {
    expect(computeRegistrationReadiness(base({}, { registrationMode: 'external', registrationLink: '' })).mode).toBe('zoom');
  });
  it('asks for a landing-page check when none has run', () => {
    expect(get(computeRegistrationReadiness(base({}, ext)), 'landing-verify')?.status).toBe('warn');
  });
  it('passes when the landing page report passes', () => {
    expect(get(computeRegistrationReadiness(base({ landing: report('pass') }, ext)), 'landing-verify')?.status).toBe('pass');
  });
  it('FAILS launch when the landing page cannot register people, carrying the exact fix', () => {
    const r = computeRegistrationReadiness(base({ landing: report('fail', [{ id: 'snippet', label: 's', status: 'fail', detail: 'No script found.', fix: 'Paste the script.' }]) }, ext));
    expect(get(r, 'landing-verify')).toMatchObject({ status: 'fail', detail: expect.stringContaining('No script found.'), fix: expect.stringContaining('Paste the script.') });
    expect(r.ready).toBe(false);
  });
  it('is mode external and does not demand a Studio invite link', () => {
    const r = computeRegistrationReadiness(base({}, ext));
    expect(r.mode).toBe('external');
    expect(get(r, 'invite-link')).toBeUndefined();
  });
});

describe('zoom checks', () => {
  it('warns (does not block) when no Zoom event is linked', () => {
    const r = computeRegistrationReadiness(base({}, { zoomMeetingId: null }));
    expect(get(r, 'zoom-link')?.status).toBe('warn');
    expect(r.ready).toBe(true);
  });
  it('FAILS when an event is linked but Zoom is disconnected', () => {
    const r = computeRegistrationReadiness(base({ zoom: { connected: false, health: null, webhookSecretSet: true } }));
    expect(get(r, 'zoom-connected')?.status).toBe('fail');
    expect(r.ready).toBe(false);
  });
  it('FAILS when registration is off on the Zoom event, naming the fix', () => {
    const r = computeRegistrationReadiness(base({ zoom: { connected: true, health: { registrationEnabled: false, kind: 'meeting' }, webhookSecretSet: true } }));
    expect(get(r, 'zoom-registration')).toMatchObject({ status: 'fail', fix: expect.stringMatching(/Enable registration/) });
  });
  it('warns when Zoom could not be checked, and when the webhook secret is missing', () => {
    expect(get(computeRegistrationReadiness(base({ zoom: { connected: true, health: { registrationEnabled: true, kind: 'meeting', error: 'timeout' }, webhookSecretSet: true } })), 'zoom-health')?.status).toBe('warn');
    expect(get(computeRegistrationReadiness(base({ zoom: { connected: true, health: { registrationEnabled: true, kind: 'meeting' }, webhookSecretSet: false } })), 'zoom-webhook')?.status).toBe('warn');
  });
  it('warns when capacity exceeds the 4,999 meeting cap but not for a webinar', () => {
    expect(get(computeRegistrationReadiness(base({}, { capacity: 6000 })), 'zoom-cap')?.status).toBe('warn');
    expect(get(computeRegistrationReadiness(base({}, { capacity: 6000, zoomEventType: 'webinar' })), 'zoom-cap')).toBeUndefined();
    expect(get(computeRegistrationReadiness(base({}, { capacity: 4999 })), 'zoom-cap')).toBeUndefined();
  });
});

describe('crm', () => {
  it('warns when LeadSquared is not connected', () => {
    expect(get(computeRegistrationReadiness(base({ lsqConfigured: false })), 'lsq')?.status).toBe('warn');
  });
});

describe('counts', () => {
  it('always sums to the number of checks', () => {
    const r = computeRegistrationReadiness(base({ lsqConfigured: false, appOrigin: 'http://localhost' }, { scheduledAt: null }));
    expect(r.counts.pass + r.counts.warn + r.counts.fail).toBe(r.checks.length);
  });
});

describe('suppression list check', () => {
  const base = () => ({
    campaign: { id: 'c', scheduledAt: new Date(Date.now() + 864e5), registrationMode: 'external', registrationLink: 'https://lp.example.com/x', zoomMeetingId: null, lsqSuppressionListId: null as string | null },
    appOrigin: 'https://studio.example.com',
    zoom: { connected: false, health: null, webhookSecretSet: false },
    lsqConfigured: true,
  });
  it('warns when LeadSquared is connected but no suppression list is chosen', () => {
    const r = computeRegistrationReadiness(base());
    expect(r.checks.find((c) => c.id === 'suppression')?.status).toBe('warn');
  });
  it('passes once a list is chosen, and is absent when LeadSquared is not connected', () => {
    const withList = base();
    withList.campaign.lsqSuppressionListId = 'list-1';
    expect(computeRegistrationReadiness(withList).checks.find((c) => c.id === 'suppression')?.status).toBe('pass');
    expect(computeRegistrationReadiness({ ...base(), lsqConfigured: false }).checks.some((c) => c.id === 'suppression')).toBe(false);
  });
});
