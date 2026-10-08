'use server';

import { db } from '@/lib/db';
import { generatePersonalized, generateAllSteps, regenerateOne, repairLinks, DEFAULT_PERSONALIZATION_PROMPT, type GenerateResult } from '@/lib/personalization';
import { revalidateCampaign } from '@/lib/revalidate';
import { revalidatePath } from 'next/cache';
import { assertStepUnsent } from '@/lib/setupLock';

export async function generatePersonalizedAction(
  campaignId: string,
  stepKey: string,
  options?: { onlyMissing?: boolean }
): Promise<GenerateResult> {
  const result = await generatePersonalized(campaignId, stepKey, options);
  revalidateCampaign(campaignId);
  return result;
}

export async function generateAllStepsAction(
  campaignId: string,
  options?: { onlyMissing?: boolean }
): Promise<{ ok: boolean; totalGenerated: number; errors: string[] }> {
  const result = await generateAllSteps(campaignId, options);
  revalidateCampaign(campaignId);
  return result;
}

export async function regeneratePersonalizedAction(campaignId: string, contactId: string, stepKey: string): Promise<GenerateResult> {
  await assertStepUnsent(campaignId, stepKey);
  const result = await regenerateOne(campaignId, contactId, stepKey);
  revalidateCampaign(campaignId);
  return result;
}

export async function savePersonalizedAction(
  campaignId: string,
  messageId: string,
  subject: string | null,
  body: string,
  context?: { contactId?: string; stepKey?: string }
) {
  const now = new Date();
  const contactId = context?.contactId ?? (messageId.startsWith('custom_') ? messageId.slice('custom_'.length) : null);
  const stepKey = context?.stepKey ?? 'invite';

  const sentCount = await db.cadenceSend.count({
    where: { campaignId, stepKey, status: 'sent' },
  });
  if (sentCount > 0) {
    throw new Error(`Step "${stepKey}" has already been dispatched and is locked from editing.`);
  }

  if (contactId) {
    const step = await db.cadenceStep.findFirst({
      where: { campaignId, key: stepKey },
      select: { channel: true },
    });
    const channel = step?.channel?.toLowerCase() ?? 'email';

    const record = await db.personalizedMessage.upsert({
      where: {
        campaignId_contactId_stepKey: {
          campaignId,
          contactId,
          stepKey,
        },
      },
      create: {
        campaignId,
        contactId,
        stepKey,
        channel,
        subject,
        body,
        status: 'edited',
        editedAt: now,
        rationale: 'Custom override based on template',
      },
      update: {
        subject,
        body,
        status: 'edited',
        editedAt: now,
      },
    });
    revalidateCampaign(campaignId);
    return { savedAt: now.toISOString(), id: record.id };
  }

  const record = await db.personalizedMessage.update({
    where: { id: messageId },
    data: { subject, body, status: 'edited', editedAt: now },
  });
  revalidateCampaign(campaignId);
  return { savedAt: now.toISOString(), id: record.id };
}

export async function markReviewedAction(campaignId: string, messageId: string) {
  const now = new Date();
  await db.personalizedMessage.update({ where: { id: messageId }, data: { status: 'reviewed', reviewedAt: now } });
  revalidateCampaign(campaignId);
  return { reviewedAt: now.toISOString() };
}

export async function markAllReviewedAction(campaignId: string, stepKey: string) {
  const result = await db.personalizedMessage.updateMany({
    where: { campaignId, stepKey, status: { in: ['draft', 'edited'] } },
    data: { status: 'reviewed', reviewedAt: new Date() },
  });
  if (result.count > 0) {
    await db.activityLogEntry.create({
      data: { campaignId, text: `${result.count} personalized message${result.count === 1 ? '' : 's'} marked reviewed`, dot: 'var(--success-500)' },
    });
  }
  revalidateCampaign(campaignId);
  return result.count;
}

/** Drops ONE recipient's personalized copy so the shared template sends instead. */
export async function discardOnePersonalizedAction(campaignId: string, contactId: string, stepKey: string) {
  await assertStepUnsent(campaignId, stepKey);
  await db.personalizedMessage.deleteMany({ where: { campaignId, contactId, stepKey } });
  revalidateCampaign(campaignId);
}

