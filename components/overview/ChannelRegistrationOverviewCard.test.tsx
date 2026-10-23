import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { CampaignRegistrationOverview, ChannelRegistrationStat } from '@/lib/registrationChannels';
import { ChannelRegistrationOverviewCard } from './ChannelRegistrationOverviewCard';

vi.mock('@/components/ui/Drawer', () => ({}));

const stat = (key: ChannelRegistrationStat['key'], label: string, category: ChannelRegistrationStat['category'], extra: Partial<ChannelRegistrationStat> = {}): ChannelRegistrationStat => ({
  key, label, icon: '', color: '', description: '', category, registeredCount: 0, pctOfTotal: 0, invitedCount: 0, conversionRate: null, trackingUrl: null, contacts: [], ...extra,
});

const overview: CampaignRegistrationOverview = {
  totalRegistered: 0,
  untrackedRegistered: 0,
  selectedChannels: [],
  topChannel: null,
  channels: [
    stat('email_campaign', 'Email Campaign', 'outreach', { invitedCount: 3, conversionRate: 0 }),
    stat('sms', 'SMS', 'outreach'),
    stat('whatsapp', 'WhatsApp', 'outreach'),
    stat('linkedin', 'LinkedIn', 'outreach'),
    stat('website', 'Website', 'inbound', { trackingUrl: 'https://lp.example.com/?source=website' }),
  ],
};

const html = () => renderToString(<ChannelRegistrationOverviewCard overview={overview} drawers={{}} onOpenDrawer={() => undefined} />);

describe('ChannelRegistrationOverviewCard', () => {
  it('no longer claims a fixed number of channels', () => {
    expect(html()).not.toMatch(/of 7 channels/);
    expect(html()).not.toContain('all 7 tracked channels');
  });

  it('offers a link to copy only where someone shares a link by hand', () => {
    const out = html();
    expect(out).toContain('https://lp.example.com/?source=website');
    expect(out).toContain('Copy tracking link for Website');
    for (const label of ['Email Campaign', 'SMS', 'WhatsApp', 'LinkedIn']) expect(out).not.toContain(`Copy tracking link for ${label}`);
    expect(out.match(/Added to each message/g)).toHaveLength(4);
  });

  it('says plainly when no invites have gone out, instead of repeating "Channel tracking link"', () => {
    const out = html();
    expect(out).toContain('3 invites sent');
    expect(out).toContain('No invites sent yet');
    expect(out).not.toContain('Channel tracking link');
  });

  it('explains attribution the way it now works', () => {
    const out = html();
    expect(out).toContain('every email, SMS, WhatsApp and LinkedIn message');
    expect(out).not.toContain('Framer UTM parameters');
  });
});
