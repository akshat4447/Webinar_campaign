'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { updateCampaignMessagingInstructionsAction } from '@/lib/actions/personalize';
import { TONE_OPTIONS, LENGTH_OPTIONS } from '@/lib/messagingOptions';

const TONES = TONE_OPTIONS;
const LENGTHS = LENGTH_OPTIONS;

export interface GenerateConfig {
  tone: string;
  msgLength: string;
  brief: string;
  aiInstructions: string;
  stepScope: 'active' | 'all';
  onlyMissing: boolean;
}

interface GenerateConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  campaignId: string;
  campaignName: string;
  activeStepKey: string;
  activeStepLabel: string;
  activeChannel: string;
  totalApproved: number;
  missingCount: number;
  initialTone?: string;
  initialLength?: string;
  initialBrief?: string;
  initialAiInstructions?: string;
  onConfirm: (config: GenerateConfig) => Promise<void>;
}

export function GenerateConfigModal({
  isOpen,
  onClose,
  campaignId,
  campaignName,
  activeStepKey,
  activeStepLabel,
  activeChannel,
  totalApproved,
  missingCount,
  initialTone = TONE_OPTIONS[0],
  initialLength = LENGTH_OPTIONS[0],
  initialBrief = '',
  initialAiInstructions = '',
  onConfirm,
}: GenerateConfigModalProps) {
  const [tone, setTone] = useState(initialTone);
  const [msgLength, setMsgLength] = useState(initialLength);
  const [brief, setBrief] = useState(initialBrief);
  const [aiInstructions, setAiInstructions] = useState(initialAiInstructions);
  const [stepScope, setStepScope] = useState<'active' | 'all'>('active');
  const [onlyMissing, setOnlyMissing] = useState(missingCount > 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);


  const targetCount = onlyMissing ? missingCount : totalApproved;

  async function handleStart() {
    setBusy(true);
    setError(null);
    try {
      // Save chosen tone/length/brief/guidance to the campaign record. Tone and
      // length go to their own columns (the same ones the webinar guidance
      // block reads) rather than being folded into personalizationPrompt —
      // that field has its own dedicated editor (PromptModal) and folding
      // tone/length text into it both overwrote whatever was set there and
      // left the real tone/msgLength columns stale, so Claude could see two
      // contradictory tone instructions in the same generation.
      await updateCampaignMessagingInstructionsAction(campaignId, {
        tone,
        msgLength,
        brief,
        aiInstructions,
      });

      // 2. Fire the generation callback
      await onConfirm({
        tone,
        msgLength,
        brief,
        aiInstructions,
        stepScope,
        onlyMissing,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate drafts');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Generate Drafts"
      subtitle={`${campaignName ? `${campaignName} · ` : ''}Set tone, length and guidance before writing personalized copy.`}
      busy={busy}
      footer={
        <>
          <p className="lsq-msg-footer-info">
            {targetCount} draft{targetCount === 1 ? '' : 's'} will be written.
          </p>
          <Button hierarchy="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button hierarchy="primary" onClick={handleStart} loading={busy} disabled={targetCount === 0}>
            {busy ? 'Generating…' : `Generate ${targetCount} Draft${targetCount === 1 ? '' : 's'}`}
          </Button>
        </>
      }
    >
      <div className="lsq-stack">
        {error && (
          <div className="lsq-banner lsq-banner--error" role="alert">
            <p className="lsq-banner__body">{error}</p>
          </div>
        )}

        <div className="lsq-stack lsq-stack--sm" role="group" aria-labelledby="gen-scope-label">
          <span className="lsq-label" id="gen-scope-label">Target step</span>
          <div className="lsq-msg-choices">
            <button type="button" className="lsq-msg-choice" aria-pressed={stepScope === 'active'} onClick={() => setStepScope('active')}>
              <span className="lsq-msg-choice__title">{activeStepLabel}</span>
              <span className="lsq-msg-choice__sub">Current step ({activeStepKey}, {activeChannel})</span>
            </button>
            <button type="button" className="lsq-msg-choice" aria-pressed={stepScope === 'all'} onClick={() => setStepScope('all')}>
              <span className="lsq-msg-choice__title">All Active Steps</span>
              <span className="lsq-msg-choice__sub">Every enabled cadence step</span>
            </button>
          </div>
        </div>

        <div className="lsq-grid">
          <Field label="Tone">
            {(p) => (
              <select {...p} className="lsq-select" value={tone} onChange={(e) => setTone(e.target.value)}>
                {TONES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Length">
            {(p) => (
              <select {...p} className="lsq-select" value={msgLength} onChange={(e) => setMsgLength(e.target.value)}>
                {LENGTHS.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>

        <Field label="Value proposition" hint="The core topic and hook, adapted across titles and seniority levels.">
          {(p) => (
            <textarea
              {...p}
              className="lsq-input"
              rows={2}
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder="e.g. Focus on eliminating cloud cost waste and securing Kubernetes clusters"
            />
          )}
        </Field>

        <Field label="Guidance" optional hint="What to emphasize or avoid.">
          {(p) => (
            <textarea
              {...p}
              className="lsq-input"
              rows={2}
              value={aiInstructions}
              onChange={(e) => setAiInstructions(e.target.value)}
              placeholder="e.g. Avoid generic flattery. Frame problems around team productivity."
            />
          )}
        </Field>

        <label className="lsq-check">
          <input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} />
          <span>
            Only write for contacts without copy
            <span className="lsq-msg-check-hint">Targets {targetCount} of {totalApproved} approved contacts.</span>
          </span>
        </label>
      </div>
    </Modal>
  );
}
