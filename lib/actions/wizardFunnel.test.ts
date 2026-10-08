/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { updateWizardFunnelModeAction } from './wizard';
import { db } from '@/lib/db';
import { revalidateCampaign } from '@/lib/revalidate';

vi.mock('@/lib/db', () => ({
  db: {
    campaign: {
      update: vi.fn(),
    },
  },
}));

vi.mock('@/lib/revalidate', () => ({
  revalidateCampaign: vi.fn(),
}));

describe('updateWizardFunnelModeAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (db.campaign as any).findUnique = vi.fn().mockResolvedValue({id:'c1',status:'draft',cadenceStatus:'not_started'});
  });

  it('switches to normal registration mode with oneClickSignup=true and registrationLink=null', async () => {
    vi.mocked(db.campaign.update).mockResolvedValue({ id: 'camp_1' } as any);

    const result = await updateWizardFunnelModeAction('camp_1', 'normal');

    expect(result.ok).toBe(true);
    expect(result.mode).toBe('normal');
    expect(result.oneClickSignup).toBe(true);
    expect(result.registrationLink).toBe('');

    expect(db.campaign.update).toHaveBeenCalledWith({
      where: { id: 'camp_1' },
      data: {
        registrationLink: null,
        oneClickSignup: true,
        registrationMode: 'zoom',
      },
    });
    expect(revalidateCampaign).toHaveBeenCalledWith('camp_1');
  });

  it('switches to framer mode with oneClickSignup=false and configured registrationLink', async () => {
    vi.mocked(db.campaign.update).mockResolvedValue({ id: 'camp_1' } as any);

    const result = await updateWizardFunnelModeAction(
      'camp_1',
      'framer',
      'https://webinar.leadsquared.com/opd-to-ipd-funnel'
    );

    expect(result.ok).toBe(true);
    expect(result.mode).toBe('framer');
    expect(result.oneClickSignup).toBe(false);
    expect(result.registrationLink).toBe('https://webinar.leadsquared.com/opd-to-ipd-funnel');

    expect(db.campaign.update).toHaveBeenCalledWith({
      where: { id: 'camp_1' },
      data: {
        registrationLink: 'https://webinar.leadsquared.com/opd-to-ipd-funnel',
        oneClickSignup: false,
        registrationMode: 'external',
      },
    });
    expect(revalidateCampaign).toHaveBeenCalledWith('camp_1');
  });

  it('handles empty framer registrationLink by defaulting oneClickSignup correctly', async () => {
    vi.mocked(db.campaign.update).mockResolvedValue({ id: 'camp_1' } as any);

    const result = await updateWizardFunnelModeAction('camp_1', 'framer', '   ');

    expect(result.ok).toBe(true);
    expect(result.registrationLink).toBe('');
    expect(result.oneClickSignup).toBe(true);

    expect(db.campaign.update).toHaveBeenCalledWith({
      where: { id: 'camp_1' },
      data: {
        registrationLink: null,
        oneClickSignup: true,
        registrationMode: 'zoom',
      },
    });
  });
});
