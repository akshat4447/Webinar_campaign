// Shared tone/length vocabulary for every UI that sets campaign.tone /
// campaign.msgLength (the wizard's first-touch picker and the Personalize
// tab's regenerate-config modal) — a single source so the two pickers can
// never drift into option sets that don't overlap.
export const TONE_OPTIONS = ['Warm & concise', 'Direct & professional', 'Consultative', 'Friendly & casual', 'Formal & executive'] as const;
export const LENGTH_OPTIONS = ['Short (~60 words)', 'Medium (~100 words)', 'Long (~150 words)'] as const;

export interface PersonalizationFieldDef {
  id: string;
  label: string;
  blurb: string;
}

export const PERSONALIZATION_FIELD_OPTIONS: readonly PersonalizationFieldDef[] = [
  { id: 'firstName', label: 'First Name', blurb: 'Recipient given name' },
  { id: 'title', label: 'Job Title', blurb: 'Current professional role' },
  { id: 'seniority', label: 'Seniority', blurb: 'Executive / Director / Manager / IC' },
  { id: 'function', label: 'Department / Function', blurb: 'Engineering, Marketing, Sales, etc.' },
  { id: 'account', label: 'Company / Account', blurb: 'Organization name' },
  { id: 'vertical', label: 'Industry / Vertical', blurb: 'SaaS, Healthcare, Finance, etc.' },
  { id: 'score', label: 'Relevance Fit Score', blurb: '0–100 audience qualification score' },
  { id: 'personaNote', label: 'Persona Notes', blurb: 'Enriched pain points & observations' },
] as const;

export const DEFAULT_PERSONALIZATION_FIELDS: readonly string[] = [
  'firstName',
  'title',
  'seniority',
  'function',
  'account',
  'vertical',
  'score',
];
