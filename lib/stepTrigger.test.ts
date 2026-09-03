import { describe, expect, it } from 'vitest';
import { cadenceStepsData } from './demo-data';
import { defaultTriggerFor, isLaunchQueued, isStepTrigger } from './stepTrigger';
import { isAutomatableChannel } from './channels';

/**
 * The allowlist this logic replaced. Kept verbatim so the equivalence test
 * below is a real comparison against the old behaviour rather than against a
 * restatement of the new rule.
 */
const LEGACY_AUTOMATED_STEP_KEYS = [
  'invite', 'nudge', 'final', 't3', 't1d', 't1h', 'sms', 'smsInvite', 'waInvite',
];

function asStep(key: string, channel: string, enabled = true) {
  return { trigger: defaultTriggerFor(key), channel, enabled };
}

describe('isAutomatableChannel', () => {
  it('excludes LinkedIn, which has no send API', () => {
    expect(isAutomatableChannel('LinkedIn')).toBe(false);
    expect(isAutomatableChannel('LinkedIn (assisted)')).toBe(false);
  });

  it('treats a mixed label as its primary channel', () => {
    // The T-1d step is labelled "Email + LinkedIn" and has always been
    // delivered as email. Reading it as LinkedIn would silently stop it.
    expect(isAutomatableChannel('Email + LinkedIn')).toBe(true);
  });

  it('accepts every channel the app can actually send', () => {
    for (const ch of ['Email', 'SMS', 'WhatsApp']) {
      expect(isAutomatableChannel(ch)).toBe(true);
    }
  });
});

describe('isLaunchQueued', () => {
  it('reproduces the legacy allowlist exactly for the built-in steps', () => {
    // This is the safety net for replacing the allowlist. If it ever fails,
    // either a built-in step changed trigger/channel, or the rule drifted.
    const queued = cadenceStepsData
      .filter((s) => isLaunchQueued(asStep(s.id, s.channel)))
      .map((s) => s.id)
      .sort();

    expect(queued).toEqual([...LEGACY_AUTOMATED_STEP_KEYS].sort());
  });

  it('queues a step the operator invented in the planner', () => {
    // The bug that motivated the change: an added step is not in any
    // allowlist, so under the old rule it rendered, reported itself enabled,
    // and never sent anything.
    const custom = { trigger: 'launch', channel: 'Email', enabled: true };
    expect(isLaunchQueued(custom)).toBe(true);
  });

  it('does not queue a disabled step', () => {
    expect(isLaunchQueued({ trigger: 'launch', channel: 'Email', enabled: false })).toBe(false);
  });

  it('does not queue registration- or attendance-triggered steps', () => {
    // Their audience is unknown at launch — only the registration webhook and
    // the attendance import know who they are.
    expect(isLaunchQueued({ trigger: 'registration', channel: 'Email', enabled: true })).toBe(false);
    expect(isLaunchQueued({ trigger: 'attendance', channel: 'Email', enabled: true })).toBe(false);
  });

  it('does not queue an assisted-channel step even when launch-triggered', () => {
    expect(isLaunchQueued({ trigger: 'launch', channel: 'LinkedIn (assisted)', enabled: true })).toBe(false);
  });
});

describe('defaultTriggerFor', () => {
  it('marks the registration-driven steps', () => {
    expect(defaultTriggerFor('confirm')).toBe('registration');
    expect(defaultTriggerFor('whatsapp')).toBe('registration');
  });

  it('marks the attendance-driven steps', () => {
    // Both are webinar-anchored, which is exactly why anchor alone could not
    // have replaced the allowlist.
    expect(defaultTriggerFor('attend')).toBe('attendance');
    expect(defaultTriggerFor('noshow')).toBe('attendance');
  });

  it('defaults anything else, including an unknown key, to launch', () => {
    expect(defaultTriggerFor('invite')).toBe('launch');
    expect(defaultTriggerFor('some-step-added-next-year')).toBe('launch');
  });
});

describe('isStepTrigger', () => {
  it('accepts the three known triggers and rejects anything else', () => {
    expect(isStepTrigger('launch')).toBe(true);
    expect(isStepTrigger('registration')).toBe(true);
    expect(isStepTrigger('attendance')).toBe(true);
    expect(isStepTrigger('whenever')).toBe(false);
  });
});
