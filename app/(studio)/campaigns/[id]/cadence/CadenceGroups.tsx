'use client';

import { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Toggle } from '@/components/ui/Toggle';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { setUnsavedChanges } from '@/lib/unsavedChangesGuard';
import { useToast } from '@/components/ui/Toast';
import { CampaignSuppressionModal } from './CampaignSuppressionModal';
import { BroadcastReminderModal } from '@/components/cadence/BroadcastReminderModal';
import type { LinkedInQueueItem } from '@/lib/linkedinQueueItem';
import { LinkedInFastRunnerModal } from '@/components/cadence/LinkedInFastRunnerModal';
import { dispatchAutomatedLinkedInAction } from '@/lib/actions/linkedin';
import {
  addCadenceStepAction,
  removeCadenceStepAction,
  resetScheduleAction,
  saveCadenceSequenceAction,
  updateCadenceStepTimingAction,
  type CadenceSequenceStepPatch,
} from '@/lib/actions/schedule';
import { switchStepModeAction } from '@/lib/actions/personalize';
import { applyOffset } from '@/lib/stepSchedule';
import { CadenceTimingModal, type CadenceTimingSelection } from '@/components/cadence/CadenceTimingModal';
import { normalizeChannel } from '@/lib/channels';
import type { CadenceStep } from '@/lib/generated/prisma/client';

const CH_ICON: Record<string, string> = { Email: 'mail', LinkedIn: 'linkedin', WhatsApp: 'whatsapp', SMS: 'sms' };

function chOf(channel: string): string {
  if (channel.includes('LinkedIn')) return 'LinkedIn';
  if (channel.includes('SMS')) return 'SMS';
  if (channel.includes('WhatsApp')) return 'WhatsApp';
  return 'Email';
}

