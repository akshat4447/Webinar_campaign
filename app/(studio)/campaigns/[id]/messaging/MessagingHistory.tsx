import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { formatLsqDateTime } from '@/lib/dateFormat';
import type { Channel } from '@/lib/channels';

interface StepOption {
  key: string;
  label: string;
  channel: Channel;
  counts: { sent: number; queued: number; failed: number; skipped: number };
}

interface DeliveryRow {
  contactId: string;
  contactName: string;
  channel: Channel;
  subject: string | null;
  body: string;
  sentAt: Date | null;
  status: string;
  error: string | null;
}

const STATUS_META: Record<string, { color: string; label: string }> = {
  sent: {color:'success',label:'Accepted'},
  accepted: {color:'success',label:'Accepted'},
  provider_queued: {color:'warning',label:'CRM queued'},
  unknown: {color:'warning',label:'Uncertain'},
  failed: { color: 'error', label: 'Failed' },
  skipped: { color: 'gray blue', label: 'Skipped' },
  queued: { color: 'warning', label: 'Left Queued' },
};

const CHANNEL_LABEL: Record<Channel, string> = { email: 'Email', linkedin: 'LinkedIn', sms: 'SMS', whatsapp: 'WhatsApp' };

/**
 * Read-only replay of a completed campaign's messaging tab — every step is
 * locked, there is nothing left to generate/edit/approve, and every number
 * shown is sourced from CadenceSend/PersonalizedMessage rows rather than
 * synthesized. See app/(studio)/campaigns/[id]/messaging/page.tsx for how `rows` is
 * assembled.
 */
export function MessagingHistory({
  campaignId,
  steps,
  activeStepKey,
  rows,
}: {
  campaignId: string;
  steps: StepOption[];
  activeStepKey: string | null;
  rows: DeliveryRow[];
}) {
  const activeStep = steps.find((s) => s.key === activeStepKey) ?? null;

  return (
    <div className="lsq-stack lsq-stack--lg">
      <header className="lsq-page-header">
        <div className="lsq-page-header__text">
          <p className="lsq-page-header__eyebrow">Messaging</p>
          <h1 className="lsq-page-header__title">Sent Messages</h1>
          <p className="lsq-page-header__sub">Latest 500 dispatch records: recorded content, recipients, and provider acceptance.</p>
        </div>
      </header>

      <div className="lsq-banner lsq-banner--neutral" role="status">
        <span className="lsq-banner__icon" aria-hidden="true">
          <Icon name="lock" size={16} />
        </span>
        <div>
          <p className="lsq-banner__title">Webinar Completed</p>
          <p className="lsq-banner__body">Messaging is read-only. Nothing here can be generated, edited or resent.</p>
        </div>
      </div>

      <section className="lsq-card" aria-label="Cadence steps">
        {steps.length === 0 ? (
          <p className="lsq-card__body lsq-hint">No cadence steps were configured for this campaign.</p>
        ) : (
          <div className="lsq-msg-steps">
            <nav className="lsq-tabs" aria-label="Cadence steps">
              {steps.map((s) => {
                const active = s.key === activeStepKey;
                const total = s.counts.sent + s.counts.queued + s.counts.failed + s.counts.skipped;
                return (
                  <Link
                    key={s.key}
                    href={`/campaigns/${campaignId}/messaging?step=${s.key}`}
                    className="lsq-tab"
                    aria-current={active ? 'page' : undefined}
                    data-active={active}
                  >
                    <Icon name="lock" size={14} />
                    {s.label}
                    <Badge color="gray" text={total > 0 ? `${s.counts.sent} sent` : 'No activity'} />
                  </Link>
                );
              })}
            </nav>
          </div>
        )}
      </section>

      {activeStep && (
        <section className="lsq-card" aria-labelledby="history-step">
          <div className="lsq-card__header">
            <div>
              <h2 className="lsq-card__title" id="history-step">
                {activeStep.label}
              </h2>
              <p className="lsq-card__sub">{CHANNEL_LABEL[activeStep.channel] ?? activeStep.channel}</p>
            </div>
            <div className="lsq-chips">
              <span className="lsq-chip">
                Sent <strong>{activeStep.counts.sent.toLocaleString()}</strong>
              </span>
              {activeStep.counts.failed > 0 && (
                <span className="lsq-chip">
                  Failed <strong>{activeStep.counts.failed.toLocaleString()}</strong>
                </span>
              )}
              {activeStep.counts.skipped > 0 && (
                <span className="lsq-chip">
                  Skipped <strong>{activeStep.counts.skipped.toLocaleString()}</strong>
                </span>
              )}
              {activeStep.counts.queued > 0 && (
                <span className="lsq-chip">
                  Left queued <strong>{activeStep.counts.queued.toLocaleString()}</strong>
                </span>
              )}
            </div>
          </div>

          <div className="lsq-card__body lsq-stack">


            {rows.length === 0 ? (
              <div className="lsq-empty">
                <p className="lsq-empty__title">No Sends Recorded</p>
                <p className="lsq-empty__body">No sends were ever recorded for this step.</p>
              </div>
            ) : (
              <ul className="lsq-rows">
                {rows.map((r) => {
                  const meta = STATUS_META[r.status] ?? { color: 'gray', label: r.status };
                  return (
                    <li key={r.contactId} className="lsq-orow" data-status={r.status}>
                      <div className="lsq-orow__who">
                        <div>
                          <p className="lsq-orow__name">{r.contactName}</p>
                          <p className="lsq-orow__meta">
                            {r.status === 'sent'
                              ? `Sent ${formatLsqDateTime(r.sentAt)}`
                              : r.status === 'queued'
                                ? 'Left queued, never sent before the webinar was marked completed'
                                : (r.error ?? '—')}
                          </p>
                        </div>
                      </div>
                      <div className="lsq-orow__msg">
                        {(r.subject || r.body) && (
                          <div className="lsq-msgbox">
                            {activeStep.channel === 'email' && r.subject && <p className="lsq-msg-section-title">{r.subject}</p>}
                            <div className="lsq-msg-scroll">{r.body || '(No content recorded)'}</div>
                          </div>
                        )}
                      </div>
                      <div className="lsq-orow__actions">
                        <Badge color={meta.color} text={meta.label} dot />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
