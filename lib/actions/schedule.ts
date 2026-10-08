'use server';

import { db } from '@/lib/db';
import { launchCadence, processDueSends, restartCadence } from '@/lib/cadence';
import { resolveStepDate, offsetLabel, ANCHOR_LABEL, STEP_DEFAULTS, STEP_DEFAULT_INSTRUCTIONS, parseTimingString } from '@/lib/stepSchedule';
import { revalidateCampaign } from '@/lib/revalidate';
import { z } from 'zod';
import { assertSetupEditable, assertStepUnsent } from '@/lib/setupLock';

const campaignIdSchema = z.string().min(1);
const stepKeySchema = z.string().min(1);
const stepIdSchema = z.string().min(1);

export async function toggleCadenceStepAction(campaignId: string, stepKey: string, enabled: boolean) {
  const validCampaignId = campaignIdSchema.parse(campaignId);
  const validStepKey = stepKeySchema.parse(stepKey);
  await assertStepUnsent(validCampaignId, validStepKey);
  await db.cadenceStep.update({ where: { campaignId_key: { campaignId: validCampaignId, key: validStepKey } }, data: { enabled: !!enabled } });
  revalidateCampaign(validCampaignId);
}

/**
 * Re-times a single step. Already-queued sends for that step are re-dated too, so
 * changing the schedule after launch actually moves the pending sends rather than
 * only changing what the UI claims.
 */
const VALID_OFFSET_UNITS = new Set(['days', 'hours', 'minutes']);
const VALID_ANCHORS = new Set(['launch', 'webinar', 'event']);

export async function updateStepScheduleAction(
  campaignId: string,
  stepKey: string,
  patch: { offsetValue?: number; offsetUnit?: string; anchor?: string; timing?: string }
) {
  const validCampaignId = campaignIdSchema.parse(campaignId);
  const validStepKey = stepKeySchema.parse(stepKey);
  await assertStepUnsent(validCampaignId, validStepKey);
  // resolveStepDate/offsetLabel switch on exact anchor/unit strings — an
  // unrecognized value wouldn't error, it would just silently fall through to
  // their default branch and misdate the step. Reject anything outside the
  // known set instead of writing it.
  if (patch.offsetUnit !== undefined && !VALID_OFFSET_UNITS.has(patch.offsetUnit)) {
    return { ok: false as const, error: `Invalid offset unit "${patch.offsetUnit}".` };
  }
  if (patch.anchor !== undefined && !VALID_ANCHORS.has(patch.anchor)) {
    return { ok: false as const, error: `Invalid anchor "${patch.anchor}".` };
  }
  if (patch.offsetValue !== undefined && !Number.isFinite(patch.offsetValue)) {
    return { ok: false as const, error: 'Offset must be a number.' };
  }

  const dataToUpdate: {
    offsetValue?: number;
    offsetUnit?: string;
    anchor?: string;
    timing?: string;
  } = {};
  if (patch.offsetValue !== undefined) dataToUpdate.offsetValue = patch.offsetValue;
  if (patch.offsetUnit !== undefined) dataToUpdate.offsetUnit = patch.offsetUnit;
  if (patch.anchor !== undefined) dataToUpdate.anchor = patch.anchor;
  if (patch.timing !== undefined && patch.timing.trim()) {
    dataToUpdate.timing = patch.timing.trim();
  }

  const step = await db.cadenceStep.update({
    where: { campaignId_key: { campaignId: validCampaignId, key: validStepKey } },
    data: dataToUpdate,
  });
  const campaign = await db.campaign.findUniqueOrThrow({ where: { id: validCampaignId } });

  const launchAt = campaign.launchedAt ?? new Date();
  const dueAt = resolveStepDate(step, { launchAt, webinarAt: campaign.scheduledAt });
  if (dueAt) {
    await db.cadenceSend.updateMany({ where: { campaignId: validCampaignId, stepKey: validStepKey, status: 'queued' }, data: { dueAt } });
  }

  await db.activityLogEntry.create({
    data: {
      campaignId: validCampaignId,
      text: `Re-timed "${step.title}" to ${step.timing || offsetLabel(step)} ${ANCHOR_LABEL[step.anchor] ?? ''}`.trim(),
      dot: 'var(--accent-500)',
    },
  });

  revalidateCampaign(validCampaignId);
  return { ok: true as const, resolvedAt: dueAt?.toISOString() ?? null, step };
}

