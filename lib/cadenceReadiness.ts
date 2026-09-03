// Readiness verdicts for the Templates and Personalize tabs — the "green
// status" an operator can trust. Green means the stage is genuinely send-safe:
//
//   Templates   every ENABLED step has a template whose content passes its
//               own channel rules (link present, SMS segment budget, etc.)
//   Personalize everything above holds AND no enabled step has an invalid
//               personalized copy waiting; missing rows are fine (the shared
//               template is a valid fallback by design).
import { db } from '@/lib/db';
import { normalizeChannel } from '@/lib/channels';
import { validateTemplateContentForChannel, validateRenderedMessageForChannel } from '@/lib/messageValidation';
import { resolveStepTemplate } from '@/lib/messageTemplates';

export const KNOWN_MERGE_VARS = ['firstName', 'lastName', 'company', 'topic', 'link', 'date'];

export interface Readiness {
  ok: boolean;
  problems: string[];
}

async function enabledStepsWithTemplates(campaignId: string) {
  const steps = await db.cadenceStep.findMany({ where: { campaignId, enabled: true, removedAt: null } });

  // Resolve through the same path the send does, rather than reading the
  // legacy per-campaign table. Since messages moved to the shared library, a
  // new campaign has no legacy rows at all — reading them would report every
  // step as ready by finding nothing to check.
  const pairs = await Promise.all(
    steps.map(async (step) => ({ step, template: await resolveStepTemplate(campaignId, step.key) }))
  );
  return pairs.filter(
    (pair): pair is { step: (typeof steps)[number]; template: NonNullable<typeof pair.template> } =>
      !!pair.template && !pair.template.hidden
  );
}

export async function computeTemplatesReadiness(campaignId: string): Promise<Readiness> {
  const pairs = await enabledStepsWithTemplates(campaignId);
  const problems: string[] = [];
  for (const { template } of pairs) {
    const v = validateTemplateContentForChannel(template.subject, template.body, template.hasSubject, KNOWN_MERGE_VARS, template.channel);
    if (!v.valid) {
      problems.push(`${template.label}: ${v.issues.filter((i) => i.severity === 'error').map((i) => i.message).join('; ')}`);
    }
  }
  return { ok: problems.length === 0, problems };
}

export async function computePersonalizeReadiness(campaignId: string): Promise<Readiness & { approvedCount: number; generatedTotal: number }> {
  const campaign = await db.campaign.findUniqueOrThrow({ where: { id: campaignId }, select: { registrationLink: true, zoomLink: true } });
  const base = await computeTemplatesReadiness(campaignId);
  if (!base.ok) return { ...base, approvedCount: 0, generatedTotal: 0 };

  const approvedCount = await db.contact.count({ where: { campaignId, approved: true } });
  const pairs = await enabledStepsWithTemplates(campaignId);
  const problems: string[] = [];
  let generatedTotal = 0;

  for (const { step, template } of pairs) {
    const channel = normalizeChannel(template.channel);
    const messages = await db.personalizedMessage.findMany({ where: { campaignId, stepKey: step.key } });
    generatedTotal += messages.length;
    const invalid = messages.filter((m) => {
      const v = validateRenderedMessageForChannel(m.subject, m.body, channel === 'email', campaign.registrationLink || campaign.zoomLink || '', channel);
      return !v.valid;
    });
    if (invalid.length > 0) {
      problems.push(`${template.label}: ${invalid.length} personalized cop${invalid.length === 1 ? 'y' : 'ies'} failed validation — they fall back to the template until fixed`);
    }
  }

  return { ok: problems.length === 0, problems, approvedCount, generatedTotal };
}