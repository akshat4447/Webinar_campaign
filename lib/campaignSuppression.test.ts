import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  normalizeSuppressionTarget,
  isEmailCampaignSuppressed,
  addCampaignSuppression,
  bulkAddCampaignSuppression,
  removeCampaignSuppression,
} from './campaignSuppression';
import { db } from './db';

// Mock Prisma client for campaignSuppression
vi.mock('./db', () => ({
  db: {
    campaignSuppression: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
    },
    contact: {
      findMany: vi.fn(),
    },
    cadenceSend: {
      updateMany: vi.fn(),
    },
    activityLogEntry: {
      create: vi.fn(),
    },
  },
}));

describe('Campaign Suppression & Exclusion Engine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('normalizeSuppressionTarget', () => {
    it('normalizes full email addresses', () => {
      const res = normalizeSuppressionTarget('  Alex.Turner@AcmeCorp.COM  ');
      expect(res.target).toBe('alex.turner@acmecorp.com');
      expect(res.isDomain).toBe(false);
    });

    it('normalizes domain patterns starting with @', () => {
      const res = normalizeSuppressionTarget('  @Competitor.COM ');
      expect(res.target).toBe('@competitor.com');
      expect(res.isDomain).toBe(true);
    });

    it('normalizes domain patterns without @ to have a leading @', () => {
      const res = normalizeSuppressionTarget('competitor.io');
      expect(res.target).toBe('@competitor.io');
      expect(res.isDomain).toBe(true);
    });

    it('handles empty input gracefully', () => {
      const res = normalizeSuppressionTarget('   ');
      expect(res.target).toBe('');
      expect(res.isDomain).toBe(false);
    });
  });

  describe('isEmailCampaignSuppressed', () => {
    it('returns null if email is empty or invalid', async () => {
      const res = await isEmailCampaignSuppressed('camp-1', '');
      expect(res).toBeNull();
      expect(db.campaignSuppression.findFirst).not.toHaveBeenCalled();
    });

    it('matches exact email suppression', async () => {
      vi.mocked(db.campaignSuppression.findFirst).mockResolvedValueOnce({
        id: 'supp-1',
        campaignId: 'camp-1',
        email: 'blocked@example.com',
        reason: 'competitor',
        source: 'manual',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await isEmailCampaignSuppressed('camp-1', 'BLOCKED@example.com');
      expect(res).toEqual({
        suppressed: true,
        reason: 'competitor',
        source: 'manual',
        matchPattern: 'blocked@example.com',
        id: 'supp-1',
      });
      expect(db.campaignSuppression.findFirst).toHaveBeenCalledWith({
        where: {
          campaignId: 'camp-1',
          email: { in: ['blocked@example.com', '@example.com'] },
        },
      });
    });

    it('matches domain wildcard suppression', async () => {
      vi.mocked(db.campaignSuppression.findFirst).mockResolvedValueOnce({
        id: 'supp-2',
        campaignId: 'camp-1',
        email: '@competitor.com',
        reason: 'competitor',
        source: 'csv_upload',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await isEmailCampaignSuppressed('camp-1', 'sales.lead@competitor.com');
      expect(res).toEqual({
        suppressed: true,
        reason: 'competitor',
        source: 'csv_upload',
        matchPattern: '@competitor.com',
        id: 'supp-2',
      });
    });

    it('returns null if no suppression rule matches this campaign', async () => {
      vi.mocked(db.campaignSuppression.findFirst).mockResolvedValueOnce(null);

      const res = await isEmailCampaignSuppressed('camp-1', 'friend@partner.com');
      expect(res).toBeNull();
    });
  });

  describe('addCampaignSuppression', () => {
    it('upserts suppression record and cancels matching pending cadence sends', async () => {
      vi.mocked(db.campaignSuppression.upsert).mockResolvedValueOnce({
        id: 'supp-3',
        campaignId: 'camp-123',
        email: '@rival.com',
        reason: 'competitor',
        source: 'manual',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      vi.mocked(db.contact.findMany).mockResolvedValueOnce([
        { id: 'c-1' } as unknown as { id: string },
        { id: 'c-2' } as unknown as { id: string },
      ] as unknown as Awaited<ReturnType<typeof db.contact.findMany>>);

      vi.mocked(db.cadenceSend.updateMany).mockResolvedValueOnce({ count: 4 });
      vi.mocked(db.activityLogEntry.create).mockResolvedValueOnce({} as unknown as Awaited<ReturnType<typeof db.activityLogEntry.create>>);

      const res = await addCampaignSuppression('camp-123', '@rival.com', 'competitor');

      expect(res.email).toBe('@rival.com');
      expect(db.contact.findMany).toHaveBeenCalled();
      expect(db.cadenceSend.updateMany).toHaveBeenCalledWith({
        where: {
          campaignId: 'camp-123',
          contactId: { in: ['c-1', 'c-2'] },
          status: { in: ['queued', 'processing'] },
        },
        data: expect.objectContaining({
          status: 'skipped',
        }),
      });
    });
  });

  describe('bulkAddCampaignSuppression', () => {
    it('parses multi-line text and adds entries', async () => {
      vi.mocked(db.campaignSuppression.upsert).mockResolvedValue({} as unknown as Awaited<ReturnType<typeof db.campaignSuppression.upsert>>);
      vi.mocked(db.contact.findMany).mockResolvedValueOnce([]);
      vi.mocked(db.activityLogEntry.create).mockResolvedValueOnce({} as unknown as Awaited<ReturnType<typeof db.activityLogEntry.create>>);

      const csvContent = `
        email
        user1@rival.com
        user2@rival.com, @blockdomain.com
        competitor3.io
      `;

      const res = await bulkAddCampaignSuppression('camp-123', csvContent, 'competitor');

      expect(res.added).toBe(4);
      expect(res.targets).toContain('user1@rival.com');
      expect(res.targets).toContain('user2@rival.com');
      expect(res.targets).toContain('@blockdomain.com');
      expect(res.targets).toContain('@competitor3.io');
    });
  });

  describe('removeCampaignSuppression', () => {
    it('removes record and logs activity', async () => {
      vi.mocked(db.campaignSuppression.delete).mockResolvedValueOnce({
        id: 'supp-1',
        campaignId: 'camp-1',
        email: 'alice@example.com',
      } as unknown as Awaited<ReturnType<typeof db.campaignSuppression.delete>>);
      vi.mocked(db.activityLogEntry.create).mockResolvedValueOnce({} as unknown as Awaited<ReturnType<typeof db.activityLogEntry.create>>);

      const ok = await removeCampaignSuppression('camp-1', 'supp-1');
      expect(ok).toBe(true);
      expect(db.campaignSuppression.delete).toHaveBeenCalledWith({
        where: { id: 'supp-1', campaignId: 'camp-1' },
      });
    });
  });
});
