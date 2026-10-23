'use client';

import { Icon } from '@/components/ui/Icon';
import {
  AUTOMATIC_CHANNELS,
  CHANNEL_DEFINITIONS,
  SHARED_CHANNELS,
  withAutomaticChannels,
  type RegistrationChannelKey,
} from '@/lib/registrationChannels';

interface ChannelSelectionCardProps {
  selectedChannels: RegistrationChannelKey[];
  onChange: (channels: RegistrationChannelKey[]) => void;
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

// What each shared channel is for, in the words a person would use for where they paste the link.
const SHARED_BLURB: Partial<Record<RegistrationChannelKey, string>> = {
  sdr_sales: 'Your reps’ own emails, calls and personal invites',
  third_parties: 'Partner webinars, sponsors and newsletters',
  linkedin_event: 'Your LinkedIn event page and its lead-gen form',
  website: 'Your website, blog or event listing',
};

export function ChannelSelectionCard({ selectedChannels, onChange, disabled = false }: ChannelSelectionCardProps) {
  const isOn = (key: RegistrationChannelKey) => selectedChannels.includes(key);
  const sharedOn = SHARED_CHANNELS.filter(isOn).length;

  const toggle = (key: RegistrationChannelKey) => {
    if (disabled) return;
    onChange(withAutomaticChannels(isOn(key) ? selectedChannels.filter((k) => k !== key) : [...selectedChannels, key]));
  };

  return (
    <section className="lsq-card" aria-labelledby="attribution-channels-title">
      <div className="lsq-card__header">
        <div>
          <h2 className="lsq-card__title" id="attribution-channels-title">Registration Channels</h2>
          <p className="lsq-card__sub">Every registration is credited to the link it came through, so you can see what is working.</p>
        </div>
      </div>

      <div className="lsq-card__body lsq-stack lsq-stack--lg">
        <div className="lsq-wiz-auto">
          <div className="lsq-wiz-auto__head">
            <span className="lsq-wiz-group-label">Added by Webinar Studio</span>
            <span className="lsq-hint">Nothing to set up</span>
          </div>
          <ul className="lsq-wiz-auto__list">
            {AUTOMATIC_CHANNELS.map((key) => (
              <li key={key} className="lsq-wiz-auto__item">
                <Icon name={CHANNEL_ICON[key]} size={16} />
                {CHANNEL_DEFINITIONS[key].label}
                <Icon name="check" size={14} />
              </li>
            ))}
          </ul>
          <p className="lsq-hint">The right link goes into every message Studio sends or drafts.</p>
        </div>

        <fieldset className="lsq-wiz-fieldset lsq-stack lsq-stack--sm">
          <legend className="lsq-wiz-group-legend">
            <span className="lsq-wiz-group-label">Shared by you</span>
            <span className="lsq-hint">{sharedOn === 0 ? 'None on' : `${sharedOn} on`}</span>
          </legend>
          <p className="lsq-hint">
            For places Studio does not send to. Turn on the ones you use, then copy each link from the Registration tab.
          </p>
          <ul className="lsq-wiz-channels lsq-wiz-channels--pair">
            {SHARED_CHANNELS.map((key) => {
              const on = isOn(key);
              return (
                <li key={key}>
                  <label className="lsq-wiz-channel" data-checked={on ? 'true' : undefined} data-disabled={disabled ? 'true' : undefined}>
                    <input type="checkbox" id={`ch-${key}`} checked={on} disabled={disabled} onChange={() => toggle(key)} />
                    <span className="lsq-wiz-channel__body">
                      <span className="lsq-wiz-channel__name">
                        <Icon name={CHANNEL_ICON[key]} size={16} />
                        {CHANNEL_DEFINITIONS[key].label}
                      </span>
                      <span className="lsq-wiz-channel__desc">{SHARED_BLURB[key]}</span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>

        <p className="lsq-hint">Someone who registers through a plain link with no channel is counted under Website.</p>
      </div>
    </section>
  );
}
