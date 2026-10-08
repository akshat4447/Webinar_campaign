import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({
  campaign: { findUnique: vi.fn(), update: vi.fn() },
  appSetting: { findUnique: vi.fn(), upsert: vi.fn() },
  activityLogEntry: { create: vi.fn() },
}));
vi.mock('@/lib/db', () => ({ db }));
vi.mock('@/lib/revalidate', () => ({ revalidateCampaign: vi.fn() }));
const resolveField = vi.fn();
vi.mock('@/lib/integrationConfig', () => ({ resolveIntegrationField: (...a: unknown[]) => resolveField(...a) }));
const zoomConnectionError = vi.fn();
vi.mock('@/lib/zoom/client', () => ({ zoomConnectionError: () => zoomConnectionError() }));
const health = vi.fn();
vi.mock('@/lib/actions/zoom', () => ({ getZoomRegistrationHealthAction: (...a: unknown[]) => health(...a) }));
const verify = vi.fn();
vi.mock('@/lib/landingVerify', () => ({ verifyLandingPage: (...a: unknown[]) => verify(...a) }));

import { getRegistrationOverviewAction, saveRegistrationSettingsAction, verifyLandingPageAction } from './registration';

const camp = (over: Record<string, unknown> = {}) => ({
  id: 'c1', name: 'AI Lending', description: 'd', status: 'draft', archived: false, scheduledAt: new Date(Date.now() + 5 * 864e5), durationMinutes: 60,
  capacity: null, registrations: 0, registrationMode: 'zoom', registrationLink: null, oneClickSignup: true, landingPrefill: false,
  zoomLink: 'https://zoom.us/j/1', zoomMeetingId: '1', zoomEventType: 'meeting', zoomRegistrationUrl: 'https://zoom.us/meeting/register/x', selectedChannels: 'email_campaign,website', ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.APP_ORIGIN = 'https://studio.example.com';
  db.campaign.findUnique.mockResolvedValue(camp());
  db.appSetting.findUnique.mockResolvedValue(null);
  db.appSetting.upsert.mockResolvedValue({});
  resolveField.mockResolvedValue('set');
  zoomConnectionError.mockResolvedValue(null);
  health.mockResolvedValue({ linked: true, kind: 'meeting', registrationEnabled: true, registrationUrl: null });
});

describe('saveRegistrationSettingsAction', () => {
  it('saves zoom mode and defaults one-click on', async () => {
    const r = await saveRegistrationSettingsAction('c1', { mode: 'zoom' });
    expect(r).toEqual({ ok: true, warnings: [] });
    expect(db.campaign.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { registrationMode: 'zoom', oneClickSignup: true } });
  });
  it('saves a normalised landing URL for external mode, turns one-click off and keeps prefill explicit', async () => {
    const r = await saveRegistrationSettingsAction('c1', { mode: 'external', landingUrl: 'webinar.example.com/ai#top', prefill: true });
    expect(r.ok).toBe(true);
    expect(db.campaign.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { registrationMode: 'external', registrationLink: 'https://webinar.example.com/ai', landingPrefill: true, oneClickSignup: false } });
  });
  it('rejects external mode without a valid URL and writes nothing', async () => {
    for (const bad of ['', 'javascript:alert(1)', 'https://u:p@x.example.com']) {
      const r = await saveRegistrationSettingsAction('c1', { mode: 'external', landingUrl: bad });
      expect(r.ok, bad).toBe(false);
    }
    expect(db.campaign.update).not.toHaveBeenCalled();
  });
  it('rejects an unknown mode and an unknown webinar', async () => {
    expect((await saveRegistrationSettingsAction('c1', { mode: 'bogus' as never })).ok).toBe(false);
    db.campaign.findUnique.mockResolvedValue(null);
    expect((await saveRegistrationSettingsAction('nope', { mode: 'zoom' })).ok).toBe(false);
  });
  it('passes URL warnings (insecure / local) back to the UI without blocking', async () => {
    const r = await saveRegistrationSettingsAction('c1', { mode: 'external', landingUrl: 'http://localhost:3000/x' });
    expect(r.ok && r.warnings.length).toBeGreaterThan(0);
  });
  it('does not touch the stored landing URL when switching BACK to zoom (switching back restores it)', async () => {
    await saveRegistrationSettingsAction('c1', { mode: 'zoom' });
    expect(db.campaign.update.mock.calls[0][0].data).not.toHaveProperty('registrationLink');
  });
});

