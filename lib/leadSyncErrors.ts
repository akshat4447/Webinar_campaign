// Pure. LeadSquared reports a failed lead row by row. When a hundred rows fail for the same reason, the person reading the
// Results tab needs the reason once, with how many people it touched, not a hundred copies of it.

export interface RowFailure {
  name: string;
  message: string;
}

/** The part of LeadSquared's wording that varies by row, removed so identical causes group together. */
function reasonOf(message: string): string {
  return message.replace(/\s+/g, ' ').trim();
}

/** What to do about a reason, when it is one with a known fix. */
function hintFor(reason: string): string {
  const unknown = /does not exist\s*-\s*(.+?)\.?$/i.exec(reason);
  if (/MXUnknownAttributeException/i.test(reason) && unknown) {
    return ` LeadSquared has no field named ${unknown[1].trim()}. Create it in LeadSquared, or leave it: Studio skips unknown fields on the next sync.`;
  }
  return '';
}

/**
 * One line per distinct reason: "3 contacts (ZZ QA One, ZZ QA Two, ZZ QA Three): <reason>". At most `max` reasons are named; the rest are counted.
 */
export function summarizeRowFailures(failures: RowFailure[], max = 3): string[] {
  const byReason = new Map<string, string[]>();
  for (const f of failures) {
    const reason = reasonOf(f.message);
    byReason.set(reason, [...(byReason.get(reason) ?? []), f.name]);
  }
  const lines = [...byReason.entries()].slice(0, max).map(([reason, names]) => {
    const shown = names.slice(0, 3).join(', ') + (names.length > 3 ? `, and ${names.length - 3} more` : '');
    return `${names.length} ${names.length === 1 ? 'contact' : 'contacts'} (${shown}): ${reason}.${hintFor(reason)}`;
  });
  const hidden = byReason.size - lines.length;
  if (hidden > 0) lines.push(`${hidden} other ${hidden === 1 ? 'reason' : 'reasons'} not shown`);
  return lines;
}