export async function updateCadenceStepTimingAction(
  campaignId: string,
  stepKey: string,
  timing: {
    timing: string;
    offsetValue: number;
    offsetUnit: string;
    anchor: string;
  }
) {
  return updateStepScheduleAction(campaignId, stepKey, timing);
}

/** Puts every step back to the shipped default timing. */
/**
 * Back to the shipped cadence: built-in timings restored, built-in steps
 * un-removed, and steps the operator invented deleted outright.
 *
 * Invented steps are deleted rather than soft-removed because there is no
 * default to fall back to — leaving them soft-removed would mean "reset"
 * quietly kept rows that reset is supposed to have undone.
 */
export async function resetScheduleAction(campaignId: string) {
  const validCampaignId = campaignIdSchema.parse(campaignId);
  const steps = await db.cadenceStep.findMany({ where: { campaignId: validCampaignId } });
  for (const step of steps) await assertStepUnsent(validCampaignId, step.key);
  const builtIns = steps.filter((s) => STEP_DEFAULTS[s.key]);
  const invented = steps.filter((s) => s.createdByUser);

  await db.$transaction([
    ...builtIns.map((s) =>
      db.cadenceStep.update({
        where: { id: s.id },
        data: {
          ...STEP_DEFAULTS[s.key],
          mode: 'ai',
          instruction: STEP_DEFAULT_INSTRUCTIONS[s.key] ?? s.desc,
          removedAt: null,
        },
      })
    ),
    ...invented.map((s) => db.cadenceStep.delete({ where: { id: s.id } })),
  ]);

  await db.activityLogEntry.create({
    data: {
      campaignId: validCampaignId,
      text: `Cadence reset to defaults — ${builtIns.length} step(s) restored${invented.length ? `, ${invented.length} added step(s) removed` : ''}`,
      dot: 'var(--accent-500)',
    },
  });
  revalidateCampaign(validCampaignId);
}

export interface CadenceSequenceStepPatch {
  key: string;
  timingValue?: string;
  offsetValue?: number;
  offsetUnit?: string;
  anchor?: string;
  mode?: 'template' | 'ai';
  instruction?: string;
  templateId?: string | null;
  enabled?: boolean;
}

/**
 * Persists changes made in the Communication sequence hero card:
 * batch updates timings, mode (template vs AI), prompt instructions,
 * templates, and toggle states in a single database transaction.
 * Queued sends are re-dated if timings shifted.
 */
