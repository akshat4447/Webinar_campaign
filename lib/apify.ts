// Real Apify integration — runs an Actor synchronously and reads back its
// dataset items. See https://docs.apify.com/api/v2/act-run-sync-get-dataset-items-post
//
// Which Actor to run is the account owner's call (cost, reliability and
// output shape all vary by Actor and by Apify plan), so it's a configurable
// field (Integrations → Apify → Actor ID) rather than hardcoded — this app
// has no way to know which Actors a given Apify account is subscribed to.
// DEFAULT_ACTOR_ID is Apify's own official Google Search Scraper: public,
// stable, and useful for ANY company name without needing a pre-existing
// LinkedIn URL, unlike most LinkedIn-specific company scrapers.
export const DEFAULT_ACTOR_ID = 'apify/google-search-scraper';

const APIFY_API_BASE = 'https://api.apify.com/v2';
const RUN_TIMEOUT_MS = 60_000; // stay well under Apify's 300s sync-call ceiling

export class ApifyError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = 'ApifyError';
  }
}

/**
 * Runs any Apify Actor synchronously and returns its default dataset's items.
 * `input` is passed through verbatim — its shape is whatever the configured
 * Actor's own input schema expects, which this module has no way to know
 * ahead of time.
 */
export async function runApifyActor<T = unknown>(actorId: string, input: Record<string, unknown>, apiToken: string): Promise<T[]> {
  if (!apiToken) throw new ApifyError('No Apify API token configured — save one on Integrations → Apify.');
  if (!actorId) throw new ApifyError('No Apify Actor ID configured — set one on Integrations → Apify.');

  const url = `${APIFY_API_BASE}/acts/${encodeURIComponent(actorId)}/run-sync-get-dataset-items?token=${encodeURIComponent(apiToken)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RUN_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      cache: 'no-store',
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new ApifyError(`Apify Actor "${actorId}" run failed: ${res.status} ${text.slice(0, 300)}`, res.status);
    const json = text ? JSON.parse(text) : [];
    return Array.isArray(json) ? (json as T[]) : [];
  } catch (err) {
    if (err instanceof ApifyError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ApifyError(`Apify Actor "${actorId}" did not finish within ${RUN_TIMEOUT_MS / 1000}s.`);
    }
    throw new ApifyError(`Apify Actor "${actorId}" run threw: ${String(err instanceof Error ? err.message : err).slice(0, 200)}`);
  } finally {
    clearTimeout(timeout);
  }
}

export interface CompanyWebContext {
  title: string;
  url: string;
  description: string;
}

/**
 * Best-effort extraction across the handful of key names different search-
 * scraper Actors actually use for the same concept (title/url/description),
 * since the configured Actor might not be DEFAULT_ACTOR_ID.
 */
function firstString(obj: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

/**
 * Real web context for a company name — one Apify Actor run (Google Search
 * Scraper by default), returning the top organic result. Used to ground
 * Claude's enrichment in an actual, live signal instead of inferring purely
 * from the sparse fields already on file.
 */
export async function searchCompanyWeb(companyName: string, apiToken: string, actorId: string): Promise<CompanyWebContext | null> {
  if (!companyName.trim()) return null;

  const items = await runApifyActor<Record<string, unknown>>(
    actorId,
    {
      queries: `${companyName} company`,
      resultsPerPage: 3,
      maxPagesPerQuery: 1,
      languageCode: 'en',
    },
    apiToken
  );
  if (items.length === 0) return null;

  // apify/google-search-scraper's own shape: one item per query, holding an
  // organicResults array. A different configured Actor might instead return
  // one flat item per result — handle both without assuming which.
  const first = items[0];
  const nested = Array.isArray(first?.organicResults) ? (first.organicResults as Record<string, unknown>[]) : null;
  const candidate = nested?.[0] ?? first;
  if (!candidate) return null;

  const url = firstString(candidate, ['url', 'link']);
  const title = firstString(candidate, ['title', 'name']);
  const description = firstString(candidate, ['description', 'snippet', 'text']);
  if (!url && !description) return null;

  return { title, url, description };
}
