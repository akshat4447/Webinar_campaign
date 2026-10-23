import { describe, it, expect } from 'vitest';
import { authConfig, createSessionToken, credentialsMatch, isPublicPath, safeNextPath, verifySessionToken, SESSION_TTL_SEC } from './auth';

const env = { APP_USERNAME: 'User1', APP_PASSWORD: 'a-test-password', REGISTRATION_SECRET: 'x'.repeat(40) };
const cfg = authConfig(env);
const NOW = 1_800_000_000_000;

describe('authConfig', () => {
  it('is configured only when both the username and the password are set', () => {
    expect(authConfig(env).configured).toBe(true);
    expect(authConfig({ ...env, APP_PASSWORD: '' }).configured).toBe(false);
    expect(authConfig({ ...env, APP_USERNAME: '  ' }).configured).toBe(false);
    expect(authConfig({}).configured).toBe(false);
  });
});

describe('credentialsMatch', () => {
  it('accepts the configured pair (the username ignoring surrounding spaces) and nothing else', async () => {
    expect(await credentialsMatch('User1', 'a-test-password', cfg)).toBe(true);
    expect(await credentialsMatch(' User1 ', 'a-test-password', cfg)).toBe(true);
    expect(await credentialsMatch('user1', 'a-test-password', cfg)).toBe(false); // case matters
    expect(await credentialsMatch('User1', 'A-test-password', cfg)).toBe(false);
    expect(await credentialsMatch('User1', 'a-test-password ', cfg)).toBe(false); // a password is not trimmed
    expect(await credentialsMatch('User2', 'a-test-password', cfg)).toBe(false);
    expect(await credentialsMatch('', '', cfg)).toBe(false);
  });
  it('never matches when nothing is configured, even empty against empty', async () => {
    expect(await credentialsMatch('', '', authConfig({}))).toBe(false);
    expect(await credentialsMatch('User1', 'a-test-password', authConfig({}))).toBe(false);
  });
});

describe('session tokens', () => {
  it('round-trips and expires', async () => {
    const t = (await createSessionToken('User1', NOW, cfg, env))!;
    expect(await verifySessionToken(t, NOW + 1000, cfg, env)).toEqual({ username: 'User1' });
    expect(await verifySessionToken(t, NOW + SESSION_TTL_SEC * 1000 - 1000, cfg, env)).toEqual({ username: 'User1' });
    expect(await verifySessionToken(t, NOW + SESSION_TTL_SEC * 1000 + 1000, cfg, env)).toBeNull();
  });
  it('rejects a tampered, truncated, foreign or empty token', async () => {
    const t = (await createSessionToken('User1', NOW, cfg, env))!;
    const [exp, user, sig] = t.split('.');
    expect(await verifySessionToken(`${Number(exp) + 999999}.${user}.${sig}`, NOW, cfg, env)).toBeNull(); // longer life
    expect(await verifySessionToken(`${exp}.${Buffer.from('Admin').toString('base64url')}.${sig}`, NOW, cfg, env)).toBeNull();
    expect(await verifySessionToken(`${exp}.${user}.${sig.slice(0, -2)}00`, NOW, cfg, env)).toBeNull();
    expect(await verifySessionToken(`${exp}.${user}`, NOW, cfg, env)).toBeNull();
    for (const bad of ['', undefined, null, 'a.b.c', '1.2.3.4', 'x'.repeat(600)]) expect(await verifySessionToken(bad as string, NOW, cfg, env)).toBeNull();
  });
  it('is invalidated by a password change, a username change and a different signing secret', async () => {
    const t = (await createSessionToken('User1', NOW, cfg, env))!;
    expect(await verifySessionToken(t, NOW, authConfig({ ...env, APP_PASSWORD: 'changed' }), { ...env, APP_PASSWORD: 'changed' })).toBeNull();
    expect(await verifySessionToken(t, NOW, authConfig({ ...env, APP_USERNAME: 'Other' }), env)).toBeNull();
    expect(await verifySessionToken(t, NOW, cfg, { ...env, REGISTRATION_SECRET: 'y'.repeat(40) })).toBeNull();
  });
  it('is not issued when sign-in is not configured or the signing secret is too short', async () => {
    expect(await createSessionToken('User1', NOW, authConfig({}), {})).toBeNull();
    expect(await createSessionToken('User1', NOW, cfg, { ...env, REGISTRATION_SECRET: 'short' })).toBeNull();
  });
  it('handles a username with non-ASCII characters', async () => {
    const e = { ...env, APP_USERNAME: 'Zoë' };
    const c = authConfig(e);
    const t = (await createSessionToken('Zoë', NOW, c, e))!;
    expect(await verifySessionToken(t, NOW, c, e)).toEqual({ username: 'Zoë' });
  });
});

describe('safeNextPath', () => {
  it('keeps same-site paths with their query', () => {
    expect(safeNextPath('/campaigns/abc/overview')).toBe('/campaigns/abc/overview');
    expect(safeNextPath('/campaigns/new?id=a&step=2')).toBe('/campaigns/new?id=a&step=2');
    expect(safeNextPath('/?view=draft')).toBe('/?view=draft');
  });
  it.each([
    ['absolute url', 'https://evil.test/x'], ['protocol relative', '//evil.test'], ['backslash', '/\\evil.test'], ['javascript', 'javascript:alert(1)'],
    ['the login page', '/login?next=/'], ['the login endpoint', '/api/auth/login'], ['logout', '/api/auth/logout'], ['empty', ''], ['null', null],
    ['newline', '/a\nb'], ['too long', `/${'a'.repeat(600)}`],
  ])('falls back to home for %s', (_label, value) => {
    expect(safeNextPath(value)).toBe('/');
  });
});

describe('isPublicPath', () => {
  it.each(['/login', '/api/auth/login', '/api/auth/logout', '/register/abc123', '/r/result', '/r/sometoken', '/api/landing/submit', '/api/webhooks/zoom', '/api/calendar/abc', '/api/health', '/api/cron/cadence'])(
    '%s is reachable without signing in',
    (p) => expect(isPublicPath(p)).toBe(true),
  );
  it.each([
    '/', '/dashboard', '/integrations', '/templates', '/linkedin', '/campaigns/new', '/campaigns/abc/overview', '/api/wizard/draft', '/api/auth/zoom/connect',
    '/api/auth/zoom/callback', '/api/auth/linkedin/connect', '/register', '/register/a/b', '/registerx', '/rx', '/api/landingx', '/api/healthz', '/api/cronx', '/login/extra', '/api/auth/loginx',
  ])('%s needs a session', (p) => expect(isPublicPath(p)).toBe(false));
});
