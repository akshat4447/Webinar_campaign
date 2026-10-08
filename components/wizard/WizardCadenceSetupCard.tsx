'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Toggle } from '@/components/ui/Toggle';
import { Icon } from '@/components/ui/Icon';
import { Field } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import {
  toggleCadenceStepAction,
  removeCadenceStepAction,
  updateCadenceStepTimingAction,
} from '@/lib/actions/schedule';
import { addWizardCadenceStepAction } from '@/lib/actions/wizard';
import { CadenceTimingModal, type CadenceTimingSelection } from '@/components/cadence/CadenceTimingModal';
import { applyOffset } from '@/lib/stepSchedule';
import { formatLsqDate, formatLsqDateTime } from '@/lib/dateFormat';

export interface WizardCadenceStep {
  id: string;
  key: string;
  title: string;
  timing: string;
  channel: string;
  enabled: boolean;
  group: string;
  desc?: string;
  offsetValue?: number | null;
  offsetUnit?: string | null;
  anchor?: string | null;
  mode?: string | null;
  instruction?: string | null;
  templateId?: string | null;
}

interface WizardCadenceSetupCardProps {
  campaignId: string;
  webinarDate?: string;
  initialSteps: WizardCadenceStep[];
  approvedCount?: number;
  registeredCount?: number;
  automationRules?: {
    stopOnRegistration?: boolean;
    stopOnDecline?: boolean;
    oneClickSignup?: boolean;
    suppressionPreflight?: boolean;
  };
  onStepsChange?: (steps: WizardCadenceStep[]) => void;
}

const CH_ICON: Record<string, 'mail' | 'linkedin' | 'whatsapp' | 'sms'> = { Email: 'mail', LinkedIn: 'linkedin', WhatsApp: 'whatsapp', SMS: 'sms' };

function channelOf(channel: string): string {
  if (channel.includes('LinkedIn')) return 'LinkedIn';
  if (channel.includes('SMS')) return 'SMS';
  if (channel.includes('WhatsApp')) return 'WhatsApp';
  return 'Email';
}

/** Local wall-clock of a Date, expressed as UTC so the formatter prints it unchanged on server and client. */
function wallClock(d: Date): Date {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()));
}

