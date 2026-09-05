import { describe, it, expect } from 'vitest';
import { validateWizardDetails } from './wizardValidation';

describe('validateWizardDetails', () => {
  it('is clean when both required fields are present', () => {
    expect(validateWizardDetails({ title: 'AI Underwriting in 2026', date: '2026-09-10' })).toEqual({});
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
