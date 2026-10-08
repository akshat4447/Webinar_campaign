import { describe, it, expect } from 'vitest';
import { formatSpeakersSummary, formatSpeakersPromptBlock } from '@/lib/speakers';
import { resolveStepDate, offsetLabel } from '@/lib/stepSchedule';
import { isPreRegistrationOutreach, isPreWebinarReminder } from '@/lib/stepTrigger';
import { DEFAULT_FIELD_SELECTION } from '@/lib/enrichment';
import { mintRegistrationToken, verifyRegistrationToken } from '@/lib/registration';

describe('Pillar 1: Multi-Speaker Support & Attendee Hub Formatting', () => {
  it('formats conversational summary and prompt roster for multiple speakers', () => {
    const speakers = [
      { id: '1', campaignId: 'c1', name: 'Dr. Sarah Chen', title: 'VP of AI', company: 'NeuralScale', bio: null, avatarUrl: null, linkedinUrl: null, isPrimary: true, order: 0 },
      { id: '2', campaignId: 'c1', name: 'Marcus Vance', title: 'Chief Architect', company: 'CloudFlow', bio: null, avatarUrl: null, linkedinUrl: null, isPrimary: false, order: 1 },
    ];
    const summary = formatSpeakersSummary(speakers);
    expect(summary).toBe('Dr. Sarah Chen & Marcus Vance');

    const promptBlock = formatSpeakersPromptBlock(speakers);
    expect(promptBlock).toContain('Dr. Sarah Chen (VP of AI at NeuralScale) [Keynote / Primary]');
    expect(promptBlock).toContain('Marcus Vance (Chief Architect at CloudFlow)');
  });
});

describe('Pillar 2: One-Click Registration & Token Verification', () => {
  it('mints a tamper-proof signed token and verifies it accurately', () => {
    const campaignId = 'camp-test-123';
    const contactId = 'cont-test-456';
    const token = mintRegistrationToken(campaignId, contactId);

    const verified = verifyRegistrationToken(token);
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.payload.campaignId).toBe(campaignId);
      expect(verified.payload.contactId).toBe(contactId);
    }
  });

  it('rejects tampered registration tokens', () => {
    const token = mintRegistrationToken('camp-1', 'cont-1');
    const tampered = token.slice(0, -4) + 'abcd';
    const verified = verifyRegistrationToken(tampered);
    expect(verified.ok).toBe(false);
  });
});

describe('Pillar 3: Cadence Dual-Guard & Minute Offset Scheduling', () => {
  it('supports minute-level precision offsets for countdown reminders', () => {
    const webinarAt = new Date('2026-10-15T15:00:00.000Z');
    const doorsOpenStep = {
      offsetValue: -15,
      offsetUnit: 'minutes',
      anchor: 'webinar',
    };
    const resolved = resolveStepDate(doorsOpenStep, { launchAt: new Date(), webinarAt });
    expect(resolved).not.toBeNull();
    expect(resolved?.toISOString()).toBe('2026-10-15T14:45:00.000Z');
    expect(offsetLabel(doorsOpenStep)).toBe('T-15 mins');
  });

  it('classifies pre-registration outreach vs countdown reminder keys', () => {
    expect(isPreRegistrationOutreach('invite')).toBe(true);
    expect(isPreRegistrationOutreach('nudge')).toBe(true);
    expect(isPreRegistrationOutreach('final')).toBe(true);
    expect(isPreRegistrationOutreach('t1h')).toBe(false);

    expect(isPreWebinarReminder('t1h')).toBe(true);
    expect(isPreWebinarReminder('doors_open')).toBe(true);
    expect(isPreWebinarReminder('invite')).toBe(false);
  });
});

describe('Pillar 5: Moderated Enrichment Configuration', () => {
  it('provides complete default field selections', () => {
    expect(DEFAULT_FIELD_SELECTION.apolloEmail).toBe(true);
    expect(DEFAULT_FIELD_SELECTION.apolloPhone).toBe(true);
    expect(DEFAULT_FIELD_SELECTION.apolloTitle).toBe(true);
    expect(DEFAULT_FIELD_SELECTION.claudePersona).toBe(true);
  });
});

describe('Channel Eligibility Guard', () => {
  it('correctly evaluates channel requirements per contact', async () => {
    const { isContactEligibleForChannel } = await import('@/lib/channels');

    // SMS requires phone
    expect(isContactEligibleForChannel({ email: 'a@b.com', phone: '+1234567890' }, 'SMS')).toBe(true);
    expect(isContactEligibleForChannel({ email: 'a@b.com', phone: null }, 'SMS')).toBe(false);

    // WhatsApp requires phone and explicit opt-in
    expect(isContactEligibleForChannel({ email: 'a@b.com', phone: '+1234567890', whatsappOptIn: true }, 'WhatsApp')).toBe(true);
    expect(isContactEligibleForChannel({ email: 'a@b.com', phone: '+1234567890', whatsappOptIn: false }, 'WhatsApp')).toBe(false);

    // Email requires email and not unverified simulated
    expect(isContactEligibleForChannel({ email: 'a@b.com', phone: null }, 'Email')).toBe(true);
    expect(isContactEligibleForChannel({ email: 'a@b.com', phone: null, emailSimulated: true, emailVerified: false }, 'Email')).toBe(false);
    expect(isContactEligibleForChannel({ email: 'a@b.com', phone: null, emailSimulated: true, emailVerified: true }, 'Email')).toBe(true);
    expect(isContactEligibleForChannel({ email: null, phone: '+1234567890' }, 'Email')).toBe(false);
  });
});
