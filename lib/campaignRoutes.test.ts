import { describe, it, expect } from 'vitest';
import {
  campaignLandingHref,
  campaignCadenceHref,
  campaignMessagingHref,
  campaignResultsHref,
  campaignOverviewHref,
  campaignPrimaryCta,
} from './campaignRoutes';

describe('campaignLandingHref', () => {
  it('opens a completed campaign on its results', () => {
    expect(campaignLandingHref({ id: 'c1', status: 'completed' })).toBe('/campaigns/c1/results');
  });

  it('opens a draft or live campaign on overview with edit setup modal available', () => {
    expect(campaignLandingHref({ id: 'c1', status: 'draft' })).toBe('/campaigns/c1/overview');
    expect(campaignLandingHref({ id: 'c1', status: 'live' })).toBe('/campaigns/c1/overview');
  });
});

describe('campaignCadenceHref', () => {
  it('links straight to a campaign\'s cadence planner', () => {
    expect(campaignCadenceHref('abc123')).toBe('/campaigns/abc123/cadence');
  });
});

describe('campaignMessagingHref', () => {
  it('links straight to a campaign\'s messaging studio', () => {
    expect(campaignMessagingHref('abc123')).toBe('/campaigns/abc123/messaging');
  });
});

describe('campaignResultsHref', () => {
  it('links straight to a campaign\'s results tab', () => {
    expect(campaignResultsHref('abc123')).toBe('/campaigns/abc123/results');
  });
});

describe('campaignOverviewHref', () => {
  it('links straight to a campaign\'s overview tab', () => {
    expect(campaignOverviewHref('abc123')).toBe('/campaigns/abc123/overview');
  });
});

describe('campaignPrimaryCta', () => {
  it('labels the primary action by status', () => {
    expect(campaignPrimaryCta('draft')).toBe('Open workspace');
    expect(campaignPrimaryCta('completed')).toBe('View results');
    expect(campaignPrimaryCta('live')).toBe('Open');
  });

  it('defaults to "Open" for any other status value', () => {
    expect(campaignPrimaryCta('archived')).toBe('Open');
  });
});