describe('getRegistrationOverviewAction', () => {
  it('zoom mode: readiness, hosted channel links, no snippet', async () => {
    const o = await getRegistrationOverviewAction('c1');
    if ('error' in o) throw new Error(o.error);
    expect(o.mode).toBe('zoom');
    expect(o.readiness.ready).toBe(true);
    expect(o.snippet).toBeNull();
    expect(o.channelLinks.map((l) => l.channel)).toEqual(['email_campaign', 'website']);
    expect(o.channelLinks[0].url).toMatch(/^https:\/\/studio\.example\.com\/register\/c1\?c=email_campaign$/);
  });
  it('external mode: landing links with UTM per channel and a snippet pointing at this app', async () => {
    db.campaign.findUnique.mockResolvedValue(camp({ registrationMode: 'external', registrationLink: 'https://lp.example.com/w', oneClickSignup: false }));
    const o = await getRegistrationOverviewAction('c1');
    if ('error' in o) throw new Error(o.error);
    expect(o.mode).toBe('external');
    expect(new URL(o.channelLinks[0].url).searchParams.get('utm_source')).toBe('email_campaign');
    expect(o.snippet).toContain('https://studio.example.com');
    expect(o.readiness.checks.find((c) => c.id === 'landing-verify')?.status).toBe('warn'); // not checked yet
  });
  it('uses the stored landing report only when it is for the CURRENT URL', async () => {
    db.campaign.findUnique.mockResolvedValue(camp({ registrationMode: 'external', registrationLink: 'https://lp.example.com/w' }));
    const stored = { url: 'https://lp.example.com/w', overall: 'pass', checks: [], checkedAt: 'now' };
    db.appSetting.findUnique.mockResolvedValue({ value: JSON.stringify(stored) });
    const o = await getRegistrationOverviewAction('c1');
    if ('error' in o) throw new Error(o.error);
    expect(o.landingReport?.overall).toBe('pass');
    db.appSetting.findUnique.mockResolvedValue({ value: JSON.stringify({ ...stored, url: 'https://old.example.com' }) });
    const o2 = await getRegistrationOverviewAction('c1');
    if ('error' in o2) throw new Error(o2.error);
    expect(o2.landingReport).toBeNull();
  });
  it('survives corrupt stored data', async () => {
    db.campaign.findUnique.mockResolvedValue(camp({ registrationMode: 'external', registrationLink: 'https://lp.example.com/w' }));
    db.appSetting.findUnique.mockResolvedValue({ value: '{not json' });
    const o = await getRegistrationOverviewAction('c1');
    if ('error' in o) throw new Error(o.error);
    expect(o.landingReport).toBeNull();
  });
  it('reports a missing webinar', async () => {
    db.campaign.findUnique.mockResolvedValue(null);
    expect(await getRegistrationOverviewAction('x')).toEqual({ error: 'Webinar not found.' });
  });
  it('flags a registration-disabled Zoom event as not ready', async () => {
    health.mockResolvedValue({ linked: true, kind: 'meeting', registrationEnabled: false, registrationUrl: null });
    const o = await getRegistrationOverviewAction('c1');
    if ('error' in o) throw new Error(o.error);
    expect(o.readiness.ready).toBe(false);
  });
});

describe('verifyLandingPageAction', () => {
  it('verifies, stamps and stores the report', async () => {
    db.campaign.findUnique.mockResolvedValue({ registrationLink: 'https://lp.example.com/w' });
    verify.mockResolvedValue({ url: 'https://lp.example.com/w', finalUrl: 'https://lp.example.com/w', status: 200, title: 't', platform: 'unknown', embeddable: true, checks: [], overall: 'pass' });
    const r = await verifyLandingPageAction('c1');
    expect(r.overall).toBe('pass');
    expect(r.checkedAt).toBeTruthy();
    expect(db.appSetting.upsert).toHaveBeenCalled();
  });
  it('short-circuits an invalid URL into a failing report WITHOUT any network call', async () => {
    const r = await verifyLandingPageAction('c1', 'javascript:alert(1)');
    expect(r.overall).toBe('fail');
    expect(verify).not.toHaveBeenCalled();
  });
});
