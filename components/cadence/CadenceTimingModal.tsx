'use client';

import { useState, useEffect, useMemo } from 'react';
import { applyOffset } from '@/lib/stepSchedule';
import { formatLsqDateTime } from '@/lib/dateFormat';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Field } from '@/components/ui/Field';

export interface CadenceTimingSelection {
  timing: string;
  offsetValue: number;
  offsetUnit: string;
  anchor: string;
}

interface CadenceTimingModalProps {
  isOpen: boolean;
  onClose: () => void;
  stepTitle: string;
  stepKey?: string;
  channel: string;
  group?: string;
  currentTiming: string;
  currentOffsetValue?: number | null;
  currentOffsetUnit?: string | null;
  currentAnchor?: string | null;
  webinarDate?: string | Date | null;
  launchDate?: string | Date | null;
  onSave: (selection: CadenceTimingSelection) => void | Promise<void>;
  isSaving?: boolean;
}

interface PresetOption {
  id: string;
  label: string;
  sublabel: string;
  badge?: string;
  timing: string;
  offsetValue: number;
  offsetUnit: string;
  anchor: string;
  category: 'launch' | 'webinar' | 'event';
}

/** Local wall-clock of a Date, printed unchanged on server and client. */
function fmtLocal(d: Date): string {
  return formatLsqDateTime(new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes())), 'UTC');
}

const PRESETS: PresetOption[] = [
  // Instant / Launch
  {
    id: 'instant-launch',
    label: 'Instant (send on launch)',
    sublabel: 'Dispatches immediately when campaign launches',
    badge: 'Immediate',
    timing: 'Instant',
    offsetValue: 0,
    offsetUnit: 'hours',
    anchor: 'launch',
    category: 'launch',
  },
  {
    id: 'launch-1d',
    label: '+1 day after launch',
    sublabel: '24 hours after launch',
    timing: '+1 day',
    offsetValue: 1,
    offsetUnit: 'days',
    anchor: 'launch',
    category: 'launch',
  },
  {
    id: 'launch-2d',
    label: '+2 days after launch',
    sublabel: '48 hours after launch',
    timing: '+2 days',
    offsetValue: 2,
    offsetUnit: 'days',
    anchor: 'launch',
    category: 'launch',
  },
  {
    id: 'launch-3d',
    label: '+3 days after launch',
    sublabel: '72 hours after launch',
    timing: '+3 days',
    offsetValue: 3,
    offsetUnit: 'days',
    anchor: 'launch',
    category: 'launch',
  },
  {
    id: 'launch-4d',
    label: '+4 days after launch',
    sublabel: 'Standard nudge follow-up window',
    timing: '+4 days',
    offsetValue: 4,
    offsetUnit: 'days',
    anchor: 'launch',
    category: 'launch',
  },
  {
    id: 'launch-7d',
    label: '+7 days after launch',
    sublabel: 'One week follow-up',
    timing: '+7 days',
    offsetValue: 7,
    offsetUnit: 'days',
    anchor: 'launch',
    category: 'launch',
  },

  // Pre-Webinar
  {
    id: 'webinar-t3d',
    label: 'T-3 days before webinar',
    sublabel: 'Warm countdown and topic highlight',
    timing: 'T-3 days',
    offsetValue: -3,
    offsetUnit: 'days',
    anchor: 'webinar',
    category: 'webinar',
  },
  {
    id: 'webinar-t2d',
    label: 'T-2 days before webinar',
    sublabel: '48 hours before live session',
    timing: 'T-2 days',
    offsetValue: -2,
    offsetUnit: 'days',
    anchor: 'webinar',
    category: 'webinar',
  },
  {
    id: 'webinar-t1d',
    label: 'T-1 day (24h before)',
    sublabel: 'Final preparation and join link',
    timing: 'T-1 day',
    offsetValue: -1,
    offsetUnit: 'days',
    anchor: 'webinar',
    category: 'webinar',
  },
  {
    id: 'webinar-t1h',
    label: 'T-1 hour before webinar',
    sublabel: 'Urgent reminder: "Starting in 60 mins"',
    timing: 'T-1 hour',
    offsetValue: -1,
    offsetUnit: 'hours',
    anchor: 'webinar',
    category: 'webinar',
  },
  {
    id: 'webinar-t15m',
    label: 'T-15 mins (Doors Open)',
    sublabel: 'Live broadcast is opening right now',
    timing: 'T-15 mins',
    offsetValue: -15,
    offsetUnit: 'minutes',
    anchor: 'webinar',
    category: 'webinar',
  },

  // Event & Post-Webinar
  {
    id: 'event-confirm',
    label: 'Instant on Registration',
    sublabel: 'Sends the moment contact registers',
    timing: 'On Registration',
    offsetValue: 0,
    offsetUnit: 'hours',
    anchor: 'event',
    category: 'event',
  },
  {
    id: 'webinar-post2h',
    label: '+2 hours post-webinar',
    sublabel: 'Recording and demo call CTA',
    timing: '+2 hours',
    offsetValue: 2,
    offsetUnit: 'hours',
    anchor: 'webinar',
    category: 'event',
  },
  {
    id: 'webinar-post1d',
    label: '+1 day post-webinar',
    sublabel: 'Full recap and attendee debrief',
    timing: '+1 day',
    offsetValue: 1,
    offsetUnit: 'days',
    anchor: 'webinar',
    category: 'event',
  },
];

