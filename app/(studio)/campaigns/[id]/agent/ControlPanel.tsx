'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { formatLsqDateTime } from '@/lib/dateFormat';
import { groupAttentionItems } from '@/lib/attentionGroups';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Modal } from '@/components/ui/Modal';
import {
  togglePauseResumeAction,
  stopCadenceAction,
  retryFailedSendsAction,
  resolveAttentionAction,
  runDueSendsNowAction,
  diagnoseAttentionItemAction,
} from '@/lib/actions/control';
import { retryLeadSquaredSyncAction } from '@/lib/actions/setup';
import { launchCadenceAction, restartCadenceAction, rescheduleWebinarAction } from '@/lib/actions/schedule';
import { retryPlanFor, retryLabel } from '@/lib/attentionRetry';
import { plainError } from '@/lib/plainError';
import type { Campaign, AttentionItem } from '@/lib/generated/prisma/client';
import type { DiagnoseResult } from '@/lib/claude';

// 'fix' used to just navigate to Scoring regardless of what actually broke —
// it's now "Fix with AI", which asks Claude to read this item's own recorded
// error and explain it (see diagnoseAttentionItemAction), so it's relevant to
// every attention item, not only the ones authored with actionsCsv='fix'.
const actionLabel: Record<string, string> = { retry: 'Retry', skip: 'Skip', fix: 'Fix with AI', view: 'View details' };

