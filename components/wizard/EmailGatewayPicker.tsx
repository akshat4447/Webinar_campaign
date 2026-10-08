'use client';

import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';

export type EmailGateway = 'leadsquared' | 'netcore';

const GATEWAYS: { id: EmailGateway; title: string; badge: string; blurb: string }[] = [
  {
    id: 'leadsquared',
    title: 'LeadSquared CRM',
    badge: 'CRM Native',
    blurb: 'Delivers through LeadSquared email infrastructure with automatic lead timeline sync.',
  },
  {
    id: 'netcore',
    title: 'Netcore Cloud',
    badge: 'High Speed and Webhook',
    blurb: 'Direct Netcore v5 API dispatch with real-time click-to-register webhook and suppression list.',
  },
];

/** Two-way choice between the CRM and Netcore email gateways, shared by the wizard and the edit-setup form. */
export function EmailGatewayPicker({
  value,
  onChange,
  netcoreConfigured,
  hint,
  disabled = false,
}: {
  value: EmailGateway;
  onChange: (next: EmailGateway) => void;
  netcoreConfigured?: boolean;
  hint: string;
  disabled?: boolean;
}) {
  return (
    <div className="lsq-stack lsq-stack--sm" role="group" aria-labelledby="email-gateway-label">
      <span className="lsq-label" id="email-gateway-label">Email delivery gateway</span>
      <div className="lsq-wiz-options lsq-wiz-options--two">
        {GATEWAYS.map((gw) => {
          const active = value === gw.id;
          return (
            <button
              key={gw.id}
              type="button"
              className="lsq-wiz-option"
              aria-pressed={active}
              disabled={disabled}
              onClick={() => onChange(gw.id)}
            >
              <span className="lsq-wiz-option__head">
                <span className="lsq-wiz-option__title">{gw.title}</span>
                <Badge color={active ? 'blue' : 'gray'} text={gw.badge} />
              </span>
              <span className="lsq-wiz-option__blurb">{gw.blurb}</span>
            </button>
          );
        })}
      </div>
      <p className="lsq-hint">{hint}</p>
      {value === 'netcore' && !netcoreConfigured && (
        <div className="lsq-banner lsq-banner--warning" role="status">
          <span className="lsq-banner__icon" aria-hidden="true"><Icon name="warning" size={16} /></span>
          <p className="lsq-banner__body">
            Netcore is not configured yet. Add an API key on the Integrations page before launching, or every send through this gateway will fail.
          </p>
        </div>
      )}
    </div>
  );
}