/** Drops the personalized copy for a step so the shared template takes over again. */
export async function discardPersonalizedAction(campaignId: string, stepKey: string) {
  await assertStepUnsent(campaignId, stepKey);
  const result = await db.personalizedMessage.deleteMany({ where: { campaignId, stepKey } });
  await db.activityLogEntry.create({
    data: { campaignId, text: `Discarded ${result.count} personalized message(s) — reverting to the shared template`, dot: 'var(--warning-700)' },
  });
  revalidateCampaign(campaignId);
  return result.count;
}

/** Swaps a superseded registration link for the current one, no model call. */
export async function repairLinksAction(campaignId: string, stepKey: string) {
  await assertStepUnsent(campaignId, stepKey);
  const result = await repairLinks(campaignId, stepKey);
  revalidateCampaign(campaignId);
  return result;
}

/** Saves edited tone/emphasis instructions for this campaign's personalization. */
export async function updatePersonalizationPromptAction(campaignId: string, prompt: string) {
  await db.campaign.update({ where: { id: campaignId }, data: { personalizationPrompt: prompt } });
  revalidateCampaign(campaignId);
  return { savedAt: new Date().toISOString() };
}

/**
 * Saves any subset of prompt/brief/aiInstructions/tone/msgLength together —
 * each field is only written when the caller actually supplies it, so e.g.
 * the Generate config modal (which has no UI for personalizationPrompt) can
 * update tone/length/brief/aiInstructions without touching the free-text
 * prompt PromptModal owns.
 */
export async function updateCampaignMessagingInstructionsAction(
  campaignId: string,
  data: { prompt?: string; brief?: string; aiInstructions?: string; tone?: string; msgLength?: string }
) {
  await db.campaign.update({
    where: { id: campaignId },
    data: {
      ...(data.prompt !== undefined ? { personalizationPrompt: data.prompt } : {}),
      ...(data.brief !== undefined ? { brief: data.brief } : {}),
      ...(data.aiInstructions !== undefined ? { aiInstructions: data.aiInstructions } : {}),
      ...(data.tone !== undefined ? { tone: data.tone } : {}),
      ...(data.msgLength !== undefined ? { msgLength: data.msgLength } : {}),
    },
  });
  revalidateCampaign(campaignId);
  return { savedAt: new Date().toISOString() };
}


/**
 * Read-only — hands back the built-in default text so "Reset to default" can
 * refill the textarea. Deliberately does not write to the DB: reset should be
 * an edit like any other, requiring the same explicit Save to persist, not a
 * side effect that fires before the user decides to keep it.
 */
export async function getDefaultPersonalizationPromptAction(): Promise<string> {
  return DEFAULT_PERSONALIZATION_PROMPT;
}

/** Generates 3 psychological copy angles (Pillar 1: A/B copy generation) */
export async function generateCopyAnglesAction(params: {
  campaignId?: string;
  topic?: string;
  speakerName?: string | null;
  speakerTitle?: string | null;
  speakers?: Array<{ name: string; title?: string | null; company?: string | null }>;
  brief?: string | null;
  stepKey?: string;
  channel: 'email' | 'linkedin' | 'sms' | 'whatsapp';
  stepLabel: string;
  baseBody?: string;
}) {
  const { generateMessageAngles } = await import('@/lib/claude');

  let topic = params.topic || 'Upcoming Strategic Webinar';
  let speakerName = params.speakerName || null;
  let speakerTitle = params.speakerTitle || null;
  let speakers = params.speakers || [];
  let brief = params.brief || null;

  if (params.campaignId) {
    const [campaign, dbSpeakers] = await Promise.all([
      db.campaign.findUnique({ where: { id: params.campaignId } }),
      db.speaker.findMany({ where: { campaignId: params.campaignId }, orderBy: [{ order: 'asc' }, { id: 'asc' }] }),
    ]);
    if (campaign) {
      topic = campaign.name;
      speakerName = campaign.speakerName;
      speakerTitle = campaign.speakerTitle;
      brief = params.brief !== undefined ? params.brief : campaign.brief;
      speakers = dbSpeakers.map((s) => ({ name: s.name, title: s.title, company: s.company }));
    }
  }

  return generateMessageAngles({
    topic,
    speakerName,
    speakerTitle,
    speakers,
    brief,
    channel: params.channel,
    stepLabel: params.stepLabel,
    baseBody: params.baseBody,
  });
}