export function CadenceTimingModal({
  isOpen,
  onClose,
  stepTitle,
  channel,
  currentTiming,
  currentOffsetValue,
  currentOffsetUnit,
  currentAnchor,
  webinarDate,
  launchDate,
  onSave,
  isSaving = false,
}: CadenceTimingModalProps) {
  // Parse initial state
  const initialOffsetValue = typeof currentOffsetValue === 'number' ? currentOffsetValue : 0;
  const initialOffsetUnit = currentOffsetUnit || 'days';
  const initialAnchor = currentAnchor || (currentTiming.toLowerCase().includes('t-') ? 'webinar' : 'launch');

  const [activeTab, setActiveTab] = useState<'presets' | 'custom' | 'exact-date'>('presets');
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);

  // Custom offset state
  const [customValue, setCustomValue] = useState<number>(Math.abs(initialOffsetValue) || 1);
  const [customUnit, setCustomUnit] = useState<string>(initialOffsetUnit || 'days');
  const [customRelation, setCustomRelation] = useState<'after_launch' | 'before_webinar' | 'after_webinar' | 'on_registration'>(() => {
    if (initialAnchor === 'event') return 'on_registration';
    if (initialAnchor === 'webinar') return initialOffsetValue < 0 ? 'before_webinar' : 'after_webinar';
    return 'after_launch';
  });

  // Exact date/time state
  const [exactDate, setExactDate] = useState<string>('');
  const [exactTime, setExactTime] = useState<string>('10:00');

  // Parse webinar / launch dates
  const parsedWebinarDate = useMemo(() => {
    if (!webinarDate) return null;
    const d = new Date(webinarDate);
    return isNaN(d.getTime()) ? null : d;
  }, [webinarDate]);

  const parsedLaunchDate = useMemo(() => {
    if (!launchDate) return new Date();
    const d = new Date(launchDate);
    return isNaN(d.getTime()) ? new Date() : d;
  }, [launchDate]);

  // Sync state on open. Intentional: re-seeds the form from props each time the
  // modal opens, which is exactly the prop-to-state sync this rule can't model.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!isOpen) return;

    // Detect if matches an existing preset
    const matching = PRESETS.find(
      (p) =>
        p.anchor === initialAnchor &&
        p.offsetValue === initialOffsetValue &&
        p.offsetUnit === initialOffsetUnit
    );

    if (matching) {
      setSelectedPresetId(matching.id);
      setActiveTab('presets');
    } else {
      setSelectedPresetId(null);
      setCustomValue(Math.abs(initialOffsetValue) || 1);
      setCustomUnit(initialOffsetUnit || 'days');
      if (initialAnchor === 'event') setCustomRelation('on_registration');
      else if (initialAnchor === 'webinar') setCustomRelation(initialOffsetValue < 0 ? 'before_webinar' : 'after_webinar');
      else setCustomRelation('after_launch');
      setActiveTab('custom');
    }

    if (parsedWebinarDate) {
      const year = parsedWebinarDate.getFullYear();
      const month = String(parsedWebinarDate.getMonth() + 1).padStart(2, '0');
      const day = String(parsedWebinarDate.getDate()).padStart(2, '0');
      setExactDate(`${year}-${month}-${day}`);
      const hours = String(parsedWebinarDate.getHours()).padStart(2, '0');
      const mins = String(parsedWebinarDate.getMinutes()).padStart(2, '0');
      setExactTime(`${hours}:${mins}`);
    }
  }, [isOpen, initialOffsetValue, initialOffsetUnit, initialAnchor, parsedWebinarDate]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Compute active selection based on current tab & inputs
  const currentSelection: CadenceTimingSelection = useMemo(() => {
    if (activeTab === 'presets') {
      const preset = PRESETS.find((p) => p.id === selectedPresetId);
      if (preset) {
        return {
          timing: preset.timing,
          offsetValue: preset.offsetValue,
          offsetUnit: preset.offsetUnit,
          anchor: preset.anchor,
        };
      }
      // Default to instant on launch
      return {
        timing: 'Instant',
        offsetValue: 0,
        offsetUnit: 'hours',
        anchor: 'launch',
      };
    }

    if (activeTab === 'exact-date' && exactDate) {
      const targetTimeStr = `${exactDate}T${exactTime || '10:00'}:00`;
      const target = new Date(targetTimeStr);
      if (!isNaN(target.getTime())) {
        if (parsedWebinarDate) {
          const diffMs = target.getTime() - parsedWebinarDate.getTime();
          const diffHours = Math.round(diffMs / (1000 * 60 * 60));
          const diffDays = Math.round(diffHours / 24);

          if (diffHours === 0) {
            return { timing: 'At webinar start', offsetValue: 0, offsetUnit: 'hours', anchor: 'webinar' };
          }
          if (Math.abs(diffHours) < 24) {
            const timing = diffHours < 0 ? `T-${Math.abs(diffHours)} hour${Math.abs(diffHours) === 1 ? '' : 's'}` : `+${diffHours} hours`;
            return { timing, offsetValue: diffHours, offsetUnit: 'hours', anchor: 'webinar' };
          }
          const timing = diffDays < 0 ? `T-${Math.abs(diffDays)} day${Math.abs(diffDays) === 1 ? '' : 's'}` : `+${diffDays} days`;
          return { timing, offsetValue: diffDays, offsetUnit: 'days', anchor: 'webinar' };
        } else {
          const diffMs = target.getTime() - parsedLaunchDate.getTime();
          const diffDays = Math.max(0, Math.round(diffMs / (1000 * 60 * 60 * 24)));
          return {
            timing: diffDays === 0 ? 'Instant' : `+${diffDays} days`,
            offsetValue: diffDays,
            offsetUnit: 'days',
            anchor: 'launch',
          };
        }
      }
    }

    // Custom offset
    if (customRelation === 'on_registration') {
      return {
        timing: 'On Registration',
        offsetValue: 0,
        offsetUnit: 'hours',
        anchor: 'event',
      };
    }

    if (customRelation === 'after_launch') {
      if (customValue === 0) {
        return {
          timing: 'Instant',
          offsetValue: 0,
          offsetUnit: 'hours',
          anchor: 'launch',
        };
      }
      return {
        timing: `+${customValue} ${customUnit}`,
        offsetValue: customValue,
        offsetUnit: customUnit,
        anchor: 'launch',
      };
    }

    if (customRelation === 'before_webinar') {
      const unitLabel = customUnit === 'minutes' ? 'mins' : customUnit === 'hours' ? 'hour' : 'day';
      const plural = customUnit === 'minutes' ? 'mins' : customValue === 1 ? unitLabel : `${unitLabel}s`;
      return {
        timing: `T-${customValue} ${plural}`,
        offsetValue: -Math.abs(customValue),
        offsetUnit: customUnit,
        anchor: 'webinar',
      };
    }

    // after_webinar
    const unitLabel = customUnit === 'minutes' ? 'mins' : customUnit === 'hours' ? 'hour' : 'day';
    const plural = customUnit === 'minutes' ? 'mins' : customValue === 1 ? unitLabel : `${unitLabel}s`;
    return {
      timing: `+${customValue} ${plural} after`,
      offsetValue: Math.abs(customValue),
      offsetUnit: customUnit,
      anchor: 'webinar',
    };
  }, [activeTab, selectedPresetId, customValue, customUnit, customRelation, exactDate, exactTime, parsedWebinarDate, parsedLaunchDate]);

  // Compute human-friendly live preview
  const previewInfo = useMemo(() => {
    const { offsetValue, offsetUnit, anchor, timing } = currentSelection;

    if (anchor === 'event') {
      return {
        icon: 'bolt' as const,
        title: 'Event trigger: on registration',
        subtitle: 'Sends automatically the instant a recipient completes registration.',
      };
    }

    if (anchor === 'launch' && offsetValue === 0) {
      return {
        icon: 'bolt' as const,
        title: 'Immediate send: on launch',
        subtitle: 'Fires the moment the cadence is launched, with no wait time.',
      };
    }

    if (anchor === 'launch') {
      const target = applyOffset(parsedLaunchDate, offsetValue, offsetUnit);
      return {
        icon: 'play' as const,
        title: `Launch offset: ${timing}`,
        subtitle: `Dispatches about ${fmtLocal(target)} (${offsetValue} ${offsetUnit} after launch).`,
      };
    }

    if (anchor === 'webinar') {
      if (parsedWebinarDate) {
        const target = applyOffset(parsedWebinarDate, offsetValue, offsetUnit);
        return {
          icon: 'clock' as const,
          title: `Webinar schedule: ${fmtLocal(target)}`,
          subtitle: `${timing} relative to the webinar date (${fmtLocal(parsedWebinarDate)}).`,
        };
      }
      return {
        icon: 'clock' as const,
        title: `Webinar schedule: ${timing}`,
        subtitle: 'The webinar date must be set in the campaign details to calculate the exact delivery time.',
      };
    }

    return {
      icon: 'calendar' as const,
      title: timing,
      subtitle: `Offset: ${offsetValue} ${offsetUnit} (${anchor})`,
    };
  }, [currentSelection, parsedWebinarDate, parsedLaunchDate]);

  if (!isOpen) return null;

  const presetGroups: Array<{ title: string; items: PresetOption[] }> = [
    { title: 'Outreach follow-ups (after launch)', items: PRESETS.filter((p) => p.category === 'launch' && p.id !== 'instant-launch') },
    { title: 'Countdown reminders (before webinar)', items: PRESETS.filter((p) => p.category === 'webinar') },
    { title: 'Registration and post-event', items: PRESETS.filter((p) => p.category === 'event') },
  ];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      busy={isSaving}
      title="Configure Step Timing"
      subtitle={`${channel} step: ${stepTitle}`}
      footer={
        <>
          <Button hierarchy="secondary" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={() => onSave(currentSelection)} loading={isSaving}>
            {isSaving ? 'Applying' : 'Apply Timing'}
          </Button>
        </>
      }
    >
      <div className="lsq-stack lsq-stack--lg">
        <div className="lsq-segmented lsq-wiz-modes-switch" role="group" aria-label="How to set the timing">
          <button type="button" aria-pressed={activeTab === 'presets'} onClick={() => setActiveTab('presets')}>
            Quick Presets
          </button>
          <button type="button" aria-pressed={activeTab === 'custom'} onClick={() => setActiveTab('custom')}>
            Custom Offset
          </button>
          <button type="button" aria-pressed={activeTab === 'exact-date'} onClick={() => setActiveTab('exact-date')}>
            Exact Date And Time
          </button>
        </div>

        {activeTab === 'presets' && (
          <div className="lsq-stack lsq-stack--lg">
            <div className="lsq-stack lsq-stack--sm">
              <p className="lsq-label">Immediate execution</p>
              <button
                type="button"
                className="lsq-wiz-preset"
                aria-pressed={selectedPresetId === 'instant-launch'}
                onClick={() => setSelectedPresetId('instant-launch')}
              >
                <span className="lsq-wiz-preset__label">
                  <Icon name="bolt" size={16} />
                  Instant (send on launch)
                </span>
                <span className="lsq-wiz-preset__sub">Fires the touchpoint as soon as the cadence is started.</span>
              </button>
            </div>

            {presetGroups.map((group) => (
              <div key={group.title} className="lsq-stack lsq-stack--sm">
                <p className="lsq-label">{group.title}</p>
                <div className="lsq-grid lsq-grid--narrow">
                  {group.items.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className="lsq-wiz-preset"
                      aria-pressed={selectedPresetId === p.id}
                      onClick={() => setSelectedPresetId(p.id)}
                    >
                      <span className="lsq-wiz-preset__label">{p.label}</span>
                      <span className="lsq-wiz-preset__sub">{p.sublabel}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'custom' && (
          <div className="lsq-stack">
            <Field label="Timing rule and anchor">
              {(p) => (
                <select {...p} className="lsq-select" value={customRelation} onChange={(e) => setCustomRelation(e.target.value as typeof customRelation)}>
                  <option value="after_launch">After campaign launch (outreach)</option>
                  <option value="before_webinar">Before webinar start (T-minus countdown)</option>
                  <option value="after_webinar">After webinar concludes (follow-up)</option>
                  <option value="on_registration">Immediately when a contact registers</option>
                </select>
              )}
            </Field>

            {customRelation !== 'on_registration' && (
              <div className="lsq-grid lsq-grid--narrow">
                <Field label="Offset amount">
                  {(p) => (
                    <input
                      {...p}
                      className="lsq-input"
                      type="number"
                      min={0}
                      max={365}
                      value={customValue}
                      onChange={(e) => setCustomValue(Math.max(0, parseInt(e.target.value, 10) || 0))}
                    />
                  )}
                </Field>
                <Field label="Unit">
                  {(p) => (
                    <select {...p} className="lsq-select" value={customUnit} onChange={(e) => setCustomUnit(e.target.value)}>
                      <option value="days">Days</option>
                      <option value="hours">Hours</option>
                      <option value="minutes">Minutes</option>
                    </select>
                  )}
                </Field>
              </div>
            )}

            {customRelation === 'after_launch' && customValue === 0 && (
              <div className="lsq-banner lsq-banner--warning">
                <Icon name="info" size={18} />
                <p className="lsq-banner__body">A value of 0 sends this step immediately when the campaign launches.</p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'exact-date' && (
          <div className="lsq-stack">
            <p className="lsq-hint">Pick an exact calendar date and time. It is mapped to the closest offset relative to the webinar.</p>
            <div className="lsq-grid lsq-grid--narrow">
              <Field label="Target send date">
                {(p) => <input {...p} className="lsq-input" type="date" value={exactDate} onChange={(e) => setExactDate(e.target.value)} />}
              </Field>
              <Field label="Time">
                {(p) => <input {...p} className="lsq-input" type="time" value={exactTime} onChange={(e) => setExactTime(e.target.value)} />}
              </Field>
            </div>
            {parsedWebinarDate && (
              <p className="lsq-hint">
                Anchor webinar: <strong>{fmtLocal(parsedWebinarDate)}</strong>
              </p>
            )}
          </div>
        )}

        <div className="lsq-banner lsq-banner--neutral" role="status" aria-live="polite">
          <Icon name={previewInfo.icon} size={18} />
          <div>
            <p className="lsq-banner__title lsq-wiz-preview__title">
              {previewInfo.title}
              <Badge color="blue" text={currentSelection.timing} />
            </p>
            <p className="lsq-banner__body">{previewInfo.subtitle}</p>
          </div>
        </div>
      </div>
    </Modal>
  );
}
