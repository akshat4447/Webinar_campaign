import { describe, it, expect } from 'vitest';
import { evaluateApolloMatch, companiesMatch, splitName } from './apolloVerify';

describe('splitName', () => {
  it('splits a normal two-part name', () => {
    expect(splitName('Satya Nadella')).toEqual({ first_name: 'Satya', last_name: 'Nadella' });
  });

  it('joins a multi-word surname into last_name', () => {
    expect(splitName('Priya Nair Singh')).toEqual({ first_name: 'Priya', last_name: 'Nair Singh' });
  });

  it('omits last_name for a single-word name rather than sending an empty string', () => {
    expect(splitName('Madonna')).toEqual({ first_name: 'Madonna' });
  });

  it('handles empty input without throwing', () => {
    expect(splitName('   ')).toEqual({ first_name: '' });
  });
});

const base = { name: 'Priya Nair', title: 'VP Marketing', account: 'Acme Financial' };

describe('companiesMatch', () => {
  it('ignores legal suffixes and case', () => {
    expect(companiesMatch('Acme Financial Inc', 'acme financial')).toBe(true);
    expect(companiesMatch('Northwind Health Ltd.', 'Northwind Health')).toBe(true);
  });

  it('rejects genuinely different companies and empty inputs', () => {
    expect(companiesMatch('Acme Financial', 'Northwind Health')).toBe(false);
    expect(companiesMatch('', 'Acme')).toBe(false);
  });
});

describe('evaluateApolloMatch', () => {
  it('verifies when company and role line up (suffix/case tolerant)', () => {
    const r = evaluateApolloMatch(base, { found: true, title: 'Vice President of Marketing', company: 'Acme Financial, Inc.' });
    expect(r.status).toBe('verified');
    expect(r.note).toContain('Vice President of Marketing'); // note quotes Apollo's own title
  });

  it('flags a job change when the employer differs', () => {
    const r = evaluateApolloMatch(base, { found: true, title: 'VP Marketing', company: 'Northwind Health' });
    expect(r.status).toBe('mismatch');
    expect(r.note).toContain('Northwind Health');
    expect(r.note).toContain('job change');
  });

  it('flags role drift only when BOTH function and seniority moved', () => {
    // Same function band (Marketing) → not a drift worth blocking.
    expect(evaluateApolloMatch(base, { found: true, title: 'Marketing Manager', company: 'Acme Financial' }).status).toBe('verified');
    // Function AND seniority both changed → block.
    const r = evaluateApolloMatch(base, { found: true, title: 'IT Manager', company: 'Acme Financial' });
    expect(r.status).toBe('mismatch');
    expect(r.note).toContain('Role drifted');
  });

  it('reports not_found when Apollo has no profile', () => {
    const r = evaluateApolloMatch(base, { found: false });
    expect(r.status).toBe('not_found');
    expect(r.note).toContain('changed jobs');
  });

  it('is lenient when our own baseline is sparse — nothing to contradict', () => {
    expect(evaluateApolloMatch({ name: 'X', title: '', account: '' }, { found: true }).status).toBe('verified');
  });

  it('treats an unclassifiable new title as still-fine rather than guessing wrong', () => {
    // functionFor falls back to 'Other' for unknown titles; the evaluator must
    // NOT treat that as a real functional move.
    expect(evaluateApolloMatch(base, { found: true, title: 'Chief Happiness Officer', company: 'Acme Financial' }).status).toBe('verified');
  });
});