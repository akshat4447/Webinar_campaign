'use client';

import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Field } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/Toast';
import { runScoringAction, updateScoringConfigAction } from '@/lib/actions/scoring';

export interface ScoredContactItem {
  id: string;
  name: string;
  email: string | null;
  title: string;
  account: string;
  seniority: string;
  function: string;
  score: number | null;
  explanation: string | null;
  approved: boolean;
  approvedManually: boolean;
  enrichedAt?: Date | null;
  enrichmentSource?: string | null;
}

interface ClaudeScoringApprovalCardProps {
  campaignId: string;
  initialThreshold: number;
  initialPrompt: string;
  initialCriteria: string;
  contacts: ScoredContactItem[];
  onThresholdChange?: (threshold: number) => void;
  onRefreshScoring?: () => void;
}

export function ClaudeScoringApprovalCard({
  campaignId,
  initialThreshold,
  initialPrompt,
  initialCriteria,
  contacts: initialContacts,
  onThresholdChange,
  onRefreshScoring,
}: ClaudeScoringApprovalCardProps) {
  const { showToast } = useToast();
  const [threshold, setThreshold] = useState(initialThreshold);
  const [prompt, setPrompt] = useState(initialPrompt);
  const [criteria, setCriteria] = useState(initialCriteria);
  const [contacts, setContacts] = useState(initialContacts);
  const [seenContacts, setSeenContacts] = useState(initialContacts);
  const [isCriteriaOpen, setIsCriteriaOpen] = useState(false);
  const [scoringBusy, setScoringBusy] = useState(false);
  const [savingThreshold, setSavingThreshold] = useState(false);
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  // Sync internal contacts when initialContacts prop updates from the parent (e.g. after enrichment or scoring)
  if (seenContacts !== initialContacts && !scoringBusy) {
    setSeenContacts(initialContacts);
    setContacts(initialContacts);
  }

  const scoredContacts = contacts.filter((c) => c.score !== null);
  const scoredCount = scoredContacts.length;

  // Calculate live approvals based on current threshold
  const liveApprovedCount = contacts.filter((c) => {
    if (c.approvedManually) return c.approved;
    return c.score !== null && c.score >= threshold;
  }).length;

  function handleThresholdSlider(val: number) {
    const clamped = Math.max(0, Math.min(100, Math.round(val)));
    const previousThreshold = threshold;
    const previousContacts = contacts;
    setThreshold(clamped);
    onThresholdChange?.(clamped);

    // Update contacts locally immediately for zero-latency slider UI
    setContacts((prev) =>
      prev.map((c) => {
        if (c.approvedManually) return c;
        return {
          ...c,
          approved: c.score !== null && c.score >= clamped,
        };
      })
    );

    // Debounce server action persistence to ensure silky-smooth dragging without out-of-order race conditions
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = setTimeout(async () => {
      setSavingThreshold(true);
      try {
        await updateScoringConfigAction(campaignId, { threshold: clamped });
      } catch (err) {
        setThreshold(previousThreshold);
        onThresholdChange?.(previousThreshold);
        setContacts(previousContacts);
        showToast(err instanceof Error ? err.message : 'Failed to save threshold. Reverted.');
      } finally {
        setSavingThreshold(false);
      }
    }, 250);
  }

  async function handleRunScoring() {
    if (contacts.length === 0) {
      showToast('Import contacts first before running scoring.');
      return;
    }

    setScoringBusy(true);
    try {
      await updateScoringConfigAction(campaignId, { prompt, criteria, threshold });
      const res = await runScoringAction(campaignId);
      if (res.ok) {
        showToast(`Scored ${res.scoredCount} contacts with Claude.`);
        onRefreshScoring?.();
      } else {
        showToast(res.error || 'Scoring failed');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to score contacts');
    } finally {
      setScoringBusy(false);
    }
  }

  return (
    <section className="lsq-card" aria-labelledby="scoring-card-title">
      <div className="lsq-card__header">
        <div>
          <div className="lsq-cluster">
            <h2 className="lsq-card__title" id="scoring-card-title">Claude Relevance Scoring and Approval</h2>
            <Badge color={scoredCount > 0 ? 'blue light' : 'gray'} text={`${scoredCount} of ${contacts.length} scored`} />
          </div>
          <p className="lsq-card__sub">
            Every contact is evaluated against topic relevance. Move the threshold slider to approve qualified leads.
          </p>
        </div>
        <div className="lsq-cluster">
          <Button hierarchy="tertiary" size="sm" onClick={() => setIsCriteriaOpen((prev) => !prev)}>
            {isCriteriaOpen ? 'Hide Criteria' : 'Edit Criteria'}
          </Button>
          <Button
            hierarchy={scoredCount > 0 ? 'secondary' : 'primary'}
            size="sm"
            icon={<Icon name={scoredCount > 0 ? 'refresh' : 'sparkle'} size={14} />}
            disabled={scoringBusy || contacts.length === 0}
            loading={scoringBusy}
            onClick={handleRunScoring}
          >
            {scoringBusy ? 'Scoring With Claude' : scoredCount > 0 ? 'Re-Run Scoring' : 'Run Claude Scoring'}
          </Button>
        </div>
      </div>

      <div className="lsq-card__body lsq-stack lsq-stack--lg">
        {isCriteriaOpen && (
          <div className="lsq-wiz-panel lsq-stack">
            <Field label="Scoring prompt or ICP role mandate">
              {(p) => (
                <textarea
                  {...p}
                  className="lsq-input"
                  rows={2}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="e.g. Score higher for Directors and VP roles in Engineering and Infrastructure."
                />
              )}
            </Field>
            <Field label="Scoring criteria or exclusion rules">
              {(p) => (
                <textarea
                  {...p}
                  className="lsq-input"
                  rows={2}
                  value={criteria}
                  onChange={(e) => setCriteria(e.target.value)}
                  placeholder="e.g. Reject student or unverified contractor roles."
                />
              )}
            </Field>
          </div>
        )}

        {/* Approval threshold slider */}
        <div className="lsq-wiz-panel lsq-stack lsq-stack--sm">
          <div className="lsq-cluster lsq-cluster--between">
            <label className="lsq-label" htmlFor="approval-threshold">
              Approval threshold
              {savingThreshold && <span className="lsq-label__opt">Saving</span>}
            </label>
            <strong className="lsq-wiz-threshold">Score {threshold} or above</strong>
          </div>

          <input
            id="approval-threshold"
            className="lsq-wiz-range"
            type="range"
            min={0}
            max={100}
            value={threshold}
            onChange={(e) => handleThresholdSlider(Number(e.target.value))}
          />

          <div className="lsq-wiz-scale">
            <span className="lsq-hint">0 (approve all)</span>
            <span className="lsq-wiz-scale__now" data-tone={liveApprovedCount > 0 ? 'success' : undefined} role="status">
              {liveApprovedCount > 0 && <Icon name="check" size={14} />}
              Approving {liveApprovedCount} of {contacts.length} contact{contacts.length === 1 ? '' : 's'} ({contacts.length > 0 ? Math.round((liveApprovedCount / contacts.length) * 100) : 0}%)
            </span>
            <span className="lsq-hint">100 (strict)</span>
          </div>
        </div>

        {/* Scored contacts table */}
        {contacts.length > 0 ? (
          <div className="lsq-table-wrap lsq-wiz-scroll">
            <table className="lsq-table">
              <caption className="lsq-sr-only">Contacts with relevance score and approval status</caption>
              <thead>
                <tr>
                  <th scope="col">Contact</th>
                  <th scope="col">Company</th>
                  <th scope="col" className="num">Score</th>
                  <th scope="col">Status</th>
                  <th scope="col">Seniority</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((c) => {
                  const isApproved = c.approvedManually ? c.approved : (c.score !== null && c.score >= threshold);
                  const tone = c.score === null ? 'none' : c.score >= 85 ? 'success' : c.score >= 70 ? 'accent' : 'warn';
                  return (
                    <tr key={c.id} data-excluded={isApproved ? undefined : 'true'}>
                      <td className="lsq-cell-truncate lsq-wiz-cell-wide">
                        <div className="lsq-cluster lsq-wiz-nowrap">
                          <span className="lsq-cell-primary lsq-wiz-ellipsis" title={c.name}>{c.name}</span>
                          {c.enrichmentSource && <Badge color="blue light" text="Enriched" />}
                        </div>
                        <div className="lsq-cell-secondary lsq-wiz-ellipsis">
                          {c.email ? (
                            <span className="lsq-wiz-mono" title={c.email}>{c.email}</span>
                          ) : (
                            <span className="lsq-wiz-warn-text">No email address</span>
                          )}
                          {c.title && <span> | {c.title}</span>}
                        </div>
                      </td>
                      <td className="lsq-cell-truncate">
                        <div className="lsq-wiz-ellipsis" title={c.account || undefined}>{c.account || 'None'}</div>
                        {c.explanation && (
                          <div className="lsq-cell-secondary lsq-wiz-ellipsis" title={c.explanation}>
                            {c.explanation}
                          </div>
                        )}
                      </td>
                      <td className="num">
                        <span className="lsq-wiz-score" data-tone={tone}>{c.score !== null ? c.score : 'None'}</span>
                      </td>
                      <td>
                        <Badge color={isApproved ? 'success' : 'gray'} text={isApproved ? 'Approved' : 'Excluded'} />
                      </td>
                      <td className="lsq-cell-secondary">{c.seniority || 'None'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="lsq-empty">
            <p className="lsq-empty__body">Import contacts in the Audience step to preview Claude scores and adjust approvals with the threshold slider.</p>
          </div>
        )}
      </div>
    </section>
  );
}
