'use client';

import { useRouter } from 'next/navigation';
import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { Field } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { formatLsqDateTime, safeTimeZone, timeZoneLabel, wallClockToDate, COMMON_TIME_ZONES } from '@/lib/dateFormat';
import { EmailGatewayPicker } from '@/components/wizard/EmailGatewayPicker';
import { LeadImportCard } from '../[id]/setup/LeadImportCard';
import { EnrichmentCard } from '../[id]/setup/EnrichmentCard';
import type { EnrichmentStats } from '@/lib/actions/enrichment';
import {
  createCampaignFromWizardAction,
  improveDraftDescriptionAction,
  saveWizardMessagingAction,
  updateWizardDetailsAction,
  type WizardDetails,
  type AudiencePreflightValidation,
} from '@/lib/actions/wizard';
import {
  type WizardFieldMapping,
  DEFAULT_LEADSQUARED_FIELD_MAPPINGS,
} from '@/lib/wizardFields';
import { createZoomMeetingAction, linkZoomMeetingAction, listZoomMeetingsAction, fetchZoomEventDetailsAction, type ZoomMeeting } from '@/lib/actions/zoom';
import { parseZoomInput } from '@/lib/zoomParser';
import { updateScoringConfigAction } from '@/lib/actions/scoring';
import { validateWizardDetails } from '@/lib/wizardValidation';
import { DEFAULT_ENABLED_CHANNELS } from '@/lib/channels';
import { toDateTimeLocal } from '@/lib/campaignDate';
import { SpeakerListEditor } from '@/components/speakers/SpeakerListEditor';
import type { SpeakerInput } from '@/lib/speakerUtils';
import {
  TONE_OPTIONS,
  LENGTH_OPTIONS,
  DEFAULT_PERSONALIZATION_FIELDS,
} from '@/lib/messagingOptions';
import { LeadSquaredListSyncCard } from '@/components/wizard/LeadSquaredListSyncCard';
import { AudienceValidationCard } from '@/components/wizard/AudienceValidationCard';
import { ClaudeScoringApprovalCard, type ScoredContactItem } from '@/components/wizard/ClaudeScoringApprovalCard';
import { WizardCadenceSetupCard, type WizardCadenceStep } from '@/components/wizard/WizardCadenceSetupCard';
import { WizardMessagingCard, type StepMessagingConfig } from '@/components/wizard/WizardMessagingCard';
import { WizardReviewLaunchCard } from '@/components/wizard/WizardReviewLaunchCard';
import { CampaignSuppressionModal } from '../[id]/cadence/CampaignSuppressionModal';
import { ChannelSelectionCard } from '@/components/channels/ChannelSelectionCard';
import {
  parseSelectedChannels,
  DEFAULT_SELECTED_CHANNELS,
  type RegistrationChannelKey,
} from '@/lib/registrationChannels';

// Step numbers are the URL's ?step= values and must not be reordered: 3 is Cadence, 4 is Messaging.
const STEP_META = [
  { short: 'Details', title: 'Webinar Details', sub: 'Name the session, set the schedule, connect Zoom and choose the registration channels.' },
  { short: 'Audience', title: 'Audience', sub: 'Bring in the contacts who should be invited, from a CSV file or a LeadSquared list.' },
  { short: 'Scoring', title: 'Enrich and Score', sub: 'Fill gaps in the source data, check list quality and approve contacts by relevance score.' },
  { short: 'Cadence', title: 'Cadence Setup', sub: 'Plan the touchpoints that run before and after the session.' },
  { short: 'Messaging', title: 'Messaging and Channels', sub: 'Choose how each touchpoint is written and which channels it uses.' },
  { short: 'Review', title: 'Review and Launch', sub: 'Check every setting, then launch the cadence.' },
] as const;

const TONES = TONE_OPTIONS;
const LENGTHS = LENGTH_OPTIONS;

// Same textarea, different job: in AI mode this is a brief Claude reads (never
// sent as-is), in Templatized mode it becomes the literal invite email body —
// so each mode needs its own default, and templatized's MUST carry {{link}}
// or an operator who never edits it ships an invite with no registration link.
const DEFAULT_BRIEF_BY_MODE = {
  ai: 'Invite the reader to a live session on the webinar topic, tied to the operational problem their role owns. Lead with the problem, not a pitch. Vary the angle by seniority and function. Keep the offer and registration link exactly as given.',
  templatized: "Hi {{firstName}}, join us for a live session on {{topic}} — we'll dig into how teams at companies like {{company}} are tackling this. Save your spot here: {{link}}",
} as const;

interface WizardCampaign {
  id: string;
  name: string;
  description: string | null;
  scheduledAt: string | null;
  speakerName: string | null;
  speakerTitle: string | null;
  capacity: number | null;
  registrationLink: string | null;
  zoomLink: string | null;
  zoomMeetingId?: string | null;
  msgMode: string;
  tone: string | null;
  msgLength: string | null;
  aiInstructions: string | null;
  brief: string | null;
  oneClickSignup: boolean;
  scoringPrompt: string;
  scoringCriteria: string;
  scoringThreshold: number;
  personalizationFields?: string | null;
  lsqFieldMappingTokens?: string | null;
  emailProvider?: string;
  selectedChannels?: string | null;
  speakers?: SpeakerInput[];
  /** IANA timezone the webinar's wall-clock time is expressed in. */
  timezone?: string | null;
  durationMinutes?: number | null;
}

