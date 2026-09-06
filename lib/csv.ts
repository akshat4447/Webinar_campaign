import Papa from 'papaparse';

/**
 * Shared CSV/TSV row parser — used by every CSV ingestion path (contact
 * import, attendance import). Previously lib/actions/setup.ts and
 * lib/attendance.ts each hand-rolled a near-identical quote/comma/newline
 * parser; papaparse (already a dependency, used nowhere until now) is a
 * more complete, better-tested implementation of the same thing.
 *
 * Delimiter is auto-detected (comma or tab), matching the old parsers' support
 * for both .csv and .tsv. Fully blank rows are dropped, matching the old
 * `rows.filter((r) => r.some((c) => c.trim() !== ''))` behaviour.
 */
export function parseCsvText(text: string): string[][] {
  const cleanText = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const result = Papa.parse<string[]>(cleanText, { skipEmptyLines: true });
  return result.data.filter((row) => row.some((cell) => String(cell ?? '').trim() !== ''));
}
