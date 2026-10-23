import { describe, it, expect, vi } from 'vitest';
import { effectiveZoomRedirectUri, isLoopbackOrigin, zoomCallbackUrl, zoomRedirectProblem } from './redirect';
import { describeTokenRenewalFailure } from './client';

describe('effectiveZoomRedirectUri', () => {
  it('uses this server when nothing is saved, and a saved address when there is one', () => {
    expect(effectiveZoomRedirectUri(undefined, 'http://localhost:3000')).toBe('http://localhost:3000/api/auth/zoom/callback');
    expect(effectiveZoomRedirectUri('  ', 'http://localhost:3000/')).toBe('http://localhost:3000/api/auth/zoom/callback');
    expect(effectiveZoomRedirectUri('https://app.example.com/api/auth/zoom/callback', 'http://localhost:3000')).toBe('https://app.example.com/api/auth/zoom/callback');
  });
  it('ignores a value that points at zoom.us itself', () => {
    expect(effectiveZoomRedirectUri('https://zoom.us/oauth/callback', 'https://app.example.com')).toBe('https://app.example.com/api/auth/zoom/callback');
  });
  it('builds the callback from any origin without doubling slashes', () => {
    expect(zoomCallbackUrl('https://app.example.com///')).toBe('https://app.example.com/api/auth/zoom/callback');
  });
});

describe('zoomRedirectProblem', () => {
  const here = 'http://localhost:3000';
  it('accepts an address on this server without asking the network', async () => {
    const probe = vi.fn();
    expect(await zoomRedirectProblem('http://localhost:3000/api/auth/zoom/callback', here, probe as unknown as typeof fetch)).toBeNull();
    expect(probe).not.toHaveBeenCalled();
  });
  it('accepts another address that answers', async () => {
    const probe = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
    expect(await zoomRedirectProblem('https://live.example.com/api/auth/zoom/callback', here, probe as unknown as typeof fetch)).toBeNull();
    expect(probe).toHaveBeenCalledWith('https://live.example.com/api/health', expect.anything());
  });
  it.each([
    ['does not resolve', async () => { throw new TypeError('fetch failed'); }],
    ['answers with an error page (a closed tunnel)', async () => new Response('Tunnel not found', { status: 530 })],
    ['answers 404 (not this app)', async () => new Response('no', { status: 404 })],
  ])('refuses an address that %s, and says what to do', async (_label, behaviour) => {
    const msg = await zoomRedirectProblem('https://old-tunnel.trycloudflare.com/api/auth/zoom/callback', here, behaviour as unknown as typeof fetch);
    expect(msg).toMatch(/does not answer/);
    expect(msg).toContain('https://old-tunnel.trycloudflare.com');
    expect(msg).toContain('http://localhost:3000/api/auth/zoom/callback');
    expect(msg).toMatch(/clear the Redirect URI/);
  });
  it('refuses an address that is not a URL', async () => {
    expect(await zoomRedirectProblem('not a url', here)).toMatch(/not a valid address/);
  });
});

describe('describeTokenRenewalFailure', () => {
  it('tells a refused refresh token apart from wrong app credentials and from an outage', () => {
    expect(describeTokenRenewalFailure(400, { reason: 'Invalid Token!', error: 'invalid_request' })).toMatch(/Connect With Zoom.*authorize again/);
    expect(describeTokenRenewalFailure(400, { error: 'invalid_grant' })).toMatch(/revoked|replaced|unused/);
    expect(describeTokenRenewalFailure(401, { error: 'invalid_client', reason: 'Invalid client_id or client_secret' })).toMatch(/Client ID or Client Secret/);
    expect(describeTokenRenewalFailure(503, {})).toMatch(/would not renew/);
  });
});

describe('isLoopbackOrigin', () => {
  it.each(['http://localhost:3000', 'http://127.0.0.1:3101', 'http://[::1]:3000', 'http://app.localhost:3000'])('%s is this machine only', (o) => expect(isLoopbackOrigin(o)).toBe(true));
  it.each(['https://webinar-studio.onrender.com', 'https://abc.trycloudflare.com', 'http://192.168.0.4:3000', 'not a url'])('%s is not', (o) => expect(isLoopbackOrigin(o)).toBe(false));
});

import { zoomConnectHop } from './redirect';

describe('zoomConnectHop', () => {
  const tunnel = 'https://abc.trycloudflare.com/api/auth/zoom/callback';

  it('sends the person to the redirect address, keeping where they were going', () => {
    const hop = zoomConnectHop(tunnel, 'http://localhost:3000', 'http://localhost:3000/api/auth/zoom/connect?returnTo=%2Fcampaigns%2Fnew%3Fid%3Dc1');
    const url = new URL(hop!);
    expect(url.origin).toBe('https://abc.trycloudflare.com');
    expect(url.pathname).toBe('/api/auth/zoom/connect');
    expect(url.searchParams.get('returnTo')).toBe('/campaigns/new?id=c1');
    expect(url.searchParams.get('hop')).toBe('1');
  });

  it('does nothing when they are already on that address', () => {
    expect(zoomConnectHop(tunnel, 'https://abc.trycloudflare.com', 'https://abc.trycloudflare.com/api/auth/zoom/connect')).toBeNull();
  });

  it('never sends them across twice, so a proxy that misreports its address cannot loop', () => {
    expect(zoomConnectHop(tunnel, 'http://localhost:3000', 'http://localhost:3000/api/auth/zoom/connect?hop=1')).toBeNull();
  });

  it('does nothing for an address that is not valid', () => {
    expect(zoomConnectHop('not a url', 'http://localhost:3000', 'http://localhost:3000/api/auth/zoom/connect')).toBeNull();
  });
});
