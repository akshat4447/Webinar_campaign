import { describe, it, expect } from 'vitest';
import {
  validateCampaignForPublish,
  buildEventPayload,
  buildAnnouncementPostPayload,
  eventPublicUrl,
  LINKEDIN_EVENT_NAME_MAX,
} from './events';

const NOW = new Date('2026-09-01T10:00:00Z');
const FUTURE = new Date('2026-09-15T14:00:00Z');

const validFields = {
  name: 'Scaling High-Velocity Lending Ops with AI',
  description: 'A live session on operational AI.',
  scheduledAt: FUTURE,
  zoomLink: 'https://zoom.us/j/123456789',
  organizationUrn: 'urn:li:organization:42',
};

describe('validateCampaignForPublish', () => {
  it('accepts a fully-formed campaign', () => {
    expect(validateCampaignForPublish(validFields, NOW, { requireOrganizer: true })).toEqual({ ok: true });
  });

  it('rejects a missing name and an over-limit name', () => {
    const noName = validateCampaignForPublish({ ...validFields, name: '   ' }, NOW, { requireOrganizer: false });
    expect(noName.ok).toBe(false);
    if (!noName.ok) expect(noName.error).toContain('name');

    const tooLong = validateCampaignForPublish({ ...validFields, name: 'x'.repeat(LINKEDIN_EVENT_NAME_MAX + 1) }, NOW, { requireOrganizer: false });
    expect(tooLong.ok).toBe(false);
    if (!tooLong.ok) expect(tooLong.error).toContain('150');
  });

  it('rejects a missing description', () => {
    const result = validateCampaignForPublish({ ...validFields, description: null }, NOW, { requireOrganizer: false });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('description');
  });

  it('rejects past and unparseable dates', () => {
    const past = validateCampaignForPublish({ ...validFields, scheduledAt: new Date('2026-08-01T00:00:00Z') }, NOW, { requireOrganizer: false });
    expect(past.ok).toBe(false);
    if (!past.ok) expect(past.error.toLowerCase()).toContain('past');

    const garbage = validateCampaignForPublish({ ...validFields, scheduledAt: null }, NOW, { requireOrganizer: false });
    expect(garbage.ok).toBe(false);
    if (!garbage.ok) expect(garbage.error).toContain('date');
  });

  it('rejects a missing or non-URL zoom link but accepts http', () => {
    const missing = validateCampaignForPublish({ ...validFields, zoomLink: null }, NOW, { requireOrganizer: false });
    expect(missing.ok).toBe(false);

    const junk = validateCampaignForPublish({ ...validFields, zoomLink: 'not a url' }, NOW, { requireOrganizer: false });
    expect(junk.ok).toBe(false);

    const http = validateCampaignForPublish({ ...validFields, zoomLink: 'http://zoom.us/j/1' }, NOW, { requireOrganizer: false });
    expect(http.ok).toBe(true);
  });

  it('requires a well-formed organization URN only in live mode', () => {
    const liveMissing = validateCampaignForPublish({ ...validFields, organizationUrn: null }, NOW, { requireOrganizer: true });
    expect(liveMissing.ok).toBe(false);

    const liveBad = validateCampaignForPublish({ ...validFields, organizationUrn: 'urn:li:person:abc' }, NOW, { requireOrganizer: true });
    expect(liveBad.ok).toBe(false);

    // Sandbox must accept identical input without an org — dry-runs can't
    // demand credentials the sandbox intentionally doesn't have.
    const sandboxOk = validateCampaignForPublish(validFields, NOW, { requireOrganizer: false });
    expect(sandboxOk.ok).toBe(true);
  });
});

describe('buildEventPayload', () => {
  const payload = buildEventPayload({
    name: '  My Webinar  ',
    description: '  Desc  ',
    startTimeMs: Date.UTC(2026, 8, 15, 14, 0),
    organizationUrn: 'urn:li:organization:42',
    externalUrl: 'https://zoom.us/j/123',
    registrationFormUrn: 'urn:li:registrationForm:99',
  });

  it('trims text fields and emits the exact REST field names', () => {
    expect(payload.name).toBe('My Webinar');
    expect(payload.description).toBe('Desc');
    expect(payload.organizer).toEqual({ organizerType: 'ORGANIZATION', value: 'urn:li:organization:42' });
    expect(payload.startDateTime.time).toBe(Date.UTC(2026, 8, 15, 14, 0));
    expect(payload.eventRegistrationsSettings.registrationEnabled).toBe(true);
    expect(payload.eventRegistrationsSettings.externalUrl).toBe('https://zoom.us/j/123');
    expect(payload.eventRegistrationsSettings.registrationFormSettings.registrationForm).toBe('urn:li:registrationForm:99');
  });

  it('defaults endDateTime to two hours after start', () => {
    expect(payload.endDateTime.time - payload.startDateTime.time).toBe(2 * 60 * 60 * 1000);
  });

  it('honors an explicit endTime when provided', () => {
    const custom = buildEventPayload({
      name: 'x',
      description: 'y',
      startTimeMs: 1000,
      endTimeMs: 9000,
      organizationUrn: 'urn:li:organization:1',
      externalUrl: 'https://zoom.us/j/1',
      registrationFormUrn: 'urn:li:registrationForm:1',
    });
    expect(custom.endDateTime.time).toBe(9000);
  });
});

describe('buildAnnouncementPostPayload', () => {
  const post = buildAnnouncementPostPayload({
    organizationUrn: 'urn:li:organization:42',
    eventName: 'My Webinar',
    eventUrl: 'https://www.linkedin.com/events/abc123',
    dateDisplay: 'Sep 15, 2026 · 7:30 PM IST',
    description: 'First line stays intact. '.repeat(20),
  });

  it('posts as the Page, publicly, on the main feed', () => {
    expect(post.author).toBe('urn:li:organization:42');
    expect(post.visibility).toBe('PUBLIC');
    expect(post.distribution.feedDistribution).toBe('MAIN_FEED');
    expect(post.lifecycleState).toBe('PUBLISHED');
  });

  it('always carries the registration URL — the whole point of the post', () => {
    expect(post.commentary).toContain('https://www.linkedin.com/events/abc123');
  });

  it('caps a runaway description with an ellipsis instead of flooding the feed', () => {
    expect(post.commentary.length).toBeLessThan(600);
    expect(post.commentary.endsWith('…')).toBe(false); // URL comes last
    expect(post.commentary).toMatch(/…\n/); // …but the teaser was truncated
  });
});

describe('eventPublicUrl', () => {
  it('strips the URN prefix and tolerates bare ids', () => {
    expect(eventPublicUrl('urn:li:event:12345')).toBe('https://www.linkedin.com/events/12345');
    expect(eventPublicUrl('sbxdeadbeef')).toBe('https://www.linkedin.com/events/sbxdeadbeef');
  });
});