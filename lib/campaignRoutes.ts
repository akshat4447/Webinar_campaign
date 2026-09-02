import type { Campaign } from '@/lib/generated/prisma/client';

// Every link into a campaign workspace goes through here. The tab folder names
// change in C2B (setup/scoring/personalize/schedule/control/dashboard become
// overview/audience/messaging/cadence/agent/post-event), and there is no
// appetite for hunting hrefs across a dozen components when they do.

/** Where a card, a redirect or a breadcrumb should land for this campaign. */
export function campaignLandingHref(campaign: Pick<Campaign, 'id' | 'status'>): string {
  // A finished campaign opens on its results; anything still in flight opens
  // where the operator has work to do.
  return campaign.status === 'completed'
    ? `/campaigns/${campaign.id}/dashboard`
    : `/campaigns/${campaign.id}/setup`;
}

export function campaignCadenceHref(campaignId: string): string {
  return `/campaigns/${campaignId}/schedule`;
}

/** Label for the card's primary action, which differs by what the campaign needs next. */
export function campaignPrimaryCta(status: string): string {
  if (status === 'draft') return 'Finish setup';
  if (status === 'completed') return 'View report';
  return 'Open';
}
