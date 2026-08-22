import { revalidatePath } from 'next/cache';

// Campaign fields (name, status, counts) surface on the Landing page and
// Sidebar too, not just the campaign's own tabs — revalidate both. The
// 'layout' type covers every nested tab (setup/scoring/templates/...) under
// this campaign, not just whichever exact path string is passed.
export function revalidateCampaign(campaignId: string) {
  revalidatePath(`/campaigns/${campaignId}`, 'layout');
  revalidatePath('/');
}
