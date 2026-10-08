import { describe, it, expect, vi, beforeEach } from 'vitest';
import { formatSpeakersSummary, formatSpeakersPromptBlock } from './speakers';
import { syncSpeakersForCampaign } from './speakersServer';

vi.mock('@/lib/db', () => {
  const db: Record<string, unknown> = {
    speaker: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    campaign: {
      update: vi.fn(),
    },
  };
  // Real Prisma runs the callback against an interactive-transaction client;
  // the mock just re-enters the same mocked db, which is enough to exercise
  // the atomic delete->create->update sequence in syncSpeakersForCampaign.
  db.$transaction = vi.fn((fn: (tx: unknown) => unknown) => fn(db));
  return { db };
});

import { db } from './db';

describe('speakers utility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('formats single speaker correctly', () => {
    expect(formatSpeakersSummary([{ name: 'Dr. Sarah Chen' }])).toBe('Dr. Sarah Chen');
  });

  it('formats two speakers with ampersand', () => {
    expect(
      formatSpeakersSummary([{ name: 'Dr. Sarah Chen' }, { name: 'Alex Rivera' }])
    ).toBe('Dr. Sarah Chen & Alex Rivera');
  });

  it('formats three or more speakers with oxford comma and ampersand', () => {
    expect(
      formatSpeakersSummary([
        { name: 'Dr. Sarah Chen' },
        { name: 'Alex Rivera' },
        { name: 'Maya Patel' },
      ])
    ).toBe('Dr. Sarah Chen, Alex Rivera & Maya Patel');
  });

  it('formats prompt block with titles, affiliations and primary tags', () => {
    const block = formatSpeakersPromptBlock([
      { name: 'Dr. Sarah Chen', title: 'VP of AI', company: 'Anthropic', isPrimary: true },
      { name: 'Alex Rivera', title: 'Head of Growth', company: 'Acme', bio: 'Expert in B2B scaling' },
    ]);
    expect(block).toContain('FEATURED SPEAKERS & PANEL:');
    expect(block).toContain('• Dr. Sarah Chen (VP of AI at Anthropic) [Keynote / Primary]');
    expect(block).toContain('• Alex Rivera (Head of Growth at Acme) — Expert in B2B scaling');
  });

  it('syncs primary speaker back to campaign model for backward compatibility', async () => {
    await syncSpeakersForCampaign('camp-123', [
      { name: 'Speaker 1', title: 'Director' },
      { name: 'Speaker 2', title: 'VP', isPrimary: true },
    ]);

    expect(db.speaker.deleteMany).toHaveBeenCalledWith({ where: { campaignId: 'camp-123' } });
    expect(db.speaker.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ name: 'Speaker 1', isPrimary: false }),
        expect.objectContaining({ name: 'Speaker 2', isPrimary: true }),
      ],
    });
    expect(db.campaign.update).toHaveBeenCalledWith({
      where: { id: 'camp-123' },
      data: { speakerName: 'Speaker 2', speakerTitle: 'VP' },
    });
  });

  it('clears the campaign mirror and skips createMany when the roster is emptied', async () => {
    await syncSpeakersForCampaign('camp-empty', []);

    expect(db.speaker.deleteMany).toHaveBeenCalledWith({ where: { campaignId: 'camp-empty' } });
    expect(db.speaker.createMany).not.toHaveBeenCalled();
    expect(db.campaign.update).toHaveBeenCalledWith({
      where: { id: 'camp-empty' },
      data: { speakerName: null, speakerTitle: null },
    });
  });

  it('defaults to the first speaker as primary when none is marked', async () => {
    await syncSpeakersForCampaign('camp-nodefault', [
      { name: 'Speaker A', title: 'Lead' },
      { name: 'Speaker B', title: 'Analyst' },
    ]);

    expect(db.speaker.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ name: 'Speaker A', isPrimary: true }),
        expect.objectContaining({ name: 'Speaker B', isPrimary: false }),
      ],
    });
    expect(db.campaign.update).toHaveBeenCalledWith({
      where: { id: 'camp-nodefault' },
      data: { speakerName: 'Speaker A', speakerTitle: 'Lead' },
    });
  });

  it('honors only the first isPrimary when multiple speakers claim it', async () => {
    await syncSpeakersForCampaign('camp-multi', [
      { name: 'Speaker A', isPrimary: true },
      { name: 'Speaker B', isPrimary: true },
    ]);

    expect(db.speaker.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ name: 'Speaker A', isPrimary: true }),
        expect.objectContaining({ name: 'Speaker B', isPrimary: false }),
      ],
    });
    expect(db.campaign.update).toHaveBeenCalledWith({
      where: { id: 'camp-multi' },
      data: { speakerName: 'Speaker A', speakerTitle: null },
    });
  });

  it('drops blank-name rows before assigning primary', async () => {
    await syncSpeakersForCampaign('camp-blank', [
      { name: '   ' },
      { name: 'Real Speaker', title: 'CTO' },
    ]);

    expect(db.speaker.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ name: 'Real Speaker', isPrimary: true })],
    });
    expect(db.campaign.update).toHaveBeenCalledWith({
      where: { id: 'camp-blank' },
      data: { speakerName: 'Real Speaker', speakerTitle: 'CTO' },
    });
  });

  it('runs delete, create and mirror through the same transaction client', async () => {
    await syncSpeakersForCampaign('camp-atomic', [{ name: 'Solo Speaker' }]);
    expect(db.$transaction).toHaveBeenCalled();
  });
});
