'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { toggleCadenceStepAction, updateStepScheduleAction, resetScheduleAction } from '@/lib/actions/schedule';
import { offsetLabel, resolveStepDate } from '@/lib/stepSchedule';
import { isAutomatableChannel } from '@/lib/channels';
import type { CadenceStep } from '@/lib/generated/prisma/client';

const GROUP_ORDER = ['Pre-registration', 'Reminders · registrants only', 'Post-webinar · within 2 hrs', 'Roadmap channels'];

const GROUP_BLURB: Record<string, string> = {
  'Pre-registration': 'Timed from the moment you launch the cadence.',
  'Reminders · registrants only': 'Timed from the webinar start — set the date on Setup and these follow it.',
  'Post-webinar · within 2 hrs': 'Timed from the webinar start; sending is triggered by the attendance import.',
  'Roadmap channels': 'Not scheduled — behind the cadence engine.',
};

function channelColor(channel: string): string {
  if (channel.includes('LinkedIn')) return 'gray blue';
  if (channel === 'WhatsApp' || channel === 'SMS') return 'warning';
  return 'blue';
}

export function CadenceGroups({
  campaignId,
  steps: initialSteps,
  countsByStep,
  launchAtIso,
  webinarAtIso,
}: {
  campaignId: string;
  steps: CadenceStep[];
  countsByStep: Record<string, { sent: number; queued: number; failed: number }>;
  launchAtIso: string;
  webinarAtIso: string | null;
}) {
  const [steps, setSteps] = useState(initialSteps);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [patchError, setPatchError] = useState<string | null>(null);

  const launchAt = new Date(launchAtIso);
  const webinarAt = webinarAtIso ? new Date(webinarAtIso) : null;

  function toggle(step: CadenceStep) {
    const next = !step.enabled;
    setSteps((ss) => ss.map((s) => (s.id === step.id ? { ...s, enabled: next } : s)));
    toggleCadenceStepAction(campaignId, step.key, next);
  }

  async function patch(step: CadenceStep, next: Partial<Pick<CadenceStep, 'offsetValue' | 'offsetUnit' | 'anchor'>>) {
    setSteps((ss) => ss.map((s) => (s.id === step.id ? { ...s, ...next } : s)));
    const res = await updateStepScheduleAction(campaignId, step.key, next);
    if (!res.ok) {
      // The server rejected this (e.g. a NaN offset) — revert the optimistic
      // update so the UI doesn't keep showing a value that was never saved.
      setSteps((ss) => ss.map((s) => (s.id === step.id ? step : s)));
      setPatchError(res.error);
    } else {
      setPatchError(null);
    }
  }

  async function resetAll() {
    setBusy(true);
    await resetScheduleAction(campaignId);
    setBusy(false);
    window.location.reload();
  }

  const fmt = (d: Date) => d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 'var(--fs-body)', fontWeight: 700, color: 'var(--n90)' }}>Cadence schedule</div>
          <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n60)', marginTop: 2 }}>
            Every step is editable. Pre-registration is timed from launch; reminders and follow-ups from the webinar date.
          </div>
        </div>
        <Button hierarchy="tertiary" size="sm" onClick={resetAll} disabled={busy}>
          {busy ? 'Resetting…' : 'Reset to defaults'}
        </Button>
      </div>

      {!webinarAt && (
        <div style={{ background: 'var(--warning-100)', borderRadius: 'var(--radius-md)', padding: '11px 14px', fontSize: 'var(--fs-label-1)', color: 'var(--warning-700)' }}>
          No webinar date set yet — reminder and post-webinar steps can&apos;t resolve to a real time until you set one on Setup.
        </div>
      )}

      {patchError && (
        <div style={{ background: 'var(--danger-50, #fef2f2)', borderRadius: 'var(--radius-md)', padding: '10px 14px', fontSize: 'var(--fs-label-1)', color: 'var(--danger-500)' }}>
          {patchError}
        </div>
      )}

      {GROUP_ORDER.map((group) => {
        const groupSteps = steps.filter((s) => s.group === group);
        if (groupSteps.length === 0) return null;
        return (
          <div key={group}>
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 'var(--fs-label-1)', fontWeight: 700, color: 'var(--n60)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{group}</div>
              {GROUP_BLURB[group] && <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n50)', marginTop: 3 }}>{GROUP_BLURB[group]}</div>}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {groupSteps.map((step) => {
                const counts = countsByStep[step.key];
                // Any step on a channel the app can send produces send rows
                // worth counting — including registration- and
                // attendance-triggered ones, which the old key allowlist
                // wrongly excluded from this display.
                const isAutomated = isAutomatableChannel(step.channel);
                const resolved = resolveStepDate(step, { launchAt, webinarAt });
                const isEditing = editing === step.id;
                const schedulable = !step.isRoadmap && step.anchor !== 'event';

                return (
                  <div key={step.id} style={{ background: '#fff', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-card)', padding: '14px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                      {/* Timing cell — click to edit */}
                      <div
                        onClick={schedulable ? () => setEditing(isEditing ? null : step.id) : undefined}
                        style={{
                          width: 118,
                          flexShrink: 0,
                          cursor: schedulable ? 'pointer' : 'default',
                          background: isEditing ? 'var(--accent-50)' : 'var(--n10)',
                          border: isEditing ? '1px solid var(--accent-500)' : '1px solid transparent',
                          borderRadius: 'var(--radius-sm)',
                          padding: '6px 8px',
                        }}
                      >
                        <div style={{ fontSize: 'var(--fs-label-1)', fontWeight: 700, color: schedulable ? 'var(--n90)' : 'var(--n60)' }}>{offsetLabel(step)}</div>
                        <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--n50)', marginTop: 1 }}>
                          {resolved ? fmt(resolved) : step.anchor === 'event' ? 'no fixed time' : 'needs a date'}
                        </div>
                        {schedulable && <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--accent-500)', marginTop: 3, fontWeight: 600 }}>{isEditing ? 'Editing' : 'Edit timing'}</div>}
                      </div>

                      <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--border-subtle)', flexShrink: 0 }} />

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 'var(--fs-label-1)', fontWeight: 600, color: 'var(--n90)' }}>{step.title}</span>
                          <Badge color={channelColor(step.channel)} text={step.channel} />
                          {step.isRoadmap && <Badge color="warning" text="Roadmap" />}
                          {step.key === 'linkedin' && <Badge color="gray" text="Manual or bot" />}
                          {step.anchor === 'event' && !step.isRoadmap && <Badge color="gray" text="Event-triggered" />}
                        </div>
                        <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--n60)', overflowWrap: 'anywhere', marginBottom: 4 }}>{step.desc}</div>

                        {(isAutomated || counts) && (
                          <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n50)' }}>
                            Sent {counts?.sent ?? 0} · Queued {counts?.queued ?? 0} ·{' '}
                            <span style={{ color: counts?.failed ? 'var(--danger-500)' : 'var(--n50)' }}>Failed {counts?.failed ?? 0}</span>
                          </div>
                        )}

                        {isEditing && (
                          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
                            <div>
                              <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n60)', marginBottom: 4 }}>Offset</div>
                              <input
                                className="lsq-input"
                                type="number"
                                value={step.offsetValue}
                                onChange={(e) => patch(step, { offsetValue: Number(e.target.value) })}
                                style={{ width: 84, height: 34 }}
                              />
                            </div>
                            <div>
                              <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n60)', marginBottom: 4 }}>Unit</div>
                              <select
                                className="lsq-select"
                                value={step.offsetUnit}
                                onChange={(e) => patch(step, { offsetUnit: e.target.value })}
                                style={selectStyle}
                              >
                                <option value="days">days</option>
                                <option value="hours">hours</option>
                              </select>
                            </div>
                            <div>
                              <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n60)', marginBottom: 4 }}>Relative to</div>
                              <select
                                className="lsq-select"
                                value={step.anchor}
                                onChange={(e) => patch(step, { anchor: e.target.value })}
                                style={selectStyle}
                              >
                                <option value="launch">cadence launch</option>
                                <option value="webinar">webinar start</option>
                              </select>
                            </div>
                            <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n60)', paddingBottom: 9 }}>
                              Negative values run <strong style={{ color: 'var(--n80)' }}>before</strong> the anchor — that&apos;s how T-3d works.
                            </div>
                          </div>
                        )}
                      </div>

                      {step.isRoadmap && <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n50)', flexShrink: 0 }}>Behind cadence engine</div>}
                      {step.toggleable && <Checkbox checked={step.enabled} onChange={() => toggle(step)} size={16} />}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </>
  );
}

const selectStyle: React.CSSProperties = {
  height: 34,
  borderRadius: 'var(--radius-sm)',
  boxShadow: 'inset 0 0 0 1px var(--border-default)',
  padding: '0 30px 0 10px',
  fontFamily: 'var(--font-body)',
  fontSize: 'var(--fs-label-1)',
  color: 'var(--n90)',
  background: '#fff',
  border: 'none',
};
