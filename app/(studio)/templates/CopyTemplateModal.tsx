'use client';

import { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { Field } from '@/components/ui/Field';
import {
  getTemplateCampaignStatusAction,
  copyTemplateIntoMultipleCampaignsAction,
  type CampaignTemplateTargetInfo,
  type ConflictStrategy,
} from '@/lib/actions/messageTemplates';

interface CopyTemplateModalProps {
  isOpen: boolean;
  onClose: () => void;
  templateId: string;
  templateName: string;
  templateChannel: string;
  templateKey: string | null;
  templateBody: string;
  templateSubject: string | null;
  onSuccess: (summary: string) => void;
}

export function CopyTemplateModal({
  isOpen,
  onClose,
  templateId,
  templateName,
  templateChannel,
  templateKey,
  templateBody,
  templateSubject,
  onSuccess,
}: CopyTemplateModalProps) {
  const [targets, setTargets] = useState<CampaignTemplateTargetInfo[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [conflictStrategy, setConflictStrategy] = useState<ConflictStrategy>('skip');
  const [autoLinkSteps, setAutoLinkSteps] = useState(true);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Detect merge fields in template body
  const tokensUsed = useMemo(() => {
    const matches = templateBody.match(/\{\{([a-zA-Z0-9_]+)\}\}/g) || [];
    return Array.from(new Set(matches));
  }, [templateBody]);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    getTemplateCampaignStatusAction(templateId)
      .then((data) => {
        if (!active) return;
        setTargets(data);
        // Default select uncustomized campaigns
        const initial = new Set<string>();
        data.forEach((c) => {
          if (!c.hasCustomCopy) initial.add(c.campaignId);
        });
        setSelectedIds(initial);
        setLoading(false);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Failed to load campaigns');
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [isOpen, templateId]);

  const filteredTargets = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return targets;
    return targets.filter(
      (t) => t.name.toLowerCase().includes(q) || t.vertical.toLowerCase().includes(q)
    );
  }, [targets, search]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    setSelectedIds(new Set(filteredTargets.map((t) => t.campaignId)));
  };

  const selectUncustomized = () => {
    const next = new Set<string>();
    filteredTargets.forEach((t) => {
      if (!t.hasCustomCopy) next.add(t.campaignId);
    });
    setSelectedIds(next);
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
  };

  const handleCopy = async () => {
    if (selectedIds.size === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await copyTemplateIntoMultipleCampaignsAction({
        templateId,
        campaignIds: Array.from(selectedIds),
        conflictStrategy,
        autoLinkSteps,
      });

      const parts: string[] = [];
      if (res.copiedCount > 0) parts.push(`copied to ${res.copiedCount} campaign(s)`);
      if (res.overwrittenCount > 0) parts.push(`overwritten in ${res.overwrittenCount}`);
      if (res.variantCount > 0) parts.push(`added as variant in ${res.variantCount}`);
      if (res.skippedCount > 0) parts.push(`skipped ${res.skippedCount} existing`);

      const summary = parts.length > 0 ? parts.join(', ') : 'No changes made';
      onSuccess(summary);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to copy template');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const strategies: Array<{ id: ConflictStrategy; title: string; desc: string }> = [
    {
      id: 'skip',
      title: 'Skip Existing',
      desc: 'Keep the campaign’s custom copy untouched. Only copy to uncustomized campaigns.',
    },
    {
      id: 'overwrite',
      title: 'Overwrite',
      desc: 'Replace the existing campaign copy with this library template’s subject and body.',
    },
    {
      id: 'variant',
      title: 'Create Variant',
      desc: 'Keep the existing copy and save as a new numbered variant (Variant 2) in that campaign.',
    },
  ];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      busy={submitting}
      size="lg"
      title="Copy Template Into Campaigns"
      subtitle={`Copy “${templateName}”${templateSubject ? ` (${templateSubject})` : ''} to target campaigns with fallback and collision rules.`}
      footer={
        <>
          <span className="lsq-hint lsq-grow">
            {selectedIds.size === 0
              ? 'Select at least one campaign to copy.'
              : `Ready to copy to ${selectedIds.size.toLocaleString()} campaign(s) with the “${conflictStrategy}” rule.`}
          </span>
          <Button hierarchy="tertiary" size="md" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            hierarchy="primary"
            size="md"
            onClick={handleCopy}
            disabled={selectedIds.size === 0}
            loading={submitting}
            icon={<Icon name="copy" size={16} />}
          >
            {submitting ? 'Copying…' : `Copy Into ${selectedIds.size.toLocaleString()} Campaign(s)`}
          </Button>
        </>
      }
    >
      <div className="lsq-stack lsq-stack--lg">
        <div className="lsq-cluster">
          <Badge color="blue" text={templateChannel.toUpperCase()} />
          {templateKey && <Badge color="gray" text={`Step: ${templateKey}`} />}
        </div>

        {error && (
          <div className="lsq-banner lsq-banner--error" role="alert">
            <span className="lsq-banner__icon" aria-hidden="true">
              <Icon name="x-circle" size={16} />
            </span>
            <p className="lsq-banner__body">{error}</p>
          </div>
        )}

        {tokensUsed.length > 0 && (
          <div className="lsq-int-note">
            <div className="lsq-tpl-tokens">
              <strong>Detected merge tokens:</strong>
              {tokensUsed.map((tok) => (
                <code key={tok} className="lsq-tpl-var">
                  {tok}
                </code>
              ))}
            </div>
            <p>Each campaign resolves these tokens from its webinar title, date, speaker roster and registration links.</p>
          </div>
        )}

        <div className="lsq-field" role="group" aria-labelledby="copy-strategy-label">
          <p className="lsq-label" id="copy-strategy-label">
            Collision and fallback strategy (if a campaign already has a copy for this step)
          </p>
          <div className="lsq-tpl-strategies">
            {strategies.map((strat) => (
              <button
                key={strat.id}
                type="button"
                className="lsq-tpl-strategy"
                aria-pressed={conflictStrategy === strat.id}
                onClick={() => setConflictStrategy(strat.id)}
              >
                <span className="lsq-tpl-strategy__title">{strat.title}</span>
                <span className="lsq-tpl-strategy__desc">{strat.desc}</span>
              </button>
            ))}
          </div>
        </div>

        <label className="lsq-check">
          <input type="checkbox" checked={autoLinkSteps} onChange={(e) => setAutoLinkSteps(e.target.checked)} />
          <span>
            <strong>Automatically link cadence steps.</strong> Repoint matching cadence steps in target campaigns to this new template.
          </span>
        </label>

        <div className="lsq-stack lsq-stack--sm">
          <div className="lsq-cluster lsq-cluster--between">
            <p className="lsq-label">
              Target campaigns ({selectedIds.size.toLocaleString()} of {targets.length.toLocaleString()} selected)
            </p>
            <div className="lsq-cluster">
              <Button hierarchy="tertiary" size="sm" onClick={selectAll}>
                Select All
              </Button>
              <Button hierarchy="tertiary" size="sm" onClick={selectUncustomized}>
                Only Clean
              </Button>
              <Button hierarchy="tertiary" size="sm" onClick={clearSelection}>
                Clear
              </Button>
            </div>
          </div>

          <Field label="Search campaigns">
            {(p) => (
              <input
                {...p}
                type="search"
                className="lsq-input"
                placeholder="Search campaigns by name or vertical"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            )}
          </Field>

          {loading ? (
            <p className="lsq-hint" role="status">Loading campaigns…</p>
          ) : filteredTargets.length === 0 ? (
            <p className="lsq-hint">No campaigns match the search.</p>
          ) : (
            <ul className="lsq-tpl-targets" aria-label="Target campaigns">
              {filteredTargets.map((c) => {
                const selected = selectedIds.has(c.campaignId);
                return (
                  <li key={c.campaignId}>
                    <label className="lsq-tpl-target" data-selected={selected ? 'true' : 'false'}>
                      <input type="checkbox" checked={selected} onChange={() => toggleSelect(c.campaignId)} />
                      <span className="lsq-tpl-target__main">
                        <span className="lsq-tpl-target__name">{c.name}</span>{' '}
                        <span className="lsq-hint">
                          {c.vertical} · {c.date}
                        </span>
                        <span className="lsq-tpl-target__note">
                          {c.hasCustomCopy ? `Customized copy exists: “${c.existingTemplateName || 'Custom'}”` : 'Using library default'}
                        </span>
                      </span>
                      <span className="lsq-tpl-target__badges">
                        {c.hasCustomCopy ? <Badge color="warning" text="Customized" /> : <Badge color="success" text="Clean" />}
                        {c.missingZoom && <Badge color="warning" text="No Zoom link" />}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}
