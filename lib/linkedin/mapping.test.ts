import { describe, it, expect } from 'vitest';
import { splitFullName, buildContactFields, LINKEDIN_EVENT_SOURCE } from './mapping';

describe('splitFullName', () => {
  it('splits first token vs the rest', () => {
    expect(splitFullName('Mary Jane Watson')).toEqual({ firstName: 'Mary Jane Watson'.split(' ')[0], lastName: 'Jane Watson' });
    expect(splitFullName('Priya Nair')).toEqual({ firstName: 'Priya', lastName: 'Nair' });
  });

  it('handles single names, extra whitespace and empties without throwing', () => {
    expect(splitFullName('Cher')).toEqual({ firstName: 'Cher', lastName: '' });
    expect(splitFullName('  Madonna   Louise  Ciccone ')).toEqual({ firstName: 'Madonna', lastName: 'Louise Ciccone' });
    expect(splitFullName('')).toEqual({ firstName: '', lastName: '' });
    expect(splitFullName('   ')).toEqual({ firstName: '', lastName: '' });
  });
});

describe('buildContactFields', () => {
  it('maps a complete registrant using the shared CSV heuristics', () => {
    const fields = buildContactFields(
      { name: 'Karan Mehta', email: 'Karan@BrightEdLabs.COM', title: 'IT Manager', company: 'Bright Ed Labs' },
      'Education'
    );
    expect(fields).toMatchObject({
      name: 'Karan Mehta',
      email: 'karan@brightedlabs.com', // lowercased so dedupe is reliable
      account: 'Bright Ed Labs',
      vertical: 'Education', // inherits the campaign's vertical
      function: 'IT',
      seniority: 'Manager',
      source: LINKEDIN_EVENT_SOURCE,
      missingInfo: false,
    });
  });

  it('marks missing personalization inputs instead of guessing them', () => {
    const sparse = buildContactFields({ name: 'Anonymous Lead', email: 'a@b.co', title: '', company: '' }, 'Lending');
    expect(sparse.missingInfo).toBe(true);
    expect(sparse.function).toBe('Other'); // functionFor('')
    expect(sparse.seniority).toBe('IC'); // seniorityFor('')
  });
});
describe('buildContactFields — simulated marking', () => {
  const registrant = { name: 'Priya Nair', email: 'Priya.Nair@Example.com', company: 'Acme', title: 'VP Marketing' };

  it('marks a sandbox fixture as simulated so sendGuard holds it back', () => {
    expect(buildContactFields(registrant, 'Lending', true).emailSimulated).toBe(true);
  });

  it('does not mark a real Lead Sync registrant as simulated', () => {
    expect(buildContactFields(registrant, 'Lending', false).emailSimulated).toBe(false);
  });

  it('defaults to not-simulated when the flag is omitted', () => {
    expect(buildContactFields(registrant, 'Lending').emailSimulated).toBe(false);
  });
});