export interface TestAiDraftParams {
  campaignId?: string;
  topic?: string;
  description?: string;
  speakers?: Array<{ name: string; title?: string | null; company?: string | null; bio?: string | null; isPrimary?: boolean }>;
  speakerName?: string | null;
  speakerTitle?: string | null;
  brief?: string | null;
  tone?: string | null;
  msgLength?: string | null;
  aiInstructions?: string | null;
  channel: 'email' | 'linkedin' | 'sms' | 'whatsapp';
  stepLabel: string;
  stepKey?: string;
  customSubject?: string | null;
  customBody?: string | null;
  sampleContact: {
    id?: string;
    name: string;
    title: string;
    account: string;
    function?: string;
    seniority?: string;
    vertical?: string;
    score?: number | null;
    personaNote?: string | null;
  };
  link?: string | null;
}

export interface TestAiDraftResult {
  ok: boolean;
  subject: string | null;
  body: string;
  rationale: string;
  channel: string;
  usedFallback: boolean;
  error?: string;
}

/**
 * Tests Claude AI personalization for a single sample recipient.
 * Enables live testing of AI prompts, channel conventions, and multi-speaker context
 * without requiring bulk generation across all contacts.
 */
export async function testGenerateAiDraftAction(params: TestAiDraftParams): Promise<TestAiDraftResult> {
  const { personalizeMessages } = await import('@/lib/claude');
  const { resolveStepTemplate } = await import('@/lib/messageTemplates');

  let topic = params.topic || 'Upcoming Strategic Webinar';
  let description = params.description || '';
  let speakerName = params.speakerName || null;
  let speakerTitle = params.speakerTitle || null;
  let speakers = params.speakers || [];
  let brief = params.brief || null;
  let tone = params.tone || 'Action-oriented';
  let msgLength = params.msgLength || 'Under 100 words';
  let aiInstructions = params.aiInstructions || '';
  let link = params.link || 'https://webinar.example.com/join';

  if (params.campaignId) {
    const [camp, dbSpeakers] = await Promise.all([
      db.campaign.findUnique({ where: { id: params.campaignId } }),
      db.speaker.findMany({ where: { campaignId: params.campaignId }, orderBy: [{ order: 'asc' }, { id: 'asc' }] }),
    ]);
    if (camp) {
      topic = camp.name;
      description = camp.description || '';
      speakerName = camp.speakerName;
      speakerTitle = camp.speakerTitle;
      brief = params.brief !== undefined ? params.brief : camp.brief;
      tone = (params.tone !== undefined && params.tone !== null ? params.tone : camp.tone) || 'Action-oriented';
      msgLength = (params.msgLength !== undefined && params.msgLength !== null ? params.msgLength : camp.msgLength) || 'Under 100 words';
      aiInstructions = (params.aiInstructions !== undefined && params.aiInstructions !== null ? params.aiInstructions : camp.aiInstructions) || '';
      link = camp.registrationLink || camp.zoomLink || link;
      if (dbSpeakers.length > 0 && speakers.length === 0) {
        speakers = dbSpeakers.map((s) => ({
          name: s.name,
          title: s.title,
          company: s.company,
          bio: s.bio,
          isPrimary: s.isPrimary,
        }));
      }
    }
  }

  let templateSubject: string | null = params.customSubject || "You're invited: {{topic}}";
  let templateBody = params.customBody || brief || "Hi {{firstName}},\n\nYou're invited to {{topic}}.\n\nSave your seat here: {{link}}";

  if (params.campaignId && params.stepKey) {
    const resolvedTpl = await resolveStepTemplate(params.campaignId, params.stepKey);
    if (resolvedTpl) {
      templateSubject = resolvedTpl.hasSubject ? resolvedTpl.subject : null;
      templateBody = resolvedTpl.body;
    }
  }

  const contactData = {
    id: params.sampleContact.id || 'sample-contact-preview',
    name: params.sampleContact.name,
    title: params.sampleContact.title,
    function: params.sampleContact.function || 'Engineering',
    seniority: params.sampleContact.seniority || 'VP',
    account: params.sampleContact.account,
    vertical: params.sampleContact.vertical || 'Technology',
    personaNote: params.sampleContact.personaNote || null,
    score: params.sampleContact.score ?? 92,
    scoreRationale: 'Strong seniority and role match for strategic webinar topic',
    hasLinkedIn: true,
  };

  try {
    const { drafts } = await personalizeMessages({
      campaign: {
        name: topic,
        description,
        vertical: contactData.vertical,
        whenLabel: 'Upcoming Session',
        link,
        brief,
        tone,
        msgLength,
        aiInstructions,
        speakerName,
        speakerTitle,
        speakers,
      },
      channel: params.channel,
      stepLabel: params.stepLabel,
      templateSubject: params.channel === 'email' ? templateSubject : null,
      templateBody,
      contacts: [contactData],
      customInstructions: aiInstructions,
      stepInstruction: brief,
    });

    if (drafts.length > 0 && drafts[0].body) {
      return {
        ok: true,
        subject: params.channel === 'email' ? drafts[0].subject : null,
        body: drafts[0].body,
        rationale: drafts[0].rationale || 'Crafted for seniority and role focus',
        channel: params.channel,
        usedFallback: false,
      };
    }
  } catch (err) {
    return {ok:false,subject:null,body:'',rationale:'',channel:params.channel,usedFallback:false,error:err instanceof Error ? err.message : 'Claude generation failed.'};
  }
  return {ok:false,subject:null,body:'',rationale:'',channel:params.channel,usedFallback:false,error:'Claude returned no usable draft. Try again.'};
}

