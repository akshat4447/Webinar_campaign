import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({
  campaign: { findUnique: vi.fn(), update: vi.fn() },
  contact: { updateMany: vi.fn() },
  cadenceStep: { findMany: vi.fn() },
  cadenceSend: { updateMany: vi.fn() },
}));
vi.mock('@/lib/db', () => ({ db }));
vi.mock('@/lib/revalidate', () => ({ revalidateCampaign: vi.fn() }));
vi.mock('@/lib/zoom/client', () => ({ zoomConnectionError: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/speakersServer', () => ({ syncSpeakersForCampaign: vi.fn() }));

const getZoomEventDetails = vi.fn();
vi.mock('@/lib/zoom/meetings', () => ({
  getZoomEventDetails: (...a: unknown[]) => getZoomEventDetails(...a),
  listUpcomingMeetings: vi.fn().mockResolvedValue([]),
}));

import { linkZoomMeetingAction } from './zoom';
import { zoomConnectionError } from '@/lib/zoom/client';

const meeting = (id: string) => ({ id, topic: '[Webinar] AI in Lending', startTime: '2026-11-01T10:00:00Z', duration: 60, joinUrl: `https://zoom.us/j/${id}`, speakers: [] });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(zoomConnectionError).mockResolvedValue(null);
  db.cadenceStep.findMany.mockResolvedValue([]);
  getZoomEventDetails.mockResolvedValue(meeting('222'));
});

describe('linkZoomMeetingAction — personal join links', () => {
  it('clears stored personal join links when the campaign moves to a DIFFERENT Zoom meeting', async () => {
    db.campaign.findUnique.mockResolvedValue({ zoomMeetingId: '111' });
    const res = await linkZoomMeetingAction('c1', '222');
    expect(res.ok).toBe(true);
    expect(db.contact.updateMany).toHaveBeenCalledWith({ where: { campaignId: 'c1' }, data: { zoomJoinUrl: null, zoomRegistrantId: null } });
  });

  it('keeps them when re-linking the SAME meeting (e.g. refreshing details)', async () => {
    db.campaign.findUnique.mockResolvedValue({ zoomMeetingId: '222' });
    await linkZoomMeetingAction('c1', '222');
    expect(db.contact.updateMany).not.toHaveBeenCalled();
  });

  it('keeps them on the very first link (nothing to invalidate)', async () => {
    db.campaign.findUnique.mockResolvedValue({ zoomMeetingId: null });
    await linkZoomMeetingAction('c1', '222');
    expect(db.contact.updateMany).not.toHaveBeenCalled();
  });

  it('touches nothing when Zoom is not connected', async () => {
    vi.mocked(zoomConnectionError).mockResolvedValue('Zoom is not connected');
    const res = await linkZoomMeetingAction('c1', '222');
    expect(res.ok).toBe(false);
    expect(db.campaign.update).not.toHaveBeenCalled();
    expect(db.contact.updateMany).not.toHaveBeenCalled();
  });
});
