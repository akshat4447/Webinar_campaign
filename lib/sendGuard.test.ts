import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveRecipient, sendModeLabel, UnverifiedRecipientError } from './sendGuard';

const ORIGINAL_ENV = { ...process.env };

function resetEnv() {
  process.env = { ...ORIGINAL_ENV };
}

describe('resolveRecipient', () => {
  beforeEach(resetEnv);
  afterEach(resetEnv);

  it('refuses an unverified, enrichment-inferred email regardless of send mode', () => {
    process.env.SEND_MODE = 'live';
    expect(() => resolveRecipient({ email: 'guess@company.example', emailSimulated: true, emailVerified: false })).toThrow(
      UnverifiedRecipientError
    );
  });

  it('allows a verified, previously-inferred email in live mode', () => {
    process.env.SEND_MODE = 'live';
    const result = resolveRecipient({ email: 'guess@company.example', emailSimulated: true, emailVerified: true });
    expect(result).toEqual({ email: 'guess@company.example', sandboxed: false });
  });

  it('redirects every recipient to the allowlist in sandbox mode (the default)', () => {
    delete process.env.SEND_MODE;
    process.env.SEND_ALLOWLIST_LEAD_EMAIL = 'sandbox@example.com';
    const result = resolveRecipient({ email: 'real.prospect@bigco.com' });
    expect(result).toEqual({ email: 'sandbox@example.com', sandboxed: true });
  });

  it('throws if sandbox mode has no allowlist configured', () => {
    process.env.SEND_MODE = 'sandbox';
    delete process.env.SEND_ALLOWLIST_LEAD_EMAIL;
    expect(() => resolveRecipient({ email: 'real.prospect@bigco.com' })).toThrow(/SEND_ALLOWLIST_LEAD_EMAIL/);
  });

  it('sends to the real address in live mode for a normal, sourced contact', () => {
    process.env.SEND_MODE = 'live';
    const result = resolveRecipient({ email: 'real.prospect@bigco.com' });
    expect(result).toEqual({ email: 'real.prospect@bigco.com', sandboxed: false });
  });

  it('refuses to send live with no email on file', () => {
    process.env.SEND_MODE = 'live';
    expect(() => resolveRecipient({ email: null })).toThrow(/no email on file/);
  });
});

describe('sendModeLabel', () => {
  beforeEach(resetEnv);
  afterEach(resetEnv);

  it('defaults to sandbox when SEND_MODE is unset', () => {
    delete process.env.SEND_MODE;
    expect(sendModeLabel()).toBe('sandbox');
  });

  it('only reports live for an exact "live" value', () => {
    process.env.SEND_MODE = 'live';
    expect(sendModeLabel()).toBe('live');
    process.env.SEND_MODE = 'LIVE';
    expect(sendModeLabel()).toBe('sandbox');
  });
});
