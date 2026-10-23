import { db } from '@/lib/db';
import { normalizeChannel } from '@/lib/channels';
import type { SpeakerTxClient } from '@/lib/speakers';

/** The shared client, or the interactive transaction a caller is already inside. */
type Client = typeof db | SpeakerTxClient;

// Database-only persistence for the wizard's messaging step. It is shared by the Continue action
// (lib/actions/wizard.ts, which adds the AI drafting afterwards) and by the draft autosave
// (lib/wizardDraftServer.ts), so the two write the same columns the same way. Nothing here calls the AI,
// a CRM, Zoom or any sender: drafting stays an explicit action.

export interface MessagingPatch {
  msgMode?: 'ai' | 'templatized';
  tone?: string;
  msgLength?: string;
  aiInstructions?: string;
  brief?: string;
  oneClickSignup?: boolean;
  personalizationFields?: string[];
  /** Which channels are on. Omit to leave the cadence's channel switches alone. */
  channels?: Record<string, boolean>;
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

export async function applyMessagingPatch(campaignId: string, patch: MessagingPatch, client: Client = db): Promise<void> {
  const current = await client.campaign.findUnique({
    where: { id: campaignId },
    select: { msgMode: true, tone: true, msgLength: true, aiInstructions: true },
  });
  const tone = patch.tone ?? current?.tone ?? undefined;
  const msgLength = patch.msgLength ?? current?.msgLength ?? undefined;
  const aiInstructions = patch.aiInstructions ?? current?.aiInstructions ?? undefined;
  const msgMode = patch.msgMode ?? (current?.msgMode as 'ai' | 'templatized' | undefined) ?? 'ai';

  // Tone and length are folded into the prompt the model reads, so a change to any of the three rewrites it.
  const touchesPrompt = patch.tone !== undefined || patch.msgLength !== undefined || patch.aiInstructions !== undefined;
  const instructions = [
    aiInstructions?.trim(),
    tone ? `Tone: ${tone}.` : null,
    msgLength ? `Length: ${msgLength}.` : null,
  ].filter(Boolean).join(' ');

  const data = {
    ...(patch.msgMode !== undefined ? { msgMode: patch.msgMode } : {}),
    ...(patch.tone !== undefined ? { tone: patch.tone } : {}),
    ...(patch.msgLength !== undefined ? { msgLength: patch.msgLength } : {}),
    ...(patch.aiInstructions !== undefined ? { aiInstructions: patch.aiInstructions } : {}),
    ...(patch.brief !== undefined ? { brief: patch.brief } : {}),
    ...(patch.oneClickSignup !== undefined ? { oneClickSignup: patch.oneClickSignup } : {}),
    ...(patch.personalizationFields && patch.personalizationFields.length > 0
      ? { personalizationFields: patch.personalizationFields.join(',') }
      : {}),
    ...(touchesPrompt && instructions ? { personalizationPrompt: instructions } : {}),
  };
  if (Object.keys(data).length > 0) await client.campaign.update({ where: { id: campaignId }, data });

  // Templatized mode with custom copy: the brief becomes this campaign's own "invite" template.
  if (msgMode === 'templatized' && patch.brief?.trim()) {
    const customTemplate = await client.messageTemplate.upsert({
      where: { campaignId_key: { campaignId, key: 'invite' } },
      update: { body: patch.brief.trim() },
      create: {
        campaignId,
        key: 'invite',
        name: 'Initial invite (Custom)',
        channel: 'email',
        hasSubject: true,
        subject: "You're invited: {{topic}}",
        body: patch.brief.trim(),
        status: 'ready',
      },
    });
    await client.cadenceStep.updateMany({ where: { campaignId, key: 'invite' }, data: { templateId: customTemplate.id } });
  }

  // Channel choice is the same switch the planner uses (a channel's steps being enabled), so the two can
  // never disagree. Only a channel whose on/off state actually flipped is touched, so a per-step choice made
  // in the Cadence Planner survives an unrelated re-save.
  if (patch.channels) {
    const channels = patch.channels;
    const steps = await client.cadenceStep.findMany({
      where: { campaignId, removedAt: null },
      select: { id: true, channel: true, enabled: true },
    });
    const wasChannelOn = new Map<string, boolean>();
    for (const s of steps) {
      const ch = normalizeChannel(s.channel);
      wasChannelOn.set(ch, (wasChannelOn.get(ch) ?? false) || s.enabled);
    }
    const flips = steps.filter((s) => {
      const ch = normalizeChannel(s.channel);
      return (wasChannelOn.get(ch) ?? false) !== (channels[ch] ?? false);
    });
    const flip = (s: (typeof flips)[number]) =>
      client.cadenceStep.update({ where: { id: s.id }, data: { enabled: channels[normalizeChannel(s.channel)] ?? false } });
    // One atomic batch on the shared client; inside a caller's transaction they simply run in turn.
    if (flips.length > 0) {
      if (client === db) await db.$transaction(flips.map(flip));
      else for (const s of flips) await flip(s);
    }
  }

  // Per-step configuration: template vs AI, the chosen template, custom instructions and copy.
  if (patch.stepConfigs) {
    for (const [key, cfg] of Object.entries(patch.stepConfigs)) {
      await client.cadenceStep.updateMany({
        where: { campaignId, key },
        data: {
          ...(cfg.mode ? { mode: cfg.mode } : {}),
          ...(cfg.instruction !== undefined ? { instruction: cfg.instruction } : {}),
          ...(cfg.templateId !== undefined ? { templateId: cfg.templateId } : {}),
        },
      });
      if (cfg.customBody && cfg.mode === 'template') {
        const customTemplate = await client.messageTemplate.upsert({
          where: { campaignId_key: { campaignId, key } },
          update: { body: cfg.customBody, ...(cfg.customSubject ? { subject: cfg.customSubject } : {}) },
          create: {
            campaignId,
            key,
            name: `${key} (Custom)`,
            channel: 'email',
            hasSubject: !!cfg.customSubject,
            subject: cfg.customSubject || 'Update for {{topic}}',
            body: cfg.customBody,
            status: 'ready',
          },
        });
        await client.cadenceStep.updateMany({ where: { campaignId, key }, data: { templateId: customTemplate.id } });
      }
    }
  }
}
