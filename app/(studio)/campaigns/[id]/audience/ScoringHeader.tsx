'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Field } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { updateScoringConfigAction, runScoringAction } from '@/lib/actions/scoring';
import type { Campaign } from '@/lib/generated/prisma/client';

export function ScoringHeader({
  campaign,
  scoredCount,
  approvedCount,
  completed = false,
}: {
  campaign: Campaign;
  scoredCount: number;
  approvedCount: number;
  completed?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState(campaign.scoringPrompt);
  const [criteria, setCriteria] = useState(campaign.scoringCriteria);
  const [threshold, setThreshold] = useState(campaign.scoringThreshold);
  const [confirming, setConfirming] = useState(false);
  const [rescoring, setRescoring] = useState(false);
  const [rescoreNotice, setRescoreNotice] = useState<string | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();

  function saveConfig(patch: { prompt?: string; criteria?: string; threshold?: number }) {
    setConfigError(null);
    startTransition(async () => {
      try {
        await updateScoringConfigAction(campaign.id, patch);
        router.refresh();
      } catch (err) {
        setConfigError(err instanceof Error ? err.message : 'Failed to save — try again.');
      }
    });
  }

  async function rescore() {
    setRescoring(true);
    setRescoreNotice(null);
    try {
      const res = await runScoringAction(campaign.id);
      if (res.ok) {
        setConfirming(false);
        // Re-scoring never overwrites a contact whose approval a human already
        // set by hand (Scoring tab checkbox / bulk action) — surface that so it
        // doesn't look like the re-score silently did nothing to those rows.
        setRescoreNotice(
          res.queuedCount ? `Processed ${res.scoredCount ?? 0} contacts; ${res.queuedCount} remain queued. Progress is shown in Background work.` : res.preservedManualApprovals
            ? `Re-scored ${res.scoredCount} contacts — kept ${res.preservedManualApprovals} manually-set approval${res.preservedManualApprovals === 1 ? '' : 's'} as-is.`
            : `Re-scored ${res.scoredCount} contacts.`
        );
      } else {
        setRescoreNotice(res.error ?? 'Re-scoring failed.');
      }
      router.refresh();
    } catch (err) {
      setRescoreNotice(err instanceof Error ? err.message : 'Re-scoring failed.');
    } finally {
      setRescoring(false);
    }
  }

  return (
    <section className="lsq-card" aria-labelledby="aud-scoring">
      <div className="lsq-card__body lsq-stack">
        <div className="lsq-ov-aud-head">
          <div className="lsq-ov-aud-head__who">
            <span className="lsq-avatar" aria-hidden="true">
              <Icon name="sparkle" size={16} />
            </span>
            <div>
              <h2 className="lsq-ov-aud-head__title" id="aud-scoring">Scored By Claude</h2>
              <p className="lsq-ov-aud-head__sub">Approval threshold: {threshold} · {criteria.slice(0, 60)}{criteria.length > 60 ? '…' : ''}</p>
            </div>
          </div>
          {!completed && (
            <div className="lsq-cluster">
              <Button hierarchy="tertiary" size="sm" icon={<Icon name="refresh" size={14} />} onClick={() => setConfirming(true)} disabled={rescoring}>
                {rescoring ? 'Re-scoring…' : 'Re-score All'}
              </Button>
              <Button hierarchy="tertiary" size="sm" icon={<Icon name="sliders" size={14} />} onClick={() => setOpen((o) => !o)}>
                {open ? 'Hide Config' : 'Edit Config'}
              </Button>
            </div>
          )}
        </div>
        {!completed && rescoreNotice && <p className="lsq-hint" role="status">{rescoreNotice}</p>}
        {!completed && configError && <p className="lsq-error" role="alert">{configError}</p>}
        {!completed && confirming && (
          <ConfirmDialog
            title="Re-score All Contacts?"
            message={`This overwrites the score and rationale Claude already gave ${scoredCount} contact${scoredCount === 1 ? '' : 's'} (${approvedCount} currently approved) with fresh results. Approvals a human set by hand are kept; every other approval is re-evaluated against the current threshold.`}
            confirmLabel="Re-score All"
            destructive
            onConfirm={() => {
              setConfirming(false);
              void rescore();
            }}
            onClose={() => setConfirming(false)}
          />
        )}
        {!completed && open && (
          <div className="lsq-ov-aud-config">
            <Field label="Scoring prompt">
              {(p) => <textarea className="lsq-input" rows={2} {...p} value={prompt} onChange={(e) => setPrompt(e.target.value)} onBlur={() => saveConfig({ prompt })} />}
            </Field>
            <Field label="Approval criteria">
              {(p) => <textarea className="lsq-input" rows={2} {...p} value={criteria} onChange={(e) => setCriteria(e.target.value)} onBlur={() => saveConfig({ criteria })} />}
            </Field>
            <Field
              label={`Auto-approval threshold: ${threshold}`}
              hint="Threshold slider updates approvals in real time without re-running AI scoring. Contacts a human approved or rejected by hand are left as-is."
            >
              {(p) => (
                <input
                  type="range"
                  className="lsq-ov-range"
                  min={0}
                  max={100}
                  {...p}
                  value={threshold}
                  onChange={(e) => setThreshold(Number(e.target.value))}
                  onMouseUp={() => saveConfig({ threshold })}
                  onTouchEnd={() => saveConfig({ threshold })}
                  onKeyUp={() => saveConfig({ threshold })}
                  onBlur={() => saveConfig({ threshold })}
                />
              )}
            </Field>
          </div>
        )}
      </div>
    </section>
  );
}
