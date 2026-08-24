import { describe, it, expect } from 'vitest';
import { parseCsvText } from './csv';

describe('parseCsvText', () => {
  it('parses a simple comma-delimited CSV with a header row', () => {
    const text = 'name,email\nAlice,alice@example.com\nBob,bob@example.com';
    expect(parseCsvText(text)).toEqual([
      ['name', 'email'],
      ['Alice', 'alice@example.com'],
      ['Bob', 'bob@example.com'],
    ]);
  });

  it('handles quoted fields containing commas', () => {
    const text = 'name,account\n"Doe, Jane","Acme, Inc."';
    expect(parseCsvText(text)).toEqual([
      ['name', 'account'],
      ['Doe, Jane', 'Acme, Inc.'],
    ]);
  });

  it('handles escaped double quotes inside a quoted field', () => {
    const text = 'name,note\n"Jane","She said ""hi"""';
    expect(parseCsvText(text)).toEqual([
      ['name', 'note'],
      ['Jane', 'She said "hi"'],
    ]);
  });

  it('auto-detects tab-delimited (TSV) input', () => {
    const text = 'name\temail\nAlice\talice@example.com';
    expect(parseCsvText(text)).toEqual([
      ['name', 'email'],
      ['Alice', 'alice@example.com'],
    ]);
  });

  it('drops fully blank rows', () => {
    const text = 'name,email\nAlice,alice@example.com\n\n\nBob,bob@example.com';
    expect(parseCsvText(text)).toEqual([
      ['name', 'email'],
      ['Alice', 'alice@example.com'],
      ['Bob', 'bob@example.com'],
    ]);
  });

  it('tolerates Windows-style CRLF line endings', () => {
    const text = 'name,email\r\nAlice,alice@example.com\r\n';
    expect(parseCsvText(text)).toEqual([
      ['name', 'email'],
      ['Alice', 'alice@example.com'],
    ]);
  });
});
