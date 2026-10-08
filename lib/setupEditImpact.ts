import type { SetupEditImpact } from './actions/setup';

// Shared between every entry point that can open CampaignDetailsForm
// (currently just EditSetupModal on Overview — /setup itself is a redirect
// there) so the warning text and "is there actually anything to lose" check
// can never drift between two independently-written copies of the same logic.

export function impactMessage(impact: SetupEditImpact): string {
  const parts: string[] = [];
  if (impact.scoredCount > 0) parts.push(`${impact.scoredCount} scored contact${impact.scoredCount === 1 ? '' : 's'} (${impact.approvedCount} approved)`);
  if (impact.personalizedCount > 0) parts.push(`${impact.personalizedCount} personalized message draft${impact.personalizedCount === 1 ? '' : 's'}`);
  if (impact.cadenceSendCount > 0) parts.push(`${impact.cadenceSendCount} queued or sent cadence step${impact.cadenceSendCount === 1 ? '' : 's'}`);

  if (parts.length === 0) {
    return "Nothing has been scored, personalized or sent yet, so there's nothing to lose — this just unlocks the form. Your imported contacts are always kept.";
  }
  return `Editing the webinar's topic, date or Zoom event clears work that was built against the old ones: ${parts.join(', ')}. Your imported contact list is kept exactly as is — you'll re-run scoring, messaging and the cadence launch afterward.`;
}

export function hasSetupEditImpact(impact: SetupEditImpact): boolean {
  return impact.scoredCount > 0 || impact.approvedCount > 0 || impact.personalizedCount > 0 || impact.cadenceSendCount > 0;
}
