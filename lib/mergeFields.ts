export const KNOWN_MERGE_VARS = ['firstName', 'lastName', 'company', 'topic', 'link', 'date', 'speaker'];

export interface MergeFieldOptions {
  firstName: string;
  lastName?: string;
  company: string;
  topic: string;
  link: string;
  date?: string;
  speaker?: string;
}

export function renderMergeFields(str: string, opts: MergeFieldOptions): string {
  if (!str) return '';
  return str
    .replace(/\{\{\s*firstName\s*\}\}/g, () => opts.firstName)
    .replace(/\{\{\s*lastName\s*\}\}/g, () => opts.lastName ?? '')
    .replace(/\{\{\s*company\s*\}\}/g, () => opts.company)
    .replace(/\{\{\s*account\s*\}\}/g, () => opts.company)
    .replace(/\{\{\s*topic\s*\}\}/g, () => opts.topic)
    .replace(/\{\{\s*link\s*\}\}/g, () => opts.link)
    .replace(/\{\{\s*date\s*\}\}/g, () => opts.date ?? '')
    .replace(/\{\{\s*speaker\s*\}\}/g, () => opts.speaker ?? '');
}
