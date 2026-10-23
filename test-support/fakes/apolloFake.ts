// A local fake of the parts of Apollo's REST API this app uses, so enrichment can be exercised over real HTTP
// with the failure modes that matter and no Apollo account or credits.
//
// Shapes follow Apollo's public documentation (docs.apollo.io): People Enrichment (POST /people/match),
// Bulk People Enrichment (POST /people/bulk_match, at most 10 people), the rate-limit headers and the 429
// `retry-after`, and phone numbers living under `person.contact.phone_numbers`. Anything the docs leave open
// (whether bulk results keep input order, whether a locked email is a placeholder) is a switch here, so the app
// is tested against the pessimistic reading rather than the convenient one.
//
// Point the app at it with APOLLO_API_BASE_URL=<fake.apiUrl> (read when lib/apolloVerify.ts makes a request).

import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FakeApolloPerson {
  first_name: string;
  last_name: string;
  organization: string;
  /** The employer's web domain, for `domain` matching. */
  domain?: string;
  title?: string;
  email?: string | null;
  email_status?: string;
  linkedin_url?: string;
  phone_numbers?: Array<{ raw_number: string; sanitized_number: string }>;
  /** The email exists but is not unlocked: Apollo answers with a placeholder address instead of a real one. */
  locked?: boolean;
  match_confidence?: 'high' | 'medium' | 'low';
}

export interface FakeApolloOptions {
  port?: number;
  /** Keys that are accepted. Default: ['test-key']. Anything else answers 401. */
  keys?: string[];
  /** Keys that authenticate but are refused on enrichment (the plan or key type lacks access). Answer 403. */
  forbiddenKeys?: string[];
  /** Requests allowed per rolling window (a minute unless `windowMs` says otherwise) across both enrichment endpoints. 0 / omitted = unlimited. */
  perMinute?: number;
  /** Length of the rolling window. Default 60000; tests shorten it so a real wait stays short. */
  windowMs?: number;
  /** Requests allowed in total before every further request is 429 (a daily cap). */
  total?: number;
  /** Retry-After seconds sent with a 429. Default: the time until the oldest request leaves the window. */
  retryAfterSec?: number;
  /** Bulk matches come back in a different order from the request (the docs do not promise input order). */
  shuffleBulk?: boolean;
  latencyMs?: number;
}

export interface FakeApollo {
  url: string;
  /** Base URL to give the app, ending in /api/v1. */
  apiUrl: string;
  seed(person: FakeApolloPerson): void;
  requests: Array<{ path: string; query: Record<string, string>; body: unknown; status: number; at: number; apiKey: string | null }>;
  throttled: number;
  setOptions(o: Partial<FakeApolloOptions>): void;
  reset(): void;
  stop(): Promise<void>;
}

const norm = (v: unknown) => String(v ?? '').trim().toLowerCase();

