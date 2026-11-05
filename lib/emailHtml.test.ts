import { describe, expect, it } from 'vitest';
import { linkLabel, textToEmailHtml, textToEmailHtmlBody } from './emailHtml';

const TOKEN_LINK = 'https://my-landing-page.framer.app/?token=v2.abc.def&campaignId=c1&zoomId=81234567891&source=email&utm_source=email';

describe('textToEmailHtmlBody', () => {
  it('makes a web address a hyperlink with words as its text, so no address is shown', () => {
    const html = textToEmailHtmlBody(`Save your seat: ${TOKEN_LINK}\n\nSee you there.`);
    expect(html).toContain('<a href="https://my-landing-page.framer.app/?token=v2.abc.def&amp;campaignId=c1&amp;zoomId=81234567891&amp;source=email&amp;utm_source=email">Register here</a>');
    expect(html.replace(/href="[^"]*"/g, '')).not.toContain('framer.app');
    expect(html).toContain('Save your seat: <a ');
    expect(html).toContain('</a><br/><br/>See you there.');
  });

  it('labels a Zoom link and a calendar link by what they are for', () => {
    expect(linkLabel('https://leadsquared.zoom.us/w/81234567891?tk=PERSONAL')).toBe('Join the webinar');
    expect(linkLabel('https://studio.example.com/api/calendar/camp1?x=1')).toBe('Add to calendar');
    expect(linkLabel('https://calendar.google.com/calendar/render?action=TEMPLATE')).toBe('Add to calendar');
    expect(linkLabel('https://studio.example.com/r/tok?source=email')).toBe('Register here');
    expect(linkLabel('https://studio.example.com/register/c1?c=email')).toBe('Register here');
    expect(linkLabel('https://example.com/blog')).toBe('Open the link');
    expect(linkLabel('not a url')).toBe('Open the link');
  });

  it('keeps sentence punctuation and brackets outside the link', () => {
    expect(textToEmailHtmlBody('Join: https://zoom.us/j/1.')).toBe('Join: <a href="https://zoom.us/j/1">Join the webinar</a>.');
    expect(textToEmailHtmlBody('(see https://example.com/a)')).toBe('(see <a href="https://example.com/a">Open the link</a>)');
    expect(textToEmailHtmlBody('Is it https://example.com/a?')).toBe('Is it <a href="https://example.com/a">Open the link</a>?');
    expect(textToEmailHtmlBody('https://en.wikipedia.org/wiki/Foo_(bar) ok')).toContain('href="https://en.wikipedia.org/wiki/Foo_(bar)"');
  });

  it('handles several links in one message', () => {
    const html = textToEmailHtmlBody('A https://zoom.us/j/1 and B https://example.com/x');
    expect(html.match(/<a /g)).toHaveLength(2);
    expect(html).toContain('>Join the webinar</a> and B ');
  });

  it('escapes the rest of the message, so text can never become markup', () => {
    const html = textToEmailHtmlBody('Hi <b>Priya</b> & team "quoted" \'x\' <script>alert(1)</script>');
    expect(html).not.toContain('<b>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;b&gt;Priya&lt;/b&gt; &amp; team &quot;quoted&quot;');
  });

  it('cannot be broken out of the link by quotes or tags in the address', () => {
    const html = textToEmailHtmlBody('x https://evil.example/"onmouseover="alert(1) y');
    expect(html.match(/<a /g)).toHaveLength(1);
    // the address ends at the quote; what follows is plain escaped text, never an attribute of the link
    expect(html).toContain('<a href="https://evil.example/">Open the link</a>&quot;onmouseover=&quot;alert(1) y');
    expect(html).not.toMatch(/<a [^>]*onmouseover/);
  });

  it('only makes web addresses into links', () => {
    for (const t of ['javascript:alert(1)', 'data:text/html,hi', 'ftp://example.com/x', 'mailto:a@b.com', 'see example.com/x', 'https://', 'http://']) {
      expect(textToEmailHtmlBody(t), t).not.toContain('<a ');
    }
  });

  it('leaves a message with no address, and an empty one, as escaped text', () => {
    expect(textToEmailHtmlBody('Line 1\nLine 2')).toBe('Line 1<br/>Line 2');
    expect(textToEmailHtmlBody('')).toBe('');
  });
});

describe('textToEmailHtml', () => {
  it('wraps the body in the plain styling that was delivered in testing', () => {
    const html = textToEmailHtml(`Go: ${TOKEN_LINK}`);
    expect(html.startsWith('<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6">')).toBe(true);
    expect(html.endsWith('</div>')).toBe(true);
  });
});
