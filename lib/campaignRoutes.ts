import type { Campaign } from '@/lib/generated/prisma/client';

// Every link into a campaign workspace goes through here, so a tab rename is a
// one-file change rather than a hunt across a dozen components.
//
// `setup` is transitional: campaign-detail editing moves into Overview in C6,
// once the creation wizard owns first-time setup.

/** Where a card, a redirect or a breadcrumb should land for this campaign. */
export function campaignLandingHref(campaign: Pick<Campaign, 'id' | 'status'>): string {
  return campaign.status === 'completed'
    ? `/campaigns/${campaign.id}/results`
    : `/campaigns/${campaign.id}/overview`;
}

export function campaignCadenceHref(campaignId: string): string {
  return `/campaigns/${campaignId}/cadence`;
}

export function campaignMessagingHref(campaignId: string): string {
  return `/campaigns/${campaignId}/messaging`;
}

export function campaignResultsHref(campaignId: string): string {
  return `/campaigns/${campaignId}/results`;
}

/** Straight to a campaign's overview tab, regardless of status — the landing
 *  href above only goes there for a non-completed campaign (completed goes
 *  to /results instead). */
export function campaignOverviewHref(campaignId: string): string {
  return `/campaigns/${campaignId}/overview`;
}

/** Label for the card's primary action, which differs by what the campaign needs next. */
export function campaignPrimaryCta(status: string): string {
  if (status === 'draft') return 'Open workspace';
  if (status === 'completed') return 'View results';
  return 'Open';
}
