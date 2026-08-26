'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
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
  const [busy, setBusy] = useState(false);
  const [confirmingStop, setConfirmingStop] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [runningNow, setRunningNow] = useState(false);
  const [diagnosing, setDiagnosing] = useState<string | null>(null);
  const [diagnosis, setDiagnosis] = useState<{ title: string; result: DiagnoseResult } | null>(null);
  const [diagnosisError, setDiagnosisError] = useState<string | null>(null);
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
    if (result.blocked) return "Cadence is stopped — retry is disabled. Reschedule or start a new cadence instead.";
    const parts = [`${result.sent} sent, ${result.failed} failed.`];
    if (result.dailyLimitReached) parts.push(`Daily send limit reached — ${result.remaining} more queued for tomorrow.`);
    if (result.outsideSendWindow) parts.push(`Outside the configured send window — ${result.remaining} will retry once it opens.`);
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
      const parts = [`Checked for due sends — ${result.sent} sent, ${result.failed} failed.`];
      if (result.dailyLimitReached) parts.push(`Daily send limit reached — ${result.remaining} more queued for tomorrow.`);
      if (result.outsideSendWindow) parts.push(`Outside the configured send window — ${result.remaining} will go out once it opens.`);
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

  async function resolve(id: string, action: string) {
    // "Fix with AI" opens a diagnosis rather than dismissing the card or
    // navigating away blind — the previous behaviour always sent the operator
    // to Scoring regardless of whether the error had anything to do with scoring.
    if (action === 'fix') {
      const item = items.find((it) => it.id === id);
      await diagnose(id, item?.title ?? 'This issue');
      return;
    }
    setBusy(true);
    try {
      if (action === 'retry') {
        const result = await retryFailedSendsAction(campaign.id);
        setNotice(retryNotice(result));
      }
      await resolveAttentionAction(id, campaign.id);
      // Only drop the card locally once the server has actually recorded it
      // resolved — removing it first risked the card vanishing on screen while
      // the underlying attention item (and whatever it flagged) was untouched.
      setItems((its) => its.filter((it) => it.id !== id));
      router.refresh();
    } catch (err) {
      setNotice(`Couldn't resolve: ${String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  const retryDisabled = busy || status === 'stopped' || status === 'not_started';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ background: '#fff', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)', padding: '18px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ fontSize: 'var(--fs-body)', fontWeight: 700, color: 'var(--n90)' }}>Campaign control</div>
          <Badge color={badge.color} text={badge.text} dot />
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Button hierarchy="secondary" size="sm" onClick={pauseResume} disabled={busy || status === 'not_started' || status === 'stopped'}>
            {status === 'running' ? 'Pause' : 'Resume'}
          </Button>
          <Button hierarchy="destructive-outline" size="sm" onClick={() => setConfirmingStop(true)} disabled={busy || status === 'stopped'}>
            Stop
          </Button>
          <Button hierarchy="tertiary" size="sm" onClick={retry} disabled={retryDisabled}>
            Retry failed sends
          </Button>
          <Button hierarchy="tertiary" size="sm" onClick={runNow} disabled={busy || runningNow || status !== 'running'}>
            {runningNow ? 'Checking…' : 'Run due sends now'}
          </Button>
          <Button hierarchy="tertiary" size="sm" onClick={() => router.push(`/campaigns/${campaign.id}/schedule`)}>
            Reschedule
          </Button>
        </div>
        {status === 'stopped' && (
          <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n50)', marginTop: 8 }}>
            This cadence was stopped — that&apos;s a one-way action, so retrying failed sends and running due sends are disabled here. Start a new cadence from the Schedule tab.
          </div>
        )}
        {(status === 'paused' || status === 'not_started') && (
          <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n50)', marginTop: 8 }}>
            {status === 'paused' ? 'Resume the cadence to run due sends.' : 'Launch the cadence from Schedule to enable due-send checks.'}
          </div>
        )}
        {notice && <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--n70)', marginTop: 10 }}>{notice}</div>}
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border-subtle)' }}>
          <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--n60)', marginBottom: 4 }}>Next automated action</div>
          <div style={{ fontSize: 'var(--fs-label-1)', fontWeight: 600, color: 'var(--n90)' }}>
            {nextSendDueAt ? `Send due ${new Date(nextSendDueAt).toLocaleString('en-GB', { hour12: false })}` : 'Nothing queued'}
          </div>
        </div>
      </div>

      <div style={{ background: '#fff', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)', padding: '18px 20px' }}>
        <div style={{ fontSize: 'var(--fs-body)', fontWeight: 700, color: 'var(--n90)', marginBottom: 4 }}>Needs attention</div>
        <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--n60)', marginBottom: 14 }}>{items.length} item(s) need review</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {items.map((na) => (
            <div key={na.id} style={{ display: 'flex', gap: 12, alignItems: 'start', padding: '12px 14px', borderRadius: 'var(--radius-md)', background: 'var(--n10)' }}>
              <Icon name={na.icon} size={16} style={{ color: na.color === 'error' ? 'var(--danger-500)' : 'var(--warning-700)', flexShrink: 0, marginTop: 1 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 'var(--fs-label-1)', fontWeight: 600, color: 'var(--n90)', marginBottom: 2 }}>{na.title}</div>
                <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--n60)', lineHeight: 1.5, marginBottom: 8, overflowWrap: 'anywhere' }}>{na.detail}</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {na.actionsCsv.split(',').map((a) => (
                    <Button key={a} hierarchy="tertiary" size="sm" onClick={() => resolve(na.id, a)} disabled={busy}>
                      {actionLabel[a] ?? a}
                    </Button>
                  ))}
                  {/* Every card gets this, not just ones authored with actionsCsv='fix' —
                      the diagnosis reads the item's own recorded error, so it's useful
                      regardless of which other actions the item happened to ship with. */}
                  {!na.actionsCsv.split(',').includes('fix') && (
                    <Button hierarchy="secondary-color" size="sm" onClick={() => diagnose(na.id, na.title)} disabled={busy || diagnosing === na.id}>
                      {diagnosing === na.id ? 'Thinking…' : 'Fix with AI'}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}
          {items.length === 0 && <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--n60)', padding: '8px 0' }}>Nothing needs attention right now.</div>}
        </div>
      </div>

      {confirmingStop && (
        <ConfirmDialog
          title="Stop this cadence?"
          message="Stopping is a one-way action — it can't be resumed like a pause, and retrying failed sends is disabled afterward. Every send still queued for this campaign is abandoned where it stands."
          confirmLabel="Stop cadence"
          destructive
          busy={busy}
          onConfirm={stop}
          onClose={() => setConfirmingStop(false)}
        />
      )}

      {(diagnosis || diagnosisError) && (
        <>
          <div onClick={() => { setDiagnosis(null); setDiagnosisError(null); }} style={{ position: 'fixed', inset: 0, background: 'rgba(16,20,25,0.45)', zIndex: 1200 }} />
          <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: 460, maxHeight: 'calc(100vh - 48px)', overflowY: 'auto', background: '#fff', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-panel)', zIndex: 1201, padding: '20px 22px' }}>
            {diagnosisError ? (
              <>
                <div style={{ fontSize: 'var(--fs-body)', fontWeight: 700, color: 'var(--n90)', marginBottom: 8 }}>Couldn&apos;t diagnose this</div>
                <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--danger-500)', lineHeight: 1.55, marginBottom: 16 }}>{diagnosisError}</div>
              </>
            ) : (
              diagnosis && (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <div style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--accent-purple)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 'var(--fs-caption)', fontWeight: 700, color: '#fff' }}>C</div>
                    <div style={{ fontSize: 'var(--fs-body)', fontWeight: 700, color: 'var(--n90)' }}>{diagnosis.title}</div>
                  </div>
                  <div style={{ fontSize: 'var(--fs-label-2)', fontWeight: 600, color: 'var(--n60)', textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: 14, marginBottom: 4 }}>What happened</div>
                  <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--n80)', lineHeight: 1.55 }}>{diagnosis.result.explanation}</div>
                  <div style={{ fontSize: 'var(--fs-label-2)', fontWeight: 600, color: 'var(--n60)', textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: 14, marginBottom: 4 }}>Suggested fix</div>
                  <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--n80)', lineHeight: 1.55, background: 'var(--n10)', borderRadius: 'var(--radius-sm)', padding: '10px 12px' }}>{diagnosis.result.suggestedFix}</div>
                  {diagnosis.result.canAutoResolve && (
                    <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--success-700)', marginTop: 10 }}>Claude thinks a plain retry is likely to work — try &quot;Retry failed sends&quot; above.</div>
                  )}
                </>
              )
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
              <Button hierarchy="secondary" size="sm" onClick={() => { setDiagnosis(null); setDiagnosisError(null); }}>
                Close
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
