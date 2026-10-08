import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const config = new Map<string, string>();
vi.mock('@/lib/integrationConfig', () => ({
  resolveIntegrationField: vi.fn(async (_id: string, key: string) => config.get(key)),
  saveIntegrationConfig: vi.fn(async (_id: string, fields: Record<string, string>) => {
    for (const [k, v] of Object.entries(fields)) config.set(k, v);
  }),
}));

let tokenCounter = 0;
const getServerToServerToken = vi.fn(async () => ({ accessToken: `token-${++tokenCounter}`, expiresInSec: 3600 }));
vi.mock('./auth', () => ({
  ZOOM_TOKEN_URL: 'https://zoom.us/oauth/token',
  ZOOM_API_BASE_URL: 'https://api.zoom.us/v2',
  getServerToServerToken: (...a: unknown[]) => (getServerToServerToken as (...x: unknown[]) => unknown)(...a),
}));
vi.mock('@/lib/retry', async (orig) => ({ ...(await orig<typeof import('@/lib/retry')>()), sleep: vi.fn(async () => undefined) }));

import { zoomRequest } from './client';

const json = (status: number, body: unknown = {}, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

describe('zoomRequest token lifecycle', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    config.clear();
    tokenCounter = 0;
    getServerToServerToken.mockClear();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    config.set('accountId', 'acct');
    config.set('clientId', 'cid');
    config.set('clientSecret', 'csecret');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('bootstraps a first Server-to-Server token when none has been fetched yet', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { ok: 1 }));
    await zoomRequest('/users/me');
    expect(getServerToServerToken).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer token-1' });
  });

  // Regression: the in-flight refresh promise was never cleared on the
  // Server-to-Server path, so the SECOND expiry returned the first refresh's
  // (already dead) token forever.
  it('refreshes again on a later 401 instead of reusing the first refreshed token', async () => {
    config.set('accessToken', 'token-0');
    config.set('tokenExpiresAt', new Date(Date.now() + 3_600_000).toISOString());

    fetchMock.mockResolvedValueOnce(json(401)).mockResolvedValueOnce(json(200, { n: 1 }));
    await zoomRequest('/a');
    expect(config.get('accessToken')).toBe('token-1');

    // an hour later the refreshed token has expired too
    fetchMock.mockResolvedValueOnce(json(401)).mockResolvedValueOnce(json(200, { n: 2 }));
    await zoomRequest('/b');

    expect(getServerToServerToken).toHaveBeenCalledTimes(2);
    expect(config.get('accessToken')).toBe('token-2');
    const lastAuth = (fetchMock.mock.calls[3][1] as RequestInit).headers as Record<string, string>;
    expect(lastAuth.Authorization).toBe('Bearer token-2');
  });

  it('shares one refresh among concurrent 401s (single-flight)', async () => {
    config.set('accessToken', 'stale');
    config.set('tokenExpiresAt', new Date(Date.now() + 3_600_000).toISOString());
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const auth = (init.headers as Record<string, string>).Authorization;
      return auth === 'Bearer stale' ? json(401) : json(200, { ok: true });
    });
    await Promise.all([zoomRequest('/a'), zoomRequest('/b'), zoomRequest('/c')]);
    expect(getServerToServerToken).toHaveBeenCalledTimes(1);
  });

  it('refreshes ahead of a token that is about to expire', async () => {
    config.set('accessToken', 'about-to-expire');
    config.set('tokenExpiresAt', new Date(Date.now() + 10_000).toISOString());
    fetchMock.mockResolvedValueOnce(json(200, {}));
    await zoomRequest('/x');
    expect(getServerToServerToken).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer token-1' });
  });

  it('retries a 429 honouring Retry-After, even for POST (the request was not processed)', async () => {
    config.set('accessToken', 't');
    config.set('tokenExpiresAt', new Date(Date.now() + 3_600_000).toISOString());
    fetchMock.mockResolvedValueOnce(json(429, {}, { 'retry-after': '1' })).mockResolvedValueOnce(json(201, { id: 1 }));
    await expect(zoomRequest('/webinars/1/registrants', { method: 'POST', body: '{}' })).resolves.toEqual({ id: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries a 503 for GET but never replays a POST that may have been processed', async () => {
    config.set('accessToken', 't');
    config.set('tokenExpiresAt', new Date(Date.now() + 3_600_000).toISOString());

    fetchMock.mockResolvedValueOnce(json(503)).mockResolvedValueOnce(json(200, { ok: true }));
    await expect(zoomRequest('/g')).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fetchMock.mockClear();
    fetchMock.mockResolvedValueOnce(json(503, 'down'));
    await expect(zoomRequest('/p', { method: 'POST', body: '{}' })).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('gives up with a ZoomError after exhausting retries', async () => {
    config.set('accessToken', 't');
    config.set('tokenExpiresAt', new Date(Date.now() + 3_600_000).toISOString());
    fetchMock.mockResolvedValue(json(500, 'boom'));
    await expect(zoomRequest('/g')).rejects.toMatchObject({ name: 'ZoomError', status: 500 });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
