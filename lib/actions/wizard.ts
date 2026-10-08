'use server';

import { db } from '@/lib/db';
import { provisionCampaignDefaults } from '@/lib/campaignDefaults';
import { formatWebinarDate } from '@/lib/campaignDate';
import { revalidateCampaign } from '@/lib/revalidate';
import { syncSpeakersForCampaign } from '@/lib/speakersServer';
import type { SpeakerInput } from '@/lib/speakers';
import {
  serializeSelectedChannels,
  DEFAULT_SELECTED_CHANNELS,
  type RegistrationChannelKey,
} from '@/lib/registrationChannels';

// Server actions for the creation wizard.
//
// The campaign row is created at the end of step 0 rather than at the end of
// the wizard, because steps 1-3 (import, enrich, score) all need something to
// attach to and all reuse the existing per-campaign actions. A wizard abandoned
// after step 0 leaves a draft, which is exactly what the Drafts filter is for.

export interface WizardDetails {
  title: string;
  date: string;
  time: string;
  speakerName: string;
  speakerTitle: string;
  description: string;
  capacity: string;
  registrationLink: string;
  zoomLink: string;
  zoomMeetingId?: string;
  speakers?: SpeakerInput[];
  emailProvider?: 'leadsquared' | 'netcore';
  selectedChannels?: string[];
  /** IANA zone the date and time are typed in. Defaults to the webinar's saved zone (Asia/Kolkata for new ones). */
  timezone?: string;
  /** Planned length in minutes (5–720). */
  durationMinutes?: number;
}

import type { WizardFieldMapping } from '@/lib/wizardFields';
import { assertSetupEditable } from '@/lib/setupLock';
import { after } from 'next/server';
import { wallClockToDate, safeTimeZone } from '@/lib/dateFormat';
export type { WizardFieldMapping };

export interface AudiencePreflightValidation {
  total: number;
  verifiedWorkEmailCount: number;
  totalWithEmailCount: number;
  missingEmailCount: number;
  emailHealthPercent: number;
  linkedinProfileCount: number;
  linkedinHealthPercent: number;
  titleAndSeniorityCount: number;
  titleHealthPercent: number;
  duplicateCount: number;
  suppressedCount: number;
  cleanReadyCount: number;
}

export interface WizardMessaging {
  msgMode: 'ai' | 'templatized';
  tone: string;
  msgLength: string;
  aiInstructions: string;
  brief: string;
  oneClickSignup: boolean;
  channels: Record<string, boolean>;
  emailProvider?: 'leadsquared' | 'netcore';
  personalizationFields?: string[];
  stepConfigs?: Record<
    string,
    {
      mode?: 'ai' | 'template';
      templateId?: string | null;
      instruction?: string;
      customSubject?: string;
      customBody?: string;
    }
  >;
}

function combineDateTime(date: string, time: string, timeZone?: string | null): Date | null {
  if (!date) return null;
  // The wall-clock time belongs to the webinar's zone, never the server's.
  return wallClockToDate(time ? `${date}T${time}` : `${date}T09:00`, timeZone);
}

function cleanDuration(minutes: number | undefined): number | undefined {
  if (minutes === undefined || !Number.isFinite(minutes)) return undefined;
  return Math.min(720, Math.max(5, Math.round(minutes)));
}

