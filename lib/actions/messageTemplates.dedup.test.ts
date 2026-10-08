import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/db', () => {
  const db = {
    messageTemplate: {
      findUniqueOrThrow: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    cadenceStep: {
      updateMany: vi.fn(),
    },
  };
  return { db };
});

import { db } from '@/lib/db';
import { copyIntoCampaignAction, copyTemplateIntoMultipleCampaignsAction } from './messageTemplates';

const LIBRARY_KEYLESS_TEMPLATE = {
  id: 'tpl-keyless',
  campaignId: null,
  key: null,
  forkedFromId: null,
  channel: 'email',
  name: 'Ad-hoc thank-you note',
  hasSubject: true,
  subject: 'Thanks for joining',
  body: 'Thanks for coming!',
  category: null,
  language: null,
  footer: null,
  buttons: null,
  dltTemplateId: null,
  senderId: null,
  status: 'ready',
};

describe('template copy — keyless-template collision detection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (db.messageTemplate.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  });

  it('copyIntoCampaignAction detects an existing keyless copy by lineage (forkedFromId), not name', async () => {
    (db.messageTemplate.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(LIBRARY_KEYLESS_TEMPLATE);
    (db.messageTemplate.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'already-copied-here' });

    const result = await copyIntoCampaignAction('tpl-keyless', 'camp-1');

    // `name` is deliberately NOT part of this query: every new template starts
    // from the same fixed starter name until renamed, so a name match can hit
    // an unrelated same-named template instead of "the" prior copy of this one.
    expect(db.messageTemplate.findFirst).toHaveBeenCalledWith({
      where: { campaignId: 'camp-1', key: null, forkedFromId: 'tpl-keyless' },
    });
    expect(result).toEqual({ ok: false, error: 'This campaign already has its own copy. Use multi-copy to overwrite or create a variant.' });
    expect(db.messageTemplate.create).not.toHaveBeenCalled();
  });

  it('copyIntoCampaignAction still creates a fresh copy the first time (no prior keyless copy in this campaign)', async () => {
    (db.messageTemplate.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(LIBRARY_KEYLESS_TEMPLATE);
    (db.messageTemplate.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (db.messageTemplate.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'new-copy-id' });

    const result = await copyIntoCampaignAction('tpl-keyless', 'camp-2');

    expect(result).toEqual({ ok: true, id: 'new-copy-id' });
    expect(db.messageTemplate.create).toHaveBeenCalledTimes(1);
  });

  it('copyTemplateIntoMultipleCampaignsAction skips a campaign that already has this keyless template, per the skip strategy', async () => {
    (db.messageTemplate.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(LIBRARY_KEYLESS_TEMPLATE);
    (db.messageTemplate.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'already-copied-here' });

    const result = await copyTemplateIntoMultipleCampaignsAction({
      templateId: 'tpl-keyless',
      campaignIds: ['camp-1'],
      conflictStrategy: 'skip',
    });

    expect(result.skippedCount).toBe(1);
    expect(result.copiedCount).toBe(0);
    expect(db.messageTemplate.create).not.toHaveBeenCalled();
  });

  it('copyTemplateIntoMultipleCampaignsAction creates a distinct variant instead of an untracked duplicate on repeat copy', async () => {
    (db.messageTemplate.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(LIBRARY_KEYLESS_TEMPLATE);
    (db.messageTemplate.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'already-copied-here' });
    (db.messageTemplate.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([{ name: 'Ad-hoc thank-you note' }]);
    (db.messageTemplate.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'variant-id' });

    const result = await copyTemplateIntoMultipleCampaignsAction({
      templateId: 'tpl-keyless',
      campaignIds: ['camp-1'],
      conflictStrategy: 'variant',
    });

    expect(result.variantCount).toBe(1);
    expect(db.messageTemplate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: 'Ad-hoc thank-you note (Variant 2)', key: null, forkedFromId: 'tpl-keyless' }),
      })
    );
  });

  it('variant counting ignores unrelated templates that merely share a name prefix', async () => {
    (db.messageTemplate.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(LIBRARY_KEYLESS_TEMPLATE);
    (db.messageTemplate.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'already-copied-here' });
    // "startsWith" would count this as a 2nd variant; an exact/"(Variant N)"
    // match must not.
    (db.messageTemplate.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { name: 'Ad-hoc thank-you note' },
      { name: 'Ad-hoc thank-you note for VIPs' },
    ]);
    (db.messageTemplate.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'variant-id' });

    await copyTemplateIntoMultipleCampaignsAction({
      templateId: 'tpl-keyless',
      campaignIds: ['camp-1'],
      conflictStrategy: 'variant',
    });

    expect(db.messageTemplate.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: 'Ad-hoc thank-you note (Variant 2)' }) })
    );
  });
});
