'use server';

import { db } from '@/lib/db';
import { provisionCampaignDefaults } from '@/lib/campaignDefaults';
import { formatWebinarDate } from '@/lib/campaignDate';
import { revalidateCampaign } from '@/lib/revalidate';

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
}

export interface WizardMessaging {
  msgMode: 'ai' | 'templatized';
  tone: string;
  msgLength: string;
  aiInstructions: string;
  brief: string;
  oneClickSignup: boolean;
  channels: Record<string, boolean>;
}

function combineDateTime(date: string, time: string): Date | null {
  if (!date) return null;
  const iso = time ? `${date}T${time}` : `${date}T09:00`;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Step 0 → creates the draft campaign and provisions its defaults. */
export async function createCampaignFromWizardAction(details: WizardDetails) {
  const scheduledAt = combineDateTime(details.date, details.time);
  const capacity = Number.parseInt(details.capacity, 10);

  const campaign = await db.campaign.create({
    data: {
      name: details.title.trim() || 'Untitled webinar',
      vertical: 'Unassigned',
      date: scheduledAt ? formatWebinarDate(scheduledAt) : 'Not scheduled yet',
      scheduledAt,
      description: details.description.trim() || null,
      speakerName: details.speakerName.trim() || null,
      speakerTitle: details.speakerTitle.trim() || null,
      capacity: Number.isFinite(capacity) && capacity > 0 ? capacity : null,
      registrationLink: details.registrationLink.trim() || null,
      zoomLink: details.zoomLink.trim() || null,
    },
  });

  await provisionCampaignDefaults(campaign.id);
  await db.activityLogEntry.create({
    data: { campaignId: campaign.id, text: 'Webinar created', dot: 'var(--accent-500)' },
  });
  revalidateCampaign(campaign.id);
  return campaign.id;
}

/** Step 0 edits after the draft exists (the wizard allows going Back). */
export async function updateWizardDetailsAction(campaignId: string, details: WizardDetails) {
  const scheduledAt = combineDateTime(details.date, details.time);
  const capacity = Number.parseInt(details.capacity, 10);

  await db.campaign.update({
    where: { id: campaignId },
    data: {
      name: details.title.trim() || 'Untitled webinar',
      date: scheduledAt ? formatWebinarDate(scheduledAt) : 'Not scheduled yet',
      scheduledAt,
      description: details.description.trim() || null,
      speakerName: details.speakerName.trim() || null,
      speakerTitle: details.speakerTitle.trim() || null,
      capacity: Number.isFinite(capacity) && capacity > 0 ? capacity : null,
      registrationLink: details.registrationLink.trim() || null,
      zoomLink: details.zoomLink.trim() || null,
    },
  });
  revalidateCampaign(campaignId);
}

/** Step 3 → messaging mode and which channels this campaign uses. */
export async function saveWizardMessagingAction(campaignId: string, messaging: WizardMessaging) {
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
  // the same switch the planner uses, so the two can never disagree.
  const steps = await db.cadenceStep.findMany({
    where: { campaignId, removedAt: null },
    select: { id: true, channel: true },
  });
  const { normalizeChannel } = await import('@/lib/channels');
  await db.$transaction(
    steps.map((s) =>
      db.cadenceStep.update({
        where: { id: s.id },
        data: { enabled: messaging.channels[normalizeChannel(s.channel)] ?? false },
      })
    )
  );

  // When AI mode is chosen, auto-generate reviewed drafts for approved contacts for the active initial step
  if (messaging.msgMode === 'ai') {
    try {
      const approvedCount = await db.contact.count({ where: { campaignId, approved: true } });
      if (approvedCount > 0) {
        const { generatePersonalized } = await import('@/lib/personalization');
        await generatePersonalized(campaignId, 'invite', { autoReview: true });
      }
    } catch (err) {
      console.error('Initial auto-generation on wizard finish failed (non-blocking):', err);
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
