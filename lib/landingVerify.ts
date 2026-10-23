// Server-only. "Is my landing page ready to register people into Webinar Studio?"
//
// Fetches the operator's page (SSRF-safe, see lib/safeFetch.ts) and reports, in plain language,
// what is fine and what to fix: reachable? redirected? embeddable in a preview? is a form there?
// is the Studio snippet installed — or a LeadSquared form that can call our webhook?
// The analysis is a pure function so every page shape is unit-tested.

import { safeFetchText, UnsafeUrlError, type SafeFetchResult } from '@/lib/safeFetch';

export type CheckStatus = 'pass' | 'warn' | 'fail';
export interface LandingCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  /** What the operator should do, when not a pass. */
  fix?: string;
}

export interface LandingReport {
  url: string;
  finalUrl: string | null;
  status: number | null;
  title: string | null;
  platform: 'leadsquared' | 'framer' | 'webflow' | 'wordpress' | 'unknown';
  /** True when Studio can show this page in an iframe preview. */
  embeddable: boolean;
  checks: LandingCheck[];
  /** pass when nothing failed; warn when only warnings; fail when any check failed. */
  overall: CheckStatus;
}

const SNIPPET_MARKERS = [/Webinar Studio \+ LeadSquared \+ Zoom Seamless Registration/i, /\/api\/landing\/submit/i];

function detectPlatform(html: string, headers: Headers): LandingReport['platform'] {
  const gen = /<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)["']/i.exec(html)?.[1]?.toLowerCase() ?? '';
  const h = html.toLowerCase();
  if (h.includes('lsqleadfields') || h.includes('leadsquared') || h.includes('lsq-')) return 'leadsquared';
  if (gen.includes('framer') || h.includes('framerusercontent') || h.includes('data-framer')) return 'framer';
  if (gen.includes('webflow') || h.includes('data-wf-site') || h.includes('webflow.com')) return 'webflow';
  if (gen.includes('wordpress') || h.includes('wp-content') || headers.get('x-powered-by')?.toLowerCase().includes('wordpress')) return 'wordpress';
  return 'unknown';
}

/** Whether the response forbids being shown inside an iframe on another origin. */
export function frameBlocked(headers: Headers): boolean {
  const xfo = headers.get('x-frame-options')?.toLowerCase() ?? '';
  if (xfo.includes('deny') || xfo.includes('sameorigin')) return true;
  const csp = headers.get('content-security-policy') ?? '';
  const fa = /frame-ancestors\s+([^;]+)/i.exec(csp)?.[1]?.trim().toLowerCase();
  if (fa === undefined) return false;
  return !(fa.includes('*') && !fa.includes("'none'"));
}

/** What the campaign says, so the form's baked-in values can be compared with it. */
export interface ExpectedWebinar {
  zoomId?: string | null;
  scheduledAt?: Date | null;
  timezone?: string | null;
}

/** The page the form sends people to after they submit, and whether the Studio script is on it. null = could not be checked. */
export interface ThankYouProbe {
  url: string;
  hasScript: boolean | null;
}

const decodeAttr = (v: string) => v.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

/** name -> value for every hidden input in the page source (the native LeadSquared form carries its settings here). */
export function hiddenInputs(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const tag of html.match(/<input\b[^>]*>/gi) ?? []) {
    if (!/type=["']hidden["']/i.test(tag)) continue;
    const name = /\bname=["']([^"']+)["']/i.exec(tag)?.[1];
    if (!name) continue;
    out[name] = decodeAttr(/\bvalue=["']([^"']*)["']/i.exec(tag)?.[1] ?? '');
  }
  return out;
}

/** The form's redirect target (LeadSquared's MXHRedirectUrl), as an absolute http(s) URL, or null. */
export function formRedirectUrl(html: string, base: string): string | null {
  const raw = hiddenInputs(html).MXHRedirectUrl?.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw, base);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

const bareHost = (u: URL) => u.hostname.replace(/^www\./, '').toLowerCase();

function calendarDate(d: Date, timeZone: string): string | null {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  } catch {
    return null;
  }
}

