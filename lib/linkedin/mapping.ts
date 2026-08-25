// Pure mapping from a normalized LinkedIn registrant to the app's Contact
// model. Mirrors how the CSV importer fills contacts (same function/seniority
// heuristics) so LinkedIn-sourced leads look identical to Apollo-imported ones
// everywhere they surface — Scoring table, personalization signals, CRM sync.

import { functionFor, seniorityFor } from '../importHeuristics';
import type { NormalizedRegistrant } from './webhook';

export const LINKEDIN_EVENT_SOURCE = 'LinkedIn Event';

/** 'Cher' → Cher/'', 'Mary Jane Watson' → Mary Jane/Watson, '' → ''/''. */
export function splitFullName(fullName: string): { firstName: string; lastName: string } {
  const parts = (fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: '', lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

export interface ContactFieldsForCreate {
  name: string;
  email: string;
  account: string;
  title: string;
  vertical: string;
  function: string;
  seniority: string;
  source: string;
  missingInfo: boolean;
}

/**
 * A registrant without an email never becomes a Contact — the send paths and
 * LeadSquared sync both require one — so callers filter that case out earlier.
 * `missingInfo` flags gaps that hurt personalization (no title/company),
 * following the spirit of the CSV importer's flag rather than its exact rule.
 */
export function buildContactFields(registrant: NormalizedRegistrant, campaignVertical: string): ContactFieldsForCreate {
  const title = registrant.title.trim();
  return {
    name: registrant.name.trim(),
    email: registrant.email.trim().toLowerCase(),
    account: registrant.company.trim(),
    title,
    vertical: campaignVertical,
    function: functionFor(title),
    seniority: seniorityFor(title),
    source: LINKEDIN_EVENT_SOURCE,
    missingInfo: !title || !registrant.company.trim(),
  };
}