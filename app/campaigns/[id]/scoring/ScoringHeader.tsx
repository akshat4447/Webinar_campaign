'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { updateScoringConfigAction, runScoringAction } from '@/lib/actions/scoring';
import type { Campaign } from '@/lib/generated/prisma/client';

export function ScoringHeader({ campaign }: { campaign: Campaign }) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState(campaign.scoringPrompt);
  const [criteria, setCriteria] = useState(campaign.scoringCriteria);
  const [threshold, setThreshold] = useState(campaign.scoringThreshold);
  const [rescoring, setRescoring] = useState(false);
  const [, startTransition] = useTransition();
  const router = useRouter();

  function saveConfig(patch: { prompt?: string; criteria?: string; threshold?: number }) {
    startTransition(() => updateScoringConfigAction(campaign.id, patch));
  }

  async function rescore() {
    setRescoring(true);
    await runScoringAction(campaign.id);
    setRescoring(false);
    router.refresh();
  }

  return (
    <div style={{ background: '#fff', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)', padding: '16px 20px', marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--accent-purple)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 11, fontWeight: 700, color: '#fff' }}>
            C
          </div>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--n90)' }}>Scored by Claude</div>
            <div style={{ fontSize: 12, color: 'var(--n60)' }}>Approval threshold: {threshold} · {criteria.slice(0, 60)}{criteria.length > 60 ? '…' : ''}</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button hierarchy="tertiary" size="sm" onClick={rescore} disabled={rescoring}>
            {rescoring ? 'Re-scoring…' : 'Re-score all'}
          </Button>
          <Button hierarchy="tertiary" size="sm" onClick={() => setOpen((o) => !o)}>
            {open ? 'Hide config' : 'Edit config'}
          </Button>
        </div>
      </div>
      {open && (
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <div style={{ fontSize: 12, color: 'var(--n60)', marginBottom: 6 }}>Scoring prompt</div>
            <textarea className="lsq-input" rows={2} value={prompt} onChange={(e) => setPrompt(e.target.value)} onBlur={() => saveConfig({ prompt })} />
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--n60)', marginBottom: 6 }}>Approval criteria</div>
            <textarea className="lsq-input" rows={2} value={criteria} onChange={(e) => setCriteria(e.target.value)} onBlur={() => saveConfig({ criteria })} />
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--n60)', marginBottom: 6 }}>Auto-approval threshold — {threshold}</div>
            <input
              type="range"
              min={0}
              max={100}
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              onMouseUp={() => saveConfig({ threshold })}
              onTouchEnd={() => saveConfig({ threshold })}
              style={{ width: '100%', accentColor: 'var(--accent-500)' }}
            />
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--n50)' }}>Changing the threshold here re-approves contacts only on the next re-score — it doesn&apos;t retroactively flip existing approvals.</div>
        </div>
      )}
    </div>
  );
}
