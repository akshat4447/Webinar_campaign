import { describe, it, expect } from 'vitest';
import { validateTemplateContent, validateRenderedMessage, validateRenderedMessageForChannel, validateTemplateContentForChannel } from './messageValidation';

const KNOWN_VARS = ['firstName', 'lastName', 'company', 'topic', 'link', 'date'];

describe('validateTemplateContent', () => {
  it('is valid for a well-formed template using only known variables and a link token', () => {
    const result = validateTemplateContent('Hi {{firstName}}', 'Join {{topic}} at {{link}}', true, KNOWN_VARS);
    expect(result.valid).toBe(true);
    expect(result.issues.filter((i) => i.severity === 'error')).toHaveLength(0);
  });

  it('flags an unknown variable as an error', () => {
    const result = validateTemplateContent('Hi {{firstName}}', 'Your {{unknownVar}} matters. {{link}}', true, KNOWN_VARS);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.severity === 'error' && i.message.includes('unknownVar'))).toBe(true);
  });

  it('flags a missing link placeholder as an error', () => {
    const result = validateTemplateContent('Hi {{firstName}}', 'No link mentioned anywhere in this body.', true, KNOWN_VARS);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.severity === 'error' && i.message.includes('link'))).toBe(true);
  });

  it('accepts a literal https:// URL in place of the {{link}} token', () => {
    const result = validateTemplateContent(null, 'Register here: https://example.com/webinar', false, KNOWN_VARS);
    expect(result.valid).toBe(true);
  });

  it('warns (not errors) on a long body and spam-trigger words', () => {
    const longBody = 'x'.repeat(901) + ' {{link}} act now';
    const result = validateTemplateContent(null, longBody, false, KNOWN_VARS);
    expect(result.valid).toBe(true); // warnings only
    expect(result.issues.some((i) => i.severity === 'warning' && i.message.includes('long'))).toBe(true);
    expect(result.issues.some((i) => i.severity === 'warning' && i.message.includes('Spam'))).toBe(true);
  });
});

describe('validateRenderedMessage', () => {
  const link = 'https://lsq.co/w/my-webinar';

  it('is valid for a fully rendered message with the real link and no leftover tokens', () => {
    const result = validateRenderedMessage('Join us, Priya', `Hi Priya, register here: ${link}`, true, link);
    expect(result.valid).toBe(true);
  });

  it('flags a leftover {{token}} as an error — personalization did not actually finish', () => {
    const result = validateRenderedMessage('Hi {{firstName}}', `Register: ${link}`, true, link);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.severity === 'error' && i.message.includes('firstName'))).toBe(true);
  });

  it('flags a missing registration link as an error, even with no tokens left', () => {
    const result = validateRenderedMessage('Hi Priya', 'Hi Priya, hope to see you there!', true, link);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.severity === 'error' && i.message.toLowerCase().includes('link'))).toBe(true);
  });

  it('flags an empty body as an error', () => {
    const result = validateRenderedMessage('Subject only', '   ', true, link);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.severity === 'error' && i.message.includes('empty'))).toBe(true);
  });

  it('does not require a link when none is configured on the campaign yet', () => {
    const result = validateRenderedMessage('Hi Priya', 'Hi Priya, hope to see you there!', true, '');
    expect(result.valid).toBe(true);
  });

  it('ignores the subject field for a LinkedIn message (hasChannelSubject=false)', () => {
    const result = validateRenderedMessage(null, `Hi Priya, check this out: ${link}`, false, link);
    expect(result.valid).toBe(true);
  });
});

describe('validateRenderedMessageForChannel', () => {
  const link = 'https://lsq.co/w/my-webinar';

  it('delegates SMS bodies to checkSmsBody instead of the generic length/spam rules', () => {
    // Long enough to trip the generic 900-char "body long" warning, but a single
    // GSM-7 segment is nowhere near SMS's own much lower per-segment cap — if
    // the generic rule leaked through, this would incorrectly warn.
    const short = `Reminder: ${link}`;
    const result = validateRenderedMessageForChannel(null, short, false, link, 'sms');
    expect(result.valid).toBe(true);
    expect(result.issues.some((i) => i.message.includes('long'))).toBe(false);
  });

  it('errors on an SMS body with an unbounded segment count', () => {
    const huge = 'x'.repeat(2000) + ` ${link}`;
    const result = validateRenderedMessageForChannel(null, huge, false, link, 'sms');
    expect(result.valid).toBe(false);
  });

  it('caps WhatsApp bodies at 1024 characters', () => {
    const tooLong = 'x'.repeat(1025) + ` ${link}`;
    const result = validateRenderedMessageForChannel(null, tooLong, false, link, 'whatsapp');
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.severity === 'error' && i.message.includes('1024'))).toBe(true);
  });

  it('accepts a WhatsApp body under the 1024-character cap', () => {
    const result = validateRenderedMessageForChannel(null, `Hi Priya! Your seat is confirmed: ${link}`, false, link, 'whatsapp');
    expect(result.valid).toBe(true);
  });

  it('still flags a leftover token and a missing link for every channel, not just email', () => {
    const withToken = validateRenderedMessageForChannel(null, 'Hi {{firstName}}, join us!', false, link, 'whatsapp');
    expect(withToken.valid).toBe(false);
    expect(withToken.issues.some((i) => i.message.includes('firstName'))).toBe(true);

    const noLink = validateRenderedMessageForChannel(null, 'Hi Priya, join us!', false, link, 'sms');
    expect(noLink.valid).toBe(false);
    expect(noLink.issues.some((i) => i.message.toLowerCase().includes('link'))).toBe(true);
  });
});

describe('validateTemplateContentForChannel', () => {
  const KNOWN = ['firstName', 'topic', 'link'];

  it('applies the plain template rules unchanged for a non-SMS channel', () => {
    const result = validateTemplateContentForChannel(null, 'Join {{topic}} at {{link}}', false, KNOWN, 'WhatsApp');
    expect(result.valid).toBe(true);
  });

  it('replaces the generic "body long" warning with SMS segment-count issues for an SMS template', () => {
    const longSmsBody = 'x'.repeat(901) + ' {{link}}';
    const result = validateTemplateContentForChannel(null, longSmsBody, false, KNOWN, 'SMS');
    expect(result.issues.some((i) => i.message.startsWith('Body long'))).toBe(false);
  });

  it('still catches an unknown variable regardless of channel', () => {
    const result = validateTemplateContentForChannel(null, 'Hi {{oops}} {{link}}', false, KNOWN, 'SMS');
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.message.includes('oops'))).toBe(true);
  });
});
