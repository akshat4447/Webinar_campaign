// Ported from the original mock's CSV ingestion logic — same fuzzy column
// matching and title-based function/seniority classification, now shared by
// both the CSV import path and the LeadSquared list import path.

export function pickCol(headers: string[], keys: string[]): number {
  for (const k of keys) {
    const i = headers.findIndex((h) => h.includes(k));
    if (i >= 0) return i;
  }
  return -1;
}

export function functionFor(title: string): string {
  const t = (title || '').toLowerCase();
  if (/market|growth|brand|demand/.test(t)) return 'Marketing';
  if (/admission|enrol/.test(t)) return 'Admissions';
  if (/ops|operation|process|service/.test(t)) return 'Operations';
  if (/sales|revenue|account exec|business develop/.test(t)) return 'Sales';
  if (/product/.test(t)) return 'Product';
  if (/\bit\b|tech|engineer|data|cto/.test(t)) return 'IT';
  return 'Other';
}

export function seniorityFor(title: string): string {
  const t = (title || '').toLowerCase();
  if (/chief|c[etofm]o\b|founder|president/.test(t)) return 'CXO';
  if (/\bvp\b|vice president|svp|avp/.test(t)) return 'VP';
  if (/head/.test(t)) return 'Head';
  if (/director/.test(t)) return 'Director';
  if (/manager|mgr/.test(t)) return 'Manager';
  if (/lead|principal|senior/.test(t)) return 'Lead';
  return 'IC';
}

export interface ImportedContact {
  name: string;
  email: string;
  account: string;
  title: string;
  vertical: string;
  linkedinId: string;
  phone?: string | null;
  /** Explicit WhatsApp consent from the source file. Meta requires it and the
   *  send path refuses without it, so it is never inferred — only read. */
  whatsappOptIn?: boolean;
  /** Columns with no first-class field here, kept verbatim so nothing is lost. */
  extras?: Record<string, string>;
  missingInfo: boolean;
  function: string;
  seniority: string;
  source: 'LinkedIn' | 'LinkedIn+Apollo' | 'Apollo';
}

export function classifyContact(fields: Omit<ImportedContact, 'missingInfo' | 'function' | 'seniority' | 'source'>): ImportedContact {
  const missingInfo = !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email);
  const fn = functionFor(fields.title);
  const seniority = seniorityFor(fields.title);
  const source: ImportedContact['source'] = fields.linkedinId ? (fields.email ? 'LinkedIn+Apollo' : 'LinkedIn') : 'Apollo';
  return { ...fields, missingInfo, function: fn, seniority, source };
}
