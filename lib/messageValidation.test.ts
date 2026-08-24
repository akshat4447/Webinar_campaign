import { describe, it, expect } from 'vitest';
import { validateTemplateContent, validateRenderedMessage } from './messageValidation';

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
