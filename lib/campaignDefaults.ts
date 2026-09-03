import { db } from '@/lib/db';
import { cadenceStepsData } from '@/lib/demo-data';
import { STEP_DEFAULTS } from '@/lib/stepSchedule';
import { defaultTriggerFor } from '@/lib/stepTrigger';
import { normalizeChannel } from '@/lib/channels';

/**
 * Give a new campaign its baseline cadence.
 *
 * Note what this no longer does: it does not copy fifteen Template rows into
 * the campaign. Messages live in the shared library now, and each step points
 * at the library row for its key. Copying them per campaign is what produced
 * 240 near-identical rows and made a typo a sixteen-place fix.
 *
 * A campaign that needs its own wording uses "copy into campaign" from the
 * library, which creates exactly one override.
 *
 * Idempotent via @@unique([campaignId, key]), so calling it twice is a no-op.
 */
export async function provisionCampaignDefaults(campaignId: string) {
  // One lookup for the whole library, rather than a query per step.
  const library = await db.messageTemplate.findMany({
    where: { campaignId: null },
    select: { id: true, key: true, channel: true },
  });
  const byKey = new Map(library.filter((t) => t.key).map((t) => [t.key as string, t.id]));
  const byChannel = new Map<string, string>();
  for (const t of library) if (!byChannel.has(t.channel)) byChannel.set(t.channel, t.id);

  await Promise.all(
    cadenceStepsData.map((s) =>
      db.cadenceStep.upsert({
        where: { campaignId_key: { campaignId, key: s.id } },
        update: {},
        create: {
          campaignId,
          key: s.id,
          group: s.group,
          title: s.title,
          timing: s.timing,
          channel: s.channel,
          desc: s.desc,
          toggleable: s.toggleable,
          enabled: s.toggleable,
          isRoadmap: !!s.isRoadmap,
          trigger: defaultTriggerFor(s.id),
          // Prefer the library message for this exact step; fall back to any
          // library message on the same channel so a step is never left with
          // nothing to send.
          templateId: byKey.get(s.id) ?? byChannel.get(normalizeChannel(s.channel)) ?? null,
          ...(STEP_DEFAULTS[s.id] ?? {}),
        },
      })
    )
  );
}
