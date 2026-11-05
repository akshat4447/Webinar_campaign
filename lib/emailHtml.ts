// Pure. Turns a plain-text message into the HTML an email is sent as, with every web address as a real hyperlink.
//
// A bare address in the body (https://page.example/?token=...) was held back by a company mail gateway in testing, while the
// same address behind a short clickable label ("Register here") was delivered, with or without Netcore click tracking
// (see docs/EMAIL_DELIVERABILITY.md). So an address is never shown as text: it is the target of a hyperlink whose visible text
// says what the link is for. The label never looks like an address itself, since a label that names one place while the link
// goes to another is what filters read as phishing.

const URL_IN_TEXT = /https?:\/\/[^\s<>"'`]+/gi;

const ZOOM_HOST = /(^|\.)(zoom\.us|zoom\.com|zoomgov\.com)$/i;
const CALENDAR_HOST = /^(calendar\.google\.com|outlook\.(live|office|office365)\.com)$/i;

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m] as string);
}

/** Splits trailing sentence punctuation (and a closing bracket the address does not open) off the end of a matched address. */
function trimTrailing(raw: string): { url: string; rest: string } {
  let url = raw;
  for (;;) {
    const last = url[url.length - 1];
    if (!last) break;
    if (/[.,;:!?'"]/.test(last)) { url = url.slice(0, -1); continue; }
    const open = { ')': '(', ']': '[', '}': '{' }[last];
    if (open && url.split(last).length > url.split(open).length) { url = url.slice(0, -1); continue; }
    break;
  }
  return { url, rest: raw.slice(url.length) };
}

/** What a link is for, in words. Never an address. */
export function linkLabel(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return 'Open the link';
  }
  const host = u.hostname.toLowerCase();
  if (ZOOM_HOST.test(host)) return 'Join the webinar';
  if (CALENDAR_HOST.test(host) || u.pathname.startsWith('/api/calendar') || u.pathname.toLowerCase().endsWith('.ics')) return 'Add to calendar';
  if (u.pathname.startsWith('/r/') || u.pathname.startsWith('/register/') || u.searchParams.has('token') || u.searchParams.has('campaignId')) return 'Register here';
  return 'Open the link';
}

/** The message as HTML, without any wrapper: text escaped, line breaks kept, every web address a hyperlink with a plain-words label. */
export function textToEmailHtmlBody(text: string): string {
  let out = '';
  let last = 0;
  for (const match of text.matchAll(URL_IN_TEXT)) {
    const start = match.index ?? 0;
    const { url, rest } = trimTrailing(match[0]);
    if (!url || url === 'http://' || url === 'https://') continue;
    out += escapeHtml(text.slice(last, start)).replace(/\n/g, '<br/>');
    out += `<a href="${escapeHtml(url)}">${escapeHtml(linkLabel(url))}</a>`;
    out += escapeHtml(rest);
    last = start + match[0].length;
  }
  out += escapeHtml(text.slice(last)).replace(/\n/g, '<br/>');
  return out;
}

export function textToEmailHtml(text: string): string {
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6">${textToEmailHtmlBody(text)}</div>`;
}