export function WizardCadenceSetupCard({
  campaignId,
  webinarDate,
  initialSteps,
  onStepsChange,
}: WizardCadenceSetupCardProps) {
  const { showToast } = useToast();
  const [steps, setSteps] = useState<WizardCadenceStep[]>(initialSteps);
  const [showActiveOnly, setShowActiveOnly] = useState(true);

  const [isAddingStep, setIsAddingStep] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newChannel, setNewChannel] = useState<'Email' | 'LinkedIn' | 'WhatsApp' | 'SMS'>('Email');
  const [newGroup, setNewGroup] = useState('Invitations & Outreach');
  const [newTimingPreset, setNewTimingPreset] = useState<string>('2d');
  const [newTiming, setNewTiming] = useState('+2 days');
  const [newOffsetValue, setNewOffsetValue] = useState(2);
  const [newOffsetUnit, setNewOffsetUnit] = useState<string>('days');
  const [newAnchor, setNewAnchor] = useState<string>('launch');
  const [addingBusy, setAddingBusy] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<WizardCadenceStep | null>(null);
  const [removingBusy, setRemovingBusy] = useState(false);

  // Timing editor modal state for existing steps
  const [editingTimingStep, setEditingTimingStep] = useState<WizardCadenceStep | null>(null);
  const [savingTiming, setSavingTiming] = useState(false);

  function handlePresetChange(presetKey: string) {
    setNewTimingPreset(presetKey);
    switch (presetKey) {
      case 'instant':
        setNewTiming('Instant');
        setNewOffsetValue(0);
        setNewOffsetUnit('hours');
        setNewAnchor('launch');
        break;
      case '1d':
        setNewTiming('+1 day');
        setNewOffsetValue(1);
        setNewOffsetUnit('days');
        setNewAnchor('launch');
        break;
      case '2d':
        setNewTiming('+2 days');
        setNewOffsetValue(2);
        setNewOffsetUnit('days');
        setNewAnchor('launch');
        break;
      case '3d':
        setNewTiming('+3 days');
        setNewOffsetValue(3);
        setNewOffsetUnit('days');
        setNewAnchor('launch');
        break;
      case '4d':
        setNewTiming('+4 days');
        setNewOffsetValue(4);
        setNewOffsetUnit('days');
        setNewAnchor('launch');
        break;
      case 't3d':
        setNewTiming('T-3 days');
        setNewOffsetValue(-3);
        setNewOffsetUnit('days');
        setNewAnchor('webinar');
        break;
      case 't1d':
        setNewTiming('T-1 day');
        setNewOffsetValue(-1);
        setNewOffsetUnit('days');
        setNewAnchor('webinar');
        break;
      case 't1h':
        setNewTiming('T-1 hour');
        setNewOffsetValue(-1);
        setNewOffsetUnit('hours');
        setNewAnchor('webinar');
        break;
      case 'doors':
        setNewTiming('T-15 mins');
        setNewOffsetValue(-15);
        setNewOffsetUnit('minutes');
        setNewAnchor('webinar');
        break;
      case 'register':
        setNewTiming('On Registration');
        setNewOffsetValue(0);
        setNewOffsetUnit('hours');
        setNewAnchor('event');
        break;
      case 'custom':
        // Keep current custom values
        break;
    }
  }

  function isInstantStep(step: WizardCadenceStep): boolean {
    return (step.timing || '').toLowerCase() === 'instant' || (step.anchor === 'launch' && step.offsetValue === 0);
  }

  /** Short line under the timing label, as on the Cadence tab. */
  function stepWhen(step: WizardCadenceStep): string {
    if (isInstantStep(step)) return 'At launch';
    if (step.anchor === 'event' || (step.timing || '').toLowerCase().includes('registration')) return 'On registration';
    if (step.anchor === 'webinar') {
      const webDate = webinarDate ? new Date(webinarDate) : null;
      if (webDate && !isNaN(webDate.getTime())) {
        return formatLsqDate(wallClock(applyOffset(webDate, step.offsetValue ?? 0, step.offsetUnit ?? 'days')), 'UTC');
      }
      return 'Before event';
    }
    if (step.anchor === 'launch') return 'After launch';
    return 'Scheduled';
  }

  function formatStepSchedulePreview(step: WizardCadenceStep): string {
    const timingLower = (step.timing || '').toLowerCase();
    if (isInstantStep(step)) return 'Sends immediately when the campaign launches.';
    if (step.anchor === 'event' || timingLower.includes('registration')) {
      return 'Sends immediately when the recipient completes registration.';
    }
    if (step.anchor === 'webinar' && webinarDate) {
      const webDate = new Date(webinarDate);
      if (!isNaN(webDate.getTime())) {
        const scheduled = applyOffset(webDate, step.offsetValue ?? 0, step.offsetUnit ?? 'days');
        return `Scheduled for about ${formatLsqDateTime(wallClock(scheduled), 'UTC')}.`;
      }
    }
    if (step.anchor === 'launch') {
      return `Sends ${step.timing} after launch.`;
    }
    return step.desc || `Part of the ${step.group} stage.`;
  }

  async function handleSaveTiming(selection: CadenceTimingSelection) {
    if (!editingTimingStep) return;
    setSavingTiming(true);
    const targetKey = editingTimingStep.key;
    const previous = steps;
    const updated = steps.map((s) =>
      s.key === targetKey
        ? {
            ...s,
            timing: selection.timing,
            offsetValue: selection.offsetValue,
            offsetUnit: selection.offsetUnit,
            anchor: selection.anchor,
          }
        : s
    );
    setSteps(updated);
    onStepsChange?.(updated);
    try {
      await updateCadenceStepTimingAction(campaignId, targetKey, selection);
      showToast(`Updated schedule for "${editingTimingStep.title}" to ${selection.timing}.`);
      setEditingTimingStep(null);
    } catch (err) {
      setSteps(previous);
      onStepsChange?.(previous);
      showToast(err instanceof Error ? err.message : 'Failed to update timing on server');
    } finally {
      setSavingTiming(false);
    }
  }

  async function handleToggleStep(stepKey: string, enabled: boolean) {
    const previous = steps;
    const updated = steps.map((s) => (s.key === stepKey ? { ...s, enabled } : s));
    setSteps(updated);
    onStepsChange?.(updated);
    try {
      await toggleCadenceStepAction(campaignId, stepKey, enabled);
    } catch (err) {
      setSteps(previous);
      onStepsChange?.(previous);
      showToast(err instanceof Error ? err.message : 'Failed to update step. The change was reverted.');
    }
  }

  async function handleRemoveStep(step: WizardCadenceStep) {
    const previous = steps;
    const updated = steps.filter((s) => s.id !== step.id);
    setRemovingBusy(true);
    setSteps(updated);
    onStepsChange?.(updated);
    try {
      await removeCadenceStepAction(campaignId, step.id);
      showToast(`Removed “${step.title}” from the cadence plan.`);
    } catch (err) {
      setSteps(previous);
      onStepsChange?.(previous);
      showToast(err instanceof Error ? err.message : 'Failed to remove the step. It was restored.');
    } finally {
      setRemovingBusy(false);
      setPendingRemove(null);
    }
  }

  async function handleAddStepSubmit() {
    if (!newTitle.trim()) {
      showToast('Enter a title for the touchpoint.');
      return;
    }
    setAddingBusy(true);
    try {
      const created = await addWizardCadenceStepAction(campaignId, {
        title: newTitle.trim(),
        channel: newChannel,
        group: newGroup,
        timing: newTiming.trim() || `+${newOffsetValue} ${newOffsetUnit}`,
        offsetValue: newOffsetValue,
        offsetUnit: newOffsetUnit,
        anchor: newAnchor,
      });

      const newStep: WizardCadenceStep = {
        id: created.id,
        key: created.key,
        title: created.title,
        timing: created.timing,
        channel: created.channel,
        enabled: created.enabled,
        group: created.group,
        desc: created.desc,
        offsetValue: created.offsetValue,
        offsetUnit: created.offsetUnit,
        anchor: created.anchor,
        mode: created.mode,
        instruction: created.instruction,
        templateId: created.templateId,
      };

      const updated = [...steps, newStep];
      setSteps(updated);
      onStepsChange?.(updated);
      setIsAddingStep(false);
      setNewTitle('');
      showToast(`Added touchpoint “${created.title}”.`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to add cadence touchpoint');
    } finally {
      setAddingBusy(false);
    }
  }

  const enabledStepCount = steps.filter((s) => s.enabled).length;

  const isStage1 = (s: WizardCadenceStep) =>
    s.group === 'Pre-registration' ||
    s.group === 'Invitations & Outreach' ||
    s.group === 'Invitation sequence' ||
    s.group === 'Save the Date' ||
    s.anchor === 'launch' ||
    ['invite', 'linkedin', 'nudge', 'final', 'smsInvite', 'waInvite'].includes(s.key);

  const isStage2 = (s: WizardCadenceStep) =>
    s.group === 'Reminders · registrants only' ||
    s.group === 'Reminders' ||
    s.group === 'Countdown & Reminders' ||
    s.anchor === 'event' ||
    ['confirm', 't3', 't1d', 't1h', 'doors_open', 'whatsapp', 'sms'].includes(s.key) ||
    (s.anchor === 'webinar' && (s.offsetValue ?? 0) <= 0 && s.key !== 'attend' && s.key !== 'noshow');

  const visibleSteps = showActiveOnly ? steps.filter((s) => s.enabled) : steps;
  const stage1Steps = visibleSteps.filter(isStage1);
  const stage2Steps = visibleSteps.filter((s) => !isStage1(s) && isStage2(s));
  const stage3Steps = visibleSteps.filter((s) => !isStage1(s) && !isStage2(s));

  const renderStepRow = (step: WizardCadenceStep) => {
    const ch = channelOf(step.channel);
    const when = stepWhen(step);
    return (
      <li key={step.id} className="lsq-step-row" data-state={step.enabled ? 'active' : 'paused'}>
        <div>
          <button
            type="button"
            className="lsq-timing"
            onClick={() => setEditingTimingStep(step)}
            aria-label={`Change timing for ${step.title}. Currently ${step.timing}, ${when}`}
            title="Change when this step sends"
          >
            <span className="lsq-timing__label">
              {step.timing}
              <Icon name="edit" size={14} />
            </span>
            <span className="lsq-timing__when">{when}</span>
          </button>
        </div>

        <span className="lsq-chan" data-ch={ch} aria-hidden="true">
          <Icon name={CH_ICON[ch] ?? 'mail'} size={18} />
        </span>

        <div className="lsq-step-row__main">
          <p className="lsq-step-row__title">
            {step.title}
            <Badge color="gray" text={ch} />
          </p>
          <p className="lsq-step-row__desc">{formatStepSchedulePreview(step)}</p>
        </div>

        <div className="lsq-step-row__side">
          {!step.enabled && <Badge color="gray" text="Paused" />}
          <Toggle on={step.enabled} ariaLabel={`Send ${step.title}`} onChange={() => handleToggleStep(step.key, !step.enabled)} />
          <Button
            hierarchy="tertiary"
            size="sm"
            iconPosition="only"
            icon={<Icon name="trash" size={16} />}
            ariaLabel={`Remove touchpoint ${step.title}`}
            title="Remove touchpoint"
            onClick={() => setPendingRemove(step)}
          />
        </div>
      </li>
    );
  };

  const renderStage = (
    n: number,
    id: string,
    title: string,
    trigger: string,
    sub: string,
    list: WizardCadenceStep[],
    emptyText: string
  ) => (
    <section className="lsq-card" aria-labelledby={id}>
      <div className="lsq-stage__head">
        <span className="lsq-stage__n" aria-hidden="true">{n}</span>
        <h3 className="lsq-stage__title" id={id}>{title}</h3>
        <Badge color="blue" text={trigger} />
        <p className="lsq-stage__sub">
          {sub} ({list.length} {list.length === 1 ? 'touch' : 'touches'})
        </p>
      </div>
      {list.length > 0 ? <ul className="lsq-steps">{list.map((s) => renderStepRow(s))}</ul> : <p className="lsq-stage__empty">{emptyText}</p>}
    </section>
  );

  return (
    <div className="lsq-stack lsq-stack--lg">
      <header className="lsq-page-header">
        <div className="lsq-page-header__text">
          <p className="lsq-page-header__eyebrow">Cadence</p>
          <h2 className="lsq-page-header__title">Touchpoints And Channel Plan</h2>
          <p className="lsq-page-header__sub">Add, remove or retime touchpoints across the webinar lifecycle. Changes save as they are made.</p>
        </div>
        <div className="lsq-page-header__actions">
          <Badge color="blue" text={`${enabledStepCount} of ${steps.length} steps active`} />
        </div>
      </header>

      <div className="lsq-toolbar">
        <div className="lsq-segmented" role="group" aria-label="Which steps to show">
          <button type="button" aria-pressed={showActiveOnly} onClick={() => setShowActiveOnly(true)}>
            Active only ({enabledStepCount})
          </button>
          <button type="button" aria-pressed={!showActiveOnly} onClick={() => setShowActiveOnly(false)}>
            All steps ({steps.length})
          </button>
        </div>
        <Button
          size="sm"
          hierarchy="secondary"
          icon={<Icon name={isAddingStep ? 'close' : 'plus'} size={14} />}
          onClick={() => setIsAddingStep((prev) => !prev)}
        >
          {isAddingStep ? 'Cancel' : 'Add Touchpoint'}
        </Button>
      </div>

      {isAddingStep && (
        <section className="lsq-card" aria-labelledby="wiz-add-step">
          <div className="lsq-card__header">
            <h3 className="lsq-card__title" id="wiz-add-step">Add Cadence Touchpoint</h3>
          </div>
          <div className="lsq-card__body lsq-stack">
            <div className="lsq-grid">
              <Field label="Step title" required>
                {(p) => (
                  <input
                    {...p}
                    className="lsq-input"
                    placeholder="e.g. VIP speaker teaser"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                  />
                )}
              </Field>
              <Field label="Channel">
                {(p) => (
                  <select
                    {...p}
                    className="lsq-select"
                    value={newChannel}
                    onChange={(e) => setNewChannel(e.target.value as 'Email' | 'LinkedIn' | 'WhatsApp' | 'SMS')}
                  >
                    <option value="Email">Email</option>
                    <option value="LinkedIn">LinkedIn</option>
                    <option value="WhatsApp">WhatsApp</option>
                    <option value="SMS">SMS</option>
                  </select>
                )}
              </Field>
              <Field label="Lifecycle stage">
                {(p) => (
                  <select {...p} className="lsq-select" value={newGroup} onChange={(e) => setNewGroup(e.target.value)}>
                    <option value="Save the Date">Save the Date</option>
                    <option value="Invitations & Outreach">Invitations & Outreach</option>
                    <option value="Countdown & Reminders">Countdown & Reminders</option>
                    <option value="Day of Event">Day of Event</option>
                    <option value="Post-Event Follow-up">Post-Event Follow-up</option>
                  </select>
                )}
              </Field>
              <Field label="Schedule and timing">
                {(p) => (
                  <select {...p} className="lsq-select" value={newTimingPreset} onChange={(e) => handlePresetChange(e.target.value)}>
                    <option value="instant">Instant (send on launch)</option>
                    <option value="1d">+1 day after launch</option>
                    <option value="2d">+2 days after launch</option>
                    <option value="3d">+3 days after launch</option>
                    <option value="4d">+4 days after launch</option>
                    <option value="t3d">T-3 days before webinar</option>
                    <option value="t1d">T-1 day before webinar</option>
                    <option value="t1h">T-1 hour before webinar</option>
                    <option value="doors">T-15 mins doors open</option>
                    <option value="register">Instant on registration</option>
                    <option value="custom">Custom offset</option>
                  </select>
                )}
              </Field>
            </div>

            {newTimingPreset === 'custom' && (
              <div className="lsq-grid lsq-grid--narrow">
                <Field label="Offset">
                  {(p) => (
                    <input
                      {...p}
                      type="number"
                      min={0}
                      className="lsq-input"
                      value={newOffsetValue}
                      onChange={(e) => {
                        const val = Number.parseInt(e.target.value, 10) || 0;
                        setNewOffsetValue(val);
                        setNewTiming(`+${val} ${newOffsetUnit}`);
                      }}
                    />
                  )}
                </Field>
                <Field label="Unit">
                  {(p) => (
                    <select
                      {...p}
                      className="lsq-select"
                      value={newOffsetUnit}
                      onChange={(e) => {
                        const unit = e.target.value;
                        setNewOffsetUnit(unit);
                        setNewTiming(`+${newOffsetValue} ${unit}`);
                      }}
                    >
                      <option value="days">Days</option>
                      <option value="hours">Hours</option>
                      <option value="minutes">Minutes</option>
                    </select>
                  )}
                </Field>
                <Field label="Counted from">
                  {(p) => (
                    <select {...p} className="lsq-select" value={newAnchor} onChange={(e) => setNewAnchor(e.target.value)}>
                      <option value="launch">After launch</option>
                      <option value="webinar">From webinar start</option>
                      <option value="event">When registered</option>
                    </select>
                  )}
                </Field>
              </div>
            )}
          </div>
          <div className="lsq-card__footer">
            <Button hierarchy="secondary" onClick={() => setIsAddingStep(false)} disabled={addingBusy}>
              Cancel
            </Button>
            <Button loading={addingBusy} onClick={handleAddStepSubmit}>
              {addingBusy ? 'Adding' : 'Add Touchpoint'}
            </Button>
          </div>
        </section>
      )}

      {renderStage(
        1,
        'wiz-stage-1',
        'Pre-Registration Outreach',
        'When the campaign launches',
        'Goes to all approved contacts',
        stage1Steps,
        'No active outreach touches. Select All steps to activate one, or add a touchpoint.'
      )}
      {renderStage(
        2,
        'wiz-stage-2',
        'Reminders For Registrants',
        'When a contact registers',
        'Countdown to the webinar date',
        stage2Steps,
        'No active reminder touches. Select All steps to activate one.'
      )}
      {renderStage(
        3,
        'wiz-stage-3',
        'Post-Webinar Follow-Up',
        'When the webinar ends',
        'Attended and no-show follow-up',
        stage3Steps,
        'No active post-event touches. Select All steps to activate one.'
      )}

      {pendingRemove && (
        <ConfirmDialog
          title={`Remove “${pendingRemove.title}”?`}
          message={`This removes "${pendingRemove.title}" from this webinar's cadence plan.`}
          confirmLabel="Remove step"
          destructive
          busy={removingBusy}
          onConfirm={() => handleRemoveStep(pendingRemove)}
          onClose={() => setPendingRemove(null)}
        />
      )}

      {editingTimingStep && (
        <CadenceTimingModal
          isOpen={true}
          onClose={() => setEditingTimingStep(null)}
          stepTitle={editingTimingStep.title}
          stepKey={editingTimingStep.key}
          channel={editingTimingStep.channel}
          group={editingTimingStep.group}
          currentTiming={editingTimingStep.timing}
          currentOffsetValue={editingTimingStep.offsetValue}
          currentOffsetUnit={editingTimingStep.offsetUnit}
          currentAnchor={editingTimingStep.anchor}
          webinarDate={webinarDate}
          onSave={handleSaveTiming}
          isSaving={savingTiming}
        />
      )}
    </div>
  );
}