export function analyzeLandingPage(args: {
  url: string;
  fetched: Pick<SafeFetchResult, 'finalUrl' | 'status' | 'headers' | 'body' | 'redirects' | 'truncated'>;
  appOrigin: string;
  expected?: ExpectedWebinar;
  thankYou?: ThankYouProbe | null;
}): LandingReport {
  const { fetched, appOrigin } = args;
  const html = fetched.body;
  const checks: LandingCheck[] = [];
  const add = (c: LandingCheck) => checks.push(c);

  const ok = fetched.status >= 200 && fetched.status < 300;
  add(
    ok
      ? { id: 'reachable', label: 'Page loads', status: 'pass', detail: `Responded with ${fetched.status}.` }
      : { id: 'reachable', label: 'Page loads', status: 'fail', detail: `The page answered ${fetched.status}.`, fix: fetched.status === 404 ? 'Check the URL — the page does not exist.' : fetched.status === 401 || fetched.status === 403 ? 'The page is access-restricted. Publish it publicly so invitees can open it.' : 'Check that the page is published and public.' }
  );

  const final = new URL(fetched.finalUrl);
  const start = new URL(/^https?:/i.test(args.url) ? args.url : `https://${args.url}`);
  if (fetched.redirects.length > 0) {
    const loginLike = /login|signin|sign-in|auth|sso/i.test(final.pathname + final.hostname);
    add(
      loginLike
        ? { id: 'redirect', label: 'No redirect to a login page', status: 'fail', detail: `The link redirects to ${final.origin}${final.pathname}, which looks like a login page.`, fix: 'Make the landing page public.' }
        : { id: 'redirect', label: 'Redirects', status: 'warn', detail: `The link redirects ${fetched.redirects.length} time(s) to ${final.origin}${final.pathname}. Tracking parameters can be lost on redirect.`, fix: 'Use the final URL directly, or confirm your redirect keeps the query string.' }
    );
  }

  add(
    start.protocol === 'https:' && final.protocol === 'https:'
      ? { id: 'https', label: 'Secure (https)', status: 'pass', detail: 'The page is served over https.' }
      : { id: 'https', label: 'Secure (https)', status: 'warn', detail: 'The page is not served over https; browsers warn visitors and may block the form.', fix: 'Serve the landing page over https.' }
  );

  const title = /<title[^>]*>([^<]{0,200})<\/title>/i.exec(html)?.[1]?.replace(/\s+/g, ' ').trim() || null;
  const platform = detectPlatform(html, fetched.headers);
  const hasForm = /<form[\s>]/i.test(html) || /type=["']email["']/i.test(html);
  const hasSnippet = SNIPPET_MARKERS.some((m) => m.test(html));
  const pointsAtThisApp = appOrigin ? html.includes(appOrigin.replace(/\/$/, '')) : false;
  const hasLsqForm = platform === 'leadsquared' || /lsqleadfields|leadsquared\.com\/.*(form|lp)/i.test(html);

  if (hasSnippet) {
    add(
      pointsAtThisApp || !appOrigin
        ? { id: 'snippet', label: 'Studio registration script', status: 'pass', detail: 'The Webinar Studio script is installed and points at this Studio.' }
        : { id: 'snippet', label: 'Studio registration script', status: 'warn', detail: 'A Webinar Studio script is installed, but it points at a different Studio address.', fix: 'Copy the script again from this webinar and replace the old one.' }
    );
  } else if (hasLsqForm) {
    add({ id: 'snippet', label: 'Registration capture', status: 'warn', detail: 'A LeadSquared form was detected, but not the Webinar Studio script.', fix: 'Either add the Studio script, or use a LeadSquared automation that calls the Studio webhook when the form is submitted (see the webhook recipe).' });
  } else {
    add({ id: 'snippet', label: 'Registration capture', status: 'fail', detail: 'Neither the Webinar Studio script nor a LeadSquared form was found. Registrations on this page would not reach Webinar Studio.', fix: 'Paste the Studio script before </body> on the landing page, or connect the form through the LeadSquared webhook.' });
  }

  add(
    hasForm
      ? { id: 'form', label: 'Registration form', status: 'pass', detail: 'A form with an email field was found.' }
      : { id: 'form', label: 'Registration form', status: hasSnippet ? 'warn' : 'fail', detail: 'No <form> or email field is visible in the page source.', fix: 'If the form is rendered by JavaScript this check cannot see it; otherwise add a registration form with an email field.' }
  );

  // The native form carries a webinar's identity in hidden fields. When they were copied from another webinar, every
  // lead that comes in through the form's own post is filed under the wrong event.
  const hidden = hiddenInputs(html);
  const exp = args.expected;
  if (exp?.zoomId && hidden.mx_WebinarID !== undefined) {
    const same = hidden.mx_WebinarID.replace(/\D/g, '') === exp.zoomId.replace(/\D/g, '');
    add(
      same
        ? { id: 'form-webinar', label: 'Form webinar ID', status: 'pass', detail: "The form's hidden webinar ID matches this webinar's Zoom event." }
        : { id: 'form-webinar', label: 'Form webinar ID', status: 'warn', detail: `The form's hidden mx_WebinarID is ${hidden.mx_WebinarID || 'empty'}, but this webinar's Zoom event is ${exp.zoomId}.`, fix: `In the form, set the hidden mx_WebinarID field to ${exp.zoomId}.` }
    );
  }
  const formDate = /^(\d{4}-\d{2}-\d{2})/.exec(hidden.mx_Date_and_Time ?? '')?.[1];
  const webinarDate = exp?.scheduledAt ? calendarDate(exp.scheduledAt, exp.timezone || 'UTC') : null;
  if (formDate && webinarDate) {
    add(
      formDate === webinarDate
        ? { id: 'form-date', label: 'Form webinar date', status: 'pass', detail: "The form's hidden date matches this webinar." }
        : { id: 'form-date', label: 'Form webinar date', status: 'warn', detail: `The form's hidden mx_Date_and_Time says ${formDate}, but this webinar is on ${webinarDate}.`, fix: `In the form, set the hidden mx_Date_and_Time field to this webinar's date, or remove it.` }
    );
  }
  const redirect = formRedirectUrl(html, fetched.finalUrl);
  if (redirect && args.thankYou !== undefined) {
    const to = new URL(redirect);
    const sameSite = bareHost(to) === bareHost(final);
    const probe = args.thankYou;
    if (probe?.hasScript === true) {
      add({ id: 'thankyou', label: 'Thank-you page', status: 'pass', detail: `After sign-up people go to ${to.host}${to.pathname}, which has the Studio script, so the calendar pop-up opens.` });
    } else if (probe?.hasScript === false) {
      add({
        id: 'thankyou',
        label: 'Thank-you page',
        status: 'warn',
        detail: `After sign-up the form sends people to ${to.host}${to.pathname}, which does not have the Studio script, so there is no calendar pop-up.`,
        fix: sameSite
          ? 'Add the script to your site-wide custom code (Framer: Site Settings, Custom Code, End of body) so it runs on this page too.'
          : "Point the form's redirect (MXHRedirectUrl) at a thank-you page on your own site that has the script.",
      });
    } else {
      add({ id: 'thankyou', label: 'Thank-you page', status: 'warn', detail: `The form sends people to ${to.host}${to.pathname}, which could not be checked for the Studio script.`, fix: 'Make sure that page is public and has the script.' });
    }
  }

  const embeddable = ok && !frameBlocked(fetched.headers);
  add(
    embeddable
      ? { id: 'preview', label: 'Live preview', status: 'pass', detail: 'The page allows being shown in a preview.' }
      : { id: 'preview', label: 'Live preview', status: 'warn', detail: 'The page blocks embedding, so a live preview is not available. This does not affect registration.', fix: 'Open the page in a new tab to review it.' }
  );

  if (fetched.truncated) add({ id: 'size', label: 'Page size', status: 'warn', detail: 'The page is very large; only the first part was checked.' });

  const overall: CheckStatus = checks.some((c) => c.status === 'fail') ? 'fail' : checks.some((c) => c.status === 'warn') ? 'warn' : 'pass';
  return { url: args.url, finalUrl: fetched.finalUrl, status: fetched.status, title, platform, embeddable, checks, overall };
}

export function failureReport(url: string, message: string): LandingReport {
  return {
    url,
    finalUrl: null,
    status: null,
    title: null,
    platform: 'unknown',
    embeddable: false,
    overall: 'fail',
    checks: [{ id: 'reachable', label: 'Page loads', status: 'fail', detail: message, fix: 'Check the URL and that the page is public.' }],
  };
}

export async function hasStudioScript(url: string, fetchImpl?: typeof fetch): Promise<boolean | null> {
  try {
    const page = await safeFetchText(url, { fetchImpl });
    if (page.status < 200 || page.status >= 300) return null;
    return SNIPPET_MARKERS.some((m) => m.test(page.body));
  } catch {
    return null;
  }
}

export async function verifyLandingPage(url: string, appOrigin: string, fetchImpl?: typeof fetch, expected?: ExpectedWebinar): Promise<LandingReport> {
  try {
    const fetched = await safeFetchText(url, { fetchImpl });
    const redirect = formRedirectUrl(fetched.body, fetched.finalUrl);
    const sameAsPage = redirect !== null && redirect.replace(/\/$/, '') === fetched.finalUrl.replace(/\/$/, '');
    const thankYou = redirect ? { url: redirect, hasScript: sameAsPage ? SNIPPET_MARKERS.some((m) => m.test(fetched.body)) : await hasStudioScript(redirect, fetchImpl) } : undefined;
    return analyzeLandingPage({ url, fetched, appOrigin, expected, thankYou });
  } catch (err) {
    if (err instanceof UnsafeUrlError) return failureReport(url, err.message);
    const msg = err instanceof Error ? err.message : String(err);
    if (/aborted|timeout/i.test(msg)) return failureReport(url, 'The page took too long to respond (over 8 seconds).');
    return failureReport(url, `The page could not be reached (${msg.slice(0, 120)}).`);
  }
}
