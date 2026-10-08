/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '@/lib/db';
import { syncZoomAttendanceAction, importAttendanceListAction } from '@/lib/actions/attendance';

describe('Attendance Actions & Lifecycle Synchronization', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(db, '$transaction').mockImplementation((async (cb: any) => cb(db)) as any);
    vi.spyOn(db, '$queryRaw').mockResolvedValue([]);
    vi.spyOn(db.registrationJob, 'updateMany').mockResolvedValue({count:0});
    vi.spyOn(db.registrationJob, 'createMany').mockResolvedValue({count:2});
  });

  describe('importAttendanceListAction', () => {
    it('applies attendance, marks attendees and no-shows, and queues cadence steps', async () => {
      vi.spyOn(db.contact, 'findMany').mockResolvedValueOnce([
        { id: 'c1', campaignId: 'camp_1', email: 'attendee@company.com', approved: true, registeredAt: new Date() },
        { id: 'c2', campaignId: 'camp_1', email: 'noshow@company.com', approved: true, registeredAt: new Date() },
      ] as any);

      const updateContactSpy = vi.spyOn(db.contact, 'updateMany').mockResolvedValue({ count: 1 } as any);
      vi.spyOn(db.campaign, 'update').mockResolvedValue({} as any);
      vi.spyOn(db.campaign, 'findUnique').mockResolvedValue({ id: 'camp_1', name: 'Webinar', cadenceStatus: 'paused' } as any);
      vi.spyOn(db.campaign, 'findUniqueOrThrow').mockResolvedValue({ id: 'camp_1', attendanceVersion: 0, cadenceStatus: 'paused' } as any);

      const activityPush = await import('@/lib/activityPush');
      vi.spyOn(activityPush, 'pushEngagementActivities').mockResolvedValue({ pushed: 2, failed: 0 } as any);

      vi.spyOn(db.cadenceStep, 'findMany').mockResolvedValue([
        { key: 'attend', enabled: true },
        { key: 'noshow', enabled: true },
      ] as any);

      vi.spyOn(db.cadenceSend, 'updateMany').mockResolvedValue({ count: 0 } as any);
      vi.spyOn(db.cadenceSend, 'findMany').mockResolvedValue([]);
      const createSendsSpy = vi.spyOn(db.cadenceSend, 'createMany').mockResolvedValue({ count: 2 } as any);
      vi.spyOn(db.activityLogEntry, 'create').mockResolvedValue({} as any);

      const res = await importAttendanceListAction('camp_1', [
        { email: 'attendee@company.com', watchMinutes: 45 },
      ]);

      expect(res.ok).toBe(true);
      expect(res.attendedCount).toBe(1);
      expect(res.noShowCount).toBe(1);
      expect(updateContactSpy).toHaveBeenCalledWith({
        where: { campaignId:'camp_1', id: { in: ['c1'] } },
        data: { attended: true, watchMinutes: 45 },
      });
      expect(createSendsSpy).toHaveBeenCalledWith(expect.objectContaining({data: expect.arrayContaining([expect.objectContaining({contactId:'c1',stepKey:'attend'})]),skipDuplicates:true}));
      expect(createSendsSpy).toHaveBeenCalledWith(expect.objectContaining({data: expect.arrayContaining([expect.objectContaining({contactId:'c2',stepKey:'noshow'})]),skipDuplicates:true}));
    });
  });

  describe('syncZoomAttendanceAction', () => {
    it('returns error when campaign has no linked zoom meeting', async () => {
      vi.spyOn(db.campaign, 'findUniqueOrThrow').mockResolvedValueOnce({
        zoomMeetingId: null,
      } as any);

      const res = await syncZoomAttendanceAction('camp_unlinked');
      expect(res.ok).toBe(false);
      expect(res.error).toContain('No Zoom meeting is linked');
    });
  });
});
