// Deterministic validation of CSV values against the LeadSquared field types
// they are about to be written into.
//
// Deliberately NOT an LLM job. The model proposes which column maps to which
// field (a fuzzy naming problem); whether a value is safe to write is a hard
// rule, and a hallucinated "looks fine" here would push bad data into the CRM.
// Wrong data in LeadSquared is expensive to undo, so this stays mechanical.

export interface PreflightIssue {
  row: number;
  header: string;
  schemaName: string;
  value: string;
  problem: string;
}

export interface PreflightReport {
  checked: number;
  issues: PreflightIssue[];
  /** Rows with at least one issue — these are the ones an operator must fix. */
  badRows: number;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Normalizes phone numbers to standard E.164 format (+[country code][number]).
 * Defaults to Indian country code +91 for 10-digit numbers if no code is present.
 */
export function normalizeE164(phone: string | null | undefined, defaultCountryCode = '+91'): string | null {
  if (!phone) return null;
  let clean = phone.trim().replace(/[^\d+]/g, '');
  if (!clean) return null;
  if (clean.startsWith('00')) clean = '+' + clean.slice(2);
  else if (clean.startsWith('0')) clean = clean.slice(1);

  if (!clean.startsWith('+')) {
    clean = defaultCountryCode + clean;
  }
  const digitsOnly = clean.replace(/\D/g, '');
  if (digitsOnly.length < 10 || digitsOnly.length > 15) return null;
  return clean;
}

/**
 * Digits plus the separators real CSVs actually contain. A leading "(" is
 * allowed because area-code style — "(080) 4718-1000" — is common and valid.
 * Length is judged on digits only, so formatting never affects the verdict.
 */
function phoneProblem(value: string): string | null {
  if (!/^[+(\d][\d\s\-()./+]*$/.test(value)) return 'Not a phone number — contains unexpected characters.';
  const digits = value.replace(/\D/g, '');
  if (digits.length < 7) return `Only ${digits.length} digits — too short to dial.`;
  if (digits.length > 15) return `${digits.length} digits — longer than the E.164 maximum of 15.`;
  return null;
}

function valueProblem(dataType: string, value: string): string | null {
  const t = dataType.toLowerCase();

  if (t.includes('email')) return EMAIL_RE.test(value) ? null : 'Not a valid email address.';
  if (t.includes('phone') || t.includes('mobile')) return phoneProblem(value);

  if (t.includes('number') || t.includes('int') || t.includes('decimal') || t.includes('double')) {
    return Number.isFinite(Number(value.replace(/,/g, ''))) ? null : 'LeadSquared expects a number here.';
  }

  if (t.includes('date')) {
    // Accept anything Date can parse, plus bare dd/mm/yyyy and dd-mm-yyyy.
    const parseable = !Number.isNaN(Date.parse(value)) || /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(value);
    return parseable ? null : 'LeadSquared expects a date here.';
  }

  if (t.includes('boolean') || t.includes('checkbox')) {
    return /^(true|false|yes|no|1|0|y|n)$/i.test(value) ? null : 'LeadSquared expects a yes/no value here.';
  }

  // Strings: LSQ text fields cap at 200 characters (activity strings do too).
  if (value.length > 200) return `${value.length} characters — LeadSquared truncates text fields at 200.`;
  return null;
}

/**
 * Checks every mapped value in every row. Blank values are skipped rather than
 * flagged: an empty optional column is normal in a real CSV.
 */
export function preflightCsvRows(params: {
  rows: Array<Record<string, string>>;
  mappings: Array<{ header: string; schemaName: string }>;
  fieldTypes: Record<string, string>;
}): PreflightReport {
  const issues: PreflightIssue[] = [];
  const rowsWithIssues = new Set<number>();
  let checked = 0;

  params.rows.forEach((row, i) => {
    for (const m of params.mappings) {
      const value = (row[m.header] ?? '').trim();
      if (!value) continue;
      checked++;
      const problem = valueProblem(params.fieldTypes[m.schemaName] ?? 'String', value);
      if (problem) {
        // +2 so the number matches what the operator sees in a spreadsheet
        // (1-based, and row 1 is the header).
        issues.push({ row: i + 2, header: m.header, schemaName: m.schemaName, value: value.slice(0, 80), problem });
        rowsWithIssues.add(i);
      }
    }
  });

  return { checked, issues, badRows: rowsWithIssues.size };
}
