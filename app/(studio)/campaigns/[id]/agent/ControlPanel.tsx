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
      setNotice(`Couldn't update cadence status: ${String(err)}`);
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
      setNotice(`Couldn't stop the cadence: ${String(err)}`);
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
      setNotice(`Retry failed: ${String(err)}`);
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
      setNotice(`Couldn't run due sends: ${String(err)}`);
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
      setDiagnosisError(String(err));
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
    setBusy(true);
    try {
      if (action === 'retry') {
        // One retry pass covers every failed send, so a grouped card retries once.
        const result = await retryFailedSendsAction(campaign.id);
        setNotice(retryNotice(result));
      }
      for (const id of ids) await resolveAttentionAction(id, campaign.id);
      // Only drop the card locally once the server has actually recorded it
      // resolved — removing it first risked the card vanishing on screen while
      // the underlying attention item (and whatever it flagged) was untouched.
      setItems((its) => its.filter((it) => !ids.includes(it.id)));
      router.refresh();
    } catch (err) {
      setNotice(`Couldn't resolve: ${String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  const retryDisabled = busy || status === 'stopped' || status === 'not_started';
  const groups = groupAttentionItems(items);

  return (
    <div className="lsq-stack lsq-stack--lg">
      <section className="lsq-card" aria-labelledby="res-control">
        <div className="lsq-card__header">
          <div>
            <h2 className="lsq-card__title" id="res-control">Cadence Control</h2>
            <p className="lsq-card__sub">Pause, resume or stop outreach, and run or retry sends on demand.</p>
          </div>
          <Badge color={badge.color} text={badge.text} dot />
        </div>
        <div className="lsq-card__body lsq-stack">
          <div className="lsq-cluster">
            <Button
              hierarchy="secondary"
              size="sm"
              icon={<Icon name={status === 'running' ? 'pause' : 'play'} size={14} />}
              onClick={pauseResume}
              disabled={busy || status === 'not_started' || status === 'stopped'}
            >
              {status === 'running' ? 'Pause' : 'Resume'}
            </Button>
            <Button
              hierarchy="destructive-outline"
              size="sm"
              icon={<Icon name="stop" size={14} />}
              onClick={() => setConfirmingStop(true)}
              disabled={busy || status === 'stopped'}
            >
              Stop
            </Button>
            <Button hierarchy="secondary" size="sm" icon={<Icon name="refresh" size={14} />} onClick={retry} disabled={retryDisabled}>
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
            <Button hierarchy="tertiary" size="sm" icon={<Icon name="calendar" size={14} />} onClick={() => router.push(`/campaigns/${campaign.id}/cadence`)}>
              Reschedule
            </Button>
          </div>
          {status === 'stopped' && (
            <p className="lsq-hint">
              This cadence was stopped — that&apos;s a one-way action, so retrying failed sends and running due sends are disabled here. Start a new cadence from the Cadence tab.
            </p>
          )}
          {(status === 'paused' || status === 'not_started') && (
            <p className="lsq-hint">
              {status === 'paused' ? 'Resume the cadence to run due sends.' : 'Launch the cadence from the Cadence tab to enable due-send checks.'}
            </p>
          )}
          {notice && (
            <div className="lsq-banner lsq-banner--neutral" role="status">
              <span className="lsq-banner__icon"><Icon name="info" size={16} /></span>
              <p className="lsq-banner__body">{notice}</p>
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
                            {actionLabel[a] ?? a}
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
