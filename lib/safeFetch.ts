// Server-only. Fetching a URL an operator typed in (their landing page) without becoming an SSRF
// hole: only http/https, no credentials in the URL, hostnames that resolve to loopback / private /
// link-local / metadata addresses are refused (re-checked on EVERY redirect hop), a hard timeout, a
// byte cap, and a redirect cap. Local development can opt in to localhost with ALLOW_PRIVATE_FETCH=1.

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';
import { Agent } from 'undici';

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeUrlError';
  }
}

/** True for addresses a server should never fetch on a user's behalf. */
export function isPrivateAddress(ip: string): boolean {
  try { return ipaddr.process(ip).range() !== 'unicast'; } catch { return true; }
}

/** DNS is checked at the connection itself, so fetch cannot resolve a different private address. */
export function publicDispatcher(resolve: Resolver = defaultResolver): Agent {
  return new Agent({ connect: { lookup: (hostname, options, callback) => {
    const done = callback as (...args: unknown[]) => void;
    resolve(hostname).then(addresses => {
      if (!addresses.length || addresses.some(isPrivateAddress)) return done(new UnsafeUrlError('Private and local addresses cannot be fetched.'));
      const results = addresses.map(address => ({ address, family: isIP(address) }));
      if (options.all) done(null, results);
      else done(null, results[0].address, results[0].family);
    }, error => done(error));
  } } });
}

export type Resolver = (hostname: string) => Promise<string[]>;
const defaultResolver: Resolver = async (h) => (await lookup(h, { all: true })).map((r) => r.address);

/** Throws UnsafeUrlError unless `raw` is a public http(s) URL. */
export async function assertPublicUrl(raw: string, resolve: Resolver = defaultResolver): Promise<URL> {
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`);
  } catch {
    throw new UnsafeUrlError('That is not a valid URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new UnsafeUrlError('Only http and https links can be checked.');
  if (url.username || url.password) throw new UnsafeUrlError('Links with embedded credentials are not allowed.');
  if (process.env.ALLOW_PRIVATE_FETCH === '1') return url;

  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) {
    throw new UnsafeUrlError('Private and local addresses cannot be checked.');
  }
  const addresses = isIP(host) ? [host] : await resolve(host).catch(() => []);
  if (addresses.length === 0) throw new UnsafeUrlError('That address does not resolve.');
  if (addresses.some(isPrivateAddress)) throw new UnsafeUrlError('Private and local addresses cannot be checked.');
  return url;
}

export interface SafeFetchResult {
  finalUrl: string;
  status: number;
  headers: Headers;
  /** Up to `maxBytes` of the body, decoded as text. */
  body: string;
  truncated: boolean;
  redirects: string[];
}

export async function safeFetchText(
  raw: string,
  opts: { timeoutMs?: number; maxBytes?: number; maxRedirects?: number; resolve?: Resolver; fetchImpl?: typeof fetch } = {}
): Promise<SafeFetchResult> {
  const { timeoutMs = 8000, maxBytes = 1_000_000, maxRedirects = 4, resolve, fetchImpl = fetch } = opts;
  const redirects: string[] = [];
  let current = (await assertPublicUrl(raw, resolve)).toString();
  const dispatcher = process.env.ALLOW_PRIVATE_FETCH === '1' ? undefined : publicDispatcher(resolve);
  try {
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const res = await fetchImpl(current, {
      dispatcher,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': 'WebinarStudio-LinkCheck/1.0', accept: 'text/html,*/*;q=0.5' },
    } as RequestInit & { dispatcher?: Agent });

    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      const next = new URL(res.headers.get('location') as string, current).toString();
      redirects.push(next);
      await res.body?.cancel();
      current = (await assertPublicUrl(next, resolve)).toString(); // every hop is re-validated
      continue;
    }

    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    let truncated = false;
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          truncated = true;
          chunks.push(value.slice(0, value.byteLength - (total - maxBytes)));
          await reader.cancel().catch(() => undefined);
          break;
        }
        chunks.push(value);
      }
    }
    return { finalUrl: current, status: res.status, headers: res.headers, body: new TextDecoder().decode(Buffer.concat(chunks)), truncated, redirects };
  }
  throw new UnsafeUrlError(`Too many redirects (more than ${maxRedirects}).`);
  } finally { await dispatcher?.close(); }
}
