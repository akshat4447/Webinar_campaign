import { describe, it, expect } from 'vitest';
import { retryPlanFor, retryLabel } from './attentionRetry';

describe('retryPlanFor', () => {
  it('re-runs the CRM sync for a failed LeadSquared lead sync, not the message sends', () => {
    expect(retryPlanFor('LeadSquared lead sync failed')).toEqual({ kind: 'crm-sync' });
  });

  it('re-runs the sends for a failed send or a draft that failed validation', () => {
    expect(retryPlanFor('Send failed for Priya Nair')).toEqual({ kind: 'sends' });
    expect(retryPlanFor('SMS send failed for Priya Nair')).toEqual({ kind: 'sends' });
    expect(retryPlanFor('Email draft for Priya Nair failed validation')).toEqual({ kind: 'sends' });
  });

  it('points everything else at the tab where it can really be retried', () => {
    const where = (t: string) => { const p = retryPlanFor(t); return p.kind === 'elsewhere' ? [p.where, p.href('c1')] : p.kind; };
    expect(where('Audience scoring failed')).toEqual(['Audience', '/campaigns/c1/audience']);
    expect(where('Apollo enrichment could not run')).toEqual(['Audience', '/campaigns/c1/audience']);
    expect(where('Enrichment failed')).toEqual(['Audience', '/campaigns/c1/audience']);
    expect(where('Personalization failed for "Initial invite"')).toEqual(['Messaging', '/campaigns/c1/messaging']);
    expect(where('LinkedIn publish failed')).toEqual(['LinkedIn Outreach', '/linkedin?event=c1']);
    expect(where('LeadSquared sync failed after LinkedIn registration batch')).toEqual(['LinkedIn Outreach', '/linkedin?event=c1']);
    expect(where('LeadSquared activity push failed')).toEqual(['Registration', '/campaigns/c1/registration']);
  });

  it('labels the button with where the retry happens', () => {
    expect(retryLabel(retryPlanFor('LeadSquared lead sync failed'))).toBe('Retry');
    expect(retryLabel(retryPlanFor('Audience scoring failed'))).toBe('Retry In Audience');
  });
});
