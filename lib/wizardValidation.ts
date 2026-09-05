// Pure, no server-only imports — so it's usable from the client wizard and
// testable directly (unlike lib/actions/wizard.ts, which is 'use server' and
// pulls in Prisma via its other exports).

/** The step-1 "Webinar details" fields this validates. A subset of
 *  WizardDetails (lib/actions/wizard.ts) — only the two currently required. */
export interface WizardDetailsInput {
  title: string;
  date: string;
}

/** Per-field error messages for the details step, empty when everything required is present. */
export function validateWizardDetails(details: WizardDetailsInput): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!details.title.trim()) errors.title = 'Give this webinar a title.';
  if (!details.date) errors.date = 'Pick a date.';
  return errors;
}
