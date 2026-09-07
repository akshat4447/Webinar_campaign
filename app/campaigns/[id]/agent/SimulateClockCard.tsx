'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { advanceSimulatedClockAction } from '@/lib/actions/control';

export function SimulateClockCard({ campaignId, simulatedNow }: { campaignId: string; simulatedNow: string | null }) {
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function advance(days: number) {
    setBusy(true);
    setError(null);
    try {
      const res = await advanceSimulatedClockAction(campaignId, days);
      setLastResult(
        `Now: ${new Date(res.simulatedNow).toLocaleDateString()} — ${res.sent} sent, ${res.failed} failed this tick.` +
          (res.dailyLimitReached ? ` Daily send limit reached — ${res.remaining} more queued for tomorrow.` : '')
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not advance the clock — try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ background: '#fff', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)', padding: '16px 18px' }}>
      <div style={{ fontSize: 'var(--fs-label-1)', fontWeight: 700, color: 'var(--n90)', marginBottom: 6 }}>Advance simulated time</div>
      <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--n60)', lineHeight: 1.5, marginBottom: 12 }}>
        Real cadence sends fire on real due dates — this fast-forwards the campaign&apos;s clock so nudge/final-call sends due
        days from now become due immediately, without an actual wait.
      </div>
      {simulatedNow && <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n50)', marginBottom: 10 }}>Simulated now: {new Date(simulatedNow).toLocaleString()}</div>}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {[1, 4, 7].map((d) => (
          <Button key={d} hierarchy="secondary" size="sm" onClick={() => advance(d)} disabled={busy}>
            +{d}d
          </Button>
        ))}
      </div>
      {lastResult && <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--n70)', marginBottom: 12 }}>{lastResult}</div>}
      {error && <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--danger-500)', marginBottom: 12 }}>{error}</div>}
      <Button hierarchy="primary" size="md" fullWidth icon={<Icon name="arrow-right" size={14} />} iconPosition="trailing" onClick={() => router.push(`/campaigns/${campaignId}/overview`)}>
        Go to dashboard
      </Button>
    </div>
  );
}
