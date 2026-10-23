'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { Field } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { formatLsqDateTime, safeTimeZone, timeZoneLabel, wallClockToDate, COMMON_TIME_ZONES } from '@/lib/dateFormat';
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
import { updateScoringConfigAction } from '@/lib/actions/scoring';
import { landingLinkError, validateWizardDetails } from '@/lib/wizardValidation';
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
import { useDraftAutosave } from '@/components/wizard/useDraftAutosave';
import { getDraftIdForTokenAction, getDraftRevisionAction } from '@/lib/actions/wizardDraft';
import { DraftSaveStatus } from '@/components/wizard/DraftSaveStatus';
import { clearMirror, readMirror, type Mirror } from '@/lib/wizardDraftMirror';
import {
  applyPatchToFields,
  diffDraftFields,
  integrationsHref,
  isEmptyPatch,
  describeGroups,
  type DraftFields,
  type DraftPatch,
  type DraftSpeaker,
  type DraftStepConfig,
} from '@/lib/wizardDraft';
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
  /** Where the draft was left, how far it got, and the revision autosave builds on. */
  wizardStep?: number;
  wizardFurthestStep?: number;
  draftRevision?: number;
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
  customTemplates = {},
  automationRules,
  initialChannels,
  netcoreConfigured,
  initialOrigin,
  connectResult,
}: {
  step: number;
  /** What an Integrations round trip reported when it returned here (shown once). */
  connectResult?: { ok: boolean; detail: string };
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
  customTemplates?: Record<string, { subject: string | null; body: string }>;
  automationRules?: {
    stopOnRegistration?: boolean;
    stopOnDecline?: boolean;
    oneClickSignup?: boolean;
    suppressionPreflight?: boolean;
  };
  initialChannels?: Record<string, boolean>;
  netcoreConfigured?: boolean;
}) {
  const router = useRouter();
  const { showToast } = useToast();

  // The draft may be created by autosave (as soon as there is a title) before the page has been told about it.
  const [createdId, setCreatedId] = useState<string | null>(null);
  const draftId = campaign?.id ?? createdId;
  const [remoteChanged, setRemoteChanged] = useState(false);
  const { queue, state: saveState } = useDraftAutosave({
    campaignId: campaign?.id ?? null,
    baseRevision: campaign?.draftRevision ?? 0,
    step,
    onCreated: (id) => {
      setCreatedId(id);
      // replace, not push: Back must not walk through the creation.
      router.replace(`/campaigns/new?${new URLSearchParams({ id, step: '0' })}`, { scroll: false });
    },
    onRemoteChange: () => setRemoteChanged(true),
  });
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [zoomChoice, setZoomChoice] = useState<'existing' | 'new'>('existing');
  const [zoomMeetings, setZoomMeetings] = useState<ZoomMeeting[] | null>(null);
  const [zoomMeetingId, setZoomMeetingId] = useState(campaign?.zoomMeetingId || '');
  const [zoomLoading, setZoomLoading] = useState(false);
  const [zoomError, setZoomError] = useState<string | null>(null);
  const [suppressionModalOpen, setSuppressionModalOpen] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const linkRef = useRef<HTMLInputElement>(null);

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
      } else if (res.warning) {
        setZoomError(res.warning);
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
          } else if (res.warning) {
            setZoomError(res.warning);
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

  /**
   * Fills the form from a Zoom event: `idOrLink` is the event's numeric ID, from the list. Resolves
   * to an error the person can read when Zoom could not supply the details, instead of looking like success.
   */
  async function selectZoomMeeting(idOrLink: string): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!idOrLink) return { ok: false, error: 'Nothing to look up.' };
    const isId = /^\d{9,11}$/.test(idOrLink);
    if (isId) setZoomMeetingId(idOrLink);

    // Fast preview from the list already on screen
    const quick = isId ? zoomMeetings?.find((m) => m.id === idOrLink) : undefined;
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
    const res = await fetchZoomEventDetailsAction(idOrLink);
    if (!res.ok) {
      // The preview from the list stays, but the reason Zoom would not give the rest is shown, never swallowed.
      return { ok: false, error: res.error };
    }
    const m = res.meeting;
    setZoomMeetingId(m.id);
    // The event is shown in the zone Zoom holds it in, the one the host sees, when that zone is one we know.
    const zone = m.timezone && safeTimeZone(m.timezone) === m.timezone ? m.timezone : (details.timezone ?? initialZone);
    const start = m.startTime ? new Date(m.startTime) : null;
    const localStr = start ? toDateTimeLocal(start, zone) : '';
    const cleanTitle = m.topic.replace(/^\[Webinar\]\s*/, '');

    const mappedSpeakers: SpeakerInput[] = (m.speakers || []).map((s, idx) => ({
      name: s.name,
      title: s.title || (s.isPrimary ? 'Host & Keynote Speaker' : 'Panelist / Speaker'),
      company: s.company || '',
      bio: s.bio,
      avatarUrl: s.avatarUrl,
      isPrimary: !!s.isPrimary,
      order: idx,
    }));

    setDetails((d) => ({
      ...d,
      title: cleanTitle || d.title,
      timezone: zone,
      ...(m.duration && m.duration > 0 ? { durationMinutes: Math.min(720, Math.max(5, Math.round(m.duration))) } : {}),
      date: localStr ? localStr.slice(0, 10) : d.date,
      time: localStr ? localStr.slice(11, 16) : d.time,
      zoomLink: m.joinUrl,
      description: m.agenda || d.description,
      capacity: m.capacity ? String(m.capacity) : d.capacity,
      speakers: mappedSpeakers.length > 0 ? mappedSpeakers : d.speakers,
      speakerName: mappedSpeakers[0]?.name || d.speakerName,
      speakerTitle: mappedSpeakers[0]?.title || d.speakerTitle,
    }));
    return { ok: true };
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

  // --- Autosave -------------------------------------------------------------------------------------------
  // Every autosaved field, read off the form state. Whatever changed since the last look is handed to the
  // queue as a patch, so no input handler needs to know autosave exists.
  const snapshot: DraftFields = {
    title: details.title,
    description: details.description,
    date: details.date,
    time: details.time,
    timezone: details.timezone ?? 'Asia/Kolkata',
    durationMinutes: details.durationMinutes ?? 60,
    capacity: details.capacity,
    registrationLink: details.registrationLink,
    zoomLink: details.zoomLink,
    zoomMeetingId: zoomMeetingId.trim(),
    speakers: (details.speakers ?? []) as DraftSpeaker[],
    selectedChannels: details.selectedChannels ?? [],
    scoringPrompt: scoring.prompt,
    scoringCriteria: scoring.criteria,
    scoringThreshold: scoring.threshold,
    msgMode: messaging.msgMode,
    tone: messaging.tone,
    msgLength: messaging.msgLength,
    aiInstructions: messaging.aiInstructions,
    brief: messaging.brief,
    oneClickSignup: messaging.oneClickSignup,
    personalizationFields: messaging.personalizationFields,
  };
  const snapshotKey = JSON.stringify(snapshot);
  const lastQueued = useRef<DraftFields | null>(null);
  const sentStepConfigs = useRef<Record<string, string>>({});
  useEffect(() => {
    const next = JSON.parse(snapshotKey) as DraftFields;
    if (lastQueued.current === null) {
      // The first look is what the server already holds: nothing to send.
      lastQueued.current = next;
      return;
    }
    const patch = diffDraftFields(lastQueued.current, next);
    lastQueued.current = next;
    if (!isEmptyPatch(patch)) queue.update(patch);
  }, [snapshotKey, queue]);

  // Edits kept on this device by an earlier visit that never reached the server (a crash, a closed laptop).
  const [restorable, setRestorable] = useState<{ mirror: Mirror; older: boolean } | null>(null);
  useEffect(() => {
    const mirror = readMirror(campaign?.id ?? null);
    const base = lastQueued.current;
    if (!mirror || !base) return;
    // Anything the server already has needs no restoring (the page may have unloaded just after a save).
    const remaining: DraftPatch = diffDraftFields(base, applyPatchToFields(base, mirror.patch));
    if (mirror.patch.stepConfigs) remaining.stepConfigs = mirror.patch.stepConfigs;
    if (isEmptyPatch(remaining)) {
      clearMirror(campaign?.id ?? null);
      return;
    }
    const offer = () => setRestorable({ mirror: { ...mirror, patch: remaining }, older: !!campaign && mirror.baseRevision < (campaign.draftRevision ?? 0) });
    if (!campaign && mirror.createToken) {
      // Edits kept before any draft existed. If the draft was in fact created (the page closed as it was being
      // made), the server has it and offering these edits would make a second one.
      void getDraftIdForTokenAction(mirror.createToken)
        .then((existing) => {
          if (existing) clearMirror(null);
          else offer();
        })
        .catch(offer);
      return;
    }
    offer();
    // Runs once per opened draft: later edits replace the stored copy on their own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function restoreUnsaved() {
    if (!restorable) return;
    const patch = restorable.mirror.patch;
    const f = applyPatchToFields(snapshot, patch);
    setDetails((d) => ({
      ...d,
      title: f.title, description: f.description, date: f.date, time: f.time, timezone: f.timezone,
      durationMinutes: f.durationMinutes, capacity: f.capacity, registrationLink: f.registrationLink,
      zoomLink: f.zoomLink, speakers: f.speakers as SpeakerInput[],
      selectedChannels: f.selectedChannels,
      speakerName: (f.speakers.find((x) => x.isPrimary) ?? f.speakers[0])?.name ?? d.speakerName,
      speakerTitle: (f.speakers.find((x) => x.isPrimary) ?? f.speakers[0])?.title ?? d.speakerTitle,
    }));
    setZoomMeetingId(f.zoomMeetingId);
    setScoring({ prompt: f.scoringPrompt, criteria: f.scoringCriteria, threshold: f.scoringThreshold });
    setMessaging((m) => ({
      ...m, msgMode: f.msgMode, tone: f.tone, msgLength: f.msgLength, aiInstructions: f.aiInstructions,
      brief: f.brief, oneClickSignup: f.oneClickSignup, personalizationFields: f.personalizationFields,
    }));
    // Message settings for individual steps live inside the Messaging card; they go straight to the server.
    setRestorable(null);
    if (patch.stepConfigs) {
      // The Messaging card keeps its own copy of each step's settings, so it is reopened from what was saved.
      queue.update({ stepConfigs: patch.stepConfigs });
      void queue.flush().then((ok) => {
        if (ok) window.location.reload();
        else showToast('Restored, but not saved yet. Use Retry in the header.');
      });
      return;
    }
    showToast('Unsaved changes restored.');
  }

  function discardUnsaved() {
    clearMirror(campaign?.id ?? null);
    setRestorable(null);
  }

  // A page restored by the browser's back/forward buttons can be an older copy than the server holds. If the
  // draft has moved on, reload so nothing stale is shown or saved over newer work.
  useEffect(() => {
    if (!campaign) return;
    let active = true;
    void getDraftRevisionAction(campaign.id)
      .then((revision) => {
        if (active && revision !== null && revision > (campaign.draftRevision ?? 0) && !queue.hasUnsaved()) window.location.reload();
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
    // Once per arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Which Zoom source is picked is interface state, not draft data. It is kept for
  // this tab only, so a refresh or a trip to Integrations does not silently reset "Create New in Zoom".
  // Only for a draft that exists: a brand-new wizard must start clean, not inherit what an earlier one left in this tab.
  const zoomUiKey = campaign?.id ? `wizard-ui:${campaign.id}` : null;
  useEffect(() => {
    if (!zoomUiKey) return;
    try {
      const raw = window.sessionStorage.getItem(zoomUiKey);
      if (!raw) return;
      const v = JSON.parse(raw) as { zoomChoice?: string };
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reads browser storage, which the server cannot
      if (v.zoomChoice === 'new') setZoomChoice('new');
    } catch {
      /* storage unavailable: the defaults apply */
    }
    // Read once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!zoomUiKey) return;
    try {
      window.sessionStorage.setItem(zoomUiKey, JSON.stringify({ zoomChoice }));
    } catch {
      /* ignore */
    }
  }, [zoomUiKey, zoomChoice]);

  // Returning from Integrations: say how the connection went, once, then tidy the address bar.
  useEffect(() => {
    if (!connectResult) return;
    showToast(connectResult.ok ? connectResult.detail || 'Connected.' : `Connection failed. ${connectResult.detail}`.trim());
    if (campaign) router.replace(`/campaigns/new?${new URLSearchParams({ id: campaign.id, step: String(step) })}`, { scroll: false });
    // Once per arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A shown error disappears as soon as its field is valid again, whichever path corrected it
  // (typing, or a Zoom event filling the date), instead of lingering until the next Continue.
  const stillInvalid = validateWizardDetails(details);
  const fieldErrors = Object.fromEntries(Object.entries(errors).filter(([k]) => k in stillInvalid));
  const missingDetails = Object.keys(stillInvalid);

  /**
   * Saves whatever is pending. Returns false, with the reason shown, when the draft cannot take the edit: it
   * launched, it is gone, or another tab changed the same field. A save that is merely failing does not block
   * (the edits stay on this device and Continue writes everything itself).
   */
  async function settleDraft(): Promise<boolean> {
    await queue.flush();
    const status = queue.getState().status;
    if (status === 'locked') showToast('This webinar has launched, so it can no longer be edited here.');
    else if (status === 'gone') showToast('This draft was deleted or archived.');
    else if (status === 'conflict') showToast('Another tab changed this draft. Choose Keep Mine or Reload first.');
    return status !== 'locked' && status !== 'gone' && status !== 'conflict';
  }

  async function go(nextStep: number, id = draftId ?? undefined) {
    // Everything typed is saved, and the new step recorded, before the page changes. A save that is merely
    // failing does not trap the person: their edits stay on this device. A launched or deleted draft does stop here.
    queue.setStep(nextStep);
    if (!(await settleDraft())) return;
    router.push(`/campaigns/new?${new URLSearchParams({ ...(id ? { id } : {}), step: String(nextStep) })}`);
  }

  /** Where the Integrations page should send the person back to. Only a draft that exists has somewhere to return to. */
  const returnTo = draftId ? `/campaigns/new?${new URLSearchParams({ id: draftId, step: String(step) })}` : null;

  async function continueFromDetails() {
    const next = validateWizardDetails(details);
    if (Object.keys(next).length) {
      setErrors(next);
      (next.title ? titleRef : next.date ? dateRef : linkRef).current?.focus();
      return;
    }
    setBusy(true);
    const effectiveDetails: WizardDetails = {
      ...details,
      zoomMeetingId: zoomMeetingId.trim() || undefined,
    };
    try {
      // Let autosave land first so this explicit save never races it. A save that is failing does not block
      // Continue, which writes everything itself; a launched or deleted draft does.
      if (!(await settleDraft())) return;
      // The queue may have just created the draft; the page's props only catch up after the next render.
      const existingId = queue.currentCampaignId ?? draftId;
      const id = existingId ?? (await createCampaignFromWizardAction(effectiveDetails));
      // A creation autosave has not managed yet (offline, say) must go to this draft, not make a second one.
      if (!existingId) queue.adopt(id, 0);
      if (existingId) await updateWizardDetailsAction(existingId, effectiveDetails);

      // Collected into one message rather than shown immediately — showToast
      // only ever displays one message at a time, so a Zoom result shown here
      // and then overwritten a few lines down by the "Draft created" toast
      // (new campaigns) would never be seen, silently hiding a Zoom failure.
      let zoomMessage: string | null = null;
      if (zoomChoice === 'existing' && zoomMeetingId) {
        const r = await linkZoomMeetingAction(id, zoomMeetingId);
        if (!r.ok) zoomMessage = r.error;
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

      if (zoomMessage) showToast(zoomMessage);
      else if (!existingId) showToast('Draft created. Next, bring in the audience.');
      await go(1, id);
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
    const scoringId = queue.currentCampaignId ?? draftId;
    if (!scoringId) {
      go(3);
      return;
    }
    setBusy(true);
    try {
      if (!(await settleDraft())) return;
      await updateScoringConfigAction(scoringId, {
        prompt: scoring.prompt,
        criteria: scoring.criteria,
        threshold: scoring.threshold,
      });
      await go(3);
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
    const messagingId = queue.currentCampaignId ?? draftId;
    if (!messagingId) {
      go(5);
      return;
    }
    setBusy(true);
    try {
      if (!(await settleDraft())) return;
      // Channels are left out on purpose: Step 3 owns which channels are on, and this form's copy of them was
      // read when the wizard opened, so sending it back could undo what Step 3 just set.
      await saveWizardMessagingAction(messagingId, { ...messaging, channels: undefined }, { autoDraftInvite: true });
      await go(5);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save messaging setup');
    } finally {
      setBusy(false);
    }
  }

  const furthestStep = Math.max(campaign?.wizardFurthestStep ?? 0, step);

  /** Stepper navigation. Leaving the first step forward needs a valid title and date, as Continue does. */
  function jumpTo(target: number) {
    if (target > step && step === 0) {
      const problems = validateWizardDetails(details);
      if (Object.keys(problems).length) {
        setErrors(problems);
        (problems.title ? titleRef : dateRef).current?.focus();
        return;
      }
    }
    void go(target);
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
    footerHint = `Required before continuing: ${missingDetails.map((k) => (k === 'title' ? 'webinar title' : k === 'date' ? 'date' : 'a valid landing page address (or leave it blank)')).join(' and ')}.`;
  else if (step === 0) footerHint = 'Changes are saved automatically.';
  else if (step === 1)
    footerHint = contactCount === 0 ? 'No contacts yet. Import a list so the next step has someone to score.' : `${contactCount.toLocaleString()} contact${contactCount === 1 ? '' : 's'} imported.`;
  else if (step === 2)
    footerHint = `${scoredCount.toLocaleString()} of ${contactCount.toLocaleString()} contact${contactCount === 1 ? '' : 's'} scored. Scoring settings are saved automatically.`;
  else if (step === 3) footerHint = `${enabledTouchpoints} touchpoint${enabledTouchpoints === 1 ? '' : 's'} enabled.`;
  else if (step === 4) footerHint = 'Messaging setup is saved automatically.';

  return (
    <div className="lsq-page lsq-page--form">
      <header className="lsq-page-header">
        <div className="lsq-page-header__text">
          <p className="lsq-page-header__eyebrow">New Webinar | Step {step + 1} of {STEP_META.length}</p>
          <h1 className="lsq-page-header__title">{meta.title}</h1>
          <p className="lsq-page-header__sub">{meta.sub}</p>
        </div>
        <div className="lsq-page-header__actions">
          <DraftSaveStatus
            state={saveState}
            remoteChanged={remoteChanged}
            onRetry={() => void queue.retry()}
            onKeepMine={() => void queue.keepMine()}
            onReload={() => window.location.reload()}
          />
          {draftId && <Badge color="gray" text="Draft" />}
        </div>
      </header>

      {restorable && (
        <div className="lsq-banner lsq-banner--neutral" role="region" aria-label="Unsaved changes found">
          <span className="lsq-banner__icon" aria-hidden="true"><Icon name="info" size={16} /></span>
          <div>
            <p className="lsq-banner__title">Unsaved Changes Found On This Device</p>
            <p className="lsq-banner__body">
              {restorable.older
                ? 'These edits were made on an older version of this draft. Restoring them replaces the matching fields.'
                : 'These edits were made here but never reached the server.'}
            </p>
          </div>
          <div className="lsq-cluster">
            <Button hierarchy="secondary" size="sm" onClick={restoreUnsaved}>Restore Unsaved Changes</Button>
            <Button hierarchy="tertiary" size="sm" onClick={discardUnsaved}>Discard</Button>
          </div>
        </div>
      )}

      {saveState.status === 'locked' && (
        <div className="lsq-banner lsq-banner--warning" role="alert">
          <span className="lsq-banner__icon" aria-hidden="true"><Icon name="warning" size={16} /></span>
          <div>
            <p className="lsq-banner__title">This Webinar Has Launched</p>
            <p className="lsq-banner__body">Its setup is locked, so edits made here were not saved. Open the workspace to see what was launched.</p>
          </div>
          <Link className="lsq-btn lsq-btn--sm lsq-btn--secondary" href={`/campaigns/${saveState.campaignId}/overview`}>Open Workspace</Link>
        </div>
      )}

      {saveState.status === 'gone' && (
        <div className="lsq-banner lsq-banner--warning" role="alert">
          <span className="lsq-banner__icon" aria-hidden="true"><Icon name="warning" size={16} /></span>
          <div>
            <p className="lsq-banner__title">This Draft No Longer Exists</p>
            <p className="lsq-banner__body">It was deleted or archived from another tab. Start a new webinar to continue.</p>
          </div>
          <Link className="lsq-btn lsq-btn--sm lsq-btn--secondary" href="/">Back To Webinars</Link>
        </div>
      )}

      {saveState.status === 'conflict' && (
        <div className="lsq-banner lsq-banner--warning" role="alert">
          <span className="lsq-banner__icon" aria-hidden="true"><Icon name="warning" size={16} /></span>
          <div>
            <p className="lsq-banner__title">This Draft Was Changed In Another Tab</p>
            <p className="lsq-banner__body">The {describeGroups(saveState.groups)} changed there after this page opened. Keep this version, or reload to see the other one.</p>
          </div>
          <div className="lsq-cluster">
            <Button hierarchy="secondary" size="sm" onClick={() => void queue.keepMine()}>Keep Mine</Button>
            <Button hierarchy="tertiary" size="sm" onClick={() => window.location.reload()}>Reload</Button>
          </div>
        </div>
      )}

      <nav className="lsq-card lsq-wiz-stepper-card" aria-label="Wizard progress">
        <ol className="lsq-stepper lsq-wiz-stepper">
          {STEP_META.map((s, i) => {
            const state = i < step ? 'done' : i === step ? 'current' : 'todo';
            // Any step up to the furthest one reached can be revisited; later ones open in order.
            const reachable = !!draftId && i !== step && i <= furthestStep;
            const inner = (
              <>
                <span className="lsq-step__n" aria-hidden="true">
                  {state === 'done' ? <Icon name="check" size={12} /> : i + 1}
                </span>
                <span className="lsq-wiz-step__label">
                  {s.short}
                  {state === 'done' && <span className="lsq-sr-only"> (completed)</span>}
                  {!reachable && state === 'todo' && <span className="lsq-sr-only"> (not reached yet)</span>}
                </span>
              </>
            );
            return (
              <li key={s.short} className="lsq-step" data-state={state} aria-current={state === 'current' ? 'step' : undefined}>
                {reachable ? (
                  <button type="button" className="lsq-wiz-step__btn" disabled={busy} onClick={() => jumpTo(i)}>
                    {inner}
                  </button>
                ) : (
                  <span className="lsq-wiz-step__btn" data-static="true" data-locked={state === 'todo' ? 'true' : undefined} title={state === 'todo' ? 'Finish the earlier steps first' : undefined}>{inner}</span>
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
                    <div className="lsq-cluster">
                      {/* Connecting Zoom happens on the Integrations page; the link brings the person back to this step. */}
                      <Link className="lsq-btn lsq-btn--sm lsq-btn--tertiary-color" href={integrationsHref(returnTo)}>
                        <Icon name="plug" size={14} />
                        Manage Zoom Connection
                      </Link>
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
                  </div>

                  {zoomLoading ? (
                    <p className="lsq-hint" role="status">Loading events from Zoom</p>
                  ) : zoomMeetings && zoomMeetings.length > 0 ? (
                    <Field label="Zoom event">
                      {(p) => (
                        <select {...p} className="lsq-select" value={zoomMeetingId} onChange={(e) => { setZoomError(null); void selectZoomMeeting(e.target.value).then((r) => { if (!r.ok) setZoomError(r.error); }); }}>
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
                error={fieldErrors.registrationLink ?? (landingLinkError(details.registrationLink) ? `${landingLinkError(details.registrationLink)} It is not saved until it is fixed.` : null)}
                hint={
                  details.registrationLink
                    ? 'Outbound messages route invitees to the custom landing page with recipient tokens. Form submissions register attendees, cancel the outreach cadence and sync calendars.'
                    : 'Leave blank for standard webinars. Outbound messages carry 1-click RSVP links that register contacts in Zoom and the CRM and open the attendee hub with Google, Outlook and Apple calendar scheduling.'
                }
              >
                {(p) => (
                  <input
                    {...p}
                    ref={linkRef}
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

          <ChannelSelectionCard
            selectedChannels={(details.selectedChannels as RegistrationChannelKey[]) || DEFAULT_SELECTED_CHANNELS}
            onChange={(channels) => setDetails((d) => ({ ...d, selectedChannels: channels }))}
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
            onConfigChange={({ prompt, criteria }) => setScoring((sc) => ({ ...sc, prompt, criteria }))}
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
          customTemplates={customTemplates}
          initialMode={messaging.msgMode}
          initialTone={messaging.tone}
          initialLength={messaging.msgLength}
          initialInstructions={messaging.aiInstructions}
          initialBrief={messaging.brief}
          initialOneClickSignup={messaging.oneClickSignup}
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
              personalizationFields: cfg.personalizationFields,
              stepConfigs: cfg.stepConfigs,
            }));
            // Per-step settings are saved for the steps the person changed, and only when they really differ.
            const changed: Record<string, DraftStepConfig> = {};
            for (const key of cfg.touchedStepKeys) {
              const c = cfg.stepConfigs[key];
              if (!c) continue;
              const body: DraftStepConfig = {
                mode: c.mode, templateId: c.templateId, instruction: c.instruction,
                customSubject: c.customSubject, customBody: c.customBody,
              };
              const serialized = JSON.stringify(body);
              if (sentStepConfigs.current[key] === serialized) continue;
              sentStepConfigs.current[key] = serialized;
              changed[key] = body;
            }
            if (Object.keys(changed).length > 0) queue.update({ stepConfigs: changed });
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
          validation={validation}
          approvedCount={liveApprovedCount}
          fieldMappings={fieldMappings}
          activeSteps={activeCadenceSteps}
          msgMode={messaging.msgMode}
          tone={messaging.tone}
          msgLength={messaging.msgLength}
          brief={messaging.brief}
            onApprovedCountChange={(count) => setLiveApprovedCount(count)}
          onChangeRegistration={() => void go(0)}
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