/** Step 0 → creates the draft campaign and provisions its defaults. */
export async function createCampaignFromWizardAction(details: WizardDetails) {
  const timezone = safeTimeZone(details.timezone);
  const durationMinutes = cleanDuration(details.durationMinutes);
  const scheduledAt = combineDateTime(details.date, details.time, timezone);
  const capacity = Number.parseInt(details.capacity, 10);

  const selectedChannelsSerialized =
    details.selectedChannels && details.selectedChannels.length > 0
      ? serializeSelectedChannels(details.selectedChannels as RegistrationChannelKey[])
      : serializeSelectedChannels(DEFAULT_SELECTED_CHANNELS);

  const campaign = await db.campaign.create({
    data: {
      name: details.title.trim() || 'Untitled webinar',
      vertical: 'Unassigned',
      date: scheduledAt ? formatWebinarDate(scheduledAt, timezone) : 'Not scheduled yet',
      scheduledAt,
      timezone,
      ...(durationMinutes ? { durationMinutes } : {}),
      description: details.description.trim() || null,
      speakerName: details.speakerName.trim() || null,
      speakerTitle: details.speakerTitle.trim() || null,
      capacity: Number.isFinite(capacity) && capacity > 0 ? capacity : null,
      registrationLink: details.registrationLink.trim() || null,
      oneClickSignup: !details.registrationLink.trim(),
      zoomLink: details.zoomLink.trim() || null,
      zoomMeetingId: details.zoomMeetingId ? details.zoomMeetingId.trim() : null,
      emailProvider: details.emailProvider ?? 'leadsquared',
      selectedChannels: selectedChannelsSerialized,
    },
  });

  if (details.speakers && details.speakers.length > 0) {
    await syncSpeakersForCampaign(campaign.id, details.speakers);
  } else if (details.speakerName) {
    await syncSpeakersForCampaign(campaign.id, [
      { name: details.speakerName, title: details.speakerTitle || null, isPrimary: true },
    ]);
  }

  await provisionCampaignDefaults(campaign.id);
  await db.activityLogEntry.create({
    data: { campaignId: campaign.id, text: 'Webinar created', dot: 'var(--accent-500)' },
  });
  revalidateCampaign(campaign.id);
  return campaign.id;
}

/** Step 0 edits after the draft exists (the wizard allows going Back). */
export async function updateWizardDetailsAction(campaignId: string, details: WizardDetails) {
  await assertSetupEditable(campaignId);
  const existing = await db.campaign.findUnique({ where: { id: campaignId }, select: { timezone: true } });
  const timezone = safeTimeZone(details.timezone ?? existing?.timezone);
  const durationMinutes = cleanDuration(details.durationMinutes);
  const scheduledAt = combineDateTime(details.date, details.time, timezone);
  const capacity = Number.parseInt(details.capacity, 10);

  const selectedChannelsData =
    details.selectedChannels !== undefined
      ? {
          selectedChannels:
            details.selectedChannels.length > 0
              ? serializeSelectedChannels(details.selectedChannels as RegistrationChannelKey[])
              : serializeSelectedChannels(DEFAULT_SELECTED_CHANNELS),
        }
      : {};

  await db.campaign.update({
    where: { id: campaignId },
    data: {
      name: details.title.trim() || 'Untitled webinar',
      date: scheduledAt ? formatWebinarDate(scheduledAt, timezone) : 'Not scheduled yet',
      scheduledAt,
      timezone,
      ...(durationMinutes ? { durationMinutes } : {}),
      description: details.description.trim() || null,
      speakerName: details.speakerName.trim() || null,
      speakerTitle: details.speakerTitle.trim() || null,
      capacity: Number.isFinite(capacity) && capacity > 0 ? capacity : null,
      registrationLink: details.registrationLink.trim() || null,
      oneClickSignup: !details.registrationLink.trim(),
      zoomLink: details.zoomLink.trim() || null,
      ...(details.zoomMeetingId !== undefined ? { zoomMeetingId: details.zoomMeetingId ? details.zoomMeetingId.trim() : null } : {}),
      ...(details.emailProvider ? { emailProvider: details.emailProvider } : {}),
      ...selectedChannelsData,
    },
  });

  if (details.speakers && details.speakers.length > 0) {
    await syncSpeakersForCampaign(campaignId, details.speakers);
  } else if (details.speakerName) {
    await syncSpeakersForCampaign(campaignId, [
      { name: details.speakerName, title: details.speakerTitle || null, isPrimary: true },
    ]);
  }

  revalidateCampaign(campaignId);
}

