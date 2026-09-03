import { db } from '@/lib/db';

/**
 * The copy a cadence step will actually send, flattened so callers do not care
 * which of the four possible sources it came from.
 *
 * `label` (not `name`) because the SMS/WhatsApp send path already destructures
 * that shape from the legacy Template, and there was no reason to churn it.
 */
export interface ResolvedTemplate {
  id: string;
  /** Where this came from — surfaced in errors so a wrong message is traceable. */
  source: 'step' | 'campaign-override' | 'library' | 'legacy';
  label: string;
  channel: string;
  hasSubject: boolean;
  subject: string | null;
  body: string;
  hidden: boolean;
  status: string;
}

const SELECT = {
  id: true,
  name: true,
  channel: true,
  hasSubject: true,
  subject: true,
  body: true,
  hidden: true,
  status: true,
} as const;

function fromMessageTemplate(
  m: { id: string; name: string; channel: string; hasSubject: boolean; subject: string | null; body: string; hidden: boolean; status: string },
  source: ResolvedTemplate['source']
): ResolvedTemplate {
  return {
    id: m.id,
    source,
    label: m.name,
    channel: m.channel,
    hasSubject: m.hasSubject,
    subject: m.subject,
    body: m.body,
    hidden: m.hidden,
    status: m.status,
  };
}

/**
 * Resolve the message for one step, most specific first:
 *
 *   1. the template the step explicitly points at
 *   2. this campaign's own override for that step key
 *   3. the shared library row for that step key
 *   4. the legacy per-campaign Template row
 *
 * Step 4 exists because the old `Template` table is deliberately left intact by
 * the library migration, so this is reversible and so a campaign created by
 * older code still sends. It can be deleted once no Template rows remain.
 *
 * Returning null means the step has no copy at all, which the send path treats
 * as a failure rather than sending something invented.
 */
export async function resolveStepTemplate(campaignId: string, stepKey: string): Promise<ResolvedTemplate | null> {
  const step = await db.cadenceStep.findUnique({
    where: { campaignId_key: { campaignId, key: stepKey } },
    select: { templateId: true },
  });

  if (step?.templateId) {
    const explicit = await db.messageTemplate.findUnique({ where: { id: step.templateId }, select: SELECT });
    // A deleted template leaves templateId dangling only if the FK's SetNull
    // did not run; fall through rather than failing the send outright.
    if (explicit) return fromMessageTemplate(explicit, 'step');
  }

  const override = await db.messageTemplate.findFirst({
    where: { campaignId, key: stepKey },
    select: SELECT,
  });
  if (override) return fromMessageTemplate(override, 'campaign-override');

  const library = await db.messageTemplate.findFirst({
    where: { campaignId: null, key: stepKey },
    select: SELECT,
  });
  if (library) return fromMessageTemplate(library, 'library');

  const legacy = await db.template.findUnique({
    where: { campaignId_key: { campaignId, key: stepKey } },
    select: { id: true, label: true, channel: true, hasSubject: true, subject: true, body: true, hidden: true },
  });
  if (legacy) {
    return {
      id: legacy.id,
      source: 'legacy',
      label: legacy.label,
      channel: legacy.channel,
      hasSubject: legacy.hasSubject,
      subject: legacy.subject,
      body: legacy.body,
      hidden: legacy.hidden,
      status: 'ready',
    };
  }

  return null;
}
