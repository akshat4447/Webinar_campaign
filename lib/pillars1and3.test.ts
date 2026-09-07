import { describe, it, expect } from 'vitest';
import { generateMessageAngles, generatePostEventDebrief } from './claude';

describe('Pillar 1: Multi-Angle A/B Copy Testing', () => {
  it('generates 3 distinct psychological angles for email', async () => {
    const result = await generateMessageAngles({
      topic: 'AI Agents in B2B Sales',
      speakerName: 'Dr. Sarah Chen',
      speakerTitle: 'VP of AI Research',
      brief: 'Hands-on session on implementing autonomous pipeline agents',
      channel: 'email',
      stepLabel: 'Invite 1',
    });

    expect(result.angles).toHaveLength(3);
    const ids = result.angles.map((a) => a.id);
    expect(ids).toContain('pain_point');
    expect(ids).toContain('benchmark_data');
    expect(ids).toContain('story_vision');

    for (const angle of result.angles) {
      expect(angle.name).toBeTruthy();
      expect(angle.rationale).toBeTruthy();
      expect(angle.subject).toBeTruthy();
      expect(angle.body).toContain('{{link}}');
    }
  });

  it('generates SMS angles adhering to GSM-7 constraints without subject lines', async () => {
    const result = await generateMessageAngles({
      topic: 'FinFlow Masterclass',
      channel: 'sms',
      stepLabel: 'Countdown Alert',
    });

    expect(result.angles).toHaveLength(3);
    for (const angle of result.angles) {
      expect(angle.subject).toBeNull();
      expect(angle.body).toContain('{{link}}');
      expect(angle.body.length).toBeLessThanOrEqual(300);
    }
  });

  it('generates WhatsApp angles with conversational tone and emojis', async () => {
    const result = await generateMessageAngles({
      topic: 'Enterprise Workflow Scaling',
      channel: 'whatsapp',
      stepLabel: 'Live Nudge',
    });

    expect(result.angles).toHaveLength(3);
    for (const angle of result.angles) {
      expect(angle.subject).toBeNull();
      expect(angle.body).toContain('{{link}}');
    }
  });
});

describe('Pillar 3: Post-Webinar AI Intelligence & Sales Handoff', () => {
  it('generates structured debrief and SDR talking points from attendee data', async () => {
    const result = await generatePostEventDebrief({
      topic: 'B2B Growth Summit 2026',
      totalApproved: 100,
      attendedCount: 42,
      noShowCount: 58,
      avgWatchMinutes: 48,
      accounts: [
        { account: 'Acme Corp', attended: 3, avgWatchMinutes: 52, action: 'Follow up' },
        { account: 'Beta Labs', attended: 1, avgWatchMinutes: 25, action: 'Follow up' },
        { account: 'Gamma Tech', attended: 0, avgWatchMinutes: 0, action: 'Nurture' },
      ],
    });

    expect(result.executiveSummary).toBeTruthy();
    expect(result.topInterestTopics.length).toBeGreaterThan(0);
    expect(result.sdrTalkingPoints.length).toBeGreaterThanOrEqual(3);
    expect(result.highIntentAccounts).toContain('Acme Corp');
    expect(result.recommendedEmailAngle).toBeTruthy();
  });
});
