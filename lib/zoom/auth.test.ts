import { describe, it, expect } from 'vitest';
import { buildAuthorizationUrl, ZOOM_SCOPES } from './auth';

describe('Zoom OAuth Auth Helpers', () => {
  it('builds a valid Zoom authorization URL with all required scopes', () => {
    const urlStr = buildAuthorizationUrl({
      clientId: '3agC8xZ9QnqzTD6p1qY4fw',
      redirectUri: 'https://horses-prescribed-adapted-certification.trycloudflare.com/api/auth/zoom/callback',
      state: 'test-state-123',
    });
    const url = new URL(urlStr);
    expect(url.origin).toBe('https://zoom.us');
    expect(url.pathname).toBe('/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('3agC8xZ9QnqzTD6p1qY4fw');
    expect(url.searchParams.get('redirect_uri')).toBe('https://horses-prescribed-adapted-certification.trycloudflare.com/api/auth/zoom/callback');
    expect(url.searchParams.get('state')).toBe('test-state-123');
    expect(url.searchParams.get('response_type')).toBe('code');
    for (const scope of ZOOM_SCOPES) {
      expect(url.searchParams.get('scope')).toContain(scope);
    }
  });

  it('includes all essential user-managed scopes', () => {
    expect(ZOOM_SCOPES).toEqual([
      'meeting:read:list_meetings',
      'meeting:read:meeting',
      'meeting:write:meeting',
      'meeting:read:list_past_participants',
      'user:read:user',
    ]);
  });
});

