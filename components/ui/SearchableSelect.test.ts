import { describe, expect, it } from 'vitest';
import { filterOptions } from './SearchableSelect';

const TYPES = [
  { value: '101', label: 'WebinarAgent Email Sent' },
  { value: '102', label: 'WebinarAgent WhatsApp Delivered' },
  { value: '203', label: 'Had a Phone Conversation' },
];

describe('filterOptions', () => {
  it('returns everything plus the clear row when the query is empty', () => {
    const out = filterOptions(TYPES, '', '— none —');
    expect(out).toHaveLength(4);
    expect(out[0]).toEqual({ value: '', label: '— none —' });
  });

  it('matches on the label, case-insensitively', () => {
    const out = filterOptions(TYPES, 'whatsapp', '— none —');
    expect(out.slice(1).map((o) => o.value)).toEqual(['102']);
  });

  it('matches on the underlying id, so a known activity-type number works', () => {
    const out = filterOptions(TYPES, '203', '— none —');
    expect(out.slice(1).map((o) => o.value)).toEqual(['203']);
  });

  it('keeps the clear row reachable even when nothing matches, so a selection can always be removed', () => {
    const out = filterOptions(TYPES, 'zzzz', '— none —');
    expect(out).toEqual([{ value: '', label: '— none —' }]);
  });

  it('ignores surrounding whitespace rather than matching nothing', () => {
    expect(filterOptions(TYPES, '  email  ', '—')).toHaveLength(2);
  });

  it('matches a substring anywhere in the label, not just the start', () => {
    const out = filterOptions(TYPES, 'agent', '—');
    expect(out.slice(1).map((o) => o.value)).toEqual(['101', '102']);
  });
});
