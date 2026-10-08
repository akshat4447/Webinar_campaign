'use client';

import { useState } from 'react';
import type { CampaignRegistrationOverview, ChannelRegistrationStat, RegistrationChannelKey } from '@/lib/registrationChannels';
import type { DrawerContent } from '@/components/ui/Drawer';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';

interface ChannelRegistrationOverviewCardProps {
  overview: CampaignRegistrationOverview;
  drawers: Record<string, DrawerContent>;
  onOpenDrawer: (content: DrawerContent) => void;
  onEditChannels?: () => void;
}

// The registry in lib/registrationChannels still carries emoji; the UI maps each channel to a design-system icon instead.
const CHANNEL_ICON: Record<RegistrationChannelKey, string> = {
  email_campaign: 'mail',
  sms: 'phone',
  whatsapp: 'whatsapp',
  linkedin: 'linkedin',
  sdr_sales: 'phone',
  third_parties: 'share',
  linkedin_event: 'calendar',
  website: 'globe',
};

const CATEGORY_COLOR: Record<string, string> = {
  outreach: 'blue',
  inbound: 'success',
  sales: 'purple',
  partner: 'orange',
  social: 'indigo',
};

function describeChannel(ch: ChannelRegistrationStat): string {
  if (ch.invitedCount > 0) return `${ch.invitedCount.toLocaleString()} invites sent`;
  switch (ch.category) {
    case 'inbound':
      return 'Website or direct inbound';
    case 'social':
      return 'Social or event page';
    case 'sales':
      return 'Direct SDR outreach';
    case 'partner':
      return 'Partner or affiliate';
    default:
      return 'Channel tracking link';
  }
}

