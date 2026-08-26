'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { runScoringAction } from '@/lib/actions/scoring';

export function RunScoringPrompt({ campaignId, contactCount }: { campaignId: string; contactCount: number }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function run() {
    setBusy(true);
    setError(null);
    const res = await runScoringAction(campaignId);
    setBusy(false);
    if (!res.ok) setError(res.error ?? 'Scoring failed.');
    else router.refresh();
  }

  return (
    <div style={{ background: '#fff', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)', padding: '32px 28px', textAlign: 'center', maxWidth: 480, margin: '48px auto' }}>
      <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--accent-purple)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', fontSize: 'var(--fs-label-1)', fontWeight: 700, color: '#fff' }}>
        C
      </div>
      <div style={{ fontSize: 'var(--fs-body)', fontWeight: 700, color: 'var(--n90)', marginBottom: 8 }}>Ready to score {contactCount} contacts</div>
      <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--n60)', lineHeight: 1.55, marginBottom: 20 }}>
        Claude will score every imported contact against this webinar&apos;s topic and persona criteria — this makes a real API
        call and takes a few seconds per batch of 25.
      </div>
      {error && <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--danger-500)', marginBottom: 12 }}>{error}</div>}
      <Button onClick={run} disabled={busy} icon={!busy ? <Icon name="arrow-right" size={14} /> : undefined} iconPosition="trailing">
        {busy ? 'Scoring…' : 'Run audience scoring'}
      </Button>
    </div>
  );
}