/** Updates campaign funnel mode between Normal 1-Click channel links and Custom Framer LP. */
export async function updateWizardFunnelModeAction(
  campaignId: string,
  mode: 'normal' | 'framer',
  registrationLink?: string
) {
  await assertSetupEditable(campaignId);
  const isFramer = mode === 'framer';
  const cleanLink = isFramer ? (registrationLink || '').trim() : '';

  await db.campaign.update({
    where: { id: campaignId },
    data: {
      registrationLink: cleanLink || null,
      oneClickSignup: !cleanLink,
      // The explicit mode is what the invite-link builder and readiness gate read; leaving the
      // column at its 'zoom' default made a configured external landing page silently ignored.
      registrationMode: cleanLink ? 'external' : 'zoom',
    },
  });

  revalidateCampaign(campaignId);
  return { ok: true as const, mode, registrationLink: cleanLink, oneClickSignup: !cleanLink };
}

/** Step 3 → messaging mode and which channels this campaign uses. */
export async function saveWizardMessagingAction(
  campaignId: string,
  messaging: WizardMessaging,
  opts: { autoDraftInvite?: boolean } = {}
) {
  await assertSetupEditable(campaignId);
  const instructions = [
    messaging.aiInstructions?.trim(),
    messaging.tone ? `Tone: ${messaging.tone}.` : null,
    messaging.msgLength ? `Length: ${messaging.msgLength}.` : null,
  ].filter(Boolean).join(' ');

  await db.campaign.update({
    where: { id: campaignId },
    data: {
      msgMode: messaging.msgMode,
      tone: messaging.tone,
      msgLength: messaging.msgLength,
      aiInstructions: messaging.aiInstructions,
      brief: messaging.brief,
      oneClickSignup: messaging.oneClickSignup,
      emailProvider: messaging.emailProvider || 'leadsquared',
      personalizationFields:
        messaging.personalizationFields && messaging.personalizationFields.length > 0
          ? messaging.personalizationFields.join(',')
          : undefined,
      personalizationPrompt: instructions || undefined,
    },
  });

  // If templatized mode with custom copy, persist into a campaign-specific MessageTemplate override for invite
  if (messaging.msgMode === 'templatized' && messaging.brief?.trim()) {
    const customTemplate = await db.messageTemplate.upsert({
      where: { campaignId_key: { campaignId, key: 'invite' } },
      update: { body: messaging.brief.trim() },
      create: {
        campaignId,
        key: 'invite',
        name: 'Initial invite (Custom)',
        channel: 'email',
        hasSubject: true,
        subject: "You're invited: {{topic}}",
        body: messaging.brief.trim(),
        status: 'ready',
      },
    });
    await db.cadenceStep.updateMany({
      where: { campaignId, key: 'invite' },
      data: { templateId: customTemplate.id },
    });
  }

  // Channel choice is expressed by enabling/disabling that channel's steps —
  // the same switch the planner uses, so the two can never disagree. But this
  // action re-fires on every "Finish setup" click, including a revisit where
  // the operator changed nothing about channels — only touch a channel's
  // steps when its on/off state actually flipped, so a per-step customization
  // already made in the Cadence Planner (e.g. disabling one email step while
  // keeping the rest on) survives an unrelated wizard re-save.
  const steps = await db.cadenceStep.findMany({
    where: { campaignId, removedAt: null },
    select: { id: true, channel: true, enabled: true },
  });
  const { normalizeChannel } = await import('@/lib/channels');
  const wasChannelOn = new Map<string, boolean>();
  for (const s of steps) {
    const ch = normalizeChannel(s.channel);
    wasChannelOn.set(ch, (wasChannelOn.get(ch) ?? false) || s.enabled);
  }
  const flippedStepUpdates = steps
    .filter((s) => {
      const ch = normalizeChannel(s.channel);
      const nowOn = messaging.channels[ch] ?? false;
      return (wasChannelOn.get(ch) ?? false) !== nowOn;
    })
    .map((s) =>
      db.cadenceStep.update({
        where: { id: s.id },
        data: { enabled: messaging.channels[normalizeChannel(s.channel)] ?? false },
      })
    );
  if (flippedStepUpdates.length > 0) await db.$transaction(flippedStepUpdates);

  // Persist per-step configuration (template vs AI, selected templateId, custom instructions)
  if (messaging.stepConfigs) {
    for (const [key, cfg] of Object.entries(messaging.stepConfigs)) {
      await db.cadenceStep.updateMany({
        where: { campaignId, key },
        data: {
          ...(cfg.mode ? { mode: cfg.mode } : {}),
          ...(cfg.instruction !== undefined ? { instruction: cfg.instruction } : {}),
          ...(cfg.templateId !== undefined ? { templateId: cfg.templateId } : {}),
        },
      });
      if (cfg.customBody && cfg.mode === 'template') {
        const customTemplate = await db.messageTemplate.upsert({
          where: { campaignId_key: { campaignId, key } },
          update: { body: cfg.customBody, ...(cfg.customSubject ? { subject: cfg.customSubject } : {}) },
          create: {
            campaignId,
            key,
            name: `${key} (Custom)`,
            channel: 'email',
            hasSubject: !!cfg.customSubject,
            subject: cfg.customSubject || "Update for {{topic}}",
            body: cfg.customBody,
            status: 'ready',
          },
        });
        await db.cadenceStep.updateMany({
          where: { campaignId, key },
          data: { templateId: customTemplate.id },
        });
      }
    }
  }

  // When AI mode is chosen (either globally or per-step), auto-generate reviewed drafts for approved contacts for the active steps
  const hasAiSteps = messaging.msgMode === 'ai' || Object.values(messaging.stepConfigs || {}).some((c) => c.mode === 'ai');
  if (hasAiSteps && opts.autoDraftInvite !== false) {
    // Drafting calls the model once per contact and used to run inside this request, so Continue sat on
    // "Saving…" for most of a minute. It now runs after the response is sent; drafts appear on the
    // Messaging tab as they finish, and the operator can regenerate there at any time.
    const draftInitialCopy = async () => {
      try {
        let approvedCount = await db.contact.count({ where: { campaignId, approved: true } });
        if (approvedCount === 0) {
          // If contacts were scored above threshold but not yet marked approved, approve them now
          const camp = await db.campaign.findUnique({ where: { id: campaignId }, select: { scoringThreshold: true } });
          const threshold = camp?.scoringThreshold ?? 70;
          await db.contact.updateMany({
            where: { campaignId, score: { gte: threshold } },
            data: { approved: true },
          });
          approvedCount = await db.contact.count({ where: { campaignId, approved: true } });
        }

        if (approvedCount > 0) {
          const { generatePersonalized } = await import('@/lib/personalization');
          const enabledPreRegSteps = await db.cadenceStep.findMany({
            where: {
              campaignId,
              enabled: true,
              removedAt: null,
              OR: [
                { group: 'Pre-registration' },
                { key: { in: ['invite', 'nudge', 'linkedin', 'smsInvite', 'waInvite', 'final'] } },
              ],
            },
            select: { key: true, mode: true },
          });

          const stepsToDraft = enabledPreRegSteps.length > 0
            ? enabledPreRegSteps.filter((s) => s.mode !== 'template').map((s) => s.key)
            : ['invite'];

          for (const stepKey of stepsToDraft) {
            try {
              await generatePersonalized(campaignId, stepKey, { autoReview: true, onlyMissing: true });
            } catch (stepErr) {
              console.warn(`Auto-generation for step ${stepKey} failed:`, stepErr);
            }
          }
        }
      } catch (err) {
        console.error('Initial auto-generation on wizard finish failed (non-blocking):', err);
      }
      };
    try {
      after(draftInitialCopy);
    } catch {
      // Not inside a request (tests, scripts): run it inline.
      await draftInitialCopy();
    }
  }

  revalidateCampaign(campaignId);
}

