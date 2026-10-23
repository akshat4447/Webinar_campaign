import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { isSetupLocked } from '@/lib/campaignLifecycle';
import { getEnrichmentStats } from '@/lib/actions/enrichment';
import { normalizeChannel, DEFAULT_ENABLED_CHANNELS } from '@/lib/channels';
import { getIntegrationConfigMasked } from '@/lib/integrationConfig';
import { compareCadenceSteps } from '@/lib/stepSchedule';
import {
  getAudiencePreflightValidationAction,
  getScoredContactsForWizardAction,
} from '@/lib/actions/wizard';
import { appOrigin } from '@/lib/appOrigin';
import { clampStep } from '@/lib/wizardDraft';
import { WizardClient } from './WizardClient';

// The wizard is server-rendered per step and carries its draft in the URL
// (?id=&step=). That keeps the embedded import/enrich cards reading fresh data
// after every action, and makes a half-finished wizard a shareable, resumable
// link rather than lost client state.
export const dynamic = 'force-dynamic';

export default async function NewCampaignPage(props: PageProps<'/campaigns/new'>) {
  const sp = await props.searchParams;
  const id = typeof sp.id === 'string' ? sp.id : undefined;
  const stepParam = typeof sp.step === 'string' ? Number.parseInt(sp.step, 10) : NaN;
  const campaign = id
    ? await db.campaign.findUnique({
        where: { id },
        include: { speakers: { orderBy: [{ order: 'asc' }, { id: 'asc' }] } },
      })
    : null;

  // A launched webinar's setup is a record, not a form: reopening the creation wizard for it would
  // re-offer every setting. Send it to its workspace instead.
  if (campaign && isSetupLocked(campaign)) redirect(`/campaigns/${campaign.id}/overview`);

  // A link without ?step= (the Draft card, the sidebar shortcut, a bookmark) reopens where the draft was left.
  const step = clampStep(Number.isFinite(stepParam) ? stepParam : (campaign?.wizardStep ?? 0));
  // What an OAuth round trip reports when it returns to this page; the client shows it once and clears it.
  const connected = typeof sp.connected === 'string' ? sp.connected : undefined;
  const connectedDetail = typeof sp.detail === 'string' ? sp.detail : undefined;

  const [
    contactCount,
    scoredCount,
    approvedCount,
    registeredCount,
    enrichmentStats,
    cadenceSteps,
    validationStats,
    scoredContacts,
    selectableTemplates,
    ownTemplates,
  ] = campaign
    ? await Promise.all([
        db.contact.count({ where: { campaignId: campaign.id } }),
        db.contact.count({ where: { campaignId: campaign.id, score: { not: null } } }),
        db.contact.count({ where: { campaignId: campaign.id, approved: true } }),
        db.contact.count({ where: { campaignId: campaign.id, registeredAt: { not: null } } }),
        getEnrichmentStats(campaign.id),
        db.cadenceStep.findMany({
          where: { campaignId: campaign.id, removedAt: null },
          orderBy: { offsetValue: 'asc' },
        }),
        getAudiencePreflightValidationAction(campaign.id),
        getScoredContactsForWizardAction(campaign.id),
        db.messageTemplate.findMany({
          where: { OR: [{ campaignId: null }, { campaignId: campaign.id }], hidden: false },
          orderBy: [{ campaignId: 'asc' }, { name: 'asc' }],
          select: { id: true, name: true, channel: true, campaignId: true },
        }),
        // Copy typed for this webinar's own steps, so reopening Messaging shows it instead of the defaults.
        db.messageTemplate.findMany({
          where: { campaignId: campaign.id, key: { not: null } },
          select: { key: true, subject: true, body: true },
        }),
      ])
    : [
        0,
        0,
        0,
        0,
        null,
        [],
        {
          total: 0,
          verifiedWorkEmailCount: 0,
          totalWithEmailCount: 0,
          missingEmailCount: 0,
          emailHealthPercent: 0,
          linkedinProfileCount: 0,
          linkedinHealthPercent: 0,
          titleAndSeniorityCount: 0,
          titleHealthPercent: 0,
          duplicateCount: 0,
          suppressedCount: 0,
          cleanReadyCount: 0,
        },
        [],
        [],
        [],
      ];

  const customTemplates: Record<string, { subject: string | null; body: string }> = {};
  for (const t of ownTemplates) if (t.key) customTemplates[t.key] = { subject: t.subject, body: t.body };

  const templateOptions: Record<string, { id: string; name: string; scope: string }[]> = {};
  for (const t of selectableTemplates) {
    (templateOptions[t.channel] ??= []).push({
      id: t.id,
      name: t.name,
      scope: t.campaignId ? 'this campaign' : 'library',
    });
  }

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

  const netcoreConfig = await getIntegrationConfigMasked('netcore');
  const netcoreConfigured = !!netcoreConfig.apiKey?.hasValue;
  const sortedCadenceSteps = [...cadenceSteps].sort(compareCadenceSteps);

  return (
    <main style={{ flex: 1, overflowY: 'auto' }}>
      <WizardClient
        step={campaign ? step : 0}
        connectResult={connected ? { ok: connected === 'ok', detail: connectedDetail ?? '' } : undefined}
        initialOrigin={appOrigin()}
        initialChannels={initialChannels}
        netcoreConfigured={netcoreConfigured}
        campaign={
          campaign
            ? {
                id: campaign.id,
                name: campaign.name,
                wizardStep: campaign.wizardStep,
                wizardFurthestStep: campaign.wizardFurthestStep,
                draftRevision: campaign.draftRevision,
                zoomMeetingId: campaign.zoomMeetingId,
                description: campaign.description,
                scheduledAt: campaign.scheduledAt?.toISOString() ?? null,
                timezone: campaign.timezone,
                durationMinutes: campaign.durationMinutes,
                speakerName: campaign.speakerName,
                speakerTitle: campaign.speakerTitle,
                capacity: campaign.capacity,
                registrationLink: campaign.registrationLink,
                zoomLink: campaign.zoomLink,
                selectedChannels: campaign.selectedChannels,
                msgMode: campaign.msgMode,
                tone: campaign.tone,
                msgLength: campaign.msgLength,
                aiInstructions: campaign.aiInstructions,
                brief: campaign.brief,
                oneClickSignup: campaign.oneClickSignup,
                scoringPrompt: campaign.scoringPrompt,
                scoringCriteria: campaign.scoringCriteria,
                scoringThreshold: campaign.scoringThreshold,
                personalizationFields: campaign.personalizationFields,
                lsqFieldMappingTokens: campaign.lsqFieldMappingTokens,
                speakers: campaign.speakers.map((s) => ({
                  id: s.id,
                  name: s.name,
                  title: s.title,
                  company: s.company,
                  bio: s.bio,
                  avatarUrl: s.avatarUrl,
                  linkedinUrl: s.linkedinUrl,
                  isPrimary: s.isPrimary,
                  order: s.order,
                })),
              }
            : null
        }
        contactCount={contactCount}
        scoredCount={scoredCount}
        approvedCount={approvedCount}
        registeredCount={registeredCount}
        enrichmentStats={enrichmentStats}
        validationStats={validationStats}
        cadenceSteps={sortedCadenceSteps}
        scoredContacts={scoredContacts}
        templateOptions={templateOptions}
        customTemplates={customTemplates}
        automationRules={
          campaign
            ? {
                stopOnRegistration: campaign.stopOnRegistration,
                stopOnDecline: campaign.stopOnDecline,
                oneClickSignup: campaign.oneClickSignup,
                suppressionPreflight: campaign.suppressionPreflight,
              }
            : undefined
        }
      />
    </main>
  );
}
