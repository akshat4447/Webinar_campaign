import { redirect } from 'next/navigation';

// The campaign workspace has no landing page of its own — only its layout and
// the seven stage sub-routes (setup/scoring/templates/personalize/schedule/
// control/dashboard). Without this, /campaigns/[id] 404s: any bookmark, typed
// URL, or external link straight to a campaign (rather than one of its tabs)
// hit a dead end. Send it to the first stage instead.
export default async function CampaignIndexPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/campaigns/${id}/setup`);
}