/** Updates contact fields inline and revalidates campaign */
export async function updateContactFieldsAction(
  campaignId: string,
  contactId: string,
  fields: {
    name?: string;
    title?: string;
    seniority?: string;
    function?: string;
    account?: string;
    vertical?: string;
    personaNote?: string;
  }
) {
  const updated = await db.contact.update({
    where: { id: contactId },
    data: {
      ...(fields.name !== undefined ? { name: fields.name.trim() } : {}),
      ...(fields.title !== undefined ? { title: fields.title.trim() } : {}),
      ...(fields.seniority !== undefined ? { seniority: fields.seniority.trim() } : {}),
      ...(fields.function !== undefined ? { function: fields.function.trim() } : {}),
      ...(fields.account !== undefined ? { account: fields.account.trim() } : {}),
      ...(fields.vertical !== undefined ? { vertical: fields.vertical.trim() } : {}),
      ...(fields.personaNote !== undefined ? { personaNote: fields.personaNote.trim() || null } : {}),
    },
  });
  revalidateCampaign(campaignId);
  return { ok: true, contact: updated };
}

/** Saves AI instructions / fields and regenerates drafts for all pending steps */
export async function saveAiInstructionsAndRegeneratePendingAction(
  campaignId: string,
  data: {
    aiInstructions?: string;
    tone?: string;
    msgLength?: string;
    brief?: string;
    personalizationFields?: string[];
    activeStepKey?: string;
  }
) {
  const instructions = [
    data.aiInstructions?.trim(),
    data.tone ? `Tone: ${data.tone}.` : null,
    data.msgLength ? `Length: ${data.msgLength}.` : null,
  ]
    .filter(Boolean)
    .join(' ');

  await db.campaign.update({
    where: { id: campaignId },
    data: {
      ...(data.aiInstructions !== undefined ? { aiInstructions: data.aiInstructions } : {}),
      ...(data.tone !== undefined ? { tone: data.tone } : {}),
      ...(data.msgLength !== undefined ? { msgLength: data.msgLength } : {}),
      ...(data.brief !== undefined ? { brief: data.brief } : {}),
      ...(data.personalizationFields !== undefined ? { personalizationFields: data.personalizationFields.join(',') } : {}),
      personalizationPrompt: instructions || undefined,
    },
  });

  // Find enabled steps that haven't been sent — excluding any step the
  // operator explicitly switched to Fixed Template mode, since regenerating
  // AI copy for one would silently revert that choice with no confirmation.
  const steps = await db.cadenceStep.findMany({
    where: { campaignId, removedAt: null, enabled: true, mode: { not: 'template' } },
    select: { key: true },
  });

  const stepKeys = steps.map((s) => s.key);
  const sentSends = await db.cadenceSend.groupBy({
    by: ['stepKey'],
    where: { campaignId, status: 'sent', stepKey: { in: stepKeys } },
    _count: { id: true },
  });
  const sentStepKeys = new Set(sentSends.filter((s) => s._count.id > 0).map((s) => s.stepKey));
  const pendingStepKeys = stepKeys.filter((k) => !sentStepKeys.has(k));

  let totalRegenerated = 0;
  let activeStepResult: GenerateResult | null = null;

  // Always regenerate every pending step — these are campaign-wide settings
  // (tone, instructions, grounding fields), and the button copy/toast both
  // promise "pending steps" (plural), not just the one currently open.
  // activeStepKey is only used below to know which result to hand back to
  // the UI for its own step — narrowing the loop to just that step used to
  // silently break the "all pending steps" promise for every other step.
  for (const k of pendingStepKeys) {
    const res = await generatePersonalized(campaignId, k, { onlyMissing: false });
    if (res.ok) {
      totalRegenerated += res.generated ?? 0;
      if (data.activeStepKey === k) {
        activeStepResult = res;
      }
    }
  }

  await db.activityLogEntry.create({
    data: {
      campaignId,
      text: `Updated AI instructions and regenerated ${totalRegenerated} message(s) across pending steps`,
      dot: 'var(--accent-500)',
    },
  });

  revalidateCampaign(campaignId);
  return { ok: true, totalRegenerated, activeStepResult };
}

