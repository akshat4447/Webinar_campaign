import { describe, it, expect } from 'vitest';
import {
  normalizeLinkedInSlug,
  profileUrl,
  composeUrl,
  peopleSearchUrl,
  resolveLinkedInDestination,
} from './linkedinUrl';

describe('normalizeLinkedInSlug', () => {
  it('handles null, undefined and empty strings', () => {
    expect(normalizeLinkedInSlug(null)).toBeNull();
    expect(normalizeLinkedInSlug(undefined)).toBeNull();
    expect(normalizeLinkedInSlug('')).toBeNull();
    expect(normalizeLinkedInSlug('   ')).toBeNull();
  });

  it('normalizes bare slugs', () => {
    expect(normalizeLinkedInSlug('satyanadella')).toBe('satyanadella');
    expect(normalizeLinkedInSlug('john-doe')).toBe('john-doe');
    expect(normalizeLinkedInSlug('john.doe')).toBe('john.doe');
    expect(normalizeLinkedInSlug('jane_doe_99')).toBe('jane_doe_99');
    expect(normalizeLinkedInSlug('@satyanadella')).toBe('satyanadella');
  });

  it('normalizes full LinkedIn profile URLs', () => {
    expect(normalizeLinkedInSlug('https://www.linkedin.com/in/satyanadella')).toBe('satyanadella');
    expect(normalizeLinkedInSlug('http://linkedin.com/in/satyanadella/')).toBe('satyanadella');
    expect(normalizeLinkedInSlug('https://in.linkedin.com/in/satyanadella')).toBe('satyanadella');
    expect(normalizeLinkedInSlug('https://uk.linkedin.com/in/john.smith-123')).toBe('john.smith-123');
    expect(normalizeLinkedInSlug('linkedin.com/in/akshat-kumar/')).toBe('akshat-kumar');
  });

  it('strips query parameters and hashes', () => {
    expect(normalizeLinkedInSlug('https://www.linkedin.com/in/satyanadella?miniProfileUrn=urn%3Ali%3Afs_miniProfile%3A123')).toBe('satyanadella');
    expect(normalizeLinkedInSlug('https://www.linkedin.com/in/john-doe#details')).toBe('john-doe');
  });

  it('rejects non-profile URLs and invalid strings', () => {
    expect(normalizeLinkedInSlug('https://www.linkedin.com/company/google')).toBeNull();
    expect(normalizeLinkedInSlug('https://www.linkedin.com/feed/')).toBeNull();
    expect(normalizeLinkedInSlug('https://www.linkedin.com/search/results/people/')).toBeNull();
    expect(normalizeLinkedInSlug('not a url with spaces')).toBeNull();
  });
});

describe('resolveLinkedInDestination', () => {
  it('returns direct profile destination when slug is valid', () => {
    const dest = resolveLinkedInDestination({
      name: 'Satya Nadella',
      account: 'Microsoft',
      linkedinId: 'https://www.linkedin.com/in/satyanadella',
    });
    expect(dest.kind).toBe('profile');
    expect(dest.slug).toBe('satyanadella');
    expect(dest.url).toBe('https://www.linkedin.com/in/satyanadella');
  });

  it('returns people search destination when linkedinId is missing', () => {
    const dest = resolveLinkedInDestination({
      name: 'Priya Nair',
      account: 'Infosys',
      linkedinId: null,
    });
    expect(dest.kind).toBe('search');
    expect(dest.slug).toBeUndefined();
    expect(dest.url).toContain('https://www.linkedin.com/search/results/people/?keywords=');
    expect(dest.url).toContain('Priya%20Nair');
    expect(dest.url).toContain('Infosys');
  });

  it('returns people search destination when linkedinId is invalid', () => {
    const dest = resolveLinkedInDestination({
      name: 'John Doe',
      account: 'Acme Corp',
      linkedinId: 'invalid link with spaces',
    });
    expect(dest.kind).toBe('search');
    expect(dest.url).toContain('John%20Doe');
  });
});

describe('URL Builders', () => {
  it('builds profile URL', () => {
    expect(profileUrl('satya')).toBe('https://www.linkedin.com/in/satya');
  });

  it('builds compose URL', () => {
    expect(composeUrl('satya')).toBe('https://www.linkedin.com/messaging/compose/?recipient=satya');
  });

  it('builds people search URL with encoded query', () => {
    expect(peopleSearchUrl('Elon Musk', 'Tesla Motors')).toBe(
      'https://www.linkedin.com/search/results/people/?keywords=Elon%20Musk%20Tesla%20Motors'
    );
  });
});
