import { describe, it, expect } from 'vitest';
import { workspaceTabs } from './demo-data';
import {
  campaignLandingHref,
  campaignCadenceHref,
  campaignMessagingHref,
  campaignResultsHref,
  campaignOverviewHref,
} from './campaignRoutes';

describe('Workspace Tab Information Architecture', () => {
  it('defines exactly 6 canonical tabs in correct workflow order', () => {
    const tabIds = workspaceTabs.map((t) => t.id);
    expect(tabIds).toEqual(['overview', 'audience', 'messaging', 'registration', 'cadence', 'results']);
  });

  it('keeps Messaging and Cadence as separate, distinct tabs', () => {
    const messagingTab = workspaceTabs.find((t) => t.id === 'messaging');
    const cadenceTab = workspaceTabs.find((t) => t.id === 'cadence');

    expect(messagingTab).toBeDefined();
    expect(messagingTab?.label).toBe('Messaging');

    expect(cadenceTab).toBeDefined();
    expect(cadenceTab?.label).toBe('Cadence');

    expect(messagingTab?.id).not.toBe(cadenceTab?.id);
  });

  it('does not expose legacy setup, agent, or post-event as primary workspace tabs', () => {
    const tabIds = workspaceTabs.map((t) => t.id);
    expect(tabIds).not.toContain('setup');
    expect(tabIds).not.toContain('agent');
    expect(tabIds).not.toContain('post-event');
  });

  it('routes correctly for the tabs and campaign landing states', () => {
    const campaignId = 'test-camp-123';
    expect(campaignOverviewHref(campaignId)).toBe('/campaigns/test-camp-123/overview');
    expect(campaignMessagingHref(campaignId)).toBe('/campaigns/test-camp-123/messaging');
    expect(campaignCadenceHref(campaignId)).toBe('/campaigns/test-camp-123/cadence');
    expect(campaignResultsHref(campaignId)).toBe('/campaigns/test-camp-123/results');

    // Completed campaigns land on Results, active campaigns land on Overview
    expect(campaignLandingHref({ id: campaignId, status: 'completed' })).toBe('/campaigns/test-camp-123/results');
    expect(campaignLandingHref({ id: campaignId, status: 'live' })).toBe('/campaigns/test-camp-123/overview');
    expect(campaignLandingHref({ id: campaignId, status: 'draft' })).toBe('/campaigns/test-camp-123/overview');
  });
});