/** Switches a step to fixed template or back to AI personalization, optionally auto-drafting copy */
export async function switchStepModeAction(
  campaignId: string,
  stepKey: string,
  mode: 'ai' | 'template',
  templateId?: string | null,
  options?: { autoDraft?: boolean }
) {
  const sentCount = await db.cadenceSend.count({
    where: { campaignId, stepKey, status: 'sent' },
  });
  if (sentCount > 0) {
    return { ok: false, error: 'Cannot change mode or template for steps that have already been sent.' };
  }

  await db.cadenceStep.updateMany({
    where: { campaignId, key: stepKey },
    data: {
      mode,
      ...(templateId !== undefined ? { templateId: templateId || null } : {}),
    },
  });

  await db.activityLogEntry.create({
    data: {
      campaignId,
      text: mode === 'template' ? `Switched "${stepKey}" to fixed template` : `Switched "${stepKey}" to AI personalization`,
      dot: 'var(--accent-500)',
    },
  });

  let generated = 0;
  let messages: import('@/lib/personalization').WrittenMessage[] | undefined;

  // When switching to AI mode, immediately auto-draft messages for approved contacts if none exist
  if (mode === 'ai' && options?.autoDraft !== false) {
    const approvedCount = await db.contact.count({ where: { campaignId, approved: true } });
    if (approvedCount > 0) {
      try {
        const genRes = await generatePersonalized(campaignId, stepKey, { autoReview: true, onlyMissing: true });
        if (genRes.ok) {
          generated = genRes.generated ?? 0;
          messages = genRes.messages;
        }
      } catch (err) {
        console.error(`Auto-drafting upon switching step "${stepKey}" to AI failed:`, err);
      }
    }
  }

  revalidateCampaign(campaignId);
  try {
    revalidatePath('/templates');
  } catch {
    /* not in a request context */
  }
  return { ok: true, mode, generated, messages };
}

/** Legacy wrapper for switchStepModeAction */
export async function switchStepToFixedTemplateAction(
  campaignId: string,
  stepKey: string,
  templateId: string | null
) {
  return switchStepModeAction(campaignId, stepKey, templateId ? 'template' : 'ai', templateId);
}

/** Regenerates outdated drafts for a step, preserving any manual human edits (status === 'edited') */
export async function regenerateOutdatedDraftsAction(campaignId: string, stepKey: string) {
  const res = await generatePersonalized(campaignId, stepKey, { preserveEdited: true, autoReview: true });
  revalidateCampaign(campaignId);
  return res;
}
