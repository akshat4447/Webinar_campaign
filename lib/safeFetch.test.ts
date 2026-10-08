import { describe, it, expect, vi } from 'vitest';
import { assertPublicUrl, isPrivateAddress, safeFetchText, UnsafeUrlError, type Resolver } from './safeFetch';

const publicResolver: Resolver = async () => ['93.184.216.34'];

describe('isPrivateAddress', () => {
  it('flags loopback, private, link-local, CGNAT, metadata and multicast IPv4', () => {
    for (const ip of ['127.0.0.1', '10.0.0.5', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1']) expect(isPrivateAddress(ip), ip).toBe(true);
  });
  it('allows ordinary public IPv4 including the edges just outside private ranges', () => {
    for (const ip of ['8.8.8.8', '93.184.216.34', '172.15.0.1', '172.32.0.1', '11.0.0.1', '100.63.0.1']) expect(isPrivateAddress(ip), ip).toBe(false);
  });
  it('handles IPv6 loopback, unique-local, link-local and IPv4-mapped addresses', () => {
    for (const ip of ['::1', '::', 'fe80::1', 'fc00::1', 'fd12::1', '::ffff:127.0.0.1', '::ffff:10.1.1.1']) expect(isPrivateAddress(ip), ip).toBe(true);
    expect(isPrivateAddress('2606:4700:4700::1111')).toBe(false);
    expect(isPrivateAddress('::ffff:8.8.8.8')).toBe(false);
  });
  it('treats a non-IP string as unsafe', () => expect(isPrivateAddress('example.com')).toBe(true));
});

describe('assertPublicUrl', () => {
  it('accepts a public https URL and adds https to a bare host', async () => {
    expect((await assertPublicUrl('https://webinar.example.com/x', publicResolver)).hostname).toBe('webinar.example.com');
    expect((await assertPublicUrl('webinar.example.com/x', publicResolver)).protocol).toBe('https:');
  });
  it('rejects non-http schemes, credentials and garbage', async () => {
    await expect(assertPublicUrl('ftp://example.com', publicResolver)).rejects.toThrow(/http/);
    await expect(assertPublicUrl('file:///etc/passwd', publicResolver)).rejects.toThrow(UnsafeUrlError);
    await expect(assertPublicUrl('javascript:alert(1)', publicResolver)).rejects.toThrow(UnsafeUrlError);
    await expect(assertPublicUrl('https://user:pw@example.com', publicResolver)).rejects.toThrow(/credentials/);
    await expect(assertPublicUrl('http://', publicResolver)).rejects.toThrow(UnsafeUrlError);
  });
  it('rejects localhost, internal names and literal private IPs without even resolving', async () => {
    const never: Resolver = async () => { throw new Error('should not resolve'); };
    for (const u of ['http://localhost:3000', 'http://127.0.0.1', 'http://[::1]/', 'http://169.254.169.254/latest/meta-data', 'http://db.internal', 'http://printer.local', 'http://10.0.0.1']) {
      await expect(assertPublicUrl(u, never), u).rejects.toThrow(UnsafeUrlError);
    }
  });
  it('rejects a public-looking hostname that RESOLVES to a private address (DNS rebinding style)', async () => {
    await expect(assertPublicUrl('https://evil.example.com', async () => ['10.0.0.9'])).rejects.toThrow(/Private/);
    await expect(assertPublicUrl('https://mixed.example.com', async () => ['8.8.8.8', '127.0.0.1'])).rejects.toThrow(/Private/);
  });
  it('rejects an address that does not resolve', async () => {
    await expect(assertPublicUrl('https://nope.example.com', async () => [])).rejects.toThrow(/resolve/);
  });
  it('lets local development opt in to private hosts', async () => {
    process.env.ALLOW_PRIVATE_FETCH = '1';
    try {
      expect((await assertPublicUrl('http://localhost:3000')).hostname).toBe('localhost');
    } finally {
      delete process.env.ALLOW_PRIVATE_FETCH;
    }
  });
});

const res = (body: string, init: ResponseInit = {}) => new Response(body, { status: 200, ...init });

describe('safeFetchText', () => {
  it('returns the body, final URL and status', async () => {
    const fetchImpl = vi.fn(async () => res('<html>hi</html>', { headers: { 'content-type': 'text/html' } }));
    const r = await safeFetchText('https://example.com/p', { resolve: publicResolver, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(r).toMatchObject({ status: 200, finalUrl: 'https://example.com/p', body: '<html>hi</html>', truncated: false, redirects: [] });
  });

  it('follows redirects and re-validates EVERY hop (a redirect into the private network is refused)', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://cdn.example.com/landing' } }))
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } }));
    await expect(safeFetchText('https://example.com/p', { resolve: publicResolver, fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toThrow(UnsafeUrlError);
    expect(fetchImpl).toHaveBeenCalledTimes(2); // the metadata URL was never requested
  });

  it('resolves relative redirects and records them', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: '/final' } })).mockResolvedValueOnce(res('ok'));
    const r = await safeFetchText('https://example.com/start', { resolve: publicResolver, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(r.finalUrl).toBe('https://example.com/final');
    expect(r.redirects).toEqual(['https://example.com/final']);
  });

  it('gives up after too many redirects (loop protection)', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://example.com/loop' } }));
    await expect(safeFetchText('https://example.com/loop', { resolve: publicResolver, maxRedirects: 3, fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toThrow(/redirects/);
  });

  it('caps the body size and says so', async () => {
    const fetchImpl = vi.fn(async () => res('x'.repeat(5000)));
    const r = await safeFetchText('https://example.com', { resolve: publicResolver, maxBytes: 1000, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(r.body).toHaveLength(1000);
    expect(r.truncated).toBe(true);
  });

  it('passes a timeout signal and a polite user agent', async () => {
    const fetchImpl = vi.fn(async (_u: string, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      expect((init?.headers as Record<string, string>)['user-agent']).toMatch(/WebinarStudio/);
      return res('ok');
    });
    await safeFetchText('https://example.com', { resolve: publicResolver, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(fetchImpl).toHaveBeenCalled();
  });

  it('does not follow a redirect without a Location header', async () => {
    const fetchImpl = vi.fn(async () => new Response('moved', { status: 302 }));
    const r = await safeFetchText('https://example.com', { resolve: publicResolver, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(r.status).toBe(302);
  });
});
