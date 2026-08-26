import { describe, expect, it } from 'vitest';
import { preflightCsvRows } from './csvPreflight';

const fieldTypes = {
  EmailAddress: 'Email',
  Phone: 'Phone',
  Company: 'String',
  Headcount: 'Number',
  RenewalDate: 'Date',
  OptedIn: 'Boolean',
};

function run(rows: Array<Record<string, string>>, mappings: Array<{ header: string; schemaName: string }>) {
  return preflightCsvRows({ rows, mappings, fieldTypes });
}

describe('preflightCsvRows', () => {
  it('passes clean data', () => {
    const r = run(
      [{ Email: 'a@b.com', Mobile: '+91 91234 43870', Firm: 'Northwind', Staff: '1,200', Renews: '2026-10-15', Sub: 'yes' }],
      [
        { header: 'Email', schemaName: 'EmailAddress' },
        { header: 'Mobile', schemaName: 'Phone' },
        { header: 'Firm', schemaName: 'Company' },
        { header: 'Staff', schemaName: 'Headcount' },
        { header: 'Renews', schemaName: 'RenewalDate' },
        { header: 'Sub', schemaName: 'OptedIn' },
      ]
    );
    expect(r.issues).toEqual([]);
    expect(r.badRows).toBe(0);
    expect(r.checked).toBe(6);
  });

  it('catches a malformed email', () => {
    const r = run([{ Email: 'not-an-email' }], [{ header: 'Email', schemaName: 'EmailAddress' }]);
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0].problem).toMatch(/valid email/i);
  });

  it('reports spreadsheet row numbers, accounting for the header row', () => {
    const r = run(
      [{ Email: 'ok@b.com' }, { Email: 'bad' }],
      [{ header: 'Email', schemaName: 'EmailAddress' }]
    );
    // Second data row is row 3 in a spreadsheet.
    expect(r.issues[0].row).toBe(3);
  });

  it('rejects a too-short phone but accepts a formatted one', () => {
    expect(run([{ P: '12345' }], [{ header: 'P', schemaName: 'Phone' }]).issues[0].problem).toMatch(/too short/i);
    expect(run([{ P: '(080) 4718-1000' }], [{ header: 'P', schemaName: 'Phone' }]).issues).toEqual([]);
  });

  it('rejects a phone longer than E.164 allows', () => {
    expect(run([{ P: '+1234567890123456' }], [{ header: 'P', schemaName: 'Phone' }]).issues[0].problem).toMatch(/maximum of 15/);
  });

  it('rejects text in a Number field', () => {
    expect(run([{ N: 'about fifty' }], [{ header: 'N', schemaName: 'Headcount' }]).issues[0].problem).toMatch(/expects a number/i);
  });

  it('accepts dd/mm/yyyy dates', () => {
    expect(run([{ D: '15/10/2026' }], [{ header: 'D', schemaName: 'RenewalDate' }]).issues).toEqual([]);
  });

  it('flags strings over the 200-character LeadSquared cap', () => {
    const r = run([{ C: 'x'.repeat(201) }], [{ header: 'C', schemaName: 'Company' }]);
    expect(r.issues[0].problem).toMatch(/truncates text fields at 200/);
  });

  it('skips blank values rather than flagging them', () => {
    const r = run([{ Email: '', P: '   ' }], [
      { header: 'Email', schemaName: 'EmailAddress' },
      { header: 'P', schemaName: 'Phone' },
    ]);
    expect(r.checked).toBe(0);
    expect(r.issues).toEqual([]);
  });

  it('counts a row once even with several bad columns', () => {
    const r = run([{ Email: 'bad', P: '1' }], [
      { header: 'Email', schemaName: 'EmailAddress' },
      { header: 'P', schemaName: 'Phone' },
    ]);
    expect(r.issues).toHaveLength(2);
    expect(r.badRows).toBe(1);
  });

  it('defaults an unknown field type to string rules', () => {
    const r = preflightCsvRows({
      rows: [{ X: 'y'.repeat(250) }],
      mappings: [{ header: 'X', schemaName: 'mx_Unknown' }],
      fieldTypes: {},
    });
    expect(r.issues[0].problem).toMatch(/200/);
  });
});
