import { validateLandingUrl } from '@/lib/landingUrl';

// Pure, no server-only imports — so it's usable from the client wizard and
// testable directly (unlike lib/actions/wizard.ts, which is 'use server' and
// pulls in Prisma via its other exports).

/** The step-1 "Webinar details" fields this validates. A subset of
 *  WizardDetails (lib/actions/wizard.ts) — only the two currently required. */
export interface WizardDetailsInput {
  title: string;
  date: string;
  /** The optional custom landing page. Blank means 1-click registration; anything else must be a real web address. */
  registrationLink?: string;
}

/** The message to show under the landing page field, or null when it is blank or a usable address. */
export function landingLinkError(value: string | null | undefined): string | null {
  const v = (value ?? '').trim();
  if (!v) return null;
  const r = validateLandingUrl(v);
  return r.ok ? null : (r.error ?? 'Enter a valid landing page address.');
}

/** Per-field error messages for the details step, empty when everything required is present. */
export function validateWizardDetails(details: WizardDetailsInput): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!details.title.trim()) errors.title = 'Give this webinar a title.';
  if (!details.date) errors.date = 'Pick a date.';
  const link = landingLinkError(details.registrationLink);
  if (link) errors.registrationLink = link;
  return errors;
}