export function CadenceGroups({
  campaignId,
  webinarName,
  steps: initialSteps,
  countsByStep,
  launchAtIso,
  webinarAtIso,
  templateOptions,
  hiddenPinnedTemplateNameById = {},
  registeredCount = 0,
  webinarDate,
  campaignSuppressionCount = 0,
  linkedinQueue = [],
  initialLinkedInProgress = null,
}: {
  campaignId: string;
  webinarName?: string;
  steps: CadenceStep[];
  countsByStep: Record<string, { sent: number; queued: number; failed: number }>;
  launchAtIso: string;
  webinarAtIso: string | null;
  webinarDate?: string;
  templateOptions: Record<string, { id: string; name: string; scope: string }[]>;
  /** Pinned-but-hidden templates, keyed by id — these are excluded from
   *  templateOptions (a hidden template must never be newly selectable) but
   *  a step can still be hard-pinned to one from before it was hidden. */
  hiddenPinnedTemplateNameById?: Record<string, string>;
  resolvedTemplateIdByStep?: Record<string, string>;
  approvedCount?: number;
  registeredCount?: number;
  suppressionCount?: number;
  campaignSuppressionCount?: number;
  linkedinQueue?: LinkedInQueueItem[];
  initialLinkedInProgress?: Record<string, string> | null;
  automationRules?: {
    stopOnRegistration?: boolean;
    stopOnDecline?: boolean;
    oneClickSignup?: boolean;
    suppressionPreflight?: boolean;
  };
}) {
  const router = useRouter();
  const { showToast } = useToast();

  const [steps, setSteps] = useState(initialSteps);
  const [seenSteps, setSeenSteps] = useState(initialSteps);
  if (seenSteps !== initialSteps) {
    setSeenSteps(initialSteps);
    setSteps(initialSteps);
  }

  // Local modifications for batch persistence (timing and enabled state for unsent steps)
  const [timingEdits, setTimingEdits] = useState<Record<string, string>>({});
  const [structuredTimingEdits, setStructuredTimingEdits] = useState<Record<string, CadenceTimingSelection>>({});
  const [enabledEdits, setEnabledEdits] = useState<Record<string, boolean>>({});

  // Timing configurator modal
  const [timingModalStep, setTimingModalStep] = useState<CadenceStep | null>(null);
  const [savingTimingImmediate, setSavingTimingImmediate] = useState(false);

  const [busy, setBusy] = useState(false);
  const [switchingModeStepKey, setSwitchingModeStepKey] = useState<string | null>(null);
  const [savingSequence, setSavingSequence] = useState(false);
  const [dispatchingLinkedIn, setDispatchingLinkedIn] = useState(false);
  const [confirmingLinkedInBulk, setConfirmingLinkedInBulk] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<CadenceStep | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [suppressionOpen, setSuppressionOpen] = useState(false);
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [fastRunnerOpen, setFastRunnerOpen] = useState(false);
  const [linkedInProgress, setLinkedInProgress] = useState<Record<string, string>>(initialLinkedInProgress ?? {});

  const pendingLinkedInCount = useMemo(() => {
    return linkedinQueue.filter((item) => !linkedInProgress[item.id] || linkedInProgress[item.id] === 'pending').length;
  }, [linkedinQueue, linkedInProgress]);

  const [showActiveOnly, setShowActiveOnly] = useState(true);

  const launchAt = useMemo(() => new Date(launchAtIso), [launchAtIso]);
  const webinarAt = useMemo(() => (webinarAtIso ? new Date(webinarAtIso) : null), [webinarAtIso]);

  // Track if any field was changed (only for steps that have not yet been sent)
  const isDirty =
    Object.keys(timingEdits).length > 0 ||
    Object.keys(structuredTimingEdits).length > 0 ||
    Object.keys(enabledEdits).length > 0;

  // Timing fields and toggles update instantly, so an edit looks applied long
  // before "Save changes" persists it — clicking another workspace tab used to
  // discard the lot silently. beforeunload covers a full page unload/reload;
  // it does NOT fire for a client-side route change (clicking another tab's
  // <Link>), which is exactly the case that was silently losing edits — so
  // isDirty is also published to the shared guard WorkspaceTabs reads before
  // it navigates.
  useEffect(() => {
    if (!isDirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [isDirty]);

  useEffect(() => {
    setUnsavedChanges(isDirty, 'You have unsaved cadence changes. Leave this tab and discard them?');
    // Unmounting (navigating away via a route this component doesn't control,
    // e.g. the browser back button) must not leave a stale "dirty" flag armed
    // for whatever tab renders next.
    return () => setUnsavedChanges(false);
  }, [isDirty]);

  // This does not send anything on LinkedIn — nothing in this app does, to
  // comply with LinkedIn's terms. It only bulk-records CadenceSend rows as
  // sent and notifies LeadSquared, for an operator who already sent these
  // messages manually and wants to confirm all of them at once instead of
  // one at a time. The confirm dialog says this explicitly so a click can
  // never be mistaken for a real automated dispatch.
  async function handleBulkConfirmLinkedIn() {
    if (dispatchingLinkedIn) return;
    setDispatchingLinkedIn(true);
    try {
      const res = await dispatchAutomatedLinkedInAction(campaignId, linkedinQueue.map(c=>c.id));
      if (!res.ok) throw new Error(res.error || 'Failed to record LinkedIn touches');
      showToast(`Recorded ${res.dispatchedCount} contact(s) as LinkedIn-messaged.`);
      router.refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not record LinkedIn touches');
    } finally {
      setDispatchingLinkedIn(false);
      setConfirmingLinkedInBulk(false);
    }
  }


  async function handleSaveStepTiming(selection: CadenceTimingSelection) {
    if (!timingModalStep) return;
    setSavingTimingImmediate(true);
    const targetKey = timingModalStep.key;
    try {
      const res = await updateCadenceStepTimingAction(campaignId, targetKey, selection);
      if (!res.ok) throw new Error(res.error || 'Failed to update timing');

      // Update local state immediately
      setSteps((prev) =>
        prev.map((s) =>
          s.key === targetKey
            ? {
                ...s,
                timing: selection.timing,
                offsetValue: selection.offsetValue,
                offsetUnit: selection.offsetUnit,
                anchor: selection.anchor,
              }
            : s
        )
      );

      // Clean pending edit for this step
      setTimingEdits((prev) => {
        const next = { ...prev };
        delete next[targetKey];
        return next;
      });
      setStructuredTimingEdits((prev) => {
        const next = { ...prev };
        delete next[targetKey];
        return next;
      });

      showToast(`Updated "${timingModalStep.title}" timing to ${selection.timing}`);
      setTimingModalStep(null);
      router.refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not save timing');
    } finally {
      setSavingTimingImmediate(false);
    }
  }

  async function handleToggleStepMode(step: CadenceStep) {
    const nextMode = step.mode === 'template' ? 'ai' : 'template';
    setSwitchingModeStepKey(step.key);
    try {
      const res = await switchStepModeAction(campaignId, step.key, nextMode, null, { autoDraft: true });
      if (res.ok) {
        setSteps((prev) =>
          prev.map((s) => (s.key === step.key ? { ...s, mode: nextMode } : s))
        );
        showToast(
          nextMode === 'ai'
            ? `Switched "${step.title}" to AI Personalization${res.generated ? ` (${res.generated} drafts written)` : ''}.`
            : `Switched "${step.title}" to Template mode.`
        );
        router.refresh();
      } else {
        showToast(res.error || 'Failed to switch step mode.');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Error switching step mode.');
    } finally {
      setSwitchingModeStepKey(null);
    }
  }

  async function handleBatchSave() {
    if (!isDirty || savingSequence) return;
    setSavingSequence(true);
    try {
      // Only include patches for steps that have edits and are not already sent
      const patches: CadenceSequenceStepPatch[] = steps
        .filter((s) => (countsByStep[s.key]?.sent ?? 0) === 0)
        .filter((s) => timingEdits[s.key] !== undefined || structuredTimingEdits[s.key] !== undefined || enabledEdits[s.key] !== undefined)
        .map((s) => {
          const patch: CadenceSequenceStepPatch = { key: s.key };
          const sTiming = structuredTimingEdits[s.key];
          if (sTiming) {
            patch.timingValue = sTiming.timing;
            patch.offsetValue = sTiming.offsetValue;
            patch.offsetUnit = sTiming.offsetUnit;
            patch.anchor = sTiming.anchor;
          } else if (timingEdits[s.key] !== undefined) {
            patch.timingValue = timingEdits[s.key];
          }
          if (enabledEdits[s.key] !== undefined) patch.enabled = enabledEdits[s.key];
          return patch;
        });

      if (patches.length === 0) {
        setTimingEdits({});
        setStructuredTimingEdits({});
        setEnabledEdits({});
        setSavingSequence(false);
        return;
      }

      const res = await saveCadenceSequenceAction(campaignId, patches);
      if (!res.ok) throw new Error(res.error || 'Failed to save cadence sequence');

      showToast(`Saved cadence changes (${res.updatedCount} step(s) updated).`);
      setTimingEdits({});
      setStructuredTimingEdits({});
      setEnabledEdits({});
      router.refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save cadence');
    } finally {
      setSavingSequence(false);
    }
  }

  async function handleResetAll() {
    setBusy(true);
    try {
      await resetScheduleAction(campaignId);
      setTimingEdits({});
      setStructuredTimingEdits({});
      setEnabledEdits({});
      showToast('Cadence reset to defaults.');
      window.location.reload();
    } catch (err) {
      setConfirmingReset(false);
      showToast(err instanceof Error ? err.message : 'Failed to reset cadence.');
      setBusy(false);
    }
  }

  const addedStepCount = steps.filter((s) => s.createdByUser).length;

  async function handleAddStep(group: string, channel: string) {
    setBusy(true);
    try {
      await addCadenceStepAction(campaignId, group, channel);
      showToast(`Added ${channel} step to sequence.`);
      router.refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to add step.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveStep(step: CadenceStep) {
    setBusy(true);
    try {
      const r = await removeCadenceStepAction(campaignId, step.id);
      setConfirmRemove(null);
      showToast(r.cancelled ? `Step removed (${r.cancelled} send(s) cancelled).` : 'Step removed.');
      router.refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to remove step.');
    } finally {
      setBusy(false);
    }
  }

  // Group steps into the three prototype stages
  const stage1Steps = steps.filter(
    (s) =>
      s.group === 'Pre-registration' ||
      s.group === 'Invitation sequence' ||
      (s.trigger === 'launch' && s.anchor === 'launch')
  );

  const stage2Steps = steps.filter(
    (s) =>
      s.group === 'Reminders · registrants only' ||
      s.trigger === 'registration' ||
      (s.anchor === 'webinar' && s.offsetValue <= 0 && s.key !== 'attend' && s.key !== 'noshow')
  );

  const stage3Steps = steps.filter(
    (s) =>
      s.group === 'Post-webinar · within 2 hrs' ||
      s.group === 'Post-webinar' ||
      s.key === 'attend' ||
      s.key === 'noshow' ||
      s.trigger === 'attendance'
  );

  const isStepVisible = (step: CadenceStep) => {
    if (!showActiveOnly) return true;
    const isSent = (countsByStep[step.key]?.sent ?? 0) > 0;
    const isEnabled = enabledEdits[step.key] !== undefined ? enabledEdits[step.key] : step.enabled;
    return isEnabled || isSent;
  };

  const visibleStage1 = stage1Steps.filter(isStepVisible);
  const visibleStage2 = stage2Steps.filter(isStepVisible);
  const visibleStage3 = stage3Steps.filter(isStepVisible);

  function renderStepRow(step: CadenceStep) {
    const counts = countsByStep[step.key];
    const isSent = (counts?.sent ?? 0) > 0;
    const isLocked = isSent;
    const isEditable = !isLocked;

    const ch = chOf(step.channel);

    // Timing display
    const sTiming = structuredTimingEdits[step.key];
    const timingVal = sTiming ? sTiming.timing : (timingEdits[step.key] !== undefined ? timingEdits[step.key] : step.timing);
    const effAnchor = sTiming ? sTiming.anchor : step.anchor;
    const effOffsetVal = sTiming ? sTiming.offsetValue : step.offsetValue;
    const effOffsetUnit = sTiming ? sTiming.offsetUnit : step.offsetUnit;

    const isInstant =
      (timingVal || '').toLowerCase() === 'instant' ||
      (effAnchor === 'launch' && effOffsetVal === 0);

    const shortDate = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    let dateSubtitle = '';
    if (isInstant) {
      dateSubtitle = 'At launch';
    } else if (effAnchor === 'event' || step.trigger === 'registration') {
      dateSubtitle = 'On registration';
    } else if (effAnchor === 'webinar') {
      dateSubtitle = webinarAt ? shortDate(applyOffset(webinarAt, effOffsetVal, effOffsetUnit)) : 'Before event';
    } else if (effAnchor === 'launch') {
      dateSubtitle = shortDate(applyOffset(launchAt, effOffsetVal, effOffsetUnit));
    } else if (step.trigger === 'attendance') {
      dateSubtitle = 'After event';
    } else {
      dateSubtitle = 'Scheduled';
    }

    const currentEnabled = enabledEdits[step.key] !== undefined ? enabledEdits[step.key] : step.enabled;

    // Status badge
    let status: { text: string; color: string } = { text: 'Scheduled', color: 'gray' };
    if (isSent) status = { text: 'Sent', color: 'success' };
    else if (!currentEnabled) status = { text: 'Paused', color: 'gray' };
    else if (step.trigger === 'registration') status = { text: 'Live', color: 'success' };
    const rowState = isSent ? 'sent' : !currentEnabled ? 'paused' : 'active';

    // Template options info
    const routableCh = normalizeChannel(step.channel);
    const opts = templateOptions[routableCh] ?? [];
    const currentTplId = step.templateId ?? '';
    // A step can still be hard-pinned to a template that's since been hidden
    // from the library — opts excludes hidden templates on purpose (one must
    // never become newly selectable again from here), so a miss there could
    // mean either "nothing pinned" or "pinned to a dead reference that will
    // never send" (lib/cadence.ts skips it). Only the first is really
    // "Default Template".
    const hiddenPinnedName = currentTplId ? hiddenPinnedTemplateNameById[currentTplId] : undefined;
    const tplHidden = Boolean(hiddenPinnedName) && !opts.some((o) => o.id === currentTplId);
    const currentTplName = opts.find((o) => o.id === currentTplId)?.name ?? (hiddenPinnedName ? `"${hiddenPinnedName}" (hidden)` : 'Default template');

    // Only "sent" is real data (lib/cadence.ts's own send-status counts) —
    // delivered/opened/clicked/registered have no tracking table anywhere in
    // the schema, so they must never be shown as if measured.
    const sentN = counts?.sent ?? 0;
    const queuedN = counts?.queued ?? 0;
    const failedN = counts?.failed ?? 0;

    return (
      <li key={step.id} className="lsq-step-row" data-state={rowState}>
        <div>
          {isEditable ? (
            <button
              type="button"
              className="lsq-timing"
              onClick={() => setTimingModalStep(step)}
              aria-label={`Change timing for ${step.title}. Currently ${timingVal}, ${dateSubtitle}`}
              title="Change when this step sends"
            >
              <span className="lsq-timing__label">
                {timingVal}
                <Icon name="edit" size={14} />
              </span>
              <span className="lsq-timing__when">{dateSubtitle}</span>
            </button>
          ) : (
            <div className="lsq-timing lsq-timing--static" title="This step has already sent, so its timing is locked">
              <span className="lsq-timing__label">
                {timingVal}
                <Icon name="lock" size={14} />
              </span>
              <span className="lsq-timing__when">{dateSubtitle}</span>
            </div>
          )}
        </div>

        <span className="lsq-chan" data-ch={ch} aria-hidden="true">
          <Icon name={CH_ICON[ch] ?? 'mail'} size={18} />
        </span>

        <div className="lsq-step-row__main" style={{ minWidth: 0 }}>
          <p className="lsq-step-row__title">
            {step.title}
            <Badge color="gray" text={ch} />
          </p>
          <p className="lsq-step-row__desc">{step.desc}</p>

          {isLocked ? (
            <div className="lsq-step-row__meta">
              <span>
                Sent to <strong>{sentN}</strong>
              </span>
              {queuedN > 0 && <span>{queuedN} still queued</span>}
              {failedN > 0 && <Badge color="error" text={`${failedN} failed`} />}
              <span>Locked after sending</span>
            </div>
          ) : (
            <div className="lsq-step-row__meta">
              {step.mode === 'template' ? (
                <Badge color={tplHidden ? 'warning' : 'gray'} text={tplHidden ? `${currentTplName}, will not send` : `Template: ${currentTplName}`} />
              ) : (
                <Badge color="blue" text="AI personalized" />
              )}
              <button
                type="button"
                className="lsq-linkbtn"
                onClick={() => handleToggleStepMode(step)}
                disabled={switchingModeStepKey === step.key || busy}
                title={step.mode === 'template' ? 'Write a different message for each recipient with AI' : 'Send the same template to everyone'}
              >
                {switchingModeStepKey === step.key ? 'Switching…' : step.mode === 'template' ? 'Use AI personalization' : 'Switch to template'}
              </button>
              <Link href={`/campaigns/${campaignId}/messaging?step=${step.key}`} className="lsq-linkbtn">
                Edit copy
              </Link>
            </div>
          )}

          {ch === 'LinkedIn' && (
            <div className="lsq-step-extra">
              <span>
                <strong>{linkedinQueue.length === 0 ? 'No contacts' : pendingLinkedInCount > 0 ? `${pendingLinkedInCount} to send` : 'All sent'}</strong> on LinkedIn. Messages are sent by hand, never automatically.
              </span>
              <Button hierarchy="primary" size="sm" icon={<Icon name="play" size={14} />} disabled={pendingLinkedInCount === 0} onClick={() => setFastRunnerOpen(true)}>
                Guided send
              </Button>
              <Link href={`/linkedin?event=${campaignId}`} className="lsq-btn lsq-btn--sm lsq-btn--secondary">
                Review queue
              </Link>
              <details className="lsq-menu">
                <summary>
                  <span className="lsq-btn lsq-btn--sm lsq-btn--tertiary" role="button" aria-label="More LinkedIn actions">
                    More <Icon name="chevron-down" size={14} />
                  </span>
                </summary>
                <div className="lsq-menu__panel">
                  <button
                    type="button"
                    className="lsq-menu__item"
                    disabled={dispatchingLinkedIn || isSent || linkedinQueue.length === 0}
                    onClick={() => setConfirmingLinkedInBulk(true)}
                    title="Record messages you already sent by hand. Nothing is sent on LinkedIn."
                  >
                    {dispatchingLinkedIn ? 'Recording…' : 'Mark all as sent'}
                  </button>
                </div>
              </details>
            </div>
          )}
        </div>

        <div className="lsq-step-row__side">
          <Badge color={status.color} text={status.text} />
          {isEditable ? (
            <>
              <Toggle
                on={currentEnabled}
                ariaLabel={`Send ${step.title}`}
                disabled={busy}
                onChange={(nextVal) => setEnabledEdits({ ...enabledEdits, [step.key]: nextVal })}
              />
              <Button hierarchy="tertiary" size="sm" iconPosition="only" icon={<Icon name="trash" size={16} />} ariaLabel={`Remove ${step.title}`} title="Remove step" disabled={busy} onClick={() => setConfirmRemove(step)} />
            </>
          ) : null}
        </div>
      </li>
    );
  }

  const stage3Attended = visibleStage3.filter((s) => s.key === 'attend' || s.key.includes('attend'));
  const stage3Noshow = visibleStage3.filter((s) => s.key === 'noshow' || s.key.includes('noshow'));

  const totals = steps.reduce(
    (acc, s) => {
      const c = countsByStep[s.key];
      acc.sent += c?.sent ?? 0;
      acc.queued += c?.queued ?? 0;
      acc.failed += c?.failed ?? 0;
      if ((enabledEdits[s.key] ?? s.enabled) || (c?.sent ?? 0) > 0) acc.active += 1;
      return acc;
    },
    { sent: 0, queued: 0, failed: 0, active: 0 }
  );

  const ADD_CHANNELS: Array<{ label: string; key: string; icon: string }> = [
    { label: 'Email', key: 'email', icon: 'mail' },
    { label: 'WhatsApp', key: 'whatsapp', icon: 'whatsapp' },
    { label: 'SMS', key: 'sms', icon: 'sms' },
    { label: 'LinkedIn', key: 'linkedin', icon: 'linkedin' },
  ];
  const renderAddStep = (group: string) => (
    <div className="lsq-stage__foot">
      <span className="lsq-hint">Add a step</span>
      {ADD_CHANNELS.map((c) => (
        <Button key={c.key} hierarchy="secondary" size="sm" icon={<Icon name={c.icon} size={14} />} disabled={busy} onClick={() => handleAddStep(group, c.key)}>
          {c.label}
        </Button>
      ))}
    </div>
  );

  return (
    <>
      <div className="lsq-page">
        <header className="lsq-page-header">
          <div className="lsq-page-header__text">
            <p className="lsq-page-header__eyebrow">Cadence</p>
            <h1 className="lsq-page-header__title">Outreach Cadence</h1>
            <p className="lsq-page-header__sub">
              Choose when each message goes out and how it is written. Steps that have already sent are locked.
            </p>
          </div>
          <div className="lsq-page-header__actions">
            <Button hierarchy="tertiary" onClick={() => setConfirmingReset(true)} disabled={busy}>
              {busy ? 'Resetting…' : 'Reset To Defaults'}
            </Button>
            <Button hierarchy="primary" onClick={handleBatchSave} disabled={!isDirty} loading={savingSequence}>
              Save Changes
            </Button>
          </div>
        </header>

        {/* Timing/toggle edits apply visually the instant they are made, which
            reads as "already saved". Say plainly that they aren't. */}
        {isDirty && (
          <div className="lsq-banner lsq-banner--warning" role="status">
            <div>
              <p className="lsq-banner__body">Changes are not saved yet. Leaving this tab discards them. Select Save Changes to apply.</p>
            </div>
          </div>
        )}

        <div className="lsq-grid lsq-grid--narrow" role="list" aria-label="Cadence summary">
          <div className="lsq-card lsq-stat" role="listitem">
            <p className="lsq-stat__label">Active Steps</p>
            <p className="lsq-stat__value">{totals.active}</p>
            <p className="lsq-stat__note">of {steps.length}</p>
          </div>
          <div className="lsq-card lsq-stat" role="listitem">
            <p className="lsq-stat__label">Sent</p>
            <p className="lsq-stat__value">{totals.sent.toLocaleString()}</p>
            <p className="lsq-stat__note">messages delivered to the provider</p>
          </div>
          <div className="lsq-card lsq-stat" role="listitem">
            <p className="lsq-stat__label">Queued</p>
            <p className="lsq-stat__value">{totals.queued.toLocaleString()}</p>
            <p className="lsq-stat__note">waiting for their time</p>
          </div>
          <div className="lsq-card lsq-stat" role="listitem">
            <p className="lsq-stat__label">Failed</p>
            <p className="lsq-stat__value" style={{ color: totals.failed > 0 ? 'var(--text-danger)' : undefined }}>{totals.failed.toLocaleString()}</p>
            <p className="lsq-stat__note">{totals.failed > 0 ? 'review in Results' : 'none so far'}</p>
          </div>
        </div>

        <div className="lsq-toolbar">
          <div className="lsq-segmented" role="group" aria-label="Which steps to show">
            <button type="button" aria-pressed={showActiveOnly} onClick={() => setShowActiveOnly(true)}>
              Active ({steps.filter((s) => s.enabled || (countsByStep[s.key]?.sent ?? 0) > 0).length})
            </button>
            <button type="button" aria-pressed={!showActiveOnly} onClick={() => setShowActiveOnly(false)}>
              All steps ({steps.length})
            </button>
          </div>
          <div className="lsq-toolbar__group">
            {linkedinQueue.length > 0 && (
              <Button hierarchy="secondary" icon={<Icon name="linkedin" size={16} />} onClick={() => setFastRunnerOpen(true)} disabled={pendingLinkedInCount === 0}>
                LinkedIn Send ({pendingLinkedInCount})
              </Button>
            )}
            <Button hierarchy="secondary" icon={<Icon name="lock" size={16} />} onClick={() => setSuppressionOpen(true)} title="People excluded from this webinar, plus the global suppression list">
              Exclusions ({campaignSuppressionCount})
            </Button>
            <Button hierarchy="secondary" icon={<Icon name="send" size={16} />} onClick={() => setBroadcastOpen(true)} title="Send a reminder to everyone registered right now">
              Broadcast Reminder ({registeredCount ?? 0})
            </Button>
          </div>
        </div>

        {/* STAGE 1 */}
        <section className="lsq-card" aria-labelledby="stage-1">
          <div className="lsq-stage__head">
            <span className="lsq-stage__n" aria-hidden="true">1</span>
            <h2 className="lsq-stage__title" id="stage-1">Invitation Sequence</h2>
            <Badge color="blue" text="When the campaign launches" />
            <p className="lsq-stage__sub">Goes to all approved contacts until they register.</p>
          </div>
          {visibleStage1.length > 0 ? (
            <ul className="lsq-steps">{visibleStage1.map((step) => renderStepRow(step))}</ul>
          ) : (
            <p className="lsq-stage__empty">No active steps here. Select All steps to enable one, or add a step below.</p>
          )}
          {renderAddStep('Pre-registration')}
        </section>

        {/* STAGE 2 */}
        <section className="lsq-card" aria-labelledby="stage-2">
          <div className="lsq-stage__head">
            <span className="lsq-stage__n" aria-hidden="true">2</span>
            <h2 className="lsq-stage__title" id="stage-2">Reminders For Registrants</h2>
            <Badge color="blue" text="When a contact registers" />
            <p className="lsq-stage__sub">Confirmation and countdown reminders, timed from the webinar date.</p>
          </div>
          {visibleStage2.length > 0 ? (
            <ul className="lsq-steps">{visibleStage2.map((step) => renderStepRow(step))}</ul>
          ) : (
            <p className="lsq-stage__empty">No active reminders. Select All steps to enable one, or add a step below.</p>
          )}
          {renderAddStep('Reminders · registrants only')}
        </section>

        {/* STAGE 3 */}
        <section className="lsq-card" aria-labelledby="stage-3">
          <div className="lsq-stage__head">
            <span className="lsq-stage__n" aria-hidden="true">3</span>
            <h2 className="lsq-stage__title" id="stage-3">After The Webinar</h2>
            <Badge color="blue" text="When the webinar ends" />
            <p className="lsq-stage__sub">Zoom reports who attended, and follow-up splits automatically.</p>
          </div>
          <div className="lsq-branches">
            <div className="lsq-branch" data-tone="success">
              <div className="lsq-branch__head">
                <p className="lsq-branch__title">Attended</p>
                <Badge color="success" text="High intent" />
              </div>
              <p className="lsq-hint">Thank-you note with the recording and a call to action. Sent when attendance is imported.</p>
              {stage3Attended.length > 0 ? (
                <ul className="lsq-steps">{stage3Attended.map((step) => renderStepRow(step))}</ul>
              ) : (
                <p className="lsq-stage__empty" style={{ padding: 'var(--space-8) 0' }}>No follow-up step for attendees.</p>
              )}
            </div>
            <div className="lsq-branch" data-tone="warning">
              <div className="lsq-branch__head">
                <p className="lsq-branch__title">Did Not Attend</p>
                <Badge color="warning" text="Re-engage" />
              </div>
              <p className="lsq-hint">A short note with the replay for people who registered but did not join.</p>
              {stage3Noshow.length > 0 ? (
                <ul className="lsq-steps">{stage3Noshow.map((step) => renderStepRow(step))}</ul>
              ) : (
                <p className="lsq-stage__empty" style={{ padding: 'var(--space-8) 0' }}>No follow-up step for no-shows.</p>
              )}
            </div>
          </div>
        </section>
      </div>

      {/* Confirmation for Step Removal */}
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
          onConfirm={() => handleRemoveStep(confirmRemove)}
          onClose={() => setConfirmRemove(null)}
        />
      )}

      {confirmingReset && (
        <ConfirmDialog
          title="Reset cadence to defaults?"
          message={
            addedStepCount > 0
              ? `This restores every built-in step's timing, mode, and instructions to their defaults, and permanently deletes the ${addedStepCount} step${addedStepCount === 1 ? '' : 's'} you added by hand. Steps that have already sent are not affected.`
              : "This restores every built-in step's timing, mode, and instructions to their defaults. Steps that have already sent are not affected."
          }
          confirmLabel="Reset to defaults"
          destructive
          busy={busy}
          onConfirm={handleResetAll}
          onClose={() => setConfirmingReset(false)}
        />
      )}

      {confirmingLinkedInBulk && (
        <ConfirmDialog
          title="Mark LinkedIn touches as sent?"
          message={`This does not send anything on LinkedIn — this app never messages LinkedIn directly, to comply with LinkedIn's terms. It only records ${linkedinQueue.length} contact(s) as messaged and notifies LeadSquared. Only confirm this if you've already sent these messages yourself, outside the app.`}
          confirmLabel="I've already sent these — mark as sent"
          destructive
          busy={dispatchingLinkedIn}
          onConfirm={handleBulkConfirmLinkedIn}
          onClose={() => setConfirmingLinkedInBulk(false)}
        />
      )}

      {/* Campaign & Global Suppression Modal */}
      {suppressionOpen && (
        <CampaignSuppressionModal
          campaignId={campaignId}
          campaignName={webinarName || 'Webinar'}
          onClose={() => setSuppressionOpen(false)}
          onChanged={() => router.refresh()}
        />
      )}

      {/* LinkedIn Fast-Runner Modal */}
      <LinkedInFastRunnerModal
        campaignId={campaignId}
        campaignTitle={webinarName}
        queue={linkedinQueue}
        initialProgress={linkedInProgress}
        isOpen={fastRunnerOpen}
        onClose={() => setFastRunnerOpen(false)}
        onProgressUpdate={(updated) => setLinkedInProgress(updated)}
      />

      {/* Cadence Step Timing Configurator Modal */}
      {timingModalStep && (
        <CadenceTimingModal
          isOpen={true}
          onClose={() => setTimingModalStep(null)}
          stepTitle={timingModalStep.title}
          stepKey={timingModalStep.key}
          channel={timingModalStep.channel}
          group={timingModalStep.group}
          currentTiming={
            structuredTimingEdits[timingModalStep.key]?.timing ||
            timingEdits[timingModalStep.key] ||
            timingModalStep.timing
          }
          currentOffsetValue={
            structuredTimingEdits[timingModalStep.key]?.offsetValue ??
            timingModalStep.offsetValue
          }
          currentOffsetUnit={
            structuredTimingEdits[timingModalStep.key]?.offsetUnit ??
            timingModalStep.offsetUnit
          }
          currentAnchor={
            structuredTimingEdits[timingModalStep.key]?.anchor ??
            timingModalStep.anchor
          }
          webinarDate={webinarAtIso}
          launchDate={launchAtIso}
          onSave={handleSaveStepTiming}
          isSaving={savingTimingImmediate}
        />
      )}

      {broadcastOpen && (
        <BroadcastReminderModal
          campaignId={campaignId}
          campaignName={webinarName || 'Webinar'}
          webinarDate={webinarDate}
          registeredCount={registeredCount ?? 0}
          onClose={() => setBroadcastOpen(false)}
          onSuccess={() => router.refresh()}
        />
      )}
    </>
  );
}
