import { db } from '@/lib/db';
import { getEnrichmentStats } from '@/lib/actions/enrichment';
import { normalizeChannel, DEFAULT_ENABLED_CHANNELS } from '@/lib/channels';
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

  const [contactCount, scoredCount, enrichmentStats, cadenceSteps] = campaign
    ? await Promise.all([
        db.contact.count({ where: { campaignId: campaign.id } }),
        db.contact.count({ where: { campaignId: campaign.id, score: { not: null } } }),
        getEnrichmentStats(campaign.id),
        db.cadenceStep.findMany({
          where: { campaignId: campaign.id, removedAt: null },
          select: { channel: true, enabled: true },
        }),
      ])
    : [0, 0, null, []];

  const initialChannels: Record<string, boolean> = {
    email: DEFAULT_ENABLED_CHANNELS.has('email'),
    linkedin: DEFAULT_ENABLED_CHANNELS.has('linkedin'),
    whatsapp: DEFAULT_ENABLED_CHANNELS.has('whatsapp'),
    sms: DEFAULT_ENABLED_CHANNELS.has('sms'),
  };
  if (cadenceSteps.length > 0) {
    initialChannels.email = false;
    initialChannels.linkedin = false;
    initialChannels.whatsapp = false;
    initialChannels.sms = false;
    for (const s of cadenceSteps) {
      const norm = normalizeChannel(s.channel);
      if (s.enabled) {
        initialChannels[norm] = true;
      }
    }
  }

  return (
    <main style={{ flex: 1, overflowY: 'auto', padding: '28px 32px 64px 32px' }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <WizardClient
          step={campaign ? step : 0}
          initialChannels={initialChannels}
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
