import { revalidatePath } from 'next/cache';

// Campaign fields (name, status, counts) surface on the Landing page and
// Sidebar too, not just the campaign's own tabs — revalidate both. The
// 'layout' type covers every nested tab (setup/scoring/templates/...) under
// this campaign, not just whichever exact path string is passed.
//
// Swallows the "static generation store missing" invariant so shared libs stay
// callable from CLI scripts (cadence-tick, backfills, audits) where there is no
// request context — outside a request there's nothing to invalidate anyway.
export function revalidateCampaign(campaignId: string) {
  try {
    revalidatePath(`/campaigns/${campaignId}`, 'layout');
    revalidatePath('/');
  } catch {
    /* not in a request context (script/worker) — nothing to revalidate */
  }
}
