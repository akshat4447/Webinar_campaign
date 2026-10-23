import { describe, it, expect } from 'vitest';
import { summarizeRowFailures } from './leadSyncErrors';

const unknown = 'MXUnknownAttributeException Attribute(s) does not exist - mx_Seniority,mx_Function.';

describe('summarizeRowFailures', () => {
  it('names a shared reason once, with how many contacts it touched and what to do', () => {
    const lines = summarizeRowFailures(['ZZ QA One', 'ZZ QA Two', 'ZZ QA Three'].map((name) => ({ name, message: unknown })));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('3 contacts (ZZ QA One, ZZ QA Two, ZZ QA Three)');
    expect(lines[0]).toContain('LeadSquared has no field named mx_Seniority,mx_Function');
    expect(lines[0]).toContain('Studio skips unknown fields on the next sync');
    expect(lines[0].match(/MXUnknownAttributeException/g)).toHaveLength(1);
  });

  it('counts the rest when a reason touches many contacts', () => {
    const lines = summarizeRowFailures(Array.from({ length: 12 }, (_, i) => ({ name: `Person ${i + 1}`, message: 'Duplicate lead' })));
    expect(lines).toEqual(['12 contacts (Person 1, Person 2, Person 3, and 9 more): Duplicate lead.']);
  });

  it('keeps different reasons apart, and says how many were left out', () => {
    const lines = summarizeRowFailures([
      { name: 'A', message: 'Reason one' }, { name: 'B', message: 'Reason two' }, { name: 'C', message: 'Reason three' }, { name: 'D', message: 'Reason four' }, { name: 'E', message: 'Reason four' },
    ]);
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe('1 contact (A): Reason one.');
    expect(lines[3]).toBe('1 other reason not shown');
  });

  it('treats wording that differs only in spacing as one reason', () => {
    expect(summarizeRowFailures([{ name: 'A', message: 'Bad   value' }, { name: 'B', message: 'Bad value' }])).toEqual(['2 contacts (A, B): Bad value.']);
  });

  it('says nothing when nothing failed', () => {
    expect(summarizeRowFailures([])).toEqual([]);
  });
});
