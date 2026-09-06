'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  addCadenceStepAction,
  removeCadenceStepAction,
  resetScheduleAction,
  setStepTemplateAction,
  toggleCadenceStepAction,
  updateStepScheduleAction,
} from '@/lib/actions/schedule';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import { offsetLabel, resolveStepDate } from '@/lib/stepSchedule';
import { isAutomatableChannel, normalizeChannel } from '@/lib/channels';
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
  templateOptions,
}: {
  campaignId: string;
  steps: CadenceStep[];
  countsByStep: Record<string, { sent: number; queued: number; failed: number }>;
  launchAtIso: string;
  webinarAtIso: string | null;
  /** Library + this campaign's overrides, grouped by routable channel. */
  templateOptions: Record<string, { id: string; name: string; scope: string }[]>;
}) {
  const [steps, setSteps] = useState(initialSteps);
  const [seenSteps, setSeenSteps] = useState(initialSteps);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [patchError, setPatchError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<CadenceStep | null>(null);
  const router = useRouter();
  const { showToast } = useToast();

  // Props are the source of truth after any add/remove, since the server
  // decides keys and ids; local state only smooths the toggle/offset edits.
  // This is React's sanctioned "adjust state during render" pattern — an
  // effect would render the stale list once first, and a ref cannot be written
  // during render at all.
  if (seenSteps !== initialSteps) {
    setSeenSteps(initialSteps);
    setSteps(initialSteps);
  }

  async function addStep(group: string, channel: string) {
    setBusy(true);
    try {
      await addCadenceStepAction(campaignId, group, channel);
      showToast('Step added — pick its message and timing.');
      router.refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to add step.');
    } finally {
      setBusy(false);
    }
  }

  async function removeStep(step: CadenceStep) {
    setBusy(true);
    try {
      const r = await removeCadenceStepAction(campaignId, step.id);
      setConfirmRemove(null);
      showToast(r.cancelled ? `Step removed — ${r.cancelled} queued send(s) cancelled.` : 'Step removed.');
      router.refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to remove step.');
    } finally {
      setBusy(false);
    }
  }

  async function setTemplate(step: CadenceStep, templateId: string) {
    setSteps((prev) => prev.map((s) => (s.id === step.id ? { ...s, templateId: templateId || null } : s)));
    await setStepTemplateAction(campaignId, step.id, templateId || null);
  }

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
    try {
      await resetScheduleAction(campaignId);
      window.location.reload();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to reset schedule.');
      setBusy(false);
    }
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

                        {(() => {
                          const opts = templateOptions[normalizeChannel(step.channel)] ?? [];
                          return (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '6px 0 6px 0', flexWrap: 'wrap' }}>
                              <span style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n50)' }}>Message:</span>
                              <select
                                className="lsq-select"
                                aria-label={`Message for ${step.title}`}
                                value={step.templateId ?? ''}
                                disabled={busy}
                                onChange={(e) => setTemplate(step, e.target.value)}
                                style={{ height: 26, fontSize: 'var(--fs-label-2)', maxWidth: 240 }}
                              >
                                <option value="">Library default</option>
                                {opts.map((o) => (
                                  <option key={o.id} value={o.id}>
                                    {o.name} · {o.scope}
                                  </option>
                                ))}
                              </select>
                              <Link
                                href={`/templates?channel=${normalizeChannel(step.channel)}${step.templateId ? `&id=${step.templateId}` : ''}`}
                                style={{ fontSize: 'var(--fs-label-2)', fontWeight: 'var(--fw-semibold)' }}
                              >
                                Edit
                              </Link>
                            </div>
                          );
                        })()}

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
                      <button
                        type="button"
                        aria-label={`Remove ${step.title}`}
                        title="Remove this step"
                        disabled={busy}
                        onClick={() => setConfirmRemove(step)}
                        className="lsq-btn lsq-btn--tertiary"
                        style={{ width: 26, height: 26, padding: 0, color: 'var(--danger-500)', flexShrink: 0, fontSize: 16, lineHeight: 1 }}
                      >
                        ×
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Sizing the cadence is the point of the planner: three emails or
                twenty-five. The channel is chosen up front because it decides
                which messages the step can even use. */}
            {group !== 'Roadmap channels' && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 12 }}>
                <span style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n50)' }}>Add step:</span>
                {[
                  { id: 'email', label: 'Email' },
                  { id: 'whatsapp', label: 'WhatsApp' },
                  { id: 'sms', label: 'SMS' },
                  { id: 'linkedin', label: 'LinkedIn' },
                ].map((ch) => (
                  <button
                    key={ch.id}
                    type="button"
                    disabled={busy}
                    onClick={() => addStep(group, ch.id)}
                    className="lsq-btn lsq-btn--secondary lsq-btn--sm"
                    style={{ borderRadius: 'var(--radius-full)', height: 28, color: 'var(--accent-500)' }}
                  >
                    + {ch.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {confirmRemove && (
        <ConfirmDialog
          title={`Remove “${confirmRemove.title}”?`}
          message={
            confirmRemove.createdByUser
              ? 'This step was added by hand, so removing it deletes it. Any queued sends for it are cancelled.'
              : 'This is a built-in step, so it can be brought back with “Reset to defaults”. Any queued sends for it are cancelled.'
          }
          confirmLabel="Remove step"
          destructive
          busy={busy}
          onConfirm={() => removeStep(confirmRemove)}
          onClose={() => setConfirmRemove(null)}
        />
      )}
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
