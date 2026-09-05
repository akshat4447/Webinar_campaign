'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { resetCampaignForEditAction, type SetupEditImpact } from '@/lib/actions/setup';
import { CampaignDetailsOverview } from './CampaignDetailsOverview';
import { CampaignDetailsForm } from './CampaignDetailsForm';
import type { Campaign } from '@/lib/generated/prisma/client';

function impactMessage(impact: SetupEditImpact): string {
  const parts: string[] = [];
  if (impact.scoredCount > 0) parts.push(`${impact.scoredCount} scored contact${impact.scoredCount === 1 ? '' : 's'} (${impact.approvedCount} approved)`);
  if (impact.personalizedCount > 0) parts.push(`${impact.personalizedCount} personalized message draft${impact.personalizedCount === 1 ? '' : 's'}`);
  if (impact.cadenceSendCount > 0) parts.push(`${impact.cadenceSendCount} queued or sent cadence step${impact.cadenceSendCount === 1 ? '' : 's'}`);

  if (parts.length === 0) {
    return "Nothing has been scored, personalized or sent yet, so there's nothing to lose — this just unlocks the form. Your imported contacts are always kept.";
  }
  return `Editing the webinar's topic, date or Zoom event clears work that was built against the old ones: ${parts.join(', ')}. Your imported contact list is kept exactly as is — you'll re-run scoring, messaging and the cadence launch afterward.`;
}

/**
 * Once a campaign has real audience data, its core details switch to a
 * read-only overview — changing the topic, date or Zoom event after Claude
 * has scored contacts, written personalized copy, or the cadence has queued
 * sends against the old details would leave all of that silently stale. The
 * "Edit details" button says exactly what confirming will clear before it
 * happens, using real counts rather than a generic warning.
 *
 * A campaign with no contacts yet has nothing that could go stale, so it
 * keeps the form open directly — the overview-then-edit gate only exists to
 * protect real downstream work.
 */
export function WebinarDetailsCard({
  campaign,
  serverNow,
  hasAudience,
  impact,
}: {
  campaign: Campaign;
  serverNow: number;
  hasAudience: boolean;
  impact: SetupEditImpact;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<'overview' | 'edit'>(hasAudience ? 'overview' : 'edit');
  const [confirming, setConfirming] = useState(false);
  const [resetting, setResetting] = useState(false);

  async function confirmEdit() {
    setResetting(true);
    await resetCampaignForEditAction(campaign.id);
    setResetting(false);
    setConfirming(false);
    setMode('edit');
    router.refresh();
  }

  if (mode === 'edit') {
    return <CampaignDetailsForm campaign={campaign} serverNow={serverNow} onDone={hasAudience ? () => setMode('overview') : undefined} />;
  }

  return (
    <>
      <CampaignDetailsOverview campaign={campaign} onEdit={() => setConfirming(true)} />
      {confirming && (
        <ConfirmDialog
          title="Edit webinar details?"
          message={impactMessage(impact)}
          confirmLabel="Edit details"
          destructive={impact.scoredCount > 0 || impact.personalizedCount > 0 || impact.cadenceSendCount > 0}
          busy={resetting}
          onConfirm={confirmEdit}
          onClose={() => setConfirming(false)}
        />
      )}
    </>
  );
}