export async function saveCadenceSequenceAction(
  campaignId: string,
  patches: CadenceSequenceStepPatch[]
): Promise<{ ok: boolean; updatedCount: number; error?: string }> {
  try {
    const validCampaignId = campaignIdSchema.parse(campaignId);
    if (!Array.isArray(patches) || patches.length === 0) {
      return { ok: true, updatedCount: 0 };
    }

    const campaign = await db.campaign.findUniqueOrThrow({ where: { id: validCampaignId } });
    const launchAt = campaign.launchedAt ?? new Date();

    const existingSteps = await db.cadenceStep.findMany({
      where: { campaignId: validCampaignId },
    });
    const stepsByKey = new Map(existingSteps.map((s) => [s.key, s]));

    // Query steps that already have sent records so they remain locked
    const sentSteps = await db.cadenceSend.groupBy({
      by: ['stepKey'],
      where: { campaignId: validCampaignId, status: 'sent' },
      _count: true,
    });
    const sentStepKeys = new Set(sentSteps.map((s) => s.stepKey));

    let updatedCount = 0;
    const sendsToUpdate: { stepKey: string; dueAt: Date }[] = [];
    const dbOps = [];

    for (const patch of patches) {
      const existing = stepsByKey.get(patch.key);
      if (!existing) continue;

      // If step already has sent messages, it is locked — cannot change timing or enabled state
      if (sentStepKeys.has(patch.key)) {
        continue;
      }

      let offsetValue = patch.offsetValue ?? existing.offsetValue;
      let offsetUnit = patch.offsetUnit ?? existing.offsetUnit;
      let anchor = patch.anchor ?? existing.anchor;
      const timing = patch.timingValue ?? existing.timing;

      if (patch.timingValue !== undefined && patch.offsetValue === undefined) {
        const parsed = parseTimingString(patch.timingValue, {
          offsetValue: existing.offsetValue,
          offsetUnit: existing.offsetUnit,
          anchor: existing.anchor,
        });
        offsetValue = parsed.offsetValue;
        offsetUnit = parsed.offsetUnit;
        anchor = parsed.anchor;
      }

      const nextMode = patch.mode ?? existing.mode ?? 'ai';
      const nextInstruction = patch.instruction !== undefined ? patch.instruction : existing.instruction;
      const nextTemplateId = patch.templateId !== undefined ? patch.templateId : existing.templateId;
      const nextEnabled = patch.enabled !== undefined ? patch.enabled : existing.enabled;

      dbOps.push(
        db.cadenceStep.update({
          where: { campaignId_key: { campaignId: validCampaignId, key: patch.key } },
          data: {
            timing,
            offsetValue,
            offsetUnit,
            anchor,
            mode: nextMode,
            instruction: nextInstruction,
            templateId: nextTemplateId,
            enabled: nextEnabled,
          },
        })
      );
      updatedCount++;

      if (
        offsetValue !== existing.offsetValue ||
        offsetUnit !== existing.offsetUnit ||
        anchor !== existing.anchor
      ) {
        const dummyStep = { ...existing, offsetValue, offsetUnit, anchor };
        const nextDueAt = resolveStepDate(dummyStep, { launchAt, webinarAt: campaign.scheduledAt });
        if (nextDueAt) {
          sendsToUpdate.push({ stepKey: patch.key, dueAt: nextDueAt });
        }
      }
    }

    for (const s of sendsToUpdate) {
      dbOps.push(
        db.cadenceSend.updateMany({
          where: { campaignId: validCampaignId, stepKey: s.stepKey, status: 'queued' },
          data: { dueAt: s.dueAt },
        })
      );
    }

    if (dbOps.length > 0) {
      await db.$transaction(dbOps);
    }

    await db.activityLogEntry.create({
      data: {
        campaignId: validCampaignId,
        text: `Saved communication sequence (${updatedCount} step(s) updated)`,
        dot: 'var(--accent-500)',
      },
    });

    revalidateCampaign(validCampaignId);
    return { ok: true, updatedCount };
  } catch (err) {
    return {
      ok: false,
      updatedCount: 0,
      error: err instanceof Error ? err.message : 'Failed to save communication sequence',
    };
  }
}


const CHANNEL_LABEL: Record<string, string> = {
  email: 'Email',
  sms: 'SMS',
  whatsapp: 'WhatsApp',
  linkedin: 'LinkedIn (assisted)',
};

/**
 * Add a step the operator invented.
 *
 * The key is generated and unique — it is what CadenceSend rows reference, so
 * it must never collide with a built-in or with a previously removed step of
 * the same name.
 */
export async function addCadenceStepAction(campaignId: string, group: string, channel: string) {
  const validCampaignId = campaignIdSchema.parse(campaignId);
  const validGroup = z.string().min(1).parse(group);
  const validChannel = z.string().min(1).parse(channel);
  const label = CHANNEL_LABEL[validChannel] ?? 'Email';
  const key = `custom-${validChannel}-${Date.now().toString(36)}`;

  // A registrants-only group means the audience arrives by registration; a
  // post-webinar group is decided by the attendance import. Getting this wrong
  // would queue the step to the whole approved audience at launch.
  const trigger = validGroup.toLowerCase().includes('registrant')
    ? 'registration'
    : validGroup.toLowerCase().includes('post-webinar')
      ? 'attendance'
      : 'launch';
  const anchor = trigger === 'launch' ? 'launch' : 'webinar';

  const step = await db.cadenceStep.create({
    data: {
      campaignId: validCampaignId,
      key,
      group: validGroup,
      title: `New ${label} step`,
      timing: '+2 days',
      channel: label,
      desc: 'Added in the cadence planner.',
      toggleable: true,
      enabled: true,
      createdByUser: true,
      trigger,
      anchor,
      offsetValue: 2,
      offsetUnit: 'days',
      // Default to the library message for this channel so a new step is
      // sendable immediately rather than failing on missing copy.
      templateId: (await db.messageTemplate.findFirst({ where: { campaignId: null, channel: validChannel }, select: { id: true } }))?.id ?? null,
    },
  });

  await db.activityLogEntry.create({
    data: { campaignId: validCampaignId, text: `Added a ${label} step to “${validGroup}”`, dot: 'var(--accent-500)' },
  });
  revalidateCampaign(validCampaignId);
  return step.id;
}