export function WizardClient({
  step,
  campaign,
  contactCount,
  scoredCount,
  approvedCount = 0,
  registeredCount = 0,
  enrichmentStats,
  validationStats,
  cadenceSteps = [],
  scoredContacts = [],
  templateOptions = {},
  automationRules,
  initialChannels,
  defaultEmailProvider,
  netcoreConfigured,
  initialOrigin,
}: {
  step: number;
  initialOrigin?: string;
  campaign: WizardCampaign | null;
  contactCount: number;
  scoredCount: number;
  approvedCount?: number;
  registeredCount?: number;
  enrichmentStats: EnrichmentStats | null;
  validationStats?: AudiencePreflightValidation;
  cadenceSteps?: WizardCadenceStep[];
  scoredContacts?: ScoredContactItem[];
  templateOptions?: Record<string, { id: string; name: string; scope: string }[]>;
  automationRules?: {
    stopOnRegistration?: boolean;
    stopOnDecline?: boolean;
    oneClickSignup?: boolean;
    suppressionPreflight?: boolean;
  };
  initialChannels?: Record<string, boolean>;
  defaultEmailProvider?: 'leadsquared' | 'netcore';
  netcoreConfigured?: boolean;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [zoomChoice, setZoomChoice] = useState<'existing' | 'paste' | 'new'>(
    campaign?.zoomMeetingId ? 'paste' : 'existing'
  );
  const [zoomMeetings, setZoomMeetings] = useState<ZoomMeeting[] | null>(null);
  const [zoomMeetingId, setZoomMeetingId] = useState(campaign?.zoomMeetingId || '');
  const [pastedZoomText, setPastedZoomText] = useState(campaign?.zoomMeetingId || campaign?.zoomLink || '');
  const [parsedZoomInfo, setParsedZoomInfo] = useState<ReturnType<typeof parseZoomInput> | null>(() => {
    if (campaign?.zoomMeetingId || campaign?.zoomLink) {
      return parseZoomInput(campaign.zoomMeetingId || campaign.zoomLink || '');
    }
    return null;
  });
  const [zoomLoading, setZoomLoading] = useState(false);
  const [zoomError, setZoomError] = useState<string | null>(null);
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [suppressionModalOpen, setSuppressionModalOpen] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);

  function handlePastedZoomChange(val: string) {
    setPastedZoomText(val);
    setZoomError(null);
    setPasteError(null);
    if (!val.trim()) {
      setParsedZoomInfo(null);
      setZoomMeetingId('');
      setDetails((d) => ({ ...d, zoomMeetingId: '', zoomLink: '' }));
      return;
    }
    const parsed = parseZoomInput(val);
    setParsedZoomInfo(parsed);
    if (parsed.isValid && parsed.webinarId) {
      setZoomMeetingId(parsed.webinarId);
      setDetails((d) => ({
        ...d,
        zoomMeetingId: parsed.webinarId || undefined,
        zoomLink: parsed.canonicalJoinUrl || parsed.normalizedUrl || d.zoomLink,
      }));
    }
  }

  async function fetchFromPastedZoom() {
    if (!parsedZoomInfo?.webinarId) return;
    setZoomLoading(true);
    setPasteError(null);
    try {
      await selectZoomMeeting(parsedZoomInfo.webinarId);
      showToast('Zoom details fetched and applied.');
    } catch (err) {
      setPasteError(err instanceof Error ? err.message : 'Could not fetch from Zoom API');
    } finally {
      setZoomLoading(false);
    }
  }

  async function pickExistingZoom(force = false) {
    if (zoomLoading) return;
    setZoomChoice('existing');
    setZoomError(null);
    if (zoomMeetings && !force) return;
    setZoomLoading(true);
    try {
      const res = await listZoomMeetingsAction();
      if (!res.ok) {
        setZoomError(res.error);
        return;
      }
      setZoomMeetings(res.meetings);
      if (res.meetings.length === 0) {
        setZoomError('No upcoming meetings or webinars found on this Zoom account. A new event can be created on Zoom, or the Zoom integration connected in Settings.');
      }
    } catch (err) {
      setZoomError(err instanceof Error ? err.message : 'Failed to list Zoom meetings');
    } finally {
      setZoomLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    if (step === 0 && !zoomMeetings) {
      listZoomMeetingsAction().then((res) => {
        if (!active) return;
        if (!res.ok) {
          setZoomError(res.error);
        } else {
          setZoomMeetings(res.meetings);
          if (res.meetings.length === 0) {
            setZoomError('No upcoming meetings or webinars found on this Zoom account. A new event can be created on Zoom, or the Zoom integration connected in Settings.');
          }
        }
      }).catch((err) => {
        if (!active) return;
        setZoomError(err instanceof Error ? err.message : 'Failed to list Zoom meetings');
      });
    }
    return () => {
      active = false;
    };
  }, [step, zoomMeetings]);

  async function selectZoomMeeting(id: string) {
    setZoomMeetingId(id);
    if (!id) return;

    // Fast preview from cached list
    const quick = zoomMeetings?.find((m) => m.id === id);
    if (quick) {
      const start = quick.startTime ? new Date(quick.startTime) : null;
      const localStr = start ? toDateTimeLocal(start, details.timezone) : '';
      const cleanTitle = quick.topic.replace(/^\[Webinar\]\s*/, '');
      setDetails((d) => ({
        ...d,
        title: cleanTitle,
        date: localStr ? localStr.slice(0, 10) : d.date,
        time: localStr ? localStr.slice(11, 16) : d.time,
        zoomLink: quick.joinUrl,
        description: quick.agenda || d.description,
      }));
    }

    // Deep fetch for full speakers, panelists, and capacity
    try {
      const res = await fetchZoomEventDetailsAction(id);
      if (res.ok && res.meeting) {
        const m = res.meeting;
        const start = m.startTime ? new Date(m.startTime) : null;
        const localStr = start ? toDateTimeLocal(start, details.timezone) : '';
        const cleanTitle = m.topic.replace(/^\[Webinar\]\s*/, '');

        const mappedSpeakers: SpeakerInput[] = (m.speakers || []).map((s, idx) => ({
          name: s.name,
          title: s.title || (s.isPrimary ? 'Host & Keynote Speaker' : 'Panelist / Speaker'),
          company: s.company || 'LeadSquared',
          bio: s.bio,
          avatarUrl: s.avatarUrl,
          isPrimary: !!s.isPrimary,
          order: idx,
        }));

        setDetails((d) => ({
          ...d,
          title: cleanTitle || d.title,
          date: localStr ? localStr.slice(0, 10) : d.date,
          time: localStr ? localStr.slice(11, 16) : d.time,
          zoomLink: m.joinUrl,
          description: m.agenda || d.description,
          capacity: m.capacity ? String(m.capacity) : d.capacity,
          speakers: mappedSpeakers.length > 0 ? mappedSpeakers : d.speakers,
          speakerName: mappedSpeakers[0]?.name || d.speakerName,
          speakerTitle: mappedSpeakers[0]?.title || d.speakerTitle,
        }));
      }
    } catch {
      // Non-fatal, quick state remains
    }
  }

  const scheduled = campaign?.scheduledAt ? new Date(campaign.scheduledAt) : null;
  const initialZone = safeTimeZone(campaign?.timezone);
  const local = scheduled ? toDateTimeLocal(scheduled, initialZone) : '';

  const [details, setDetails] = useState<WizardDetails>({
    title: campaign?.name && campaign.name !== 'Untitled webinar' ? campaign.name : '',
    date: local ? local.slice(0, 10) : '',
    time: local ? local.slice(11, 16) : '',
    speakerName: campaign?.speakerName ?? '',
    speakerTitle: campaign?.speakerTitle ?? '',
    description: campaign?.description ?? '',
    capacity: campaign?.capacity ? String(campaign.capacity) : '',
    registrationLink: campaign?.registrationLink ?? '',
    zoomLink: campaign?.zoomLink ?? '',
    speakers:
      campaign?.speakers && campaign.speakers.length > 0
        ? campaign.speakers
        : campaign?.speakerName
          ? [{ name: campaign.speakerName, title: campaign.speakerTitle || '', isPrimary: true, order: 0 }]
          : [],
    emailProvider: (campaign?.emailProvider as 'leadsquared' | 'netcore') ?? defaultEmailProvider ?? 'leadsquared',
    selectedChannels: parseSelectedChannels(campaign?.selectedChannels),
    timezone: initialZone,
    durationMinutes: campaign?.durationMinutes ?? 60,
  });

  const [scoring, setScoring] = useState({
    prompt: campaign?.scoringPrompt ?? '',
    criteria: campaign?.scoringCriteria ?? '',
    threshold: campaign?.scoringThreshold ?? 70,
  });

  // Step 2 & 3 state
  const [fieldMappings] = useState<WizardFieldMapping[]>(() => {
    if (campaign?.lsqFieldMappingTokens) {
      try {
        const parsed = JSON.parse(campaign.lsqFieldMappingTokens);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed as WizardFieldMapping[];
      } catch {
        // A campaign saved before this stored full mapping objects wrote a
        // plain comma-separated token list instead — degrade gracefully by
        // applying just the enabled flag onto the defaults for those, rather
        // than losing the saved on/off state entirely.
        const tokens = campaign.lsqFieldMappingTokens.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
        return DEFAULT_LEADSQUARED_FIELD_MAPPINGS.map((m) => {
          const clean = m.token.replace(/[{}]/g, '').toLowerCase();
          return { ...m, enabled: tokens.includes(clean) };
        });
      }
    }
    return DEFAULT_LEADSQUARED_FIELD_MAPPINGS;
  });

  // These four are all server-computed for the CURRENT step and re-fetched by
  // page.tsx on every `go()` navigation between steps — but go() does a soft
  // `router.push` on the same route, so Next.js reconciles the same
  // <WizardClient> instance rather than remounting it, and a plain
  // useState(prop) initializer only ever runs once, at first mount. Without
  // resyncing, these stayed frozen at their Step-0 values (empty/zero) for
  // the rest of the wizard: the scoring button stayed disabled after import,
  // the validation card kept showing 0 contacts, and cadence setup rendered
  // no steps at all. Comparing the incoming prop reference and updating state
  // during render (this codebase's established pattern for exactly this,
  // e.g. CadenceGroups.tsx's seenSteps/initialSteps) resyncs without a flash
  // of stale content the way a useEffect-based resync would.
  const [activeCadenceSteps, setActiveCadenceSteps] = useState<WizardCadenceStep[]>(cadenceSteps);
  const [seenCadenceSteps, setSeenCadenceSteps] = useState(cadenceSteps);
  if (seenCadenceSteps !== cadenceSteps) {
    setSeenCadenceSteps(cadenceSteps);
    setActiveCadenceSteps(cadenceSteps);
  }

  const [activeScoredContacts, setActiveScoredContacts] = useState<ScoredContactItem[]>(scoredContacts);
  const [seenScoredContacts, setSeenScoredContacts] = useState(scoredContacts);
  if (seenScoredContacts !== scoredContacts) {
    setSeenScoredContacts(scoredContacts);
    setActiveScoredContacts(scoredContacts);
  }

  const [liveApprovedCount, setLiveApprovedCount] = useState<number>(approvedCount);
  const [seenApprovedCount, setSeenApprovedCount] = useState(approvedCount);
  if (seenApprovedCount !== approvedCount) {
    setSeenApprovedCount(approvedCount);
    setLiveApprovedCount(approvedCount);
  }

  const defaultValidation: AudiencePreflightValidation = {
    total: contactCount,
    verifiedWorkEmailCount: contactCount,
    totalWithEmailCount: contactCount,
    missingEmailCount: 0,
    emailHealthPercent: 100,
    linkedinProfileCount: 0,
    linkedinHealthPercent: 0,
    titleAndSeniorityCount: 0,
    titleHealthPercent: 0,
    duplicateCount: 0,
    suppressedCount: 0,
    cleanReadyCount: contactCount,
  };
  const [validation, setValidation] = useState<AudiencePreflightValidation>(validationStats || defaultValidation);
  const [seenValidationStats, setSeenValidationStats] = useState(validationStats);
  if (seenValidationStats !== validationStats) {
    setSeenValidationStats(validationStats);
    setValidation(validationStats || defaultValidation);
  }

  const [messaging, setMessaging] = useState<{
    msgMode: 'ai' | 'templatized';
    tone: string;
    msgLength: string;
    aiInstructions: string;
    brief: string;
    oneClickSignup: boolean;
    channels: Record<string, boolean>;
    emailProvider: 'leadsquared' | 'netcore';
    personalizationFields: string[];
    stepConfigs?: Record<string, StepMessagingConfig>;
  }>({
    msgMode: (campaign?.msgMode as 'ai' | 'templatized') ?? 'ai',
    tone: campaign?.tone ?? TONES[0],
    msgLength: campaign?.msgLength ?? LENGTHS[0],
    aiInstructions:
      campaign?.aiInstructions ??
      (campaign?.brief && !campaign.brief.startsWith("Invite the reader to a live session on the webinar topic, tied to the operational problem their role owns. Lead with the problem, not a pitch. Keep it short and specific.")
        ? campaign.brief
        : DEFAULT_BRIEF_BY_MODE.ai),
    brief: campaign?.brief ?? DEFAULT_BRIEF_BY_MODE.ai,
    oneClickSignup: campaign?.oneClickSignup ?? true,
    emailProvider: (campaign?.emailProvider as 'leadsquared' | 'netcore') ?? defaultEmailProvider ?? 'leadsquared',
    personalizationFields: campaign?.personalizationFields
      ? campaign.personalizationFields.split(',').map((s) => s.trim()).filter(Boolean)
      : [...DEFAULT_PERSONALIZATION_FIELDS],
    channels:
      initialChannels ??
      ({
        email: DEFAULT_ENABLED_CHANNELS.has('email'),
        linkedin: DEFAULT_ENABLED_CHANNELS.has('linkedin'),
        whatsapp: DEFAULT_ENABLED_CHANNELS.has('whatsapp'),
        sms: DEFAULT_ENABLED_CHANNELS.has('sms'),
      } as Record<string, boolean>),
  });

  const set = (k: keyof WizardDetails, v: string) => setDetails((d) => ({ ...d, [k]: v }));

  // A shown error disappears as soon as its field is valid again, whichever path corrected it
  // (typing, or a Zoom event filling the date), instead of lingering until the next Continue.
  const stillInvalid = validateWizardDetails(details);
  const fieldErrors = Object.fromEntries(Object.entries(errors).filter(([k]) => k in stillInvalid));
  const missingDetails = Object.keys(stillInvalid);

  function go(nextStep: number, id = campaign?.id) {
    router.push(`/campaigns/new?${new URLSearchParams({ ...(id ? { id } : {}), step: String(nextStep) })}`);
  }

  async function continueFromDetails() {
    const next = validateWizardDetails(details);
    if (Object.keys(next).length) {
      setErrors(next);
      (next.title ? titleRef : dateRef).current?.focus();
      return;
    }
    setBusy(true);
    const effectiveDetails: WizardDetails = {
      ...details,
      zoomMeetingId: zoomMeetingId.trim() || undefined,
    };
    try {
      const id = campaign ? campaign.id : await createCampaignFromWizardAction(effectiveDetails);
      if (campaign) await updateWizardDetailsAction(campaign.id, effectiveDetails);

      // Collected into one message rather than shown immediately — showToast
      // only ever displays one message at a time, so a Zoom result shown here
      // and then overwritten a few lines down by the "Draft created" toast
      // (new campaigns) would never be seen, silently hiding a Zoom failure.
      let zoomMessage: string | null = null;
      if ((zoomChoice === 'existing' || zoomChoice === 'paste') && zoomMeetingId) {
        const r = await linkZoomMeetingAction(id, zoomMeetingId);
        if (!r.ok && zoomChoice === 'existing') zoomMessage = r.error;
      } else if (zoomChoice === 'new') {
        const r = await createZoomMeetingAction(id);
        if (r.ok && r.meeting) {
          // The server persisted the new meeting's link — mirror it into local
          // state too, otherwise later steps (Messaging, Review) keep showing
          // the Zoom link blank even though a real meeting now exists.
          setDetails((d) => ({ ...d, zoomLink: r.meeting.joinUrl }));
        }
        zoomMessage = r.ok ? 'Zoom meeting created.' : `Zoom meeting not created: ${r.error}`;
      }

      if (!campaign) {
        showToast(zoomMessage ? `Draft created. ${zoomMessage}` : 'Draft created. Next, bring in the audience.');
      } else if (zoomMessage) {
        showToast(zoomMessage);
      }
      go(1, id);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save webinar details');
    } finally {
      setBusy(false);
    }
  }

  async function improve() {
    setBusy(true);
    try {
      const r = await improveDraftDescriptionAction(details.title, details.description);
      if (r.ok && r.description) {
        set('description', r.description);
        showToast('Description rewritten. Edit as needed.');
      } else {
        showToast(r.ok ? 'Nothing returned.' : r.error);
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to improve description');
    } finally {
      setBusy(false);
    }
  }

  async function continueFromScore() {
    if (!campaign) {
      go(3);
      return;
    }
    setBusy(true);
    try {
      await updateScoringConfigAction(campaign.id, {
        prompt: scoring.prompt,
        criteria: scoring.criteria,
        threshold: scoring.threshold,
      });
      go(3);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save scoring config');
    } finally {
      setBusy(false);
    }
  }

  function continueFromCadence() {
    go(4);
  }

  async function continueFromMessaging() {
    if (!campaign) {
      go(5);
      return;
    }
    setBusy(true);
    try {
      await saveWizardMessagingAction(campaign.id, messaging, { autoDraftInvite: true });
      go(5);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save messaging setup');
    } finally {
      setBusy(false);
    }
  }

  const meta = STEP_META[step];
  const onContinue =
    step === 0
      ? continueFromDetails
      : step === 1
        ? () => go(2)
        : step === 2
          ? continueFromScore
          : step === 3
            ? continueFromCadence
            : continueFromMessaging;

  // The typed date and time are wall-clock in the chosen zone; convert once to the real instant for labels.
  const startForLabel = details.date ? wallClockToDate(`${details.date}T${details.time || '09:00'}`, details.timezone) : null;

  const enabledTouchpoints = activeCadenceSteps.filter((s) => s.enabled).length;
  let footerHint = '';
  if (busy) footerHint = 'Saving changes.';
  else if (step === 0 && missingDetails.length)
    footerHint = `Required before continuing: ${missingDetails.map((k) => (k === 'title' ? 'webinar title' : 'date')).join(' and ')}.`;
  else if (step === 0) footerHint = 'Details are saved when continuing.';
  else if (step === 1)
    footerHint = contactCount === 0 ? 'No contacts yet. Import a list so the next step has someone to score.' : `${contactCount.toLocaleString()} contact${contactCount === 1 ? '' : 's'} imported.`;
  else if (step === 2)
    footerHint = `${scoredCount.toLocaleString()} of ${contactCount.toLocaleString()} contact${contactCount === 1 ? '' : 's'} scored. Scoring settings are saved when continuing.`;
  else if (step === 3) footerHint = `${enabledTouchpoints} touchpoint${enabledTouchpoints === 1 ? '' : 's'} enabled.`;
  else if (step === 4) footerHint = 'Messaging setup is saved when continuing.';

  return (
    <div className="lsq-page lsq-page--form">
      <header className="lsq-page-header">
        <div className="lsq-page-header__text">
          <p className="lsq-page-header__eyebrow">New Webinar | Step {step + 1} of {STEP_META.length}</p>
          <h1 className="lsq-page-header__title">{meta.title}</h1>
          <p className="lsq-page-header__sub">{meta.sub}</p>
        </div>
        {campaign && (
          <div className="lsq-page-header__actions">
            <Badge color="gray" text="Draft" />
          </div>
        )}
      </header>

      <nav className="lsq-card lsq-wiz-stepper-card" aria-label="Wizard progress">
        <ol className="lsq-stepper lsq-wiz-stepper">
          {STEP_META.map((s, i) => {
            const state = i < step ? 'done' : i === step ? 'current' : 'todo';
            const clickable = state === 'done' && !!campaign;
            const inner = (
              <>
                <span className="lsq-step__n" aria-hidden="true">
                  {state === 'done' ? <Icon name="check" size={12} /> : i + 1}
                </span>
                <span className="lsq-wiz-step__label">
                  {s.short}
                  {state === 'done' && <span className="lsq-sr-only"> (completed)</span>}
                </span>
              </>
            );
            return (
              <li key={s.short} className="lsq-step" data-state={state} aria-current={state === 'current' ? 'step' : undefined}>
                {clickable ? (
                  <button type="button" className="lsq-wiz-step__btn" disabled={busy} onClick={() => go(i)}>
                    {inner}
                  </button>
                ) : (
                  <span className="lsq-wiz-step__btn" data-static="true">{inner}</span>
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      {step === 0 && (
        <div className="lsq-stack lsq-stack--lg">
          <section className="lsq-card" aria-labelledby="wiz-basics">
            <div className="lsq-card__header">
              <div>
                <h2 className="lsq-card__title" id="wiz-basics">Basics</h2>
                <p className="lsq-card__sub">What the webinar is called and what attendees will learn.</p>
              </div>
            </div>
            <div className="lsq-card__body lsq-stack">
              <Field label="Webinar title" required error={fieldErrors.title}>
                {(p) => (
                  <input
                    {...p}
                    ref={titleRef}
                    className="lsq-input"
                    value={details.title}
                    onChange={(e) => set('title', e.target.value)}
                    placeholder="e.g. Patient Journeys at Scale"
                  />
                )}
              </Field>
              <Field label="Description" optional hint="Claude uses this when scoring relevance and writing messages.">
                {(p) => (
                  <textarea
                    {...p}
                    className="lsq-input"
                    rows={3}
                    value={details.description}
                    onChange={(e) => set('description', e.target.value)}
                    placeholder="What will attendees learn?"
                  />
                )}
              </Field>
              <div className="lsq-cluster">
                <Button hierarchy="secondary-color" size="sm" icon={<Icon name="sparkle" size={14} />} disabled={busy} onClick={improve}>
                  Improve With AI
                </Button>
              </div>
            </div>
          </section>

          <section className="lsq-card" aria-labelledby="wiz-schedule">
            <div className="lsq-card__header">
              <div>
                <h2 className="lsq-card__title" id="wiz-schedule">Schedule</h2>
                <p className="lsq-card__sub">When the session runs and how many seats it has.</p>
              </div>
            </div>
            <div className="lsq-card__body lsq-stack">
              <div className="lsq-grid lsq-grid--narrow">
                <Field label="Date" required error={fieldErrors.date}>
                  {(p) => <input {...p} ref={dateRef} className="lsq-input" type="date" value={details.date} onChange={(e) => set('date', e.target.value)} />}
                </Field>
                <Field label="Time">
                  {(p) => <input {...p} className="lsq-input" type="time" value={details.time} onChange={(e) => set('time', e.target.value)} />}
                </Field>
                <Field label="Seat capacity" optional>
                  {(p) => (
                    <input
                      {...p}
                      className="lsq-input"
                      type="number"
                      min={1}
                      value={details.capacity}
                      onChange={(e) => set('capacity', e.target.value)}
                      placeholder="e.g. 500"
                    />
                  )}
                </Field>
              </div>
              <div className="lsq-grid lsq-grid--narrow">
                <Field label="Timezone" hint="The date and time above are in this zone.">
                  {(p) => (
                    <select {...p} className="lsq-select" value={details.timezone} onChange={(e) => setDetails((d) => ({ ...d, timezone: e.target.value }))}>
                      {[...new Set([details.timezone ?? '', ...COMMON_TIME_ZONES])].filter(Boolean).map((z) => (
                        <option key={z} value={z}>{z.replace('_', ' ')}</option>
                      ))}
                    </select>
                  )}
                </Field>
                <Field label="Duration (minutes)" hint="Sent to Zoom and used to decide when the webinar has ended.">
                  {(p) => (
                    <input
                      {...p}
                      className="lsq-input"
                      type="number"
                      min={5}
                      max={720}
                      step={5}
                      value={details.durationMinutes ?? 60}
                      onChange={(e) => setDetails((d) => ({ ...d, durationMinutes: Number(e.target.value) || 60 }))}
                    />
                  )}
                </Field>
              </div>
              {startForLabel && (
                <p className="lsq-hint">
                  Starts {formatLsqDateTime(startForLabel, details.timezone)} {timeZoneLabel(startForLabel, details.timezone)}
                </p>
              )}
            </div>
          </section>

          <section className="lsq-card" aria-labelledby="wiz-speakers">
            <div className="lsq-card__body">
              <SpeakerListEditor
                headingId="wiz-speakers"
                speakers={details.speakers || []}
                onChange={(updated) => {
                  const primary = updated.find((s) => s.isPrimary) || updated[0];
                  setDetails((d) => ({
                    ...d,
                    speakers: updated,
                    speakerName: primary ? primary.name : '',
                    speakerTitle: primary ? primary.title || '' : '',
                  }));
                }}
              />
            </div>
          </section>

          <section className="lsq-card" aria-labelledby="wiz-zoom">
            <div className="lsq-card__header">
              <div>
                <h2 className="lsq-card__title" id="wiz-zoom">Zoom Integration</h2>
                <p className="lsq-card__sub">Link an existing event or create a new one when continuing.</p>
              </div>
            </div>
            <div className="lsq-card__body lsq-stack">
              <div className="lsq-wiz-options" role="group" aria-label="Zoom event source">
                {(
                  [
                    { id: 'existing', icon: 'calendar', title: 'Select From Zoom', blurb: 'Pick a scheduled event from the Zoom account' },
                    { id: 'paste', icon: 'link', title: 'Paste Link or ID', blurb: 'Paste any Zoom link or webinar ID directly' },
                    { id: 'new', icon: 'plus', title: 'Create New in Zoom', blurb: 'Creates the webinar in Zoom when continuing' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    className="lsq-wiz-option"
                    aria-pressed={zoomChoice === opt.id}
                    onClick={() => {
                      setZoomChoice(opt.id);
                      if (opt.id === 'existing') pickExistingZoom();
                    }}
                  >
                    <span className="lsq-wiz-option__head">
                      <span className="lsq-wiz-option__title">
                        <Icon name={opt.icon} size={16} />
                        {opt.title}
                      </span>
                    </span>
                    <span className="lsq-wiz-option__blurb">{opt.blurb}</span>
                  </button>
                ))}
              </div>

              {zoomChoice === 'existing' && (
                <div className="lsq-stack lsq-stack--sm">
                  <div className="lsq-cluster lsq-cluster--between">
                    <span className="lsq-hint">Upcoming Zoom meetings and webinars</span>
                    <Button
                      hierarchy="tertiary-color"
                      size="sm"
                      icon={<Icon name="refresh" size={14} />}
                      onClick={() => pickExistingZoom(true)}
                      disabled={zoomLoading}
                    >
                      {zoomLoading ? 'Refreshing' : 'Refresh List'}
                    </Button>
                  </div>

                  {zoomLoading ? (
                    <p className="lsq-hint" role="status">Loading events from Zoom</p>
                  ) : zoomMeetings && zoomMeetings.length > 0 ? (
                    <Field label="Zoom event">
                      {(p) => (
                        <select {...p} className="lsq-select" value={zoomMeetingId} onChange={(e) => selectZoomMeeting(e.target.value)}>
                          <option value="">Choose an upcoming webinar or meeting</option>
                          {zoomMeetings.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.topic}
                              {m.startTime ? ` | ${formatLsqDateTime(new Date(m.startTime))}` : ''}
                            </option>
                          ))}
                        </select>
                      )}
                    </Field>
                  ) : null}

                  {zoomError && (
                    <div className="lsq-banner lsq-banner--warning" role="alert">
                      <span className="lsq-banner__icon" aria-hidden="true"><Icon name="warning" size={16} /></span>
                      <p className="lsq-banner__body">{zoomError}</p>
                    </div>
                  )}

                  {zoomMeetingId && (
                    <div className="lsq-banner lsq-banner--success" role="status">
                      <span className="lsq-banner__icon" aria-hidden="true"><Icon name="check-circle" size={16} /></span>
                      <div>
                        <p className="lsq-banner__title">Synced with Zoom</p>
                        <p className="lsq-banner__body">
                          {details.title}
                          {details.speakers && details.speakers.length > 0 && (
                            <> | {details.speakers.length} speaker{details.speakers.length === 1 ? '' : 's'}: {details.speakers.map((s) => s.name).join(', ')}</>
                          )}
                          {details.capacity && <> | Capacity: {details.capacity} seats</>}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {zoomChoice === 'paste' && (
                <div className="lsq-stack lsq-stack--sm">
                  <Field label="Zoom webinar URL or numeric ID">
                    {(p) => (
                      <div className="lsq-cluster lsq-wiz-inputrow">
                        <input
                          {...p}
                          className="lsq-input lsq-grow lsq-wiz-mono"
                          type="text"
                          value={pastedZoomText}
                          onChange={(e) => handlePastedZoomChange(e.target.value)}
                          placeholder="https://zoom.us/webinar/register/WN_... or 849 2049 1823"
                        />
                        {parsedZoomInfo?.isValid && (
                          <Button hierarchy="secondary" icon={<Icon name="bolt" size={14} />} disabled={zoomLoading} onClick={fetchFromPastedZoom}>
                            {zoomLoading ? 'Fetching' : 'Sync Details'}
                          </Button>
                        )}
                      </div>
                    )}
                  </Field>

                  {pasteError && (
                    <div className="lsq-banner lsq-banner--warning" role="alert">
                      <span className="lsq-banner__icon" aria-hidden="true"><Icon name="warning" size={16} /></span>
                      <p className="lsq-banner__body">{pasteError}</p>
                    </div>
                  )}

                  {parsedZoomInfo && parsedZoomInfo.isValid ? (
                    <div className="lsq-banner lsq-banner--success" role="status">
                      <span className="lsq-banner__icon" aria-hidden="true"><Icon name="check-circle" size={16} /></span>
                      <div>
                        <p className="lsq-banner__title">Valid Zoom {parsedZoomInfo.type === 'webinar' ? 'webinar' : 'event'}</p>
                        <p className="lsq-banner__body lsq-cluster">
                          <span className="lsq-wiz-code-inline">ID #{parsedZoomInfo.webinarId}</span>
                          {parsedZoomInfo.isRegistration && <Badge color="blue" text={`Registration slug ${parsedZoomInfo.registrationSlug}`} />}
                          <span>Attribution and auto-sync ready</span>
                        </p>
                      </div>
                    </div>
                  ) : pastedZoomText.trim() ? (
                    <div className="lsq-banner lsq-banner--error" role="alert">
                      <span className="lsq-banner__icon" aria-hidden="true"><Icon name="error" size={16} /></span>
                      <p className="lsq-banner__body">
                        Could not detect a valid Zoom webinar ID or registration link. Enter a 9 to 11 digit ID or a standard zoom.us URL.
                      </p>
                    </div>
                  ) : null}

                  <p className="lsq-hint">
                    Works with Zoom webinar registration links (<span className="lsq-wiz-code-inline">https://zoom.us/webinar/register/WN_...</span>), direct join
                    links (<span className="lsq-wiz-code-inline">https://zoom.us/w/84920491823</span>) or plain IDs. The webinar ID is extracted and passed to the
                    landing page and the registration sync.
                  </p>
                </div>
              )}

              {zoomChoice === 'new' && (
                <div className="lsq-banner lsq-banner--neutral">
                  <span className="lsq-banner__icon" aria-hidden="true"><Icon name="info" size={16} /></span>
                  <p className="lsq-banner__body">
                    A new Zoom meeting or webinar is created automatically from the title, date, time and speakers above when continuing to the next step.
                  </p>
                </div>
              )}
            </div>
          </section>

          <section className="lsq-card" aria-labelledby="wiz-registration">
            <div className="lsq-card__header">
              <div>
                <h2 className="lsq-card__title" id="wiz-registration">Registration Page</h2>
                <p className="lsq-card__sub">Where invitees land when they follow a message link.</p>
              </div>
              <Badge color={details.registrationLink ? 'blue' : 'success'} text={details.registrationLink ? 'Custom landing page' : '1-click registration'} />
            </div>
            <div className="lsq-card__body lsq-stack">
              <Field
                label="Custom landing page URL"
                optional
                hint={
                  details.registrationLink
                    ? 'Outbound messages route invitees to the custom landing page with recipient tokens. Form submissions register attendees, cancel the outreach cadence and sync calendars.'
                    : 'Leave blank for standard webinars. Outbound messages carry 1-click RSVP links that register contacts in Zoom and the CRM and open the attendee hub with Google, Outlook and Apple calendar scheduling.'
                }
              >
                {(p) => (
                  <input
                    {...p}
                    className={`lsq-input${details.registrationLink ? ' lsq-wiz-mono' : ''}`}
                    type="url"
                    value={details.registrationLink}
                    onChange={(e) => {
                      const val = e.target.value;
                      set('registrationLink', val);
                      setMessaging((m) => ({ ...m, oneClickSignup: !val.trim() }));
                    }}
                    placeholder="https://webinar.leadsquared.com/custom-funnel"
                  />
                )}
              </Field>
            </div>
          </section>

          <section className="lsq-card" aria-labelledby="wiz-gateway">
            <div className="lsq-card__header">
              <div>
                <h2 className="lsq-card__title" id="wiz-gateway">Email Delivery</h2>
                <p className="lsq-card__sub">Which service sends the emails for this webinar.</p>
              </div>
            </div>
            <div className="lsq-card__body">
              <EmailGatewayPicker
                value={details.emailProvider || 'leadsquared'}
                netcoreConfigured={netcoreConfigured}
                hint="Choose whether emails for this webinar dispatch via LeadSquared CRM or Netcore Cloud."
                onChange={(gw) => {
                  setDetails((d) => ({ ...d, emailProvider: gw }));
                  setMessaging((m) => ({ ...m, emailProvider: gw }));
                }}
              />
            </div>
          </section>

          <ChannelSelectionCard
            selectedChannels={(details.selectedChannels as RegistrationChannelKey[]) || DEFAULT_SELECTED_CHANNELS}
            onChange={(channels) => setDetails((d) => ({ ...d, selectedChannels: channels }))}
            zoomMeetingId={zoomMeetingId}
            disabled={busy}
          />
        </div>
      )}

      {step === 1 && campaign && (
        <div className="lsq-stack lsq-stack--lg">
          <LeadImportCard campaignId={campaign.id} existingContactCount={contactCount} existingScoredCount={scoredCount} />
          <ImportedContactsPreview contacts={activeScoredContacts} total={contactCount} />
        </div>
      )}

      {step === 2 && campaign && (
        <div className="lsq-stack lsq-stack--lg">
          {enrichmentStats && <EnrichmentCard campaignId={campaign.id} stats={enrichmentStats} />}

          <LeadSquaredListSyncCard
            campaignId={campaign.id}
            campaignTitle={details.title || campaign.name}
            onChanged={() => router.refresh()}
          />

          <AudienceValidationCard validation={validation} onOpenExclusions={() => setSuppressionModalOpen(true)} />

          <ClaudeScoringApprovalCard
            campaignId={campaign.id}
            initialThreshold={scoring.threshold}
            initialPrompt={scoring.prompt}
            initialCriteria={scoring.criteria}
            contacts={activeScoredContacts}
            onThresholdChange={(thresh) => {
              setScoring((s) => ({ ...s, threshold: thresh }));
              setLiveApprovedCount(
                activeScoredContacts.filter((c) =>
                  c.approvedManually ? c.approved : (c.score !== null && c.score >= thresh)
                ).length
              );
              setActiveScoredContacts((prev) =>
                prev.map((c) => ({
                  ...c,
                  approved: c.approvedManually ? c.approved : (c.score !== null && c.score >= thresh),
                }))
              );
            }}
            onRefreshScoring={() => {
              router.refresh();
            }}
          />

          {suppressionModalOpen && (
            <CampaignSuppressionModal
              campaignId={campaign.id}
              campaignName={details.title || campaign.name || 'New Webinar'}
              onClose={() => setSuppressionModalOpen(false)}
              onChanged={() => {
                router.refresh();
              }}
            />
          )}
        </div>
      )}

      {step === 3 && campaign && (
        <WizardCadenceSetupCard
          campaignId={campaign.id}
          webinarDate={details.date ? `${details.date} ${details.time}` : campaign.scheduledAt || undefined}
          initialSteps={activeCadenceSteps}
          approvedCount={liveApprovedCount}
          registeredCount={registeredCount}
          automationRules={automationRules}
          onStepsChange={(updated) => setActiveCadenceSteps(updated)}
        />
      )}

      {step === 4 && campaign && (
        <WizardMessagingCard
          campaignId={campaign.id}
          webinarTitle={details.title}
          webinarDate={details.date}
          webinarTime={details.time}
          speakerName={details.speakerName}
          speakerTitle={details.speakerTitle}
          speakers={details.speakers}
          registrationLink={details.registrationLink}
          zoomLink={details.zoomLink}
          activeSteps={activeCadenceSteps}
          fieldMappings={fieldMappings}
          templateOptions={templateOptions}
          initialMode={messaging.msgMode}
          initialTone={messaging.tone}
          initialLength={messaging.msgLength}
          initialInstructions={messaging.aiInstructions}
          initialBrief={messaging.brief}
          initialOneClickSignup={messaging.oneClickSignup}
          initialEmailProvider={messaging.emailProvider}
          initialGroundingFields={messaging.personalizationFields}
          netcoreConfigured={netcoreConfigured}
          sampleContact={activeScoredContacts[0] ? {
            name: activeScoredContacts[0].name,
            title: activeScoredContacts[0].title,
            account: activeScoredContacts[0].account,
            score: activeScoredContacts[0].score,
          } : undefined}
          onChange={(cfg) => {
            setMessaging((prev) => ({
              ...prev,
              msgMode: cfg.msgMode,
              tone: cfg.tone,
              msgLength: cfg.msgLength,
              aiInstructions: cfg.aiInstructions,
              brief: cfg.brief,
              oneClickSignup: cfg.oneClickSignup,
              emailProvider: cfg.emailProvider,
              personalizationFields: cfg.personalizationFields,
              stepConfigs: cfg.stepConfigs,
            }));
          }}
        />
      )}

      {step === 5 && campaign && (
        <WizardReviewLaunchCard
          timezone={details.timezone}
          durationMinutes={details.durationMinutes}
          campaignId={campaign.id}
          webinarTitle={details.title}
          webinarDate={details.date}
          webinarTime={details.time}
          scheduledAt={campaign.scheduledAt ?? undefined}
          initialOrigin={initialOrigin}
          description={details.description}
          capacity={details.capacity}
          registrationLink={details.registrationLink}
          zoomLink={details.zoomLink}
          zoomMeetingId={zoomMeetingId || campaign.zoomMeetingId || undefined}
          speakers={details.speakers}
          emailProvider={messaging.emailProvider}
          validation={validation}
          approvedCount={liveApprovedCount}
          fieldMappings={fieldMappings}
          activeSteps={activeCadenceSteps}
          msgMode={messaging.msgMode}
          tone={messaging.tone}
          msgLength={messaging.msgLength}
          brief={messaging.brief}
            onApprovedCountChange={(count) => setLiveApprovedCount(count)}
          onFunnelModeChange={(mode, link) => {
            set('registrationLink', mode === 'framer' ? (link || '') : '');
            setMessaging((m) => ({ ...m, oneClickSignup: mode === 'normal' }));
          }}
        />
      )}

      <footer className="lsq-card lsq-wiz-footer">
        <div className="lsq-wiz-footer__back">
          {step > 0 && (
            <Button hierarchy="secondary" icon={<Icon name="arrow-left" size={16} />} disabled={busy} onClick={() => go(step - 1)}>
              Back
            </Button>
          )}
        </div>
        {footerHint && (
          <p className="lsq-hint lsq-wiz-footer__hint" role="status" aria-live="polite">
            {footerHint}
          </p>
        )}
        {step < 5 && (
          <div className="lsq-wiz-footer__next">
            <Button icon={<Icon name="arrow-right" size={16} />} iconPosition="trailing" loading={busy} onClick={onContinue}>
              {busy ? 'Saving' : 'Continue'}
            </Button>
          </div>
        )}
      </footer>
    </div>
  );
}

/** What the import actually stored, read back from the database, so the numbers match the next steps. */
function ImportedContactsPreview({ contacts, total }: { contacts: ScoredContactItem[]; total: number }) {
  if (total === 0) return null;
  const withEmail = contacts.filter((c) => c.email).length;
  const preview = contacts.slice(0, 5);
  return (
    <section className="lsq-card" aria-labelledby="wiz-imported">
      <div className="lsq-card__header">
        <div>
          <h2 className="lsq-card__title" id="wiz-imported">Imported Contacts</h2>
          <p className="lsq-card__sub">
            {total.toLocaleString()} contact{total === 1 ? '' : 's'} imported. Every column without a first-class field is kept alongside the contact, so nothing supplied is discarded.
          </p>
        </div>
      </div>
      <div className="lsq-card__body lsq-stack">
        <div className="lsq-grid lsq-grid--narrow">
          <div className="lsq-wiz-stat">
            <p className="lsq-wiz-stat__label">Contacts</p>
            <p className="lsq-wiz-stat__value">{total.toLocaleString()}</p>
          </div>
          <div className="lsq-wiz-stat">
            <p className="lsq-wiz-stat__label">With email</p>
            <p className="lsq-wiz-stat__value">{withEmail.toLocaleString()}</p>
          </div>
          <div className="lsq-wiz-stat" data-tone={total - withEmail > 0 ? 'warn' : undefined}>
            <p className="lsq-wiz-stat__label">Missing email</p>
            <p className="lsq-wiz-stat__value">{(total - withEmail).toLocaleString()}</p>
          </div>
        </div>
        <div className="lsq-table-wrap" tabIndex={0} role="region" aria-label="Scrollable table">
          <table className="lsq-table">
            <caption className="lsq-sr-only">Preview of the first {preview.length} imported contacts</caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Email</th>
                <th scope="col">Company</th>
                <th scope="col">Title</th>
              </tr>
            </thead>
            <tbody>
              {preview.map((c) => (
                <tr key={c.id}>
                  <td className="lsq-cell-primary lsq-cell-truncate">{c.name || 'Unnamed'}</td>
                  <td className="lsq-cell-truncate">{c.email || <Badge color="warning" text="No email" />}</td>
                  <td className="lsq-cell-truncate">{c.account || 'None'}</td>
                  <td className="lsq-cell-truncate">{c.title || 'None'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {total > preview.length && (
          <p className="lsq-hint">Showing {preview.length} of {total.toLocaleString()} contacts.</p>
        )}
      </div>
    </section>
  );
}