export async function startFakeApollo(initial: FakeApolloOptions = {}): Promise<FakeApollo> {
  let opts: FakeApolloOptions = { keys: ['test-key'], ...initial };
  const people: FakeApolloPerson[] = [];
  const requests: FakeApollo['requests'] = [];
  let window: number[] = [];
  let served = 0;
  let throttled = 0;

  function find(d: Record<string, unknown>): FakeApolloPerson | null {
    const first = norm(d.first_name ?? String(d.name ?? '').split(/\s+/)[0]);
    const last = norm(d.last_name ?? String(d.name ?? '').split(/\s+/).slice(1).join(' '));
    const org = norm(d.organization_name);
    const domain = norm(d.domain);
    const linkedin = norm(d.linkedin_url);
    const email = norm(d.email);
    return (
      people.find((p) => {
        if (linkedin && norm(p.linkedin_url) === linkedin) return true;
        if (email && norm(p.email) === email) return true;
        if (!first || norm(p.first_name) !== first) return false;
        if (last && norm(p.last_name) !== last) return false;
        if (domain && p.domain) return norm(p.domain) === domain;
        if (org) return norm(p.organization) === org || norm(p.organization).includes(org) || org.includes(norm(p.organization));
        return false;
      }) ?? null
    );
  }

  function personJson(p: FakeApolloPerson, reveal: boolean) {
    const email = p.locked ? `email_not_unlocked@${p.domain ?? 'domain.com'}` : p.email ?? null;
    return {
      id: `apollo_${norm(p.first_name)}_${norm(p.last_name)}`,
      first_name: p.first_name,
      last_name: p.last_name,
      name: `${p.first_name} ${p.last_name}`,
      title: p.title,
      linkedin_url: p.linkedin_url,
      email,
      email_status: p.locked ? 'unavailable' : p.email_status ?? (p.email ? 'verified' : undefined),
      match_confidence: p.match_confidence ?? 'high',
      organization: { name: p.organization },
      // Per the docs, phone numbers live under person.contact. They are only present once revealed.
      contact: { phone_numbers: reveal ? (p.phone_numbers ?? []) : (p.phone_numbers ?? []) },
    };
  }
  const noMatch = { id: null, match_confidence: 'none' };

  function rateCheck(res: http.ServerResponse): boolean {
    const now = Date.now();
    const windowMs = opts.windowMs ?? 60_000;
    window = window.filter((t) => now - t < windowMs);
    const overTotal = opts.total !== undefined && served >= opts.total;
    if (overTotal || (opts.perMinute && window.length >= opts.perMinute)) {
      throttled++;
      const untilFree = window.length ? Math.max(1, Math.ceil((window[0] + windowMs - now) / 1000)) : 1;
      res.writeHead(429, { 'content-type': 'application/json', 'retry-after': String(opts.retryAfterSec ?? untilFree) });
      res.end(JSON.stringify({ error: 'API rate limit exceeded' }));
      return false;
    }
    window.push(now);
    served++;
    return true;
  }

  async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://x');
    const query: Record<string, string> = Object.fromEntries(url.searchParams);
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    let body: unknown = null;
    try {
      body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
    } catch {
      body = null;
    }
    const apiKey = (req.headers['x-api-key'] as string | undefined) ?? null;
    const log = (status: number) => requests.push({ path: url.pathname, query, body, status, at: Date.now(), apiKey });
    const send = (status: number, payload: unknown, headers: Record<string, string> = {}) => {
      log(status);
      res.writeHead(status, { 'content-type': 'application/json', ...headers });
      res.end(JSON.stringify(payload));
    };

    if (opts.latencyMs) await new Promise((r) => setTimeout(r, opts.latencyMs));
    const path = url.pathname.replace(/^\/api\/v1/, '');

    if (path === '/auth/health') {
      const ok = !!apiKey && (opts.keys ?? []).includes(apiKey);
      return send(ok ? 200 : 401, { healthy: true, is_logged_in: ok });
    }
    if (!apiKey || !((opts.keys ?? []).includes(apiKey) || (opts.forbiddenKeys ?? []).includes(apiKey))) {
      return send(401, { error: 'Invalid access credentials.' });
    }
    if ((opts.forbiddenKeys ?? []).includes(apiKey)) {
      return send(403, { error: 'This endpoint is not available to your API key or plan.' });
    }
    if (path !== '/people/match' && path !== '/people/bulk_match') return send(404, { error: 'Not found' });
    if (req.method !== 'POST') return send(405, { error: 'Method not allowed' });
    if (!rateCheck(res)) {
      log(429);
      return;
    }

    const merged = { ...query, ...(body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {}) } as Record<string, unknown>;
    const reveal = String(merged.reveal_personal_emails) === 'true' || merged.reveal_personal_emails === true;
    if (String(merged.reveal_phone_number) === 'true' && !merged.webhook_url) {
      return send(422, { error: 'SEARCH.VALIDATION.WEBHOOK_URL_REQUIRED' });
    }

    if (path === '/people/match') {
      const p = find(merged);
      return send(200, { person: p ? personJson(p, reveal) : noMatch });
    }

    const details = (body as { details?: unknown } | null)?.details;
    if (!Array.isArray(details)) return send(400, { error: 'details is required' });
    if (details.length > 10) return send(422, { error: 'You can enrich up to 10 people per request.' });
    const found = details.map((d) => {
      const p = find({ ...(d as Record<string, unknown>) });
      return p ? personJson(p, reveal) : null;
    });
    const matches = opts.shuffleBulk ? [...found].reverse() : found;
    return send(200, {
      status: 'success',
      total_requested_enrichments: details.length,
      unique_enriched_records: found.filter(Boolean).length,
      missing_records: found.filter((m) => !m).length,
      credits_consumed: found.filter(Boolean).length,
      matches,
    });
  }

  const server = http.createServer((req, res) => {
    void handle(req, res).catch(() => {
      res.writeHead(500);
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(opts.port ?? 0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    url: `http://127.0.0.1:${port}`,
    apiUrl: `http://127.0.0.1:${port}/api/v1`,
    seed: (p) => void people.push(p),
    requests,
    get throttled() {
      return throttled;
    },
    setOptions: (o) => {
      opts = { ...opts, ...o };
    },
    reset: () => {
      people.length = 0;
      requests.length = 0;
      window = [];
      served = 0;
      throttled = 0;
      opts = { keys: ['test-key'], ...initial };
    },
    stop: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
