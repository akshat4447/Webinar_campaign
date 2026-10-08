import { db } from '@/lib/db';
import { resolveStepTemplate } from '@/lib/messageTemplates';
import { personalizeMessages, type PersonalizeContact } from '@/lib/claude';
import { upsertAttentionItem } from '@/lib/attentionItems';
import { normalizeChannel } from '@/lib/channels';
import { DEFAULT_PERSONALIZATION_FIELDS } from '@/lib/messagingOptions';

export function parseActiveFields(personalizationFields: string | null | undefined): Set<string> {
  if (!personalizationFields) {
    return new Set(DEFAULT_PERSONALIZATION_FIELDS);
  }
  const parsed = personalizationFields.split(',').map((f) => f.trim()).filter(Boolean);
  return parsed.length > 0 ? new Set(parsed) : new Set(DEFAULT_PERSONALIZATION_FIELDS);
}

export function buildPersonalizeContact(c: {
  id: string;
  name: string;
  title: string | null;
  function: string | null;
  seniority: string | null;
  account: string | null;
  vertical: string | null;
  personaNote: string | null;
  score: number | null;
  explanation: string | null;
  linkedinId: string | null;
}, activeFields: Set<string>): PersonalizeContact {
  return {
    id: c.id,
    name: activeFields.has('firstName') ? c.name : 'Recipient',
    title: activeFields.has('title') ? (c.title || '') : '',
    function: activeFields.has('function') ? (c.function || '') : '',
    seniority: activeFields.has('seniority') ? (c.seniority || '') : '',
    account: activeFields.has('account') ? (c.account || '') : '',
    vertical: activeFields.has('vertical') ? (c.vertical || '') : '',
    personaNote: activeFields.has('personaNote') ? c.personaNote : null,
    score: activeFields.has('score') ? c.score : null,
    scoreRationale: activeFields.has('score') ? c.explanation : null,
    hasLinkedIn: !!c.linkedinId,
  };
}

/** Steps that carry a template and can therefore be personalized — every step, across all channels. */
export const PERSONALIZABLE_STEPS = [
  'invite',
  'confirm',
  'nudge',
  'final',
  't3',
  't1d',
  't1h',
  'linkedin',
  'whatsapp',
  'sms',
  'attend',
  'noshow',
] as const;

/**
 * Canonical default for Campaign.personalizationPrompt — the single source of
 * truth for the "Reset to default" action. Keep this in sync with the
 * @default in prisma/schema.prisma, which exists so a fresh campaign starts
 * with sane tone guidance without a round-trip through this module.
 */
export const DEFAULT_PERSONALIZATION_PROMPT =
  "Lead with the operational problem their role actually owns — don't open by praising the company or telling the reader how impressive their work is. Vary the angle by seniority: executives care about outcome and risk, directors and heads about process and their team's throughput, managers and individual contributors about the day-to-day mechanics. Vary by function too — a marketing lead and an operations lead should not receive the same framing.";

/** Above this many recipients the UI asks for confirmation before running. */
export const CONFIRM_THRESHOLD = 50;

/** A written message, shaped for the editor so it can be applied without a reload. */
export interface WrittenMessage {
  contactId: string;
  id: string;
  subject: string | null;
  body: string;
  rationale: string | null;
  status: string;
  linkStale: boolean;
}

export interface GenerateResult {
  ok: boolean;
  error?: string;
  generated?: number;
  skipped?: number;
  linkRepaired?: number;
  /** Count of Claude batches (see personalizeMessages) that returned no
   *  usable output — those approved contacts got no draft this run, distinct
   *  from `skipped` (contacts filtered out before the call even ran). */
  batchFailures?: number;
  /** Returned so the editor can show new copy immediately — a router.refresh()
   *  alone re-renders the server component but won't reseed the editor's state. */
  messages?: WrittenMessage[];
}

function toWritten(m: {
  id: string;
  contactId: string;
  subject: string | null;
  body: string;
  rationale: string | null;
  status: string;
}): WrittenMessage {
  // Freshly written copy always carries the campaign's current link.
  return { contactId: m.contactId, id: m.id, subject: m.subject, body: m.body, rationale: m.rationale, status: m.status, linkStale: false };
}

function channelFor(templateChannel: string): 'email' | 'linkedin' | 'sms' | 'whatsapp' {
  return normalizeChannel(templateChannel);
}

/**
 * The template owns the link, so a personalized message that dropped it would
 * quietly break the whole point of the send. Rather than rejecting the draft we
 * append the link back and report how often it happened.
 */
