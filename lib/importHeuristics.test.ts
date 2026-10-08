import { describe, it, expect } from 'vitest';
import { pickCol, functionFor, seniorityFor } from './importHeuristics';

// pickCol decides which CSV column feeds every downstream system — merge
// fields, the CRM sync, Apollo's match confidence. Its failure mode is silent
// (wrong column, plausible-looking data), so the greedy-substring cases that
// actually bit are pinned here.
describe('pickCol column detection', () => {
  it('does not let a "First Name" column masquerade as the full-name column', () => {
    const headers = ['first name', 'last name', 'email', 'company'];
    const first = pickCol(headers, ['first name', 'firstname', 'first']);
    const last = pickCol(headers, ['last name', 'lastname', 'surname', 'last']);

    expect(first).toBe(0);
    expect(last).toBe(1);
    // The regression: 'name' substring-matched "first name" and claimed it,
    // so every contact imported as "Priya" with the surname dropped.
    expect(pickCol(headers, ['full name', 'fullname', 'contact name', 'name'], { exclude: [first, last] })).toBe(-1);
  });

  it('still finds a real full-name column', () => {
    expect(pickCol(['full name', 'email'], ['full name', 'fullname', 'contact name', 'name'])).toBe(0);
    expect(pickCol(['name', 'email'], ['full name', 'fullname', 'contact name', 'name'])).toBe(0);
    expect(pickCol(['contact name', 'email'], ['full name', 'fullname', 'contact name', 'name'])).toBe(0);
  });

  it('prefers an exact header match over an earlier substring match', () => {
    // "customer name" contains 'name', but a column literally called "name"
    // is the better answer.
    expect(pickCol(['customer name', 'name'], ['name'])).toBe(1);
  });

  it('honours the key list order for exact matches', () => {
    expect(pickCol(['name', 'full name'], ['full name', 'name'])).toBe(1);
  });

  it('never reads an email/SMS consent column as WhatsApp consent', () => {
    const headers = ['email', 'email opt-in', 'sms consent'];
    expect(
      pickCol(headers, ['whatsapp opt-in', 'whatsapp optin', 'whatsapp consent', 'wa opt-in', 'wa consent'], {
        reject: /e-?mail|sms|call|phone|number/,
      })
    ).toBe(-1);
  });

  it('still finds a genuine WhatsApp consent column', () => {
    const headers = ['email', 'whatsapp opt-in'];
    expect(
      pickCol(headers, ['whatsapp opt-in', 'whatsapp optin', 'whatsapp consent', 'wa opt-in', 'wa consent'], {
        reject: /e-?mail|sms|call|phone|number/,
      })
    ).toBe(1);
  });

  it('does not mistake a WhatsApp phone-number column for consent', () => {
    const headers = ['name', 'whatsapp number'];
    const phone = pickCol(headers, ['phone', 'mobile', 'contact number', 'whatsapp number', 'whatsapp']);
    expect(phone).toBe(1);
    expect(
      pickCol(headers, ['whatsapp opt-in', 'whatsapp optin', 'whatsapp consent', 'wa opt-in', 'wa consent'], {
        exclude: [phone],
        reject: /e-?mail|sms|call|phone|number/,
      })
    ).toBe(-1);
  });

  it('returns -1 rather than guessing when nothing matches', () => {
    expect(pickCol(['region', 'plan tier'], ['email', 'e-mail'])).toBe(-1);
  });
});

describe('title classification stays stable for the re-import refresh path', () => {
  it('derives function and seniority the same way on a refreshed title', () => {
    expect(functionFor('VP Marketing')).toBe('Marketing');
    expect(seniorityFor('VP Marketing')).toBe('VP');
    expect(functionFor('Head of Admissions')).toBe('Admissions');
    expect(seniorityFor('Head of Admissions')).toBe('Head');
  });
});
