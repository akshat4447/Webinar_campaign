import { describe, it, expect, vi, beforeEach } from 'vitest';

const zoomRequest = vi.fn();
vi.mock('./client', () => ({
  getZoomMode: vi.fn(async () => 'live'),
  zoomIsConfigured: vi.fn(async () => true),
  zoomRequest: (...a: unknown[]) => zoomRequest(...a),
  zoomHostUser: vi.fn(async () => 'me'),
  ZoomError: class ZoomError extends Error {
    constructor(message: string, readonly status?: number, readonly code?: number) {
      super(message);
    }
  },
}));

import { listUpcomingMeetings, zoomListAllPages, getZoomEventDetails } from './meetings';

// Braces matter: returning the mock from beforeEach would make vitest call it as a cleanup hook.
beforeEach(() => {
  zoomRequest.mockReset();
});

describe('zoomListAllPages', () => {
  it('follows next_page_token until the last page', async () => {
    zoomRequest
      .mockResolvedValueOnce({ next_page_token: 'p2', meetings: [{ id: 1 }] })
      .mockResolvedValueOnce({ next_page_token: 'p3', meetings: [{ id: 2 }] })
      .mockResolvedValueOnce({ next_page_token: '', meetings: [{ id: 3 }] });
    const pages = await zoomListAllPages('/users/me/meetings?type=upcoming');
    expect(pages).toHaveLength(3);
    expect(zoomRequest.mock.calls[0][0]).toBe('/users/me/meetings?type=upcoming&page_size=100');
    expect(zoomRequest.mock.calls[1][0]).toContain('next_page_token=p2');
    expect(zoomRequest.mock.calls[2][0]).toContain('next_page_token=p3');
  });

  it('uses ? for a bare path and URL-encodes the token', async () => {
    zoomRequest.mockResolvedValueOnce({ next_page_token: 'a+b/c=' }).mockResolvedValueOnce({});
    await zoomListAllPages('/users/me/webinars');
    expect(zoomRequest.mock.calls[0][0]).toBe('/users/me/webinars?page_size=100');
    expect(zoomRequest.mock.calls[1][0]).toContain('next_page_token=a%2Bb%2Fc%3D');
  });

  it('stops at the page cap even if Zoom keeps returning a token (no unbounded loop)', async () => {
    zoomRequest.mockResolvedValue({ next_page_token: 'again' });
    const pages = await zoomListAllPages('/x');
    expect(pages).toHaveLength(10);
  });
});

describe('listUpcomingMeetings', () => {
  it('returns meetings beyond the first page', async () => {
    zoomRequest.mockImplementation(async (path: string) => {
      if (path.startsWith('/users/me/webinars')) return { webinars: [] };
      if (path.includes('next_page_token=t2')) return { meetings: [{ id: 2, topic: 'Second page', join_url: 'u2' }] };
      return { next_page_token: 't2', meetings: [{ id: 1, topic: 'First page', join_url: 'u1' }] };
    });
    const out = await listUpcomingMeetings();
    expect(out.map((m) => m.id)).toEqual(['1', '2']);
  });

  it('still returns meetings when the webinar listing is unavailable (no webinar plan/scope)', async () => {
    zoomRequest.mockImplementation(async (path: string) => {
      if (path.startsWith('/users/me/webinars')) throw new Error('scope missing');
      return { meetings: [{ id: 9, topic: 'M', join_url: 'u' }] };
    });
    expect((await listUpcomingMeetings()).map((m) => m.id)).toEqual(['9']);
  });
});

describe('getZoomEventDetails', () => {
  it('never invents a personal name for a webinar whose host is unknown', async () => {
    zoomRequest.mockImplementation(async (path: string) => {
      if (path.endsWith('/panelists')) return { panelists: [] };
      return { id: 81234567890, topic: 'T', join_url: 'u', settings: {} };
    });
    const d = await getZoomEventDetails('81234567890');
    expect(d?.host?.name).toBe('Webinar Host');
  });
});
