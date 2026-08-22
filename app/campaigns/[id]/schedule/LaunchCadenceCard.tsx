'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { launchCadenceAction } from '@/lib/actions/schedule';

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
  const router = useRouter();

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
      ]
        .filter(Boolean)
        .join(' ')
    );
    setTimeout(() => router.push(`/campaigns/${campaignId}/control`), 1400);
  }

  if (cadenceStatus !== 'not_started') {
    return (
      <div style={{ background: '#fff', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)', padding: '16px 18px' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--n90)', marginBottom: 6 }}>Cadence already launched</div>
        <div style={{ fontSize: 12, color: 'var(--n60)', lineHeight: 1.5, marginBottom: 14 }}>Manage pause/resume/stop from Control Center.</div>
        <Button hierarchy="secondary" size="md" fullWidth onClick={() => router.push(`/campaigns/${campaignId}/control`)}>
          Go to Control Center
        </Button>
      </div>
    );
  }

  return (
    <div style={{ background: 'var(--n90)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)', padding: '16px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>Ready to launch</div>
        <Badge color={sendMode === 'sandbox' ? 'warning' : 'error'} text={sendMode === 'sandbox' ? 'Sandbox sends' : 'LIVE sends'} />
      </div>
      <div style={{ fontSize: 12, color: '#9CA3AF', lineHeight: 1.5, marginBottom: 14 }}>
        {approvedCount} approved contact{approvedCount === 1 ? '' : 's'} will get real invite/nudge/final-call emails sent via
        LeadSquared.{' '}
        {sendMode === 'sandbox'
          ? 'Every send is redirected to your allowlisted sandbox lead, not the real contact.'
          : 'SEND_MODE=live — these will go to real contact addresses.'}
      </div>

      {result ? (
        <div style={{ fontSize: 12.5, color: '#fff', lineHeight: 1.5 }}>{result}</div>
      ) : confirming ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 12, color: '#fff', fontWeight: 600 }}>
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
      {approvedCount === 0 && !result && <div style={{ fontSize: 11.5, color: '#F59E0B', marginTop: 8 }}>No approved contacts yet — approve some in Scoring first.</div>}
    </div>
  );
}
