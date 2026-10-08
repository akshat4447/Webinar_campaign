/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '@/lib/db';
import { computeTemplatesReadiness } from '@/lib/cadenceReadiness';
import { updateCampaignCapacityAction } from '@/lib/actions/setup';
import { regenerateOutdatedDraftsAction } from '@/lib/actions/personalize';

describe('Cadence Safeguards, Dynamic Cancellation & Editing', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(db.campaign, "findUnique").mockResolvedValue({id:"c1",status:"draft",cadenceStatus:"not_started"} as any);
  });

  describe('Cadence Readiness Template Blocker', () => {
    it('reports problems when an enabled cadence step has no template', async () => {
      vi.spyOn(db.cadenceStep, 'findMany').mockResolvedValue([
        {
          id: 'step_1',
          campaignId: 'camp_1',
          key: 'custom_step',
          title: 'Custom VIP Outreach',
          channel: 'email',
          enabled: true,
          removedAt: null,
          templateId: null,
        } as any,
      ]);

      vi.spyOn(db.cadenceStep, 'findUnique').mockResolvedValue(null);
      vi.spyOn(db.messageTemplate, 'findFirst').mockResolvedValue(null);
      vi.spyOn(db.messageTemplate, 'findMany').mockResolvedValue([]);
      vi.spyOn(db.template, 'findUnique').mockResolvedValue(null);
      vi.spyOn(db.template, 'findMany').mockResolvedValue([]);

      const res = await computeTemplatesReadiness('camp_1');
      expect(res.ok).toBe(false);
      expect(res.problems.length).toBeGreaterThan(0);
      expect(res.problems[0]).toContain('No valid template assigned');
    });
  });

  describe('Campaign Capacity Action', () => {
    it('updates campaign capacity with a positive integer and creates activity log', async () => {
      const updateSpy = vi.spyOn(db.campaign, 'update').mockResolvedValueOnce({} as any);
      const logSpy = vi.spyOn(db.activityLogEntry, 'create').mockResolvedValueOnce({} as any);

      const res = await updateCampaignCapacityAction('camp_capacity_1', 350);
      expect(res.ok).toBe(true);
      expect(updateSpy).toHaveBeenCalledWith({
        where: { id: 'camp_capacity_1' },
        data: { capacity: 350 },
      });
      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            campaignId: 'camp_capacity_1',
            text: expect.stringContaining('350 seats'),
          }),
        })
      );
    });

    it('clears capacity when null is provided', async () => {
      const updateSpy = vi.spyOn(db.campaign, 'update').mockResolvedValueOnce({} as any);
      vi.spyOn(db.activityLogEntry, 'create').mockResolvedValueOnce({} as any);

      const res = await updateCampaignCapacityAction('camp_capacity_1', null);
      expect(res.ok).toBe(true);
      expect(updateSpy).toHaveBeenCalledWith({
        where: { id: 'camp_capacity_1' },
        data: { capacity: null },
      });
    });
  });

  describe('AI Draft Staleness & Preservation', () => {
    it('regenerateOutdatedDraftsAction passes preserveEdited: true to preserve human edits', async () => {
      vi.spyOn(db.campaign, 'findUniqueOrThrow').mockResolvedValueOnce({
        id: 'camp_refresh_1',
        name: 'AI in 2027',
        personalizationFields: 'firstName,company',
        personalizationPrompt: 'Test prompt',
        msgMode: 'ai',
      } as any);

      vi.spyOn(db.cadenceStep, 'findUnique').mockResolvedValue({ templateId: 'tmpl_1' } as any);
      vi.spyOn(db.messageTemplate, 'findUnique').mockResolvedValue({
        id: 'tmpl_1',
        channel: 'email',
        label: 'Invite',
        hasSubject: true,
        subject: 'Inviting {{firstName}}',
        body: 'Hello {{firstName}}',
      } as any);

      vi.spyOn(db.cadenceSend, 'count').mockResolvedValue(0);
      vi.spyOn(db.contact, 'findMany').mockResolvedValue([
        { id: 'c1', name: 'Alice', account: 'Acme', approved: true },
      ] as any);
      vi.spyOn(db.speaker, 'findMany').mockResolvedValue([]);
      vi.spyOn(db.cadenceStep, 'findFirst').mockResolvedValue({ mode: 'ai' } as any);

      // c1 is manually edited, so with preserveEdited: true, contacts list becomes empty
      vi.spyOn(db.personalizedMessage, 'findMany').mockResolvedValue([
        { contactId: 'c1' },
      ] as any);

      const res = await regenerateOutdatedDraftsAction('camp_refresh_1', 'invite');
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.generated).toBe(0);
        expect(res.skipped).toBe(0);
      }
    });
  });
});
