'use client';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import {
  CHANNEL_DEFINITIONS,
  DEFAULT_SELECTED_CHANNELS,
  type RegistrationChannelKey,
} from '@/lib/registrationChannels';

interface ChannelSelectionCardProps {
  selectedChannels: RegistrationChannelKey[];
  onChange: (channels: RegistrationChannelKey[]) => void;
  zoomMeetingId?: string | null;
  disabled?: boolean;
}

// The registry's own `icon` is an emoji; the UI kit allows only the shared glyph set.
const CHANNEL_ICON: Record<RegistrationChannelKey, string> = {
  email_campaign: 'mail',
  sms: 'phone',
  whatsapp: 'whatsapp',
  linkedin: 'linkedin',
  sdr_sales: 'phone',
  third_parties: 'globe',
  linkedin_event: 'calendar',
  website: 'link',
};

const CATEGORY_COLOR: Record<string, string> = {
  outreach: 'blue',
  inbound: 'success',
  sales: 'orange',
  partner: 'purple',
  social: 'indigo',
};

export function ChannelSelectionCard({
  selectedChannels,
  onChange,
  zoomMeetingId,
  disabled = false,
}: ChannelSelectionCardProps) {
  const isSelected = (key: RegistrationChannelKey) => selectedChannels.includes(key);

  const toggleChannel = (key: RegistrationChannelKey) => {
    if (disabled) return;
    if (isSelected(key)) {
      // Keep at least one channel selected
      if (selectedChannels.length <= 1) return;
      onChange(selectedChannels.filter((k) => k !== key));
    } else {
      onChange([...selectedChannels, key]);
    }
  };

  const selectAll = () => {
    if (disabled) return;
    onChange([...DEFAULT_SELECTED_CHANNELS]);
  };

  const selectOutreachOnly = () => {
    if (disabled) return;
    onChange(['email_campaign', 'sms', 'whatsapp', 'linkedin', 'sdr_sales']);
  };

  return (
    <section className="lsq-card" aria-labelledby="attribution-channels-title">
      <div className="lsq-card__header">
        <div>
          <div className="lsq-cluster">
            <h2 className="lsq-card__title" id="attribution-channels-title">Attribution Channels</h2>
            <Badge color="blue" text={`${selectedChannels.length} of ${DEFAULT_SELECTED_CHANNELS.length} active`} />
          </div>
          <p className="lsq-card__sub">
            Select the channels to track for this webinar. Registration analytics on the Overview tab only display the channels enabled here. At least one channel stays selected.
          </p>
        </div>
        <div className="lsq-cluster">
          <Button hierarchy="secondary" size="sm" disabled={disabled} onClick={selectAll}>
            Select All ({DEFAULT_SELECTED_CHANNELS.length})
          </Button>
          <Button hierarchy="secondary" size="sm" disabled={disabled} onClick={selectOutreachOnly}>
            Outreach And Sales (5)
          </Button>
        </div>
      </div>

      <div className="lsq-card__body lsq-stack">
        <div className={`lsq-banner ${zoomMeetingId ? 'lsq-banner--success' : 'lsq-banner--neutral'}`} role="status">
          <span className="lsq-banner__icon" aria-hidden="true">
            <Icon name={zoomMeetingId ? 'bolt' : 'link'} size={16} />
          </span>
          <p className="lsq-banner__body">
            {zoomMeetingId ? (
              <>
                <strong>Zoom tracking sources synced.</strong> Each selected channel creates a dedicated tracking link
                (<span className="lsq-wiz-code-inline">?source=channel_key</span>) registering directly into Zoom and LeadSquared.
              </>
            ) : (
              <>
                <strong>Zoom and CRM sync ready.</strong> Connecting a Zoom event automatically registers tracking sources for all selected channels below.
              </>
            )}
          </p>
        </div>

        <ul className="lsq-wiz-channels">
          {DEFAULT_SELECTED_CHANNELS.map((key) => {
            const ch = CHANNEL_DEFINITIONS[key];
            const checked = isSelected(key);
            return (
              <li key={key}>
                <label className="lsq-wiz-channel" data-checked={checked ? 'true' : undefined} data-disabled={disabled ? 'true' : undefined}>
                  <input
                    type="checkbox"
                    id={`ch-${key}`}
                    checked={checked}
                    disabled={disabled}
                    onChange={() => toggleChannel(key)}
                  />
                  <span className="lsq-wiz-channel__body">
                    <span className="lsq-wiz-channel__head">
                      <span className="lsq-wiz-channel__name">
                        <Icon name={CHANNEL_ICON[key]} size={16} />
                        {ch.label}
                      </span>
                      <Badge color={checked ? (CATEGORY_COLOR[ch.category] ?? 'blue') : 'gray'} text={ch.category.charAt(0).toUpperCase() + ch.category.slice(1)} />
                    </span>
                    <span className="lsq-wiz-channel__desc">{ch.description}</span>
                    <span className="lsq-wiz-code-inline">?source={key}</span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
