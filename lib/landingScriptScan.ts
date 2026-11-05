// Server-only. Finds the Webinar Studio script on a landing page, including a copy that lives inside the page builder's own
// JavaScript files, and reads out which Studio address and which webinar it is set up for.
//
// The page's HTML alone is not enough: a script pasted into Framer's custom code is in the HTML, but one built into a component
// is only in the bundled .mjs files the page loads, and the address it sends to can be a value saved on the component instance,
// not in the script text at all. Looking only at the HTML reported such a page as having no script, and could never notice that
// it sent registrations to an address that no longer exists.

import { safeFetchText, type SafeFetchResult, type Resolver } from '@/lib/safeFetch';

export interface ScriptScan {
  /** The Studio script (or a form-submit call to /api/landing/submit) was found somewhere the page loads. */
  found: boolean;
  /** Every Studio address the page is set to send registrations to, as origins. */
  origins: string[];
  /** Every webinar id the page is set up for. */
  campaignIds: string[];
  /** How many of the page's script files were read. */
  assetsRead: number;
}

const MARKERS = [/Webinar Studio \+ LeadSquared \+ Zoom Seamless Registration/i, /\/api\/landing\/submit/i];
// apiOrigin: "https://studio.example.com" in the script text, or apiOrigin:`https://...` as a component's saved property. The value
// must follow the colon directly: a property's definition (apiOrigin:{title:..., defaultValue:...}) is not a value in use.
const API_ORIGIN = /\bapiOrigin\s*:\s*(["'`])(https?:\/\/[^"'`\s]+)\1/g;
// A hand-written call, fetch("https://studio.example.com/api/landing/submit"): the address is the part before the path.
const SUBMIT_URL = /(https?:\/\/[^"'`\s\\]+?)\/api\/landing\/submit/gi;
const CAMPAIGN_IN_SCRIPT = /webinar_attribution_['"]\s*\+\s*(["'`])([A-Za-z0-9_-]{8,64})\1/g;
const CAMPAIGN_PROP = /\bcampaignId\s*:\s*(["'`])([A-Za-z0-9_-]{8,64})\1/g;

/** Hosts whose script files are read besides the page's own: where page builders keep what they publish. */
const ASSET_HOSTS = /(^|\.)(framerusercontent\.com)$/i;
export const MAX_ASSETS = 16;
const MAX_ASSET_BYTES = 2_000_000;

const normalizeOrigin = (raw: string): string | null => {
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
};

/** What one piece of text (a page, or one script file) says. Pure. */
export function scanText(text: string): { found: boolean; origins: string[]; campaignIds: string[] } {
  const origins = new Set<string>();
  const campaignIds = new Set<string>();
  for (const m of text.matchAll(API_ORIGIN)) {
    const o = normalizeOrigin(m[2]);
    if (o) origins.add(o);
  }
  for (const m of text.matchAll(SUBMIT_URL)) {
    const o = normalizeOrigin(m[1]);
    if (o) origins.add(o);
  }
  for (const m of text.matchAll(CAMPAIGN_IN_SCRIPT)) campaignIds.add(m[2]);
  for (const m of text.matchAll(CAMPAIGN_PROP)) campaignIds.add(m[2]);
  return { found: MARKERS.some((m) => m.test(text)), origins: [...origins], campaignIds: [...campaignIds] };
}

/** The script files a page loads that are worth reading: its own, and the page builder's published ones. Pure. */
export function assetUrls(html: string, pageUrl: string): string[] {
  let base: URL;
  try {
    base = new URL(pageUrl);
  } catch {
    return [];
  }
  const found = new Set<string>();
  const candidates = [
    ...[...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]),
    ...[...html.matchAll(/<link\b[^>]*\brel\s*=\s*["'](?:modulepreload|preload)["'][^>]*\bhref\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]),
    ...[...html.matchAll(/<link\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*\brel\s*=\s*["'](?:modulepreload|preload)["']/gi)].map((m) => m[1]),
  ];
  for (const raw of candidates) {
    let u: URL;
    try {
      u = new URL(raw.replace(/&amp;/g, '&'), base);
    } catch {
      continue;
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') continue;
    if (!/\.(m?js)$/i.test(u.pathname)) continue;
    if (u.hostname !== base.hostname && !ASSET_HOSTS.test(u.hostname)) continue;
    u.hash = '';
    found.add(u.toString());
    if (found.size >= MAX_ASSETS) break;
  }
  return [...found];
}

/** Reads the page and the script files it loads. A file that cannot be read is skipped: the scan says what it could see. */
export async function scanPageForStudioScript(
  page: Pick<SafeFetchResult, 'finalUrl' | 'body'>,
  opts: { fetchImpl?: typeof fetch; resolve?: Resolver } = {},
): Promise<ScriptScan> {
  const parts = [scanText(page.body)];
  const urls = assetUrls(page.body, page.finalUrl);
  const settled = await Promise.allSettled(
    urls.map((u) => safeFetchText(u, { fetchImpl: opts.fetchImpl, resolve: opts.resolve, timeoutMs: 6000, maxBytes: MAX_ASSET_BYTES })),
  );
  let assetsRead = 0;
  for (const s of settled) {
    if (s.status !== 'fulfilled' || s.value.status < 200 || s.value.status >= 300) continue;
    assetsRead++;
    parts.push(scanText(s.value.body));
  }
  return {
    found: parts.some((p) => p.found),
    origins: [...new Set(parts.flatMap((p) => p.origins))],
    campaignIds: [...new Set(parts.flatMap((p) => p.campaignIds))],
    assetsRead,
  };
}

/** True when two addresses are the same place: scheme, host and port, ignoring case and a trailing slash. */
export function sameOrigin(a: string, b: string): boolean {
  const x = normalizeOrigin(a);
  const y = normalizeOrigin(b);
  return Boolean(x && y && x === y);
}
