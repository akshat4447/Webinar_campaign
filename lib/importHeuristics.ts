// Ported from the original mock's CSV ingestion logic — same fuzzy column
// matching and title-based function/seniority classification, now shared by
// both the CSV import path and the LeadSquared list import path.

/**
 * Finds the column a logical field lives in, by fuzzy header match.
 *
 * Exact matches win over substring matches across the whole key list, because
 * substring matching alone is greedy in a way that silently picks the wrong
 * column: for the single most common B2B export shape
 * (`First Name,Last Name,Email,Company`), the key `'name'` substring-matches
 * `"first name"` and claims it as the full-name column, so every imported
 * contact ends up named "Priya" instead of "Priya Nair".
 *
 * `exclude` lets a caller resolve the more specific fields first and then keep
 * this from re-claiming them; `reject` blocks headers that must never satisfy
 * this field regardless of the keys (e.g. an "Email Opt-In" column can never
 * stand in for WhatsApp consent).
 */
export function pickCol(
  headers: string[],
  keys: string[],
  opts: { exclude?: number[]; reject?: RegExp } = {}
): number {
  const excluded = new Set(opts.exclude?.filter((i) => i >= 0) ?? []);
  const eligible = (i: number, h: string) => !excluded.has(i) && !(opts.reject && opts.reject.test(h));

  for (const k of keys) {
    const i = headers.findIndex((h, idx) => h === k && eligible(idx, h));
    if (i >= 0) return i;
  }
  for (const k of keys) {
    const i = headers.findIndex((h, idx) => h.includes(k) && eligible(idx, h));
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
  smsOptOut?: boolean;
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
