import { describe, it, expect } from 'vitest';
import { isWrapUpOverdue, isCampaignCompleted, isSetupLocked } from './campaignLifecycle';

const HOUR = 3_600_000;
const at = new Date('2026-08-28T10:00:00Z');

describe('isWrapUpOverdue', () => {
  it('is false before the webinar and within a day of its end', () => {
    expect(isWrapUpOverdue({ status: 'live', scheduledAt: at }, at.getTime() - HOUR)).toBe(false);
    expect(isWrapUpOverdue({ status: 'live', scheduledAt: at }, at.getTime() + 20 * HOUR)).toBe(false);
  });
  it('is true more than a day after the planned end', () => {
    expect(isWrapUpOverdue({ status: 'live', scheduledAt: at }, at.getTime() + 26 * HOUR)).toBe(true);
  });
  it('uses the campaign duration', () => {
    const c = { status: 'live', scheduledAt: at, durationMinutes: 240 };
    expect(isWrapUpOverdue(c, at.getTime() + 27 * HOUR)).toBe(false);
    expect(isWrapUpOverdue(c, at.getTime() + 29 * HOUR)).toBe(true);
  });
  it('never nudges completed, archived or undated campaigns', () => {
    const late = at.getTime() + 500 * HOUR;
    expect(isWrapUpOverdue({ status: 'completed', scheduledAt: at }, late)).toBe(false);
    expect(isWrapUpOverdue({ status: 'archived', scheduledAt: at }, late)).toBe(false);
    expect(isWrapUpOverdue({ status: 'live', scheduledAt: null }, late)).toBe(false);
    expect(isCampaignCompleted('completed')).toBe(true);
  });
});

describe('isSetupLocked', () => {
  it('is open for a draft that has not launched', () => {
    expect(isSetupLocked({ status: 'draft', cadenceStatus: 'not_started' })).toBe(false);
    expect(isSetupLocked({ status: 'draft' })).toBe(false);
  });
  it('locks once launched, however the cadence is now', () => {
    for (const cadenceStatus of ['running', 'paused', 'stopped']) {
      expect(isSetupLocked({ status: 'live', cadenceStatus })).toBe(true);
      expect(isSetupLocked({ status: 'draft', cadenceStatus })).toBe(true);
    }
  });
  it('stays locked when completed', () => {
    expect(isSetupLocked({ status: 'completed', cadenceStatus: 'stopped' })).toBe(true);
  });
});
