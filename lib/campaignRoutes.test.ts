import { describe, it, expect } from 'vitest';
import { campaignLandingHref, campaignCadenceHref, campaignPrimaryCta } from './campaignRoutes';

describe('campaignLandingHref', () => {
  it('opens a completed campaign on its results', () => {
    expect(campaignLandingHref({ id: 'c1', status: 'completed' })).toBe('/campaigns/c1/overview');
  });

  it('opens a draft or live campaign on setup — where there is still work to do', () => {
    expect(campaignLandingHref({ id: 'c1', status: 'draft' })).toBe('/campaigns/c1/setup');
    expect(campaignLandingHref({ id: 'c1', status: 'live' })).toBe('/campaigns/c1/setup');
  });
});

describe('campaignCadenceHref', () => {
  it('links straight to a campaign\'s cadence planner', () => {
    expect(campaignCadenceHref('abc123')).toBe('/campaigns/abc123/cadence');
  });
});

describe('campaignPrimaryCta', () => {
  it('labels the primary action by status', () => {
    expect(campaignPrimaryCta('draft')).toBe('Finish setup');
    expect(campaignPrimaryCta('completed')).toBe('View report');
    expect(campaignPrimaryCta('live')).toBe('Open');
  });

  it('defaults to "Open" for any other status value', () => {
    expect(campaignPrimaryCta('archived')).toBe('Open');
  });
});
