import { db } from '@/lib/db';
import { resolveStepTemplate } from '@/lib/messageTemplates';
import { personalizeMessages, type PersonalizeContact } from '@/lib/claude';
import { upsertAttentionItem } from '@/lib/attentionItems';
import { normalizeChannel } from '@/lib/channels';

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

export async function generatePersonalized(campaignId: string, stepKey: string): Promise<GenerateResult> {
  const [campaign, template, contacts] = await Promise.all([
    db.campaign.findUniqueOrThrow({ where: { id: campaignId } }),
    // Same resolution the send path uses. Reading the legacy per-campaign
    // table would find nothing for a campaign created after messages moved to
    // the shared library, and personalization would refuse to run.
    resolveStepTemplate(campaignId, stepKey),
    db.contact.findMany({ where: { campaignId, approved: true } }),
  ]);

  if (!template) return { ok: false, error: `No "${stepKey}" template on this campaign yet.` };
  if (contacts.length === 0) return { ok: false, error: 'No approved contacts — approve some on the Scoring tab first.' };

  const link = campaign.registrationLink || campaign.zoomLink || '';
  const channel = channelFor(template.channel);

  const payload: PersonalizeContact[] = contacts.map((c) => ({
    id: c.id,
    name: c.name,
    title: c.title,
    function: c.function,
    seniority: c.seniority,
    account: c.account,
    vertical: c.vertical,
    personaNote: c.personaNote,
    score: c.score,
    scoreRationale: c.explanation,
    hasLinkedIn: !!c.linkedinId,
  }));

  try {
    const drafts = await personalizeMessages({
      campaign: {
        name: campaign.name,
        description: campaign.description,
        vertical: campaign.vertical,
        whenLabel: campaign.date,
        link,
      },
      channel,
      stepLabel: template.label,
      templateSubject: template.hasSubject ? template.subject : null,
      templateBody: template.body,
      contacts: payload,
      customInstructions: campaign.personalizationPrompt,
    });

    const validIds = new Set(contacts.map((c) => c.id));
    let linkRepaired = 0;

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
          status: 'draft',
          generatedAt: new Date(),
          editedAt: null,
          reviewedAt: null,
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
        }`,
        dot: 'var(--accent-500)',
      },
    });

    return {
      ok: true,
      generated: written.length,
      skipped: contacts.length - written.length,
      linkRepaired,
      messages: written.map(toWritten),
    };
  } catch (err) {
    await upsertAttentionItem(campaignId, {
      icon: 'ErrorProperty1Outline',
      color: 'error',
      title: `Personalization failed for "${template.label}"`,
      detail: String(err).slice(0, 300),
      actionsCsv: 'retry',
    });
    return { ok: false, error: String(err).slice(0, 250) };
  }
}

/** Regenerates a single recipient's message — used by the per-row Regenerate action. */
export async function regenerateOne(campaignId: string, contactId: string, stepKey: string): Promise<GenerateResult> {
  const [campaign, template, contact] = await Promise.all([
    db.campaign.findUniqueOrThrow({ where: { id: campaignId } }),
    resolveStepTemplate(campaignId, stepKey),
    db.contact.findUniqueOrThrow({ where: { id: contactId } }),
  ]);
  if (!template) return { ok: false, error: 'Template missing.' };

  const link = campaign.registrationLink || campaign.zoomLink || '';
  const channel = channelFor(template.channel);

  try {
    const [draft] = await personalizeMessages({
      campaign: { name: campaign.name, description: campaign.description, vertical: campaign.vertical, whenLabel: campaign.date, link },
      channel,
      stepLabel: template.label,
      templateSubject: template.hasSubject ? template.subject : null,
      templateBody: template.body,
      customInstructions: campaign.personalizationPrompt,
      contacts: [
        {
          id: contact.id,
          name: contact.name,
          title: contact.title,
          function: contact.function,
          seniority: contact.seniority,
          account: contact.account,
          vertical: contact.vertical,
          personaNote: contact.personaNote,
          score: contact.score,
          scoreRationale: contact.explanation,
          hasLinkedIn: !!contact.linkedinId,
        },
      ],
    });
    if (!draft) return { ok: false, error: 'Claude returned nothing usable.' };

    const { body } = ensureLink(draft.body, link);
    const data = {
      channel,
      subject: channel === 'email' ? draft.subject : null,
      body,
      rationale: draft.rationale,
      linkUsed: link || null,
      status: 'draft',
      generatedAt: new Date(),
      editedAt: null,
      reviewedAt: null,
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
