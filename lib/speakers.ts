import { db } from './db';
import {
  type SpeakerInput,
  formatSpeakersSummary,
  formatSpeakersPromptBlock,
} from './speakerUtils';

export type { SpeakerInput };
export { formatSpeakersSummary, formatSpeakersPromptBlock };

export type SpeakerTxClient = Parameters<Parameters<typeof db.$transaction>[0]>[0];

async function syncSpeakersWith(
  client: SpeakerTxClient | typeof db,
  campaignId: string,
  speakers: SpeakerInput[]
): Promise<void> {
  // Identify primary speaker
  const validSpeakers = (speakers || []).filter((s) => s && s.name && s.name.trim());
  let primaryIndex = validSpeakers.findIndex((s) => s.isPrimary);
  if (primaryIndex === -1 && validSpeakers.length > 0) {
    primaryIndex = 0;
  }

  // Delete existing speakers and recreate to maintain exact order
  await client.speaker.deleteMany({ where: { campaignId } });

  if (validSpeakers.length > 0) {
    await client.speaker.createMany({
      data: validSpeakers.map((s, idx) => ({
        campaignId,
        name: s.name.trim(),
        title: s.title?.trim() || null,
        company: s.company?.trim() || null,
        bio: s.bio?.trim() || null,
        avatarUrl: s.avatarUrl?.trim() || null,
        linkedinUrl: s.linkedinUrl?.trim() || null,
        isPrimary: idx === primaryIndex,
        order: s.order ?? idx,
      })),
    });
  }

  // Mirror primary speaker to Campaign.speakerName and Campaign.speakerTitle for backward compatibility
  const primarySpeaker = validSpeakers[primaryIndex];
  await client.campaign.update({
    where: { id: campaignId },
    data: {
      speakerName: primarySpeaker ? primarySpeaker.name.trim() : null,
      speakerTitle: primarySpeaker ? primarySpeaker.title?.trim() || null : null,
    },
  });
}

/**
 * Persists a campaign's speaker roster and maintains backward-compatible
 * mirrors on Campaign (speakerName, speakerTitle).
 */
export async function syncSpeakersForCampaign(
  campaignId: string,
  speakers: SpeakerInput[],
  txClient?: SpeakerTxClient
): Promise<void> {
  if (txClient) {
    await syncSpeakersWith(txClient, campaignId, speakers);
  } else {
    await db.$transaction((tx) => syncSpeakersWith(tx, campaignId, speakers));
  }
}
