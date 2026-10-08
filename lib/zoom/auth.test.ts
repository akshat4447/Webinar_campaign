import { describe, it, expect } from 'vitest';
import { buildAuthorizationUrl, ZOOM_SCOPES } from './auth';

describe('Zoom OAuth Auth Helpers', () => {
  it('builds a valid Zoom authorization URL with all required scopes', () => {
    const urlStr = buildAuthorizationUrl({
      clientId: 'test-client-id',
      redirectUri: 'https://example-tunnel.trycloudflare.com/api/auth/zoom/callback',
      state: 'test-state-123',
    });
    const url = new URL(urlStr);
    expect(url.origin).toBe('https://zoom.us');
    expect(url.pathname).toBe('/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('test-client-id');
    expect(url.searchParams.get('redirect_uri')).toBe('https://example-tunnel.trycloudflare.com/api/auth/zoom/callback');
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
      'webinar:read:list_webinars',
      'webinar:read:webinar',
      'webinar:write:webinar',
      'webinar:read:list_past_participants',
      'user:read:user',
      'meeting:write:registrant',
      'webinar:write:registrant',
      'meeting:read:list_registrants',
      'webinar:read:list_registrants',
      'meeting:update:meeting',
      'webinar:update:webinar',
    ]);
  });

  it('requests the registrant-write scopes — without them every add-registrant call is refused', () => {
    expect(ZOOM_SCOPES).toContain('meeting:write:registrant');
    expect(ZOOM_SCOPES).toContain('webinar:write:registrant');
  });
});