export function ControlPanel({ campaign, attentionItems: initialItems, nextSendDueAt }: { campaign: Campaign; attentionItems: AttentionItem[]; nextSendDueAt: string | null }) {
  const [status, setStatus] = useState(campaign.cadenceStatus);
  const [items, setItems] = useState(initialItems);
  // Resync from the server on refresh. Both of these are seeded from props and
  // then mutated locally, so after router.refresh() (fired by runNow/retry),
  // the panel previously kept rendering the old
  // attention list and the pre-action cadence status until a full reload. Same
  // adjust-during-render pattern as CadenceGroups/ScoringTable.
  const [seenItems, setSeenItems] = useState(initialItems);
  if (seenItems !== initialItems) {
    setSeenItems(initialItems);
    setItems(initialItems);
  }
  const [seenStatus, setSeenStatus] = useState(campaign.cadenceStatus);
  if (seenStatus !== campaign.cadenceStatus) {
    setSeenStatus(campaign.cadenceStatus);
    setStatus(campaign.cadenceStatus);
  }
  const [busy, setBusy] = useState(false);
  const [confirmingStop, setConfirmingStop] = useState(false);
  const [confirmingRestart, setConfirmingRestart] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [launchProblems, setLaunchProblems] = useState<string[]>([]);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [rescheduleTime, setRescheduleTime] = useState('10:00');
  const [rescheduleError, setRescheduleError] = useState<string | null>(null);
  const [rescheduling, setRescheduling] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [runningNow, setRunningNow] = useState(false);
  const [diagnosing, setDiagnosing] = useState<string | null>(null);
  const [diagnosis, setDiagnosis] = useState<{ title: string; result: DiagnoseResult } | null>(null);
  const [diagnosisError, setDiagnosisError] = useState<string | null>(null);
  const closeDiagnosis = () => { setDiagnosis(null); setDiagnosisError(null); };
  const router = useRouter();

  const badge =
    status === 'paused'
      ? { color: 'warning', text: 'Cadence paused' }
      : status === 'stopped'
      ? { color: 'error', text: 'Cadence stopped' }
      : status === 'running'
      ? { color: 'success', text: 'Cadence live' }
      : { color: 'gray', text: 'Not yet launched' };

  // Local state only ever moves after the server confirms the write — showing
  // "Cadence stopped" optimistically, before the action resolves, meant a
  // failed request left the badge claiming a state the DB never reached.
  async function pauseResume() {
    setBusy(true);
    try {
      await togglePauseResumeAction(campaign.id);
      setStatus((s) => (s === 'running' ? 'paused' : 'running'));
      router.refresh();
    } catch (err) {
      setNotice(`Couldn't update cadence status: ${plainError(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    setBusy(true);
    try {
      await stopCadenceAction(campaign.id);
      setStatus('stopped');
      setConfirmingStop(false);
      router.refresh();
    } catch (err) {
      setNotice(`Couldn't stop the cadence: ${plainError(err)}`);
    } finally {
      setBusy(false);
    }
  }

  function retryNotice(result: Awaited<ReturnType<typeof retryFailedSendsAction>>): string {
    if (result.blocked) return "Cadence is stopped, so retry is disabled. Reschedule or start a new cadence instead.";
    const parts = [`${result.sent} sent, ${result.failed} failed.`];
    if (result.dailyLimitReached) parts.push(`Daily send limit reached: ${result.remaining} more queued for tomorrow.`);
    if (result.outsideSendWindow) parts.push(`Outside the configured send window: ${result.remaining} will retry once it opens.`);
    return parts.join(' ');
  }

  async function retry() {
    setBusy(true);
    try {
      const result = await retryFailedSendsAction(campaign.id);
      setNotice(retryNotice(result));
      router.refresh();
    } catch (err) {
      setNotice(`Retry failed: ${plainError(err)}`);
    } finally {
      setBusy(false);
    }
  }

  // Previously unwired: Control Center had no on-demand way to make the cadence
  // check for due sends — only a background tick (see scripts/cadence-tick.ts)
  // or a side effect of clicking Retry did this.
  async function runNow() {
    setRunningNow(true);
    try {
      const result = await runDueSendsNowAction(campaign.id);
      const parts = [`Checked for due sends: ${result.sent} sent, ${result.failed} failed.`];
      if (result.dailyLimitReached) parts.push(`Daily send limit reached: ${result.remaining} more queued for tomorrow.`);
      if (result.outsideSendWindow) parts.push(`Outside the configured send window: ${result.remaining} will go out once it opens.`);
      if (!result.dailyLimitReached && !result.outsideSendWindow && result.sent === 0 && result.failed === 0) parts.push('Nothing was due yet.');
      setNotice(parts.join(' '));
      router.refresh();
    } catch (err) {
      setNotice(`Couldn't run due sends: ${plainError(err)}`);
    } finally {
      setRunningNow(false);
    }
  }

  async function diagnose(itemId: string, title: string) {
    setDiagnosing(itemId);
    setDiagnosisError(null);
    try {
      const res = await diagnoseAttentionItemAction(itemId);
      if (res.ok && res.diagnosis) setDiagnosis({ title, result: res.diagnosis });
      else setDiagnosisError(res.error ?? 'Claude could not diagnose this.');
    } catch (err) {
      setDiagnosisError(plainError(err));
    } finally {
      setDiagnosing(null);
    }
  }

  async function resolve(ids: string[], action: string) {
    // "Fix with AI" opens a diagnosis rather than dismissing the card or
    // navigating away blind — the previous behaviour always sent the operator
    // to Scoring regardless of whether the error had anything to do with scoring.
    if (action === 'fix') {
      const item = items.find((it) => it.id === ids[0]);
      await diagnose(ids[0], item?.title ?? 'This issue');
      return;
    }
    const item = items.find((it) => it.id === ids[0]);
    if (action === 'retry' && item) {
      // Retry the thing that went wrong. Only a retry that actually ran, and worked, clears the card.
      const plan = retryPlanFor(item.title);
      if (plan.kind === 'elsewhere') {
        router.push(plan.href(campaign.id));
        return;
      }
      setBusy(true);
      try {
        if (plan.kind === 'crm-sync') {
          const res = await retryLeadSquaredSyncAction(campaign.id);
          if (!res.ok) {
            setNotice(`The LeadSquared sync failed again: ${res.error}`);
            router.refresh();
            return;
          }
          setNotice(res.message);
        } else {
          // One retry pass covers every failed send, so a grouped card retries once.
          const result = await retryFailedSendsAction(campaign.id);
          setNotice(retryNotice(result));
          if (result.blocked) return;
        }
        for (const id of ids) await resolveAttentionAction(id, campaign.id);
        setItems((its) => its.filter((it) => !ids.includes(it.id)));
        router.refresh();
      } catch (err) {
        setNotice(`Couldn't retry: ${plainError(err)}`);
      } finally {
        setBusy(false);
      }
      return;
    }
    setBusy(true);
    try {
      for (const id of ids) await resolveAttentionAction(id, campaign.id);
      // Only drop the card locally once the server has actually recorded it
      // resolved — removing it first risked the card vanishing on screen while
      // the underlying attention item (and whatever it flagged) was untouched.
      setItems((its) => its.filter((it) => !ids.includes(it.id)));
      router.refresh();
    } catch (err) {
      setNotice(`Couldn't resolve: ${plainError(err)}`);
    } finally {
      setBusy(false);
    }
  }

  const completed = campaign.status === 'completed';
  // A webinar whose date is still ahead can be started over; one whose date has passed must be moved first.
  const [openedAtMs] = useState(() => Date.now());
  const dateAhead = campaign.scheduledAt ? new Date(campaign.scheduledAt).getTime() > openedAtMs : false;
  const launchedBefore = campaign.status === 'live';

  async function restart() {
    setBusy(true);
    try {
      const res = await restartCadenceAction(campaign.id);
      setConfirmingRestart(false);
      if (!res.ok) {
        setNotice(res.error);
        return;
      }
      setStatus('not_started');
      setLaunchProblems([]);
      setNotice(`Cadence reset. ${res.skipped} unsent ${res.skipped === 1 ? 'message was' : 'messages were'} set aside; messages already sent stay sent. Launch it when you are ready.`);
      router.refresh();
    } catch (err) {
      setNotice(`Couldn't restart the cadence: ${plainError(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function launch() {
    setLaunching(true);
    setLaunchProblems([]);
    try {
      const res = await launchCadenceAction(campaign.id);
      if (!res.ok) {
        setLaunchProblems(res.problems ?? []);
        setNotice(res.error);
        return;
      }
      setStatus('running');
      setNotice(`Cadence launched. ${res.queued} ${res.queued === 1 ? 'message' : 'messages'} queued, ${res.sent} sent right away.`);
      router.refresh();
    } catch (err) {
      setNotice(`Couldn't launch the cadence: ${plainError(err)}`);
    } finally {
      setLaunching(false);
    }
  }

  async function reschedule() {
    setRescheduleError(null);
    if (!rescheduleDate || !rescheduleTime) {
      setRescheduleError('Choose both a date and a time.');
      return;
    }
    setRescheduling(true);
    try {
      const res = await rescheduleWebinarAction(campaign.id, `${rescheduleDate}T${rescheduleTime}`);
      if (!res.ok) {
        setRescheduleError(res.error);
        return;
      }
      setRescheduleOpen(false);
      setNotice(`Webinar moved to ${res.display}.${res.zoomLinked ? ' Studio does not change the Zoom event, so change its date in Zoom too.' : ''}`);
      router.refresh();
    } catch (err) {
      setRescheduleError(plainError(err));
    } finally {
      setRescheduling(false);
    }
  }

  const groups = groupAttentionItems(items);

  return (
    <div className="lsq-stack lsq-stack--lg">
      <section className="lsq-card" aria-labelledby="res-control">
        <div className="lsq-card__header">
          <div>
            <h2 className="lsq-card__title" id="res-control">Cadence Control</h2>
            <p className="lsq-card__sub">
              {status === 'stopped'
                ? 'This cadence is stopped. Start it over to send again, or move the webinar to a new date first.'
                : status === 'not_started'
                  ? 'This cadence has not started.'
                  : 'Pause, resume or stop outreach, and run or retry sends on demand.'}
            </p>
          </div>
          <Badge color={badge.color} text={badge.text} dot />
        </div>
        <div className="lsq-card__body lsq-stack">
          <div className="lsq-cluster">
            {/* Only the controls that can act on the cadence as it is now: a stopped or unlaunched one has nothing to pause, stop, retry or run. */}
            {(status === 'running' || status === 'paused') && (
              <>
              <Button
                hierarchy="secondary"
                size="sm"
                icon={<Icon name={status === 'running' ? 'pause' : 'play'} size={14} />}
                onClick={pauseResume}
                disabled={busy}
              >
                {status === 'running' ? 'Pause' : 'Resume'}
              </Button>
              <Button
                hierarchy="destructive-outline"
                size="sm"
                icon={<Icon name="stop" size={14} />}
                onClick={() => setConfirmingStop(true)}
                disabled={busy}
              >
                Stop
              </Button>
              <Button hierarchy="secondary" size="sm" icon={<Icon name="refresh" size={14} />} onClick={retry} disabled={busy}>
                Retry Failed Sends
              </Button>
              <Button
                hierarchy="secondary"
                size="sm"
                icon={<Icon name="bolt" size={14} />}
                onClick={runNow}
                loading={runningNow}
                disabled={busy || status !== 'running'}
              >
                {runningNow ? 'Checking' : 'Run Due Sends Now'}
              </Button>
              </>
            )}
            {status === 'stopped' && !completed && (
              <Button hierarchy="primary" size="sm" icon={<Icon name="refresh" size={14} />} onClick={() => setConfirmingRestart(true)} disabled={busy || !dateAhead}>
                Restart Cadence
              </Button>
            )}
            {status === 'not_started' && launchedBefore && !completed && (
              <Button hierarchy="primary" size="sm" icon={<Icon name="play" size={14} />} onClick={launch} loading={launching} disabled={busy}>
                {launching ? 'Launching' : 'Launch Cadence'}
              </Button>
            )}
            {!completed && (
              <Button hierarchy="tertiary" size="sm" icon={<Icon name="calendar" size={14} />} onClick={() => setRescheduleOpen(true)} disabled={busy}>
                Reschedule Webinar
              </Button>
            )}
            <Button hierarchy="tertiary" size="sm" icon={<Icon name="edit" size={14} />} onClick={() => router.push(`/campaigns/${campaign.id}/cadence`)}>
              Edit Step Timing
            </Button>
          </div>
          {status === 'stopped' && (
            <p className="lsq-hint">
              {completed
                ? 'This webinar is completed, so its cadence stays stopped.'
                : dateAhead
                  ? 'This cadence was stopped and cannot be resumed. Restart it to begin a fresh run: messages already sent stay sent, and unsent ones are queued again when you launch.'
                  : 'This cadence was stopped and cannot be resumed. The webinar date has passed, so move the webinar to a date that is still ahead (Reschedule Webinar), then restart the cadence.'}
            </p>
          )}
          {status === 'paused' && <p className="lsq-hint">Resume the cadence to run due sends.</p>}
          {status === 'not_started' && (
            <p className="lsq-hint">
              {launchedBefore && !completed
                ? 'The cadence is reset and ready. Launch it to queue the messages that have not been sent.'
                : 'Launch the cadence from the last step of the webinar setup to enable due-send checks.'}
            </p>
          )}
          {notice && (
            <div className="lsq-banner lsq-banner--neutral" role="status">
              <span className="lsq-banner__icon"><Icon name="info" size={16} /></span>
              <div>
                <p className="lsq-banner__body">{notice}</p>
                {launchProblems.length > 0 && (
                  <ul className="lsq-wiz-list">
                    {launchProblems.map((p) => <li key={p}>{p}</li>)}
                  </ul>
                )}
              </div>
            </div>
          )}
          <hr className="lsq-divider" />
          <dl className="lsq-kv">
            <dt>Next automated action</dt>
            <dd>
              {status === 'stopped'
                ? 'None. The cadence is stopped.'
                : nextSendDueAt
                  ? `Send due ${formatLsqDateTime(new Date(nextSendDueAt))}`
                  : 'Nothing queued'}
            </dd>
          </dl>
        </div>
      </section>

      <section className="lsq-card" aria-labelledby="res-attention">
        <div className="lsq-card__header">
          <div>
            <h2 className="lsq-card__title" id="res-attention">Needs Attention</h2>
            <p className="lsq-card__sub">
              {items.length === 0 ? 'No open items' : `${groups.length} ${groups.length === 1 ? 'issue' : 'issues'} \u00b7 ${items.length} affected`}
            </p>
          </div>
        </div>
        <div className="lsq-card__body">
          {items.length === 0 ? (
            <div className="lsq-res-clear">
              <Icon name="check-circle" size={20} />
              <span>Nothing needs attention right now.</span>
            </div>
          ) : (
            <ul className="lsq-rows">
              {groups.map((g) => {
                const na = g.first;
                const ids = g.items.map((i) => i.id);
                const tone = na.color === 'error' ? 'error' : 'warning';
                return (
                  <li key={g.key} className="lsq-res-attn" data-tone={tone}>
                    <span className="lsq-res-attn__icon"><Icon name={na.icon} size={16} /></span>
                    <div className="lsq-res-attn__main">
                      <p className="lsq-res-attn__title">{g.title}</p>
                      <p className="lsq-res-attn__detail">{na.detail}</p>
                      <div className="lsq-cluster">
                        {na.actionsCsv.split(',').map((a) => (
                          <Button key={a} hierarchy="secondary" size="sm" onClick={() => resolve(ids, a)} disabled={busy}>
                            {a === 'retry' ? retryLabel(retryPlanFor(na.title)) : actionLabel[a] ?? a}
                          </Button>
                        ))}
                        {/* Every card gets this, not just ones authored with actionsCsv='fix' —
                            the diagnosis reads the item's own recorded error, so it's useful
                            regardless of which other actions the item happened to ship with. */}
                        {!na.actionsCsv.split(',').includes('fix') && (
                          <Button
                            hierarchy="secondary-color"
                            size="sm"
                            icon={<Icon name="sparkle" size={14} />}
                            onClick={() => diagnose(na.id, g.title)}
                            loading={diagnosing === na.id}
                            disabled={busy}
                          >
                            {diagnosing === na.id ? 'Thinking' : 'Fix with AI'}
                          </Button>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      {confirmingRestart && (
        <ConfirmDialog
          title="Restart This Cadence?"
          message="This starts a fresh run. Messages already sent stay sent and are not sent again. Messages that were waiting are set aside, and you then launch the cadence to queue them again for the people who have not received them."
          confirmLabel="Restart Cadence"
          destructive={false}
          busy={busy}
          onConfirm={restart}
          onClose={() => setConfirmingRestart(false)}
        />
      )}

      <Modal
        isOpen={rescheduleOpen}
        onClose={() => setRescheduleOpen(false)}
        busy={rescheduling}
        size="sm"
        title="Reschedule Webinar"
        subtitle={`Times are in the webinar's time zone (${campaign.timezone}).`}
        footer={
          <>
            <Button hierarchy="secondary" size="md" onClick={() => setRescheduleOpen(false)} disabled={rescheduling}>Cancel</Button>
            <Button hierarchy="primary" size="md" onClick={reschedule} loading={rescheduling}>{rescheduling ? 'Moving' : 'Move Webinar'}</Button>
          </>
        }
      >
        <div className="lsq-stack">
          <p className="lsq-hint">
            Messages still waiting on the old date move with the webinar; messages already sent stay as they were. Studio does not change the Zoom event: change its date in Zoom too.
          </p>
          <div className="lsq-field">
            <label className="lsq-label" htmlFor="reschedule-date">New date</label>
            <input id="reschedule-date" className="lsq-input" type="date" value={rescheduleDate} onChange={(e) => setRescheduleDate(e.target.value)} />
          </div>
          <div className="lsq-field">
            <label className="lsq-label" htmlFor="reschedule-time">New time</label>
            <input id="reschedule-time" className="lsq-input" type="time" value={rescheduleTime} onChange={(e) => setRescheduleTime(e.target.value)} />
          </div>
          {rescheduleError && <p className="lsq-error" role="alert">{rescheduleError}</p>}
        </div>
      </Modal>

      {confirmingStop && (
        <ConfirmDialog
          title="Stop This Cadence?"
          message="Stopping is a one-way action — it can't be resumed like a pause, and retrying failed sends is disabled afterward. Every send still queued for this campaign is abandoned where it stands."
          confirmLabel="Stop Cadence"
          destructive
          busy={busy}
          onConfirm={stop}
          onClose={() => setConfirmingStop(false)}
        />
      )}

      <Modal
        isOpen={!!(diagnosis || diagnosisError)}
        onClose={closeDiagnosis}
        size="sm"
        title={diagnosisError ? "Couldn't Diagnose This" : diagnosis?.title ?? 'Diagnosis'}
        footer={
          <Button hierarchy="secondary" size="sm" onClick={closeDiagnosis}>
            Close
          </Button>
        }
      >
        {diagnosisError ? (
          <p className="lsq-error" role="alert">{diagnosisError}</p>
        ) : (
          diagnosis && (
            <div className="lsq-stack">
              <Badge color="purple" text="AI diagnosis" />
              <div className="lsq-field">
                <p className="lsq-stat__label">What happened</p>
                <p className="lsq-res-prose">{diagnosis.result.explanation}</p>
              </div>
              <div className="lsq-field">
                <p className="lsq-stat__label">Suggested fix</p>
                <div className="lsq-msgbox">{diagnosis.result.suggestedFix}</div>
              </div>
              {diagnosis.result.canAutoResolve && (
                <div className="lsq-banner lsq-banner--success">
                  <span className="lsq-banner__icon"><Icon name="check-circle" size={16} /></span>
                  <p className="lsq-banner__body">Claude thinks a plain retry is likely to work. Try &quot;Retry Failed Sends&quot; above.</p>
                </div>
              )}
            </div>
          )
        )}
      </Modal>
    </div>
  );
}
