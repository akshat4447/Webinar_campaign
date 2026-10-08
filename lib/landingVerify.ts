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

export function analyzeLandingPage(args: {
  url: string;
  fetched: Pick<SafeFetchResult, 'finalUrl' | 'status' | 'headers' | 'body' | 'redirects' | 'truncated'>;
  appOrigin: string;
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

export async function verifyLandingPage(url: string, appOrigin: string, fetchImpl?: typeof fetch): Promise<LandingReport> {
  try {
    const fetched = await safeFetchText(url, { fetchImpl });
    return analyzeLandingPage({ url, fetched, appOrigin });
  } catch (err) {
    if (err instanceof UnsafeUrlError) return failureReport(url, err.message);
    const msg = err instanceof Error ? err.message : String(err);
    if (/aborted|timeout/i.test(msg)) return failureReport(url, 'The page took too long to respond (over 8 seconds).');
    return failureReport(url, `The page could not be reached (${msg.slice(0, 120)}).`);
  }
}