/**
 * Remove a step from the planner.
 *
 * Built-ins are soft-removed so reset can bring them back and so their unique
 * key stays taken. Invented steps are deleted, since nothing would restore
 * them. Queued sends are cancelled either way — leaving them would send a
 * message from a step the operator believes they deleted.
 */
export async function removeCadenceStepAction(campaignId: string, stepId: string) {
  const validCampaignId = campaignIdSchema.parse(campaignId);
  const state = await db.campaign.findUniqueOrThrow({ where: { id: validCampaignId }, select: { status: true, archived: true } });
  if (state.status === 'completed' || state.archived) throw new Error('This webinar is closed.');
  const validStepId = stepIdSchema.parse(stepId);
  const step = await db.cadenceStep.findUniqueOrThrow({ where: { id: validStepId } });
  await assertStepUnsent(validCampaignId, step.key);

  const cancelled = await db.cadenceSend.updateMany({
    where: { campaignId: validCampaignId, stepKey: step.key, status: 'queued' },
    data: { status: 'skipped', error: 'Step removed from the cadence planner' },
  });

  if (step.createdByUser) {
    await db.cadenceStep.delete({ where: { id: validStepId } });
  } else {
    await db.cadenceStep.update({ where: { id: validStepId }, data: { removedAt: new Date(), enabled: false } });
  }

  await db.activityLogEntry.create({
    data: {
      campaignId: validCampaignId,
      text: `Removed “${step.title}” from the cadence${cancelled.count ? ` — ${cancelled.count} queued send(s) cancelled` : ''}`,
      dot: 'var(--warning-700)',
    },
  });
  revalidateCampaign(validCampaignId);
  return { cancelled: cancelled.count };
}

export async function launchCadenceAction(campaignId: string) {
  const validCampaignId = campaignIdSchema.parse(campaignId);
  const result = await launchCadence(validCampaignId);
  // Fire anything already due (e.g. the Day-0 invite) immediately after launch.
  const processed = await processDueSends(validCampaignId);
  revalidateCampaign(validCampaignId);
  return { ...result, ...processed };
}

/**
 * Resets a stopped cadence back to `not_started` so Schedule can show the
 * Launch button again — previously a stopped campaign had no path back to
 * sending at all short of manually editing the database. This does not
 * un-stop the abandoned run (see restartCadence's comment); it starts a new one.
 */
export async function restartCadenceAction(campaignId: string) {
  const validCampaignId = campaignIdSchema.parse(campaignId);
  const result = await restartCadence(validCampaignId);
  revalidateCampaign(validCampaignId);
  return result;
}

export type AutomationRuleKey =
  | 'stopOnRegistration'
  | 'stopOnDecline'
  | 'oneClickSignup'
  | 'suppressionPreflight';

const RULE_LABELS: Record<AutomationRuleKey, string> = {
  stopOnRegistration: 'Stop when a contact registers',
  stopOnDecline: 'Stop when a contact declines',
  oneClickSignup: 'One-click registration magic link',
  suppressionPreflight: 'Suppression list pre-flight filtering',
};