/** Counts the wizard shows after an import, without loading every contact. */
export async function getWizardAudienceSummaryAction(campaignId: string) {
  const [total, withEmail, withLinkedin, missingTitle, scored, approved] = await Promise.all([
    db.contact.count({ where: { campaignId } }),
    db.contact.count({ where: { campaignId, email: { not: null } } }),
    db.contact.count({ where: { campaignId, linkedinId: { not: null } } }),
    db.contact.count({ where: { campaignId, missingInfo: true } }),
    db.contact.count({ where: { campaignId, score: { not: null } } }),
    db.contact.count({ where: { campaignId, approved: true } }),
  ]);
  return { total, withEmail, withLinkedin, missingTitle, scored, approved };
}

/**
 * Real-time 4-metric audience input validation preflight:
 * 1. Verified work email
 * 2. LinkedIn profile URL
 * 3. Title & seniority
 * 4. Duplicate / suppressed
 */
export async function getAudiencePreflightValidationAction(campaignId: string): Promise<AudiencePreflightValidation> {
  const contacts = await db.contact.findMany({
    where: { campaignId },
    select: {
      id: true,
      email: true,
      linkedinId: true,
      extraFieldsJson: true,
      title: true,
      seniority: true,
      emailVerified: true,
    },
  });

  const total = contacts.length;
  if (total === 0) {
    return {
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
    };
  }

  const freeEmailDomains = new Set(['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'aol.com', 'mail.com']);
  const seenEmails = new Set<string>();
  let duplicateCount = 0;
  let totalWithEmailCount = 0;
  let verifiedWorkEmailCount = 0;
  let missingEmailCount = 0;
  let linkedinProfileCount = 0;
  let titleAndSeniorityCount = 0;
  const emailsToCheck: string[] = [];

  for (const c of contacts) {
    const rawEmail = c.email?.trim().toLowerCase() || '';
    if (rawEmail) {
      totalWithEmailCount++;
      emailsToCheck.push(rawEmail);
      if (seenEmails.has(rawEmail)) {
        duplicateCount++;
      } else {
        seenEmails.add(rawEmail);
      }

      const parts = rawEmail.split('@');
      const domain = parts[1]?.toLowerCase();
      const isCorporate = domain && !freeEmailDomains.has(domain);
      if (c.emailVerified || isCorporate) {
        verifiedWorkEmailCount++;
      }
    } else {
      missingEmailCount++;
    }

    // LinkedIn Profile check
    const hasDirectLinkedin = !!c.linkedinId && c.linkedinId.trim() !== '' && c.linkedinId !== '—';
    let hasExtraLinkedin = false;
    if (c.extraFieldsJson) {
      try {
        const extra = JSON.parse(c.extraFieldsJson) as Record<string, unknown>;
        for (const [k, v] of Object.entries(extra)) {
          if (typeof v === 'string' && (k.toLowerCase().includes('linkedin') || v.includes('linkedin.com/in/'))) {
            hasExtraLinkedin = true;
            break;
          }
        }
      } catch {}
    }
    if (hasDirectLinkedin || hasExtraLinkedin) {
      linkedinProfileCount++;
    }

    // Title & Seniority check
    const hasTitle = !!c.title && c.title.trim() !== '' && c.title !== '—';
    const hasSeniority = !!c.seniority && c.seniority.trim() !== '' && c.seniority !== '—' && c.seniority.toLowerCase() !== 'unknown';
    if (hasTitle && hasSeniority) {
      titleAndSeniorityCount++;
    }
  }

  // Cross-reference both global and webinar-specific suppression lists
  let suppressedCount = 0;
  if (emailsToCheck.length > 0) {
    const [globalSuppressed, campSuppressions] = await Promise.all([
      db.emailSuppression.findMany({
        where: { email: { in: Array.from(new Set(emailsToCheck)), mode: 'insensitive' } },
        select: { email: true },
      }),
      db.campaignSuppression?.findMany
        ? db.campaignSuppression.findMany({
            where: { campaignId },
            select: { email: true },
          })
        : [],
    ]);

    const globalSet = new Set(globalSuppressed.map((s) => s.email.toLowerCase()));
    const campExact = new Set(campSuppressions.filter((s) => !s.email.startsWith('@')).map((s) => s.email.toLowerCase()));
    const campDomains = campSuppressions.filter((s) => s.email.startsWith('@')).map((s) => s.email.slice(1).toLowerCase());

    const isSuppressed = (email: string) => {
      const norm = email.toLowerCase();
      if (globalSet.has(norm) || campExact.has(norm)) return true;
      const at = norm.indexOf('@');
      if (at !== -1 && campDomains.includes(norm.slice(at + 1))) return true;
      return false;
    };

    suppressedCount = emailsToCheck.filter(isSuppressed).length;
  }

  const emailHealthPercent = total > 0 ? Math.round((verifiedWorkEmailCount / total) * 100) : 0;
  const linkedinHealthPercent = total > 0 ? Math.round((linkedinProfileCount / total) * 100) : 0;
  const titleHealthPercent = total > 0 ? Math.round((titleAndSeniorityCount / total) * 100) : 0;
  const cleanReadyCount = Math.max(0, totalWithEmailCount - duplicateCount - suppressedCount);

  return {
    total,
    verifiedWorkEmailCount,
    totalWithEmailCount,
    missingEmailCount,
    emailHealthPercent,
    linkedinProfileCount,
    linkedinHealthPercent,
    titleAndSeniorityCount,
    titleHealthPercent,
    duplicateCount,
    suppressedCount,
    cleanReadyCount,
  };
}

/** Save selective LeadSquared field mappings and optionally trigger CRM sync. */
export async function saveWizardFieldMappingsAction(
  campaignId: string,
  mappings: WizardFieldMapping[],
  syncWithLsq?: boolean
) {
  await assertSetupEditable(campaignId);
  await db.campaign.update({
    where: { id: campaignId },
    data: {
      // A different column than personalizationFields (Step 4's AI grounding
      // fields) — these two vocabularies don't overlap, and one wizard step
      // used to silently clobber the other's choice by writing both into the
      // same column. Stores the full mapping list (not just the enabled
      // token names) as JSON: persisting only which defaults were on/off
      // meant a custom field's chosen LeadSquared target, and any
      // operator-added custom mapping, silently vanished on the next reload
      // even though the card's toast said "Field mappings saved."
      lsqFieldMappingTokens: JSON.stringify(mappings),
    },
  });

  let syncResult = null;
  if (syncWithLsq) {
    const { syncContactsToLeadSquared } = await import('@/lib/leadSync');
    syncResult = await syncContactsToLeadSquared(campaignId);
  }

  revalidateCampaign(campaignId);
  return { ok: true as const, syncResult };
}

/** Get full scored contacts for the wizard's interactive table and approval slider. */
export async function getScoredContactsForWizardAction(campaignId: string) {
  const rows = await db.contact.findMany({
    where: { campaignId },
    orderBy: [{ score: 'desc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      email: true,
      title: true,
      account: true,
      seniority: true,
      function: true,
      score: true,
      explanation: true,
      approved: true,
      approvedManually: true,
      enrichedAt: true,
      enrichmentSource: true,
    },
  });
  return rows;
}

/** Top scored contacts, for the wizard's score preview. */
export async function getWizardScorePreviewAction(campaignId: string, take = 6) {
  const rows = await db.contact.findMany({
    where: { campaignId, score: { not: null } },
    orderBy: { score: 'desc' },
    take,
    select: { id: true, name: true, title: true, account: true, score: true },
  });
  return rows;
}

export interface LsqTenantField {
  schemaName: string;
  displayName: string;
  dataType?: string;
}

/**
 * Fetches the actual standard and custom fields directly from the connected
 * LeadSquared tenant via /LeadManagement.svc/LeadsMetaData.Get.
 */
export async function fetchLeadSquaredTenantFieldsAction(): Promise<{
  ok: boolean;
  fields: LsqTenantField[];
  error?: string;
}> {
  try {
    const { getLeadsMetadata } = await import('@/lib/leadsquared');
    const metadata = await getLeadsMetadata();
    if (Array.isArray(metadata) && metadata.length > 0) {
      const fields: LsqTenantField[] = metadata
        .filter((f) => f && f.SchemaName)
        .map((f) => ({
          schemaName: f.SchemaName,
          displayName: f.DisplayName || f.SchemaName,
          dataType: f.DataType,
        }))
        .sort((a, b) => a.displayName.localeCompare(b.displayName));
      return { ok: true, fields };
    }
    return { ok: true, fields: [] };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Could not fetch fields from LeadSquared';
    return { ok: false, fields: [], error: msg };
  }
}

/**
 * Add a custom cadence touchpoint in the wizard.
 */
export async function addWizardCadenceStepAction(
  campaignId: string,
  data: {
    title: string;
    channel: string;
    group: string;
    timing: string;
    desc?: string;
    offsetValue?: number;
    offsetUnit?: string;
    anchor?: string;
  }
) {
  await assertSetupEditable(campaignId);
  const { normalizeChannel } = await import('@/lib/channels');
  const routable = normalizeChannel(data.channel);
  const key = `custom-${routable}-${Date.now().toString(36)}`;
  const trigger = data.group.toLowerCase().includes('registrant')
    ? 'registration'
    : data.group.toLowerCase().includes('post-webinar') || data.group.toLowerCase().includes('follow-up')
      ? 'attendance'
      : 'launch';
  const anchor = data.anchor || (trigger === 'launch' ? 'launch' : 'webinar');

  const defaultTemplate = await db.messageTemplate.findFirst({
    where: { OR: [{ campaignId: null }, { campaignId }], channel: routable },
    select: { id: true },
  });

  const step = await db.cadenceStep.create({
    data: {
      campaignId,
      key,
      group: data.group || 'Invitations & Outreach',
      title: data.title.trim() || `New ${data.channel} step`,
      timing: data.timing.trim() || '+1 day',
      channel: data.channel,
      desc: data.desc?.trim() || 'Custom step added in cadence planner.',
      toggleable: true,
      enabled: true,
      createdByUser: true,
      trigger,
      anchor,
      offsetValue: data.offsetValue ?? 1,
      offsetUnit: data.offsetUnit ?? 'days',
      templateId: defaultTemplate?.id ?? null,
      mode: 'ai',
      instruction: `Touchpoint for ${data.title}`,
    },
  });

  await db.activityLogEntry.create({
    data: {
      campaignId,
      text: `Added step “${step.title}” (${step.channel}) in cadence setup`,
      dot: 'var(--accent-500)',
    },
  });

  revalidateCampaign(campaignId);
  return step;
}

/**
 * Approve all clean, unsuppressed contacts for the campaign to unlock launch.
 */
export async function approveAllCleanContactsAction(campaignId: string) {
  await assertSetupEditable(campaignId);
  const suppressedRows = await db.emailSuppression.findMany({ select: { email: true } });
  const suppressedSet = new Set(suppressedRows.map((s) => s.email.toLowerCase()));

  const contacts = await db.contact.findMany({
    where: { campaignId },
    select: { id: true, email: true },
  });

  const cleanIds = contacts
    .filter((c) => c.email && !suppressedSet.has(c.email.trim().toLowerCase()))
    .map((c) => c.id);

  if (cleanIds.length > 0) {
    await db.contact.updateMany({
      where: { id: { in: cleanIds } },
      data: { approved: true, approvedManually: true },
    });
  }

  revalidateCampaign(campaignId);
  return { approvedCount: cleanIds.length };
}

/**
 * Description rewrite during step 0, before any campaign row exists.
 *
 * The existing improveDescriptionAction needs a campaign to read the topic
 * from; here the topic is simply what the operator has typed so far.
 */
export async function improveDraftDescriptionAction(topic: string, current: string) {
  const { improveDescription } = await import('@/lib/claude');
  if (!topic.trim()) return { ok: false as const, error: 'Add a title first — it is what the description is written from.' };
  try {
    const result = await improveDescription({ topic, vertical: 'B2B', current });
    if (!result) return { ok: false as const, error: 'Claude returned nothing usable.' };
    return { ok: true as const, description: result };
  } catch (err) {
    return { ok: false as const, error: String(err) };
  }
}

// Zoom linking/creation for step 0 lives in lib/actions/zoom.ts — shared with
// the Setup tab, since re-linking or creating a Zoom meeting is the same
// operation whether the campaign is a fresh draft or already running.
