import type { CadenceStep } from '@/lib/generated/prisma/client';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { formatLsqDate } from '@/lib/dateFormat';

interface StepCounts {
  sent: number;
  queued: number;
  failed: number;
}

interface SentRange {
  first: Date | null;
  last: Date | null;
}

const CH_ICON: Record<string, string> = { Email: 'mail', LinkedIn: 'linkedin', WhatsApp: 'whatsapp', SMS: 'sms' };

function chOf(channel: string): string {
  if (channel.includes('LinkedIn')) return 'LinkedIn';
  if (channel.includes('SMS')) return 'SMS';
  if (channel.includes('WhatsApp')) return 'WhatsApp';
  return 'Email';
}

// Same timezone as the rest of the app (lib/dateFormat.ts defaults to Asia/Kolkata), so a send
// timestamp near midnight IST resolves to the same calendar day here as everywhere else.
function formatDate(d: Date | null): string {
  if (!d) return '\u2014';
  return formatLsqDate(new Date(d));
}

/**
 * Read-only replay of a completed campaign's cadence — every step is locked
 * (no timing edits, no enable/disable, no add/remove), there is no LinkedIn
 * dispatch surface, and the stop-rules block shows the final saved value as
 * plain text instead of a live toggle. Every figure comes from CadenceSend
 * aggregates computed in page.tsx, never invented. See
 * app/campaigns/[id]/cadence/CadenceGroups.tsx for the live/editable
 * counterpart this mirrors visually.
 */
export function CadenceHistory({
  steps,
  countsByStep,
  sentRangeByStep,
}: {
  steps: CadenceStep[];
  countsByStep: Record<string, StepCounts>;
  sentRangeByStep: Record<string, SentRange>;
  automationRules?: {
    stopOnRegistration?: boolean;
    stopOnDecline?: boolean;
    oneClickSignup?: boolean;
  };
}) {
  const stage1Steps = steps.filter(
    (s) => s.group === 'Pre-registration' || s.group === 'Invitation sequence' || (s.trigger === 'launch' && s.anchor === 'launch')
  );
  const stage2Steps = steps.filter(
    (s) =>
      s.group === 'Reminders · registrants only' ||
      s.trigger === 'registration' ||
      (s.anchor === 'webinar' && s.offsetValue <= 0 && s.key !== 'attend' && s.key !== 'noshow')
  );
  const stage3Steps = steps.filter(
    (s) => s.group === 'Post-webinar · within 2 hrs' || s.group === 'Post-webinar' || s.key === 'attend' || s.key === 'noshow' || s.trigger === 'attendance'
  );

  function renderStepRow(step: CadenceStep) {
    const counts = countsByStep[step.key] ?? { sent: 0, queued: 0, failed: 0 };
    const range = sentRangeByStep[step.key];
    const ch = chOf(step.channel);
    const total = counts.sent + counts.queued + counts.failed;

    return (
      <li key={step.id} className="lsq-step-row lsq-res-hist-row">
        <span className="lsq-chan" data-ch={ch} aria-hidden="true">
          <Icon name={CH_ICON[ch] ?? 'mail'} size={18} />
        </span>

        <div className="lsq-step-row__main">
          <p className="lsq-step-row__title">
            {step.title}
            <Badge color="gray" text={ch} />
            {!step.enabled && <Badge color="warning" text="Paused before completion" />}
          </p>
          <p className="lsq-step-row__desc">{step.desc}</p>

          {total === 0 ? (
            <div className="lsq-step-row__meta">
              <span>No sends recorded for this step.</span>
            </div>
          ) : (
            <div className="lsq-step-row__meta">
              {counts.sent > 0 && (
                <Badge
                  color="success"
                  text={`Sent (${counts.sent.toLocaleString()})${range?.first ? ` | ${formatDate(range.first)}${range.last && range.last.getTime() !== range.first.getTime() ? ` to ${formatDate(range.last)}` : ''}` : ''}`}
                />
              )}
              {counts.failed > 0 && <Badge color="error" text={`Failed (${counts.failed.toLocaleString()})`} />}
              {counts.queued > 0 && (
                <Badge color="warning" text={`${counts.queued.toLocaleString()} left queued, never sent before this webinar was marked completed`} />
              )}
            </div>
          )}
        </div>

        <div className="lsq-step-row__side">
          <Badge color="gray" text="Locked" />
        </div>
      </li>
    );
  }

  const stages = [
    { num: 1, title: 'Invitation Sequence', rows: stage1Steps },
    { num: 2, title: 'Reminders For Registrants', rows: stage2Steps },
    { num: 3, title: 'After The Webinar', rows: stage3Steps },
  ].filter((st) => st.rows.length > 0);

  return (
    <div className="lsq-page">
      <header className="lsq-page-header">
        <div className="lsq-page-header__text">
          <p className="lsq-page-header__eyebrow">Cadence</p>
          <h1 className="lsq-page-header__title">Webinar Cadence</h1>
          <p className="lsq-page-header__sub">
            {steps.length.toLocaleString()} step{steps.length === 1 ? '' : 's'}. Read-only delivery history, nothing here can send again.
          </p>
        </div>
        <div className="lsq-page-header__actions">
          <Badge color="success" text="Completed" dot />
        </div>
      </header>

      {stages.map((st) => (
        <section key={st.num} className="lsq-card" aria-labelledby={`hist-stage-${st.num}`}>
          <div className="lsq-stage__head">
            <span className="lsq-stage__n" aria-hidden="true">{st.num}</span>
            <h2 className="lsq-stage__title" id={`hist-stage-${st.num}`}>{st.title}</h2>
          </div>
          <ul className="lsq-steps">{st.rows.map(renderStepRow)}</ul>
        </section>
      ))}
    </div>
  );
}
