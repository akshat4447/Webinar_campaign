import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@/lib/leadsquared', () => ({ getLeadsInList: vi.fn() }));

import { isHeldBySuppressionList } from './lsqExclusions';

const members = { emails: new Set(['casey@example.com']), leadIds: new Set(['lead-1']) };
const none = { emails: new Set<string>(), leadIds: new Set<string>() };

describe('isHeldBySuppressionList', () => {
  it('holds back an unregistered person matched by email, ignoring case and spaces', () => {
    expect(isHeldBySuppressionList(members, { email: '  Casey@Example.COM ' })).toBe(true);
  });
  it('holds back an unregistered person matched by lead id, even with a different address on file', () => {
    expect(isHeldBySuppressionList(members, { email: 'other@example.com', lsqLeadId: 'lead-1' })).toBe(true);
  });
  it('never holds back a registrant, who is on the list because Studio put them there', () => {
    expect(isHeldBySuppressionList(members, { email: 'casey@example.com', lsqLeadId: 'lead-1', registeredAt: new Date() })).toBe(false);
  });
  it('does not hold back a person who is not on the list, or has nothing to match on', () => {
    expect(isHeldBySuppressionList(members, { email: 'free@example.com', lsqLeadId: 'lead-2' })).toBe(false);
    expect(isHeldBySuppressionList(members, { email: null, lsqLeadId: null })).toBe(false);
    expect(isHeldBySuppressionList(members, {})).toBe(false);
  });
  it('holds back nobody when no list is attached', () => {
    expect(isHeldBySuppressionList(none, { email: 'casey@example.com', lsqLeadId: 'lead-1' })).toBe(false);
  });
  it('matches the whole address, not a part of it', () => {
    expect(isHeldBySuppressionList(members, { email: 'xcasey@example.com' })).toBe(false);
    expect(isHeldBySuppressionList(members, { email: 'casey@example.com.au' })).toBe(false);
  });
});
