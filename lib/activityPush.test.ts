import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getOrCreateRegistrationActivityTypeId, postWebinarRegistrationActivity } from '@/lib/activityPush';
import { db } from '@/lib/db';
import * as lsq from '@/lib/leadsquared';

describe('Checkpoint 4: LeadSquared Activity Sync', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('provisions a dedicated Webinar Registration activity type and caches its ID in AppSetting', async () => {
    const mockFindUnique = vi.spyOn(db.appSetting, 'findUnique').mockResolvedValue(null);
    const mockCreateType = vi.spyOn(lsq, 'createActivityType').mockResolvedValue(205);
    const mockUpsert = vi.spyOn(db.appSetting, 'upsert').mockResolvedValue({
      key: 'lsq_webinar_reg_activity_type_id',
      value: '205',
    });

    const activityId = await getOrCreateRegistrationActivityTypeId();

    expect(mockFindUnique).toHaveBeenCalledWith({ where: { key: 'lsq_webinar_reg_activity_type_id' } });
    expect(mockCreateType).toHaveBeenCalledWith(
      'Webinar Registration',
      expect.arrayContaining([
        { schemaName: 'mx_Custom_1', displayName: 'Webinar Name' },
        { schemaName: 'mx_Custom_2', displayName: 'Registration Source' },
        { schemaName: 'mx_Custom_3', displayName: 'Webinar Date' },
        { schemaName: 'mx_Custom_4', displayName: 'Zoom Join URL' },
        { schemaName: 'mx_Custom_5', displayName: 'Speaker' },
        { schemaName: 'mx_Custom_6', displayName: 'Registration Time' },
      ])
    );
    expect(mockUpsert).toHaveBeenCalled();
    expect(activityId).toBe(205);
  });

  it('gracefully skips LeadSquared sync when credentials are not configured', async () => {
    vi.spyOn(db.campaign, 'findUnique').mockResolvedValue({
      id: 'c1',
      name: 'Test Webinar',
      speakers: [],
    } as unknown as Awaited<ReturnType<typeof db.campaign.findUnique>>);
    vi.spyOn(db.contact, 'findUnique').mockResolvedValue({
      id: 'cnt1',
      campaignId: 'c1',
      name: 'John Doe',
      email: 'john@example.com',
    } as unknown as Awaited<ReturnType<typeof db.contact.findUnique>>);
    vi.spyOn(db.appSetting, 'findUnique').mockResolvedValue(null);
    vi.spyOn(db.appSetting, 'findMany').mockResolvedValue([]);

    const origKey = process.env.LEADSQUARED_ACCESS_KEY;
    const origSecret = process.env.LEADSQUARED_SECRET_KEY;
    const origLsqKey = process.env.LSQ_ACCESS_KEY;
    const origLsqSecret = process.env.LSQ_SECRET_KEY;
    delete process.env.LEADSQUARED_ACCESS_KEY;
    delete process.env.LEADSQUARED_SECRET_KEY;
    delete process.env.LSQ_ACCESS_KEY;
    delete process.env.LSQ_SECRET_KEY;

    try {
      const result = await postWebinarRegistrationActivity('c1', 'cnt1', 'one_click');
      expect(result.ok).toBe(true);
      expect(result.skipped).toBe(true);
    } finally {
      if (origKey !== undefined) process.env.LEADSQUARED_ACCESS_KEY = origKey;
      if (origSecret !== undefined) process.env.LEADSQUARED_SECRET_KEY = origSecret;
      if (origLsqKey !== undefined) process.env.LSQ_ACCESS_KEY = origLsqKey;
      if (origLsqSecret !== undefined) process.env.LSQ_SECRET_KEY = origLsqSecret;
    }
  });
});
