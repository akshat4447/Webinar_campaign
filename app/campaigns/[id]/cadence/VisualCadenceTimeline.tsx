'use client';

interface StepSummary {
  id: string;
  title: string;
  timing: string;
  channel: string;
  enabled: boolean;
  group: string;
}

interface StepCounts {
  sent: number;
  queued: number;
  failed: number;
}

export function VisualCadenceTimeline({
  webinarDate,
  steps,
  countsByStep,
}: {
  webinarDate: string;
  steps: StepSummary[];
  countsByStep: Record<string, StepCounts>;
}) {
  const stepByKey = new Map(steps.map((s) => [s.id, s]));

  // Selected landmark stages for the visual pipeline
  const pipelineStages = [
    {
      phase: 'INVITE',
      label: 'Initial Outreach',
      stepKeys: ['invite', 'smsInvite', 'waInvite', 'linkedin'],
      defaultTiming: 'Launch',
      color: 'var(--accent-500)',
    },
    {
      phase: 'NUDGE',
      label: 'Nudge / Final Call',
      stepKeys: ['nudge', 'final'],
      defaultTiming: '+4d / +7d',
      color: 'var(--accent-purple)',
    },
    {
      phase: 'COUNTDOWN',
      label: 'Prep & Reminders',
      stepKeys: ['t3', 't1d', 't1h', 'sms'],
      defaultTiming: 'T-3d to T-1h',
      color: '#0284C7',
    },
    {
      phase: 'DOORS OPEN',
      label: '15-Min Live Nudge',
      stepKeys: ['doors_open'],
      defaultTiming: 'T-15m',
      color: '#0D9488',
    },
    {
      phase: 'LIVE EVENT',
      label: webinarDate || 'Live Webinar',
      isEvent: true,
      defaultTiming: 'Webinar Day',
      color: '#DC2625',
    },
    {
      phase: 'CONVERSION',
      label: 'Post-Event Recap & Replay',
      stepKeys: ['attend', 'noshow'],
      defaultTiming: '+0-2h',
      color: 'var(--success-700)',
    },
  ];

  return (
    <div
      style={{
        background: '#fff',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-card)',
        padding: '18px 22px',
        marginBottom: 20,
        overflowX: 'auto',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div>
          <span style={{ fontSize: 'var(--fs-body)', fontWeight: 700, color: 'var(--n90)' }}>
            Cadence Flow &amp; Timeline Pipeline
          </span>
          <span style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n50)', marginLeft: 8 }}>
            Multi-channel schedule progression
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'stretch', gap: 8, minWidth: 780 }}>
        {pipelineStages.map((stage) => {
          if (stage.isEvent) {
            return (
              <div
                key="event-stage"
                style={{
                  flex: '1 1 0',
                  minWidth: 130,
                  background: '#FEF2F2',
                  border: '1.5px solid #FCA5A5',
                  borderRadius: 'var(--radius-md)',
                  padding: '10px 12px',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  position: 'relative',
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#DC2625', animation: 'pulse 2s infinite' }} />
                    <span style={{ fontSize: 10, fontWeight: 700, color: '#991B1B', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      {stage.phase}
                    </span>
                  </div>
                  <div style={{ fontSize: 'var(--fs-label-1)', fontWeight: 700, color: '#7F1D1D', lineHeight: 1.3 }}>
                    {stage.label}
                  </div>
                </div>
                <div style={{ fontSize: 11, color: '#B91C1C', marginTop: 8, fontWeight: 600 }}>
                  Live Session Anchor
                </div>
              </div>
            );
          }

          const matchedSteps = (stage.stepKeys || []).map((k) => stepByKey.get(k)).filter(Boolean) as StepSummary[];
          const anyEnabled = matchedSteps.some((s) => s.enabled);
          const totalSent = (stage.stepKeys || []).reduce((acc, k) => acc + (countsByStep[k]?.sent || 0), 0);
          const totalQueued = (stage.stepKeys || []).reduce((acc, k) => acc + (countsByStep[k]?.queued || 0), 0);
          // The campaign's own configured offsets, not a fixed label — a step
          // moved in the Cadence Planner (e.g. nudge retimed from +4d to +2d)
          // must show up here too, not the phase's generic placeholder text.
          const realTimings = [...new Set(matchedSteps.map((s) => s.timing).filter(Boolean))];
          const timingLabel = realTimings.length > 0 ? realTimings.join(' / ') : stage.defaultTiming;

          return (
            <div
              key={stage.phase}
              style={{
                flex: '1 1 0',
                minWidth: 120,
                background: anyEnabled ? 'var(--n10)' : '#f9fafb',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                padding: '10px 12px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                opacity: anyEnabled ? 1 : 0.6,
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: stage.color, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    {stage.phase}
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--n50)', fontWeight: 600 }}>
                    {timingLabel}
                  </span>
                </div>
                <div style={{ fontSize: 'var(--fs-label-1)', fontWeight: 600, color: 'var(--n90)', lineHeight: 1.25, marginBottom: 6 }}>
                  {stage.label}
                </div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {matchedSteps.map((s) => (
                    <span
                      key={s.id}
                      style={{
                        fontSize: 9,
                        fontWeight: 600,
                        padding: '2px 5px',
                        borderRadius: 4,
                        background: s.enabled ? '#E0E7FF' : '#F3F4F6',
                        color: s.enabled ? '#3730A3' : '#6B7280',
                      }}
                    >
                      {s.channel}
                    </span>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, paddingTop: 6, borderTop: '1px solid var(--border-subtle)' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--n80)' }}>
                  {totalSent > 0 ? `${totalSent} sent` : `${totalQueued} queued`}
                </span>
                <span style={{ fontSize: 10, color: anyEnabled ? 'var(--success-700)' : 'var(--n50)', fontWeight: 600 }}>
                  {anyEnabled ? 'Active' : 'Off'}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
