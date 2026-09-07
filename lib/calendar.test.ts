import { describe, it, expect } from 'vitest';

describe('Calendar (.ics) and Attendee Hub', () => {
  it('formats dates cleanly for iCalendar standard RFC 5545', () => {
    const testDate = new Date('2026-09-15T10:00:00.000Z');
    const formatted = testDate.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    expect(formatted).toBe('20260915T100000Z');
  });

  it('escapes description and summary for RFC 5545 compatibility', () => {
    const title = 'FinTech & Lending: 2026 Strategy; Workshop';
    const safeSummary = title.replace(/[,;\\]/g, ' ');
    expect(safeSummary).toBe('FinTech & Lending: 2026 Strategy  Workshop');

    const desc = 'Line 1\nLine 2, with comma; and semicolon.';
    const safeDesc = desc.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
    expect(safeDesc).toBe('Line 1\\nLine 2\\, with comma\\; and semicolon.');
  });
});
