import { describe, it, expect } from 'vitest';
import { resolveRecipient, UnverifiedRecipientError } from './sendGuard';
describe('Actual recipients', () => {
  it('uses the contact email and normalizes it', () => expect(resolveRecipient({email:' Person@Example.com '})).toEqual({email:'person@example.com'}));
  it('blocks an inferred unverified address', () => expect(() => resolveRecipient({email:'guess@example.com',emailSimulated:true,emailVerified:false})).toThrow(UnverifiedRecipientError));
  it('allows a verified inferred address', () => expect(resolveRecipient({email:'person@example.com',emailSimulated:true,emailVerified:true}).email).toBe('person@example.com'));
  it('refuses a missing address', () => expect(() => resolveRecipient({email:null})).toThrow());
});
