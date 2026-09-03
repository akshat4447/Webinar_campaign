import type { Campaign } from '@/lib/generated/prisma/client';

// Every link into a campaign workspace goes through here, so a tab rename is a
// one-file change rather than a hunt across a dozen components.
//
// `setup` is transitional: campaign-detail editing moves into Overview in C6,
// once the creation wizard owns first-time setup.

/** Where a card, a redirect or a breadcrumb should land for this campaign. */
export function campaignLandingHref(campaign: Pick<Campaign, 'id' | 'status'>): string {
  // A finished campaign opens on its results; anything still in flight opens
  // where the operator has work to do.
  return campaign.status === 'completed'
    ? `/campaigns/${campaign.id}/overview`
    : `/campaigns/${campaign.id}/setup`;
}

export function campaignCadenceHref(campaignId: string): string {
  return `/campaigns/${campaignId}/cadence`;
}

/** Label for the card's primary action, which differs by what the campaign needs next. */
export function campaignPrimaryCta(status: string): string {
  if (status === 'draft') return 'Finish setup';
  if (status === 'completed') return 'View report';
  return 'Open';
}
