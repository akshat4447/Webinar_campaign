import { describe, it, expect } from 'vitest';
import { validateLandingUrl } from './landingUrl';

describe('validateLandingUrl', () => {
  it('accepts and normalises ordinary URLs', () => {
    expect(validateLandingUrl('https://webinar.example.com/ai')).toMatchObject({ ok: true, url: 'https://webinar.example.com/ai', warnings: [] });
    expect(validateLandingUrl('  webinar.example.com/ai  ')).toMatchObject({ ok: true, url: 'https://webinar.example.com/ai' });
    expect(validateLandingUrl('HTTPS://Webinar.Example.com')).toMatchObject({ ok: true, url: 'https://webinar.example.com/' });
  });
  it('keeps an existing query string', () => {
    expect(validateLandingUrl('https://x.example.com/p?ref=partner').url).toBe('https://x.example.com/p?ref=partner');
  });
  it('rejects empty, spaced, over-long and non-web input', () => {
    for (const bad of ['', '   ', 'https://exa mple.com', 'x'.repeat(2100), 'javascript:alert(1)', 'data:text/html,hi', 'ftp://example.com', 'file:///etc/passwd', 'mailto:a@b.com', 'vbscript:x']) {
      expect(validateLandingUrl(bad).ok, bad).toBe(false);
    }
  });
  it('rejects embedded credentials and dotless hosts', () => {
    expect(validateLandingUrl('https://user:pw@example.com').error).toMatch(/username/);
    expect(validateLandingUrl('https://intranet').error).toMatch(/domain/);
  });
  it('warns (but allows) local and insecure addresses', () => {
    expect(validateLandingUrl('http://localhost:3000/x')).toMatchObject({ ok: true, warnings: expect.arrayContaining([expect.stringMatching(/only reachable/), expect.stringMatching(/not secure/)]) });
    expect(validateLandingUrl('http://example.com').warnings.join(' ')).toMatch(/https/);
  });
  it('strips and warns about a #fragment', () => {
    const r = validateLandingUrl('https://x.example.com/p#section');
    expect(r.url).toBe('https://x.example.com/p');
    expect(r.warnings.join(' ')).toMatch(/#/);
  });
  it('handles unicode hostnames and ports', () => {
    expect(validateLandingUrl('https://webinär.example.com:8443/x').ok).toBe(true);
  });
});
