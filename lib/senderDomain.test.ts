import { describe, expect, it } from 'vitest';
import { emailDomainOf, organizationDomain, sharesOrganization } from './senderDomain';

describe('organizationDomain', () => {
  it('reduces a subdomain to the company domain', () => {
    expect(organizationDomain('digital.leadsquared.com')).toBe('leadsquared.com');
    expect(organizationDomain('LeadSquared.com')).toBe('leadsquared.com');
    expect(organizationDomain('mail.eu.example.co.uk')).toBe('example.co.uk');
  });
  it('gives nothing for a value that is not a domain', () => {
    expect(organizationDomain('')).toBe('');
    expect(organizationDomain(null)).toBe('');
    expect(organizationDomain('localhost')).toBe('');
  });
});

describe('sharesOrganization', () => {
  it('sees the sender subdomain and the parent company as the same organization', () => {
    expect(sharesOrganization('events@digital.leadsquared.com', 'person.one@leadsquared.com')).toBe(true);
    expect(sharesOrganization('events@digital.leadsquared.com', 'x@Mail.LeadSquared.com')).toBe(true);
  });
  it('does not match other companies, look-alikes or missing values', () => {
    expect(sharesOrganization('events@digital.leadsquared.com', 'x@gmail.com')).toBe(false);
    expect(sharesOrganization('events@digital.leadsquared.com', 'x@notleadsquared.com')).toBe(false);
    expect(sharesOrganization('events@example.co.uk', 'x@other.co.uk')).toBe(false);
    expect(sharesOrganization('', 'x@leadsquared.com')).toBe(false);
    expect(sharesOrganization('events@digital.leadsquared.com', undefined)).toBe(false);
  });
  it('reads the domain after the last @', () => {
    expect(emailDomainOf('a@b.com')).toBe('b.com');
    expect(emailDomainOf('nope')).toBe('');
  });
});
