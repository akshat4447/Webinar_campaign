import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveRecipient, UnverifiedRecipientError } from './sendGuard';

const ORIGINAL_ENV = { ...process.env };

function resetEnv() {
  process.env = { ...ORIGINAL_ENV };
}

describe('resolveRecipient', () => {
  beforeEach(resetEnv);
  afterEach(resetEnv);

  it('refuses an unverified, enrichment-inferred email regardless of send mode', () => {
    expect(() => resolveRecipient({ email: 'guess@company.example', emailSimulated: true, emailVerified: false }, 'live')).toThrow(
      UnverifiedRecipientError
    );
  });

  it('allows a verified, previously-inferred email in live mode', () => {
    const result = resolveRecipient({ email: 'guess@company.example', emailSimulated: true, emailVerified: true }, 'live');
    expect(result).toEqual({ email: 'guess@company.example', sandboxed: false });
  });

  it('redirects every recipient to the allowlist in sandbox mode', () => {
    process.env.SEND_ALLOWLIST_LEAD_EMAIL = 'sandbox@example.com';
    const result = resolveRecipient({ email: 'real.prospect@bigco.com' }, 'sandbox');
    expect(result).toEqual({ email: 'sandbox@example.com', sandboxed: true });
  });

  it('throws if sandbox mode has no allowlist configured', () => {
    delete process.env.SEND_ALLOWLIST_LEAD_EMAIL;
    expect(() => resolveRecipient({ email: 'real.prospect@bigco.com' }, 'sandbox')).toThrow(/SEND_ALLOWLIST_LEAD_EMAIL/);
  });

  it('sends to the real address in live mode for a normal, sourced contact', () => {
    const result = resolveRecipient({ email: 'real.prospect@bigco.com' }, 'live');
    expect(result).toEqual({ email: 'real.prospect@bigco.com', sandboxed: false });
  });

  it('refuses to send live with no email on file', () => {
    expect(() => resolveRecipient({ email: null }, 'live')).toThrow(/no email on file/);
  });
});