export async function updateCadenceAutomationRuleAction(
  campaignId: string,
  rule: AutomationRuleKey,
  enabled: boolean
) {
  const validCampaignId = campaignIdSchema.parse(campaignId);
  const state = await db.campaign.findUniqueOrThrow({ where: { id: validCampaignId }, select: { status: true, archived: true } });
  if (state.status === 'completed' || state.archived) throw new Error('This webinar is closed.');
  if (rule === 'oneClickSignup') await assertSetupEditable(validCampaignId);
  if (!RULE_LABELS[rule]) {
    return { ok: false as const, error: `Invalid automation rule: ${rule}` };
  }

  await db.campaign.update({
    where: { id: validCampaignId },
    data: { [rule]: !!enabled },
  });

  let reconciledSendsCount = 0;

  // Retroactive send reconciliation when a rule is enabled
  if (enabled) {
    if (rule === 'stopOnRegistration') {
      const registeredContacts = await db.contact.findMany({
        where: { campaignId: validCampaignId, registeredAt: { not: null } },
        select: { id: true },
      });
      const registeredIds = registeredContacts.map((c) => c.id);
      if (registeredIds.length > 0) {
        const outreachSteps = await db.cadenceStep.findMany({
          where: {
            campaignId: validCampaignId,
            OR: [
              { group: 'Pre-registration' },
              { key: { in: ['invite', 'smsInvite', 'waInvite', 'linkedin', 'nudge', 'final'] } },
            ],
          },
          select: { key: true },
        });
        const outreachKeys = Array.from(
          new Set(outreachSteps.map((s) => s.key).concat(['invite', 'smsInvite', 'waInvite', 'linkedin', 'nudge', 'final']))
        );

        const cancelled = await db.cadenceSend.updateMany({
          where: {
            campaignId: validCampaignId,
            contactId: { in: registeredIds },
            stepKey: { in: outreachKeys },
            status: { in: ['queued', 'processing'] },
          },
          data: {
            status: 'skipped',
            error: 'Rule enabled: Stop when a contact registers — pending outreach cancelled',
          },
        });
        reconciledSendsCount = cancelled.count;
      }
    } else if (rule === 'stopOnDecline') {
      const unsubContacts = await db.contact.findMany({
        where: { campaignId: validCampaignId, unsubscribedAt: { not: null } },
        select: { id: true },
      });
      const unsubIds = unsubContacts.map((c) => c.id);
      if (unsubIds.length > 0) {
        const cancelled = await db.cadenceSend.updateMany({
          where: {
            campaignId: validCampaignId,
            contactId: { in: unsubIds },
            status: { in: ['queued', 'processing'] },
          },
          data: {
            status: 'skipped',
            error: 'Rule enabled: Stop when a contact declines — pending touches cancelled',
          },
        });
        reconciledSendsCount = cancelled.count;
      }
    } else if (rule === 'suppressionPreflight') {
      const suppressions = await db.emailSuppression.findMany({ select: { email: true } });
      const suppressedEmails = suppressions.map((s) => s.email.toLowerCase());
      if (suppressedEmails.length > 0) {
        const contacts = await db.contact.findMany({
          where: { campaignId: validCampaignId, email: { in: suppressedEmails, mode: 'insensitive' } },
          select: { id: true },
        });
        const contactIds = contacts.map((c) => c.id);
        if (contactIds.length > 0) {
          const cancelled = await db.cadenceSend.updateMany({
            where: {
              campaignId: validCampaignId,
              contactId: { in: contactIds },
              status: { in: ['queued', 'processing'] },
            },
            data: {
              status: 'skipped',
              error: 'Rule enabled: Suppression pre-flight filtering — address on suppression list',
            },
          });
          reconciledSendsCount = cancelled.count;
        }
      }
    }
  }

  const logText = `${RULE_LABELS[rule]} ${enabled ? 'enabled' : 'disabled'}${reconciledSendsCount > 0 ? ` (${reconciledSendsCount} pending send(s) cancelled)` : ''}`;

  await db.activityLogEntry.create({
    data: {
      campaignId: validCampaignId,
      text: logText,
      dot: enabled ? 'var(--accent-500)' : 'var(--n50)',
    },
  });

  revalidateCampaign(validCampaignId);
  return { ok: true as const, rule, enabled, reconciledSendsCount };
}


export async function getLaunchReadinessAction(campaignId: string) {
  const {getLaunchReadiness}=await import('@/lib/launchReadiness');
  return getLaunchReadiness(campaignIdSchema.parse(campaignId));
}
