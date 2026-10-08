import { redirect } from 'next/navigation';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { campaignLandingHref } from '@/lib/campaignRoutes';

// The campaign workspace has no landing page of its own — only its layout and
// the tab sub-routes. Without this, /campaigns/[id] 404s: any bookmark, typed
// URL or external link straight to a campaign (rather than one of its tabs)
// would hit a dead end. Send it wherever that campaign's work actually is.
export default async function CampaignIndexPage(props: PageProps<'/campaigns/[id]'>) {
  const { id } = await props.params;
  const campaign = await db.campaign.findUnique({ where: { id }, select: { id: true, status: true } });
  if (!campaign) notFound();
  redirect(campaignLandingHref(campaign));
}
