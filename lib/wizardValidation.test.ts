import { describe, it, expect } from 'vitest';
import { landingLinkError, validateWizardDetails } from './wizardValidation';

describe('validateWizardDetails', () => {
  it('is clean when both required fields are present', () => {
    expect(validateWizardDetails({ title: 'AI Underwriting in 2026', date: '2026-09-10' })).toEqual({});
  });

  it('treats the landing page as optional but refuses an address that is not a web address', () => {
    const base = { title: 'AI Underwriting in 2026', date: '2026-09-10' };
    expect(validateWizardDetails({ ...base, registrationLink: '' })).toEqual({});
    expect(validateWizardDetails({ ...base, registrationLink: 'https://pages.example.com/w' })).toEqual({});
    expect(validateWizardDetails({ ...base, registrationLink: 'javascript:alert(1)' })).toHaveProperty('registrationLink');
    expect(validateWizardDetails({ ...base, registrationLink: 'not a url' })).toHaveProperty('registrationLink');
    expect(landingLinkError('   ')).toBeNull();
  });

  it('requires a non-blank title', () => {
    expect(validateWizardDetails({ title: '', date: '2026-09-10' })).toHaveProperty('title');
    expect(validateWizardDetails({ title: '   ', date: '2026-09-10' })).toHaveProperty('title');
  });

  it('requires a date', () => {
    expect(validateWizardDetails({ title: 'Webinar', date: '' })).toHaveProperty('date');
  });

  it('reports both fields when both are missing', () => {
    const errors = validateWizardDetails({ title: '', date: '' });
    expect(Object.keys(errors).sort()).toEqual(['date', 'title']);
  });
});
