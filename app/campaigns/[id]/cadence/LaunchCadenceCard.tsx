'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { launchCadenceAction, restartCadenceAction } from '@/lib/actions/schedule';

export function LaunchCadenceCard({
  campaignId,
  approvedCount,
  cadenceStatus,
  sendMode,
}: {
  campaignId: string;
  approvedCount: number;
  cadenceStatus: string;
  sendMode: 'sandbox' | 'live';
}) {
  const [confirming, setConfirming] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [confirmingRestart, setConfirmingRestart] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const router = useRouter();

  async function restart() {
    setRestarting(true);
    await restartCadenceAction(campaignId);
    setRestarting(false);
    setConfirmingRestart(false);
    router.refresh();
  }

  async function launch() {
    setLaunching(true);
    const res = await launchCadenceAction(campaignId);
    setLaunching(false);
    setConfirming(false);
    setResult(
      [
        `Queued ${res.queued} sends.`,
        res.skippedNoEmail ? `Skipped ${res.skippedNoEmail} with no email.` : null,
        res.skippedUnverified ? `Held back ${res.skippedUnverified} unverified inferred email${res.skippedUnverified === 1 ? '' : 's'}.` : null,
        `Sent ${res.sent} immediately, ${res.failed} failed.`,
        res.dailyLimitReached ? `Daily send limit reached — ${res.remaining} more will go out once the limit resets.` : null,
        res.outsideSendWindow ? `Outside the configured send window — ${res.remaining} due send(s) will go out once it opens.` : null,
      ]
        .filter(Boolean)
        .join(' ')
    );
    setTimeout(() => router.push(`/campaigns/${campaignId}/agent`), 1400);
  }

  // A stopped cadence used to leave this card permanently stuck on "already
  // launched" pointing at a Control Center that (correctly) refuses to resume
  // it — Stop is documented as one-way, so there was no path back to sending
  // at all short of editing the database directly. Offer a fresh launch instead.
  if (cadenceStatus === 'stopped') {
    return (
      <div style={{ background: '#fff', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)', padding: '16px 18px' }}>
        <div style={{ fontSize: 'var(--fs-label-1)', fontWeight: 700, color: 'var(--n90)', marginBottom: 6 }}>This cadence was stopped</div>
        <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--n60)', lineHeight: 1.5, marginBottom: 14 }}>
          Stopping can&apos;t be undone, but you can start a new cadence run for the same {approvedCount} approved contact{approvedCount === 1 ? '' : 's'}. Any send still queued from the stopped run is marked skipped first.
        </div>
        {restarting ? (
          <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--n60)' }}>Resetting…</div>
        ) : (
          <Button hierarchy="secondary" size="md" fullWidth onClick={() => setConfirmingRestart(true)}>
            Start a new cadence
          </Button>
        )}
        {confirmingRestart && (
          <ConfirmDialog
            title="Start a new cadence?"
            message="Any send still queued from the stopped run is marked skipped and left in the log. You'll then see the Launch button again to start fresh."
            confirmLabel="Reset for relaunch"
            busy={restarting}
            onConfirm={restart}
            onClose={() => setConfirmingRestart(false)}
          />
        )}
      </div>
    );
  }

  if (cadenceStatus !== 'not_started') {
    return (
      <div style={{ background: '#fff', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)', padding: '16px 18px' }}>
        <div style={{ fontSize: 'var(--fs-label-1)', fontWeight: 700, color: 'var(--n90)', marginBottom: 6 }}>Cadence already launched</div>
        <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--n60)', lineHeight: 1.5, marginBottom: 14 }}>Manage pause/resume/stop from Control Center.</div>
        <Button hierarchy="secondary" size="md" fullWidth onClick={() => router.push(`/campaigns/${campaignId}/agent`)}>
          Go to Control Center
        </Button>
      </div>
    );
  }

  return (
    <div style={{ background: 'var(--n90)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)', padding: '16px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <div style={{ fontSize: 'var(--fs-label-1)', fontWeight: 700, color: '#fff' }}>Ready to launch</div>
        <Badge color={sendMode === 'sandbox' ? 'warning' : 'error'} text={sendMode === 'sandbox' ? 'Sandbox sends' : 'LIVE sends'} />
      </div>
      <div style={{ fontSize: 'var(--fs-label-1)', color: '#9CA3AF', lineHeight: 1.5, marginBottom: 14 }}>
        {approvedCount} approved contact{approvedCount === 1 ? '' : 's'} will get real invite/nudge/final-call emails sent via
        LeadSquared.{' '}
        {sendMode === 'sandbox'
          ? 'Every send is redirected to your allowlisted sandbox lead, not the real contact.'
          : 'SEND_MODE=live — these will go to real contact addresses.'}
      </div>

      {result ? (
        <div style={{ fontSize: 'var(--fs-label-1)', color: '#fff', lineHeight: 1.5 }}>{result}</div>
      ) : confirming ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 'var(--fs-label-1)', color: '#fff', fontWeight: 600 }}>
            Confirm: send to {approvedCount} contacts in {sendMode} mode?
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button hierarchy="secondary" size="sm" onClick={() => setConfirming(false)} disabled={launching}>
              Cancel
            </Button>
            <Button hierarchy="primary" size="sm" onClick={launch} disabled={launching}>
              {launching ? 'Launching…' : 'Confirm launch'}
            </Button>
          </div>
        </div>
      ) : (
        <Button hierarchy="primary" size="md" fullWidth icon={<Icon name="arrow-right" size={14} />} iconPosition="trailing" onClick={() => setConfirming(true)} disabled={approvedCount === 0}>
          Launch cadence
        </Button>
      )}
      {approvedCount === 0 && !result && <div style={{ fontSize: 'var(--fs-label-2)', color: '#F59E0B', marginTop: 8 }}>No approved contacts yet — approve some in Scoring first.</div>}
    </div>
  );
}
