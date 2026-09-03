import { db } from '@/lib/db';
import { getEnrichmentStats } from '@/lib/actions/enrichment';
import { WizardClient } from './WizardClient';

// The wizard is server-rendered per step and carries its draft in the URL
// (?id=&step=). That keeps the embedded import/enrich cards reading fresh data
// after every action, and makes a half-finished wizard a shareable, resumable
// link rather than lost client state.
export const dynamic = 'force-dynamic';

export default async function NewCampaignPage(props: PageProps<'/campaigns/new'>) {
  const sp = await props.searchParams;
  const id = typeof sp.id === 'string' ? sp.id : undefined;
  const step = Math.min(3, Math.max(0, Number.parseInt(typeof sp.step === 'string' ? sp.step : '0', 10) || 0));

  const campaign = id ? await db.campaign.findUnique({ where: { id } }) : null;

  const [contactCount, scoredCount, enrichmentStats] = campaign
    ? await Promise.all([
        db.contact.count({ where: { campaignId: campaign.id } }),
        db.contact.count({ where: { campaignId: campaign.id, score: { not: null } } }),
        getEnrichmentStats(campaign.id),
      ])
    : [0, 0, null];

  return (
    <main style={{ flex: 1, overflowY: 'auto', padding: '28px 32px 64px 32px' }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <WizardClient
          step={campaign ? step : 0}
          campaign={
            campaign
              ? {
                  id: campaign.id,
                  name: campaign.name,
                  description: campaign.description,
                  scheduledAt: campaign.scheduledAt?.toISOString() ?? null,
                  speakerName: campaign.speakerName,
                  speakerTitle: campaign.speakerTitle,
                  capacity: campaign.capacity,
                  registrationLink: campaign.registrationLink,
                  zoomLink: campaign.zoomLink,
                  msgMode: campaign.msgMode,
                  tone: campaign.tone,
                  msgLength: campaign.msgLength,
                  aiInstructions: campaign.aiInstructions,
                  brief: campaign.brief,
                  oneClickSignup: campaign.oneClickSignup,
                  scoringPrompt: campaign.scoringPrompt,
                  scoringCriteria: campaign.scoringCriteria,
                  scoringThreshold: campaign.scoringThreshold,
                }
              : null
          }
          contactCount={contactCount}
          scoredCount={scoredCount}
          enrichmentStats={enrichmentStats}
        />
      </div>
    </main>
  );
}
