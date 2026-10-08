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
  dltTemplateId?: string | null;
  senderId?: string | null;
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
  dltTemplateId: true,
  senderId: true,
} as const;

function fromMessageTemplate(
  m: {
    id: string;
    name: string;
    channel: string;
    hasSubject: boolean;
    subject: string | null;
    body: string;
    hidden: boolean;
    status: string;
    dltTemplateId?: string | null;
    senderId?: string | null;
  },
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
    dltTemplateId: m.dltTemplateId ?? null,
    senderId: m.senderId ?? null,
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

/**
 * Same fallback chain as resolveStepTemplate, for every step key at once —
 * 5 batched queries total instead of up to 4 sequential ones PER key. Pages
 * that resolve a whole cadence's worth of steps (Overview, Cadence, Messaging,
 * the readiness checks) used to call resolveStepTemplate per step, which at
 * ~10 steps meant up to ~40 sequential round trips on a single page load.
 */
export async function resolveStepTemplates(
  campaignId: string,
  stepKeys: string[]
): Promise<Map<string, ResolvedTemplate | null>> {
  const result = new Map<string, ResolvedTemplate | null>();
  if (stepKeys.length === 0) return result;

  const steps = await db.cadenceStep.findMany({
    where: { campaignId, key: { in: stepKeys } },
    select: { key: true, templateId: true },
  });
  const stepByKey = new Map(steps.map((s) => [s.key, s]));

  const explicitIds = steps.map((s) => s.templateId).filter((id): id is string => !!id);

  const SELECT_WITH_KEY = { ...SELECT, key: true } as const;

  const [explicitRows, overrideRows, libraryRows, legacyRows] = await Promise.all([
    explicitIds.length
      ? db.messageTemplate.findMany({ where: { id: { in: explicitIds } }, select: SELECT })
      : Promise.resolve([]),
    db.messageTemplate.findMany({ where: { campaignId, key: { in: stepKeys } }, select: SELECT_WITH_KEY }),
    db.messageTemplate.findMany({ where: { campaignId: null, key: { in: stepKeys } }, select: SELECT_WITH_KEY }),
    db.template.findMany({
      where: { campaignId, key: { in: stepKeys } },
      select: { id: true, key: true, label: true, channel: true, hasSubject: true, subject: true, body: true, hidden: true },
    }),
  ]);

  const explicitById = new Map(explicitRows.map((r) => [r.id, r]));
  // Both MessageTemplate tables carry a @@unique([campaignId, key]) constraint,
  // so at most one row per key can come back here — safe to key a map by it.
  const overrideByKey = new Map(overrideRows.map((r) => [r.key as string, r]));
  const libraryByKey = new Map(libraryRows.map((r) => [r.key as string, r]));
  const legacyByKey = new Map(legacyRows.map((r) => [r.key, r]));

  for (const key of stepKeys) {
    const step = stepByKey.get(key);

    const explicit = step?.templateId ? explicitById.get(step.templateId) : undefined;
    if (explicit) {
      result.set(key, fromMessageTemplate(explicit, 'step'));
      continue;
    }

    const override = overrideByKey.get(key);
    if (override) {
      result.set(key, fromMessageTemplate(override, 'campaign-override'));
      continue;
    }

    const library = libraryByKey.get(key);
    if (library) {
      result.set(key, fromMessageTemplate(library, 'library'));
      continue;
    }

    const legacy = legacyByKey.get(key);
    if (legacy) {
      result.set(key, {
        id: legacy.id,
        source: 'legacy',
        label: legacy.label,
        channel: legacy.channel,
        hasSubject: legacy.hasSubject,
        subject: legacy.subject,
        body: legacy.body,
        hidden: legacy.hidden,
        status: 'ready',
      });
      continue;
    }

    result.set(key, null);
  }

  return result;
}

export interface TemplateUsageInput {
  id: string;
  key: string | null;
  campaignId: string | null;
}

/**
 * How many CadenceStep rows actually resolve to each of these templates —
 * not just steps that explicitly point at the row (`templateId`), but ones
 * that would land on it via the same key-fallback chain `resolveStepTemplate`
 * walks. Without this, a library default (or campaign override) that dozens
 * of `templateId: null` steps silently depend on looks unused.
 *
 * For a template with a `key`:
 *   - campaign override (campaignId set): a step in that same campaign with
 *     no explicit template pointer falls back to it ahead of the library
 *     default, so it counts as usage.
 *   - library default (campaignId null): a step in ANY campaign with no
 *     explicit pointer falls back to it, unless that campaign has its own
 *     override for the key (which wins first) — those steps are excluded.
 */
export async function getTemplateUsageCounts(templates: TemplateUsageInput[]): Promise<Record<string, number>> {
  const ids = templates.map((t) => t.id);
  const keys = Array.from(new Set(templates.map((t) => t.key).filter((k): k is string => !!k)));

  const [explicitUsage, fallbackSteps, overrides] = await Promise.all([
    db.cadenceStep.groupBy({ by: ['templateId'], where: { templateId: { in: ids } }, _count: true }),
    keys.length
      ? db.cadenceStep.findMany({ where: { templateId: null, key: { in: keys } }, select: { key: true, campaignId: true } })
      : Promise.resolve([]),
    keys.length
      ? db.messageTemplate.findMany({ where: { key: { in: keys }, campaignId: { not: null } }, select: { key: true, campaignId: true } })
      : Promise.resolve([]),
  ]);

  const explicitById = Object.fromEntries(explicitUsage.map((u) => [u.templateId ?? '', u._count]));

  const overriddenCampaignsByKey = new Map<string, Set<string>>();
  for (const o of overrides) {
    if (!o.key) continue;
    if (!overriddenCampaignsByKey.has(o.key)) overriddenCampaignsByKey.set(o.key, new Set());
    overriddenCampaignsByKey.get(o.key)!.add(o.campaignId as string);
  }

  const result: Record<string, number> = {};
  for (const t of templates) {
    let count = explicitById[t.id] ?? 0;
    if (t.key) {
      if (t.campaignId) {
        count += fallbackSteps.filter((s) => s.key === t.key && s.campaignId === t.campaignId).length;
      } else {
        const overridden = overriddenCampaignsByKey.get(t.key);
        count += fallbackSteps.filter((s) => s.key === t.key && !overridden?.has(s.campaignId)).length;
      }
    }
    result[t.id] = count;
  }
  return result;
}
