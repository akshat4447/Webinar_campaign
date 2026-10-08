export interface WizardFieldMapping {
  id: string;
  token: string;
  lsqField: string;
  label: string;
  isSystem?: boolean;
  enabled: boolean;
}

export const DEFAULT_LEADSQUARED_FIELD_MAPPINGS: WizardFieldMapping[] = [
  { id: 'firstName', token: '{{firstName}}', lsqField: 'FirstName', label: 'First Name', enabled: true },
  { id: 'lastName', token: '{{lastName}}', lsqField: 'LastName', label: 'Last Name', enabled: true },
  { id: 'company', token: '{{company}}', lsqField: 'Company', label: 'Company', enabled: true },
  { id: 'title', token: '{{title}}', lsqField: 'JobTitle', label: 'Job Title', enabled: true },
  { id: 'email', token: '{{email}}', lsqField: 'EmailAddress', label: 'Email', enabled: true },
  { id: 'link', token: '{{link}}', lsqField: '(auto — per-contact link)', label: '(auto — per-contact link)', isSystem: true, enabled: true },
];
