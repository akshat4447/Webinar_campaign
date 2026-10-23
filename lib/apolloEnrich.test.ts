import { describe, it, expect } from 'vitest';
import { cleanApolloEmail, namesAgree, splitName } from './apolloVerify';

describe('cleanApolloEmail', () => {
  it('accepts a normal address, normalised', () => {
    expect(cleanApolloEmail('  Jane.Doe@Acme.COM ')).toBe('jane.doe@acme.com');
  });
  it.each([
    ['the locked placeholder', 'email_not_unlocked@acme.com'],
    ['a not-unlocked variant', 'not_unlocked@acme.com'],
    ['unavailable', 'unavailable@acme.com'],
    ['no at sign', 'jane.doe'],
    ['no dot in the domain', 'jane@localhost'],
    ['empty', ''],
    ['null', null],
    ['a number', 42],
  ])('rejects %s', (_label, value) => {
    expect(cleanApolloEmail(value)).toBeUndefined();
  });
});

describe('namesAgree (guards against a result for a different person)', () => {
  const asked = { name: 'Maria Garcia Lopez', title: '', account: '' };
  it('accepts the same person, however Apollo splits the name', () => {
    expect(namesAgree(asked, { first_name: 'Maria', last_name: 'Garcia Lopez' })).toBe(true);
    expect(namesAgree(asked, { first_name: 'maria', last_name: 'garcia' })).toBe(true);
    expect(namesAgree(asked, { name: 'Maria Garcia-Lopez' })).toBe(true);
  });
  it('rejects a different first name, a different surname, and a mere prefix of a surname', () => {
    expect(namesAgree(asked, { first_name: 'Marco', last_name: 'Garcia' })).toBe(false);
    expect(namesAgree(asked, { first_name: 'Maria', last_name: 'Fernandez' })).toBe(false);
    expect(namesAgree({ name: 'Ann Kim', title: '', account: '' }, { first_name: 'Ann', last_name: 'Kimball' })).toBe(false);
  });
  it('rejects a result with no name at all', () => {
    expect(namesAgree(asked, {})).toBe(false);
  });
  it('accepts a first-name-only request when the first names match', () => {
    expect(namesAgree({ name: 'Cher', title: '', account: '' }, { first_name: 'Cher' })).toBe(true);
    expect(splitName('Cher')).toEqual({ first_name: 'Cher' });
  });
});
