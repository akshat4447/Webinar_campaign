import { notFound } from 'next/navigation';
import { getRegistrationOverviewAction } from '@/lib/actions/registration';
import { getCachedCampaign } from '@/lib/campaignCache';
import { isSetupLocked, isCampaignCompleted } from '@/lib/campaignLifecycle';
import { RegistrationClient } from './RegistrationClient';

export default async function RegistrationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [overview, campaign] = await Promise.all([getRegistrationOverviewAction(id), getCachedCampaign(id).catch(() => null)]);
  if ('error' in overview || !campaign) notFound();

  return (
    <main style={{ flex: 1, overflowY: 'auto' }}>
      <RegistrationClient
        campaignId={id}
        overview={overview}
        zoomLinked={Boolean(campaign.zoomMeetingId)}
        locked={isSetupLocked(campaign)}
        completed={isCampaignCompleted(campaign.status)}
      />
    </main>
  );
}