export function ChannelRegistrationOverviewCard({
  overview,
  drawers,
  onOpenDrawer,
  onEditChannels,
}: ChannelRegistrationOverviewCardProps) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const handleCopyLink = async (key: string, url: string) => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Fallback if the clipboard API is restricted
      const textarea = document.createElement('textarea');
      textarea.value = url;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2200);
  };

  const handleOpenChannelDrawer = (ch: ChannelRegistrationStat) => {
    const key = `Channel: ${ch.label}`;
    const drawer = drawers[key];
    if (drawer) {
      onOpenDrawer(drawer);
    } else {
      // Fallback drawer generated on-the-fly from channel contacts
      onOpenDrawer({
        title: `${ch.label} Registrants`,
        subtitle: `${ch.registeredCount} contacts registered via ${ch.label} (${ch.pctOfTotal}% of total registrations)`,
        columns: ['Contact', 'Account', 'Title', 'Score'],
        rows: ch.contacts.map((c) => [
          c.name,
          c.account || '—',
          c.title || '—',
          c.score !== null ? String(c.score) : '—',
        ]),
        notes: ch.trackingUrl ? [`Channel Tracking URL: ${ch.trackingUrl}`] : undefined,
      });
    }
  };

  const top = overview.topChannel && overview.topChannel.registeredCount > 0 ? overview.topChannel : null;

  return (
    <section className="lsq-card" aria-labelledby="ov-registrations">
      <div className="lsq-card__header">
        <div>
          <h2 className="lsq-card__title" id="ov-registrations">Registrations By Channel</h2>
          <p className="lsq-card__sub">
            Attribution across the channels selected for this webinar. Select a channel to view its registered contacts.
          </p>
        </div>
        {onEditChannels && (
          <Button hierarchy="secondary" size="sm" icon={<Icon name="settings" size={14} />} onClick={onEditChannels}>
            Configure Channels
          </Button>
        )}
      </div>

      <div className="lsq-card__body lsq-stack">
        <div className="lsq-ov-reg-summary">
          <span className="lsq-ov-reg-total">
            Total registered <strong>{overview.totalRegistered.toLocaleString()}</strong>
          </span>
          <Badge color="gray" text={`${overview.channels.length} of 7 channels active`} />
          {top && <Badge color="success" text={`Top: ${top.label} (${top.registeredCount.toLocaleString()} · ${top.pctOfTotal}%)`} />}
        </div>

        {overview.untrackedRegistered > 0 && (
          <p className="lsq-hint">
            {overview.untrackedRegistered.toLocaleString()} imported without contact records, so not attributed to a channel
          </p>
        )}

        <div className="lsq-table-wrap" tabIndex={0} role="region" aria-label="Scrollable table">
          <table className="lsq-table">
            <thead>
              <tr>
                <th scope="col">Channel</th>
                <th scope="col" className="lsq-ov-num">Registered</th>
                <th scope="col">Share of total</th>
                <th scope="col">Conversion</th>
                <th scope="col">Tracking link</th>
                <th scope="col"><span className="lsq-sr-only">Registrants</span></th>
              </tr>
            </thead>
            <tbody>
              {overview.channels.map((ch) => {
                const hasRegistrations = ch.registeredCount > 0;
                const copied = copiedKey === ch.key;
                return (
                  <tr key={ch.key} className="lsq-ov-reg-row" data-empty={!hasRegistrations}>
                    <td>
                      <div className="lsq-ov-chan">
                        <span className="lsq-ov-chan__icon" aria-hidden="true">
                          <Icon name={CHANNEL_ICON[ch.key] ?? 'link'} size={16} />
                        </span>
                        <div>
                          <div className="lsq-ov-chan__name">
                            <button type="button" className="lsq-ov-chan__label" onClick={() => handleOpenChannelDrawer(ch)}>
                              {ch.label}
                            </button>
                            <Badge color={CATEGORY_COLOR[ch.category] ?? 'gray'} text={ch.category} />
                          </div>
                          <p className="lsq-ov-chan__desc">{describeChannel(ch)}</p>
                        </div>
                      </div>
                    </td>
                    <td className="lsq-ov-num lsq-ov-reg-count">{ch.registeredCount.toLocaleString()}</td>
                    <td>
                      <div className="lsq-ov-rate">
                        <div className="lsq-progress" aria-hidden="true">
                          <div className="lsq-progress__bar" style={{ width: `${Math.max(ch.pctOfTotal > 0 ? 3 : 0, ch.pctOfTotal)}%` }} />
                        </div>
                        <span className="lsq-ov-rate__text">{ch.pctOfTotal}%</span>
                      </div>
                    </td>
                    <td>
                      {ch.conversionRate !== null ? (
                        <span>
                          <strong>{ch.conversionRate}%</strong>
                          <span className="lsq-ov-sub">{ch.registeredCount.toLocaleString()} of {ch.invitedCount.toLocaleString()} invited</span>
                        </span>
                      ) : (
                        <span className="lsq-ov-subtle">{hasRegistrations ? 'Direct or inbound sign-ups' : 'Awaiting sign-ups'}</span>
                      )}
                    </td>
                    <td>
                      {ch.trackingUrl ? (
                        <div className="lsq-ov-link">
                          <span className="lsq-ov-link__url" title={ch.trackingUrl}>{ch.trackingUrl}</span>
                          <Button
                            hierarchy="secondary"
                            size="sm"
                            icon={<Icon name={copied ? 'check' : 'copy'} size={14} />}
                            ariaLabel={copied ? `Copied tracking link for ${ch.label}` : `Copy tracking link for ${ch.label}`}
                            onClick={() => void handleCopyLink(ch.key, ch.trackingUrl!)}
                          >
                            {copied ? 'Copied' : 'Copy'}
                          </Button>
                        </div>
                      ) : (
                        <span className="lsq-ov-disabled">—</span>
                      )}
                    </td>
                    <td>
                      <Button
                        hierarchy="tertiary-color"
                        size="sm"
                        icon={<Icon name="chevron-right" size={14} />}
                        iconPosition="trailing"
                        ariaLabel={`View ${ch.registeredCount} registered contacts for ${ch.label}`}
                        onClick={() => handleOpenChannelDrawer(ch)}
                      >
                        View
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="lsq-banner lsq-banner--neutral">
          <Icon name="info" size={16} />
          <p className="lsq-banner__body">
            <strong>How attribution works:</strong> registrations from all 7 tracked channels (Email Campaign, WhatsApp, LinkedIn, SDR/Sales, Third-parties, LinkedIn Event Page, Website) are captured and mapped through Zoom tracking links, LeadSquared CRM activities and Framer UTM parameters.
          </p>
        </div>
      </div>
    </section>
  );
}