function ensureLink(body: string, link: string): { body: string; repaired: boolean } {
  if (!link) return { body, repaired: false };
  const bare = link.replace(/^https?:\/\//, '');
  if (body.includes(link) || body.includes(bare)) return { body, repaired: false };
  return { body: `${body.trimEnd()}\n\n${link}`, repaired: true };
}

/**
 * A message is stale when it inlined a registration link that the campaign has
 * since changed — the copy still reads fine but points at the wrong page.
 */
export function isLinkStale(linkUsed: string | null, currentLink: string): boolean {
  if (!linkUsed || !currentLink) return false;
  return linkUsed !== currentLink;
}

/**
 * Swaps a superseded registration link for the current one in place. Exact —
 * it replaces the link the message was generated with, so it needs no model
 * call and cannot touch the rest of the copy.
 */
export async function repairLinks(
  campaignId: string,
  stepKey: string
): Promise<{ count: number; bodies: Record<string, string> }> {
  const campaign = await db.campaign.findUniqueOrThrow({ where: { id: campaignId } });
  const current = campaign.registrationLink || campaign.zoomLink || '';
  if (!current) return { count: 0, bodies: {} };

  const messages = await db.personalizedMessage.findMany({ where: { campaignId, stepKey } });
  const stale = messages.filter((m) => isLinkStale(m.linkUsed, current));
  if (stale.length === 0) return { count: 0, bodies: {} };

  const currentBare = current.replace(/^https?:\/\//, '');
  const bodies: Record<string, string> = {};

  const writes = stale.map((m) => {
    const old = m.linkUsed!;
    const oldBare = old.replace(/^https?:\/\//, '');
    // Replace the fully-qualified form first so the bare pass can't corrupt it.
    let body = m.body.split(old).join(current);
    if (oldBare !== old) body = body.split(oldBare).join(currentBare);
    const { body: withLink } = ensureLink(body, current);
    bodies[m.contactId] = withLink;
    return db.personalizedMessage.update({ where: { id: m.id }, data: { body: withLink, linkUsed: current } });
  });

  await db.$transaction(writes);

  await db.activityLogEntry.create({
    data: {
      campaignId,
      text: `Updated the registration link in ${stale.length} personalized message${stale.length === 1 ? '' : 's'}`,
      dot: 'var(--accent-500)',
    },
  });
  return { count: stale.length, bodies };
}

export async function generatePersonalized(
  campaignId: string,
  stepKey: string,
  options: { onlyMissing?: boolean; autoReview?: boolean; preserveEdited?: boolean } = {}
): Promise<GenerateResult> {
  const [campaign, template, allApprovedContacts, speakers, sentCount, cadenceStep] = await Promise.all([
    db.campaign.findUniqueOrThrow({ where: { id: campaignId } }),
    // Same resolution the send path uses. Reading the legacy per-campaign
    // table would find nothing for a campaign created after messages moved to
    // the shared library, and personalization would refuse to run.
    resolveStepTemplate(campaignId, stepKey),
    db.contact.findMany({ where: { campaignId, approved: true } }),
    db.speaker.findMany({ where: { campaignId }, orderBy: [{ order: 'asc' }, { id: 'asc' }] }),
    db.cadenceSend.count({ where: { campaignId, stepKey, status: 'sent' } }),
    db.cadenceStep.findFirst({ where: { campaignId, key: stepKey }, select: { mode: true, instruction: true } }),
  ]);

  if (sentCount > 0) {
    return { ok: false, error: `Step "${stepKey}" messages have already been sent (${sentCount} sent) — locked from regeneration.` };
  }
  // Defense-in-depth: the UI hides the Generate/Regenerate controls for a
  // Fixed Template step, but the server action must refuse it too — otherwise
  // a stale tab or a race with switchStepToFixedTemplateAction could silently
  // resurrect AI copy for a step the operator explicitly locked to fixed text.
  if (cadenceStep?.mode === 'template') {
    return { ok: false, error: `Step "${stepKey}" is set to a fixed template — switch it back to AI personalization first if you want to regenerate.` };
  }
  if (!template) return { ok: false, error: `No "${stepKey}" template on this campaign yet.` };
  if (allApprovedContacts.length === 0) return { ok: false, error: 'No approved contacts — approve some on the Scoring tab first.' };

  let contacts = allApprovedContacts;
  if (options.onlyMissing) {
    const existing = await db.personalizedMessage.findMany({
      where: { campaignId, stepKey },
      select: { contactId: true },
    });
    const existingIds = new Set(existing.map((e) => e.contactId));
    contacts = allApprovedContacts.filter((c) => !existingIds.has(c.id));
    if (contacts.length === 0) {
      return { ok: true, generated: 0, skipped: 0, linkRepaired: 0, messages: [] };
    }
  } else if (options.preserveEdited) {
    const edited = await db.personalizedMessage.findMany({
      where: { campaignId, stepKey, status: 'edited' },
      select: { contactId: true },
    });
    const editedIds = new Set(edited.map((e) => e.contactId));
    contacts = allApprovedContacts.filter((c) => !editedIds.has(c.id));
    if (contacts.length === 0) {
      return { ok: true, generated: 0, skipped: 0, linkRepaired: 0, messages: [] };
    }
  }

  const link = campaign.registrationLink || campaign.zoomLink || '';
  const channel = channelFor(template.channel);
  const activeFields = parseActiveFields(campaign.personalizationFields);

  const payload: PersonalizeContact[] = contacts.map((c) => buildPersonalizeContact(c, activeFields));

  try {
    const { drafts, failedBatches } = await personalizeMessages({
      campaign: {
        name: campaign.name,
        description: campaign.description,
        vertical: campaign.vertical,
        whenLabel: campaign.date,
        link,
        brief: campaign.brief,
        tone: campaign.tone,
        msgLength: campaign.msgLength,
        aiInstructions: campaign.aiInstructions,
        speakerName: campaign.speakerName,
        speakerTitle: campaign.speakerTitle,
        speakers: speakers.map((s) => ({
          name: s.name,
          title: s.title,
          company: s.company,
          bio: s.bio,
          isPrimary: s.isPrimary,
        })),
      },
      channel,
      stepLabel: template.label,
      templateSubject: template.hasSubject ? template.subject : null,
      templateBody: template.body,
      contacts: payload,
      customInstructions: campaign.personalizationPrompt,
      stepInstruction: cadenceStep?.instruction,
    });

    const validIds = new Set(contacts.map((c) => c.id));
    let linkRepaired = 0;
    const autoReview = options.autoReview !== false;
    const now = new Date();

    const writes = drafts
      .filter((d) => validIds.has(d.id))
      .map((d) => {
        const { body, repaired } = ensureLink(d.body, link);
        if (repaired) linkRepaired++;
        const data = {
          channel,
          subject: channel === 'email' ? d.subject : null,
          body,
          rationale: d.rationale,
          linkUsed: link || null,
          status: autoReview ? 'reviewed' : 'draft',
          generatedAt: now,
          editedAt: null,
          reviewedAt: autoReview ? now : null,
        };
        return db.personalizedMessage.upsert({
          where: { campaignId_contactId_stepKey: { campaignId, contactId: d.id, stepKey } },
          update: data,
          create: { campaignId, contactId: d.id, stepKey, ...data },
        });
      });

    const written = await db.$transaction(writes);

    await db.activityLogEntry.create({
      data: {
        campaignId,
        text: `Personalized "${template.label}" for ${writes.length} approved contact${writes.length === 1 ? '' : 's'}${
          linkRepaired ? ` — registration link re-inserted into ${linkRepaired}` : ''
        }${failedBatches > 0 ? ` — ${failedBatches} batch${failedBatches === 1 ? '' : 'es'} returned no usable output and were skipped` : ''}`,
        dot: failedBatches > 0 ? 'var(--warning-700)' : 'var(--accent-500)',
      },
    });

    // A dropped batch used to just vanish silently — those approved contacts
    // got no draft at all with nothing telling the operator a re-run is needed.
    if (failedBatches > 0) {
      await upsertAttentionItem(campaignId, {
        icon: 'ErrorProperty1Outline',
        color: 'warning',
        title: `Personalization incomplete for "${template.label}"`,
        detail: `${failedBatches} batch${failedBatches === 1 ? '' : 'es'} of contacts got no usable output from Claude — some approved contacts were not personalized this run. Regenerate to retry them.`,
        actionsCsv: 'retry',
      });
    }

    return {
      ok: true,
      generated: written.length,
      skipped: contacts.length - written.length,
      linkRepaired,
      batchFailures: failedBatches,
      messages: written.map(toWritten),
    };
  } catch (err) {
    await upsertAttentionItem(campaignId, {
      icon: 'ErrorProperty1Outline',
      color: 'error',
      title: `Personalization failed for "${template.label}"`,
      detail: String(err).slice(0, 600),
      actionsCsv: 'retry',
    });
    return { ok: false, error: String(err).slice(0, 250) };
  }
}

/** Regenerates a single recipient's message — used by the per-row Regenerate action. */
export async function regenerateOne(campaignId: string, contactId: string, stepKey: string): Promise<GenerateResult> {
  const [campaign, template, contact, speakers, sentCount, cadenceStep] = await Promise.all([
    db.campaign.findUniqueOrThrow({ where: { id: campaignId } }),
    resolveStepTemplate(campaignId, stepKey),
    db.contact.findUniqueOrThrow({ where: { id: contactId } }),
    db.speaker.findMany({ where: { campaignId }, orderBy: [{ order: 'asc' }, { id: 'asc' }] }),
    db.cadenceSend.count({ where: { campaignId, stepKey, status: 'sent' } }),
    db.cadenceStep.findFirst({ where: { campaignId, key: stepKey }, select: { mode: true, instruction: true } }),
  ]);

  if (sentCount > 0) {
    return { ok: false, error: `Step "${stepKey}" has already been dispatched (${sentCount} sent) — locked from regeneration.` };
  }
  if (cadenceStep?.mode === 'template') {
    return { ok: false, error: `Step "${stepKey}" is set to a fixed template — switch it back to AI personalization first if you want to regenerate.` };
  }
  if (!template) return { ok: false, error: 'Template missing.' };

  const link = campaign.registrationLink || campaign.zoomLink || '';
  const channel = channelFor(template.channel);
  const activeFields = parseActiveFields(campaign.personalizationFields);

  try {
    const { drafts } = await personalizeMessages({
      campaign: {
        name: campaign.name,
        description: campaign.description,
        vertical: campaign.vertical,
        whenLabel: campaign.date,
        link,
        brief: campaign.brief,
        tone: campaign.tone,
        msgLength: campaign.msgLength,
        aiInstructions: campaign.aiInstructions,
        speakerName: campaign.speakerName,
        speakerTitle: campaign.speakerTitle,
        speakers: speakers.map((s) => ({
          name: s.name,
          title: s.title,
          company: s.company,
          bio: s.bio,
          isPrimary: s.isPrimary,
        })),
      },
      channel,
      stepLabel: template.label,
      templateSubject: template.hasSubject ? template.subject : null,
      templateBody: template.body,
      customInstructions: campaign.personalizationPrompt,
      contacts: [buildPersonalizeContact(contact, activeFields)],
      stepInstruction: cadenceStep?.instruction,
    });
    const draft = drafts[0];
    if (!draft) return { ok: false, error: 'Claude returned nothing usable.' };

    const { body } = ensureLink(draft.body, link);
    const now = new Date();
    const data = {
      channel,
      subject: channel === 'email' ? draft.subject : null,
      body,
      rationale: draft.rationale,
      linkUsed: link || null,
      status: 'reviewed',
      generatedAt: now,
      editedAt: null,
      reviewedAt: now,
    };
    const written = await db.personalizedMessage.upsert({
      where: { campaignId_contactId_stepKey: { campaignId, contactId, stepKey } },
      update: data,
      create: { campaignId, contactId, stepKey, ...data },
    });
    return { ok: true, generated: 1, messages: [toWritten(written)] };
  } catch (err) {
    return { ok: false, error: String(err).slice(0, 250) };
  }
}

/** Generates personalized drafts for all enabled personalizable steps for this campaign. */
export async function generateAllSteps(
  campaignId: string,
  options: { onlyMissing?: boolean; autoReview?: boolean } = {}
): Promise<{ ok: boolean; totalGenerated: number; errors: string[] }> {
  const steps = await db.cadenceStep.findMany({
    // Fixed Template steps are intentionally excluded here rather than left
    // to fail inside generatePersonalized — that would surface a "locked to
    // fixed template" message in the errors list as if something went wrong,
    // when skipping it is exactly the expected behavior for "all steps".
    where: { campaignId, enabled: true, removedAt: null, mode: { not: 'template' }, key: { in: PERSONALIZABLE_STEPS as unknown as string[] } },
    select: { key: true },
  });
  let totalGenerated = 0;
  const errors: string[] = [];
  for (const s of steps) {
    const res = await generatePersonalized(campaignId, s.key, options);
    if (res.ok) {
      totalGenerated += res.generated ?? 0;
      // ok:true only means the step ran — a dropped Claude batch inside it
      // still needs to reach this array, or "all steps" reports clean while
      // some approved contacts quietly got no draft.
      if (res.batchFailures) {
        errors.push(`${s.key}: ${res.batchFailures} batch${res.batchFailures === 1 ? '' : 'es'} returned no usable output — some contacts were not personalized.`);
      }
    } else if (res.error) {
      errors.push(`${s.key}: ${res.error}`);
    }
  }
  return { ok: errors.length === 0, totalGenerated, errors };
}

