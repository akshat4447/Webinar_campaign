'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import {
  updateCampaignMessagingInstructionsAction,
  getDefaultPersonalizationPromptAction,
  saveAiInstructionsAndRegeneratePendingAction,
} from '@/lib/actions/personalize';
import {
  TONE_OPTIONS,
  LENGTH_OPTIONS,
  PERSONALIZATION_FIELD_OPTIONS,
  DEFAULT_PERSONALIZATION_FIELDS,
} from '@/lib/messagingOptions';

const ALWAYS_TRUE = [
  "Keeps the template's offer and registration link exactly as given — never altered, shortened, or dropped.",
  'Personalizes only from real data on file: title, seniority, function, company, industry, and why the contact scored as they did — never invents an initiative, a connection, or a metric.',
  'Writes the real name and company into the message — no {{merge}} tokens left behind.',
  "Matches the channel's format: LinkedIn stays under 60 words with no subject line; email keeps a subject under 60 characters and a body under 120 words.",
];

export function PromptModal({
  campaignId,
  campaignName,
  prompt,
  brief = '',
  aiInstructions = '',
  tone,
  msgLength,
  personalizationFields,
  activeStepKey,
  onClose,
  onSaved,
  onRegeneratedPending,
}: {
  campaignId: string;
  campaignName: string;
  prompt: string;
  brief?: string;
  aiInstructions?: string;
  tone?: string | null;
  msgLength?: string | null;
  personalizationFields?: string[];
  activeStepKey?: string;
  onClose: () => void;
  onSaved: (prompt: string, brief?: string, aiInstructions?: string, tone?: string, msgLength?: string, fields?: string[]) => void;
  onRegeneratedPending?: (result: { totalRegenerated: number; activeStepResult: unknown }) => void;
}) {
  const [text, setText] = useState(prompt);
  const [instructionsText, setInstructionsText] = useState(aiInstructions || brief || '');
  const [briefText, setBriefText] = useState(aiInstructions || brief || '');
  const [selectedTone, setSelectedTone] = useState(tone || TONE_OPTIONS[0]);
  const [selectedLength, setSelectedLength] = useState(msgLength || LENGTH_OPTIONS[0]);
  const [activeFields, setActiveFields] = useState<string[]>(
    personalizationFields && personalizationFields.length > 0
      ? personalizationFields
      : [...DEFAULT_PERSONALIZATION_FIELDS]
  );
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    text !== prompt ||
    briefText !== brief ||
    instructionsText !== aiInstructions ||
    selectedTone !== (tone || TONE_OPTIONS[0]) ||
    selectedLength !== (msgLength || LENGTH_OPTIONS[0]) ||
    JSON.stringify(activeFields) !== JSON.stringify(personalizationFields || DEFAULT_PERSONALIZATION_FIELDS);

  async function save() {
    if (!dirty) return;
    setSaving(true);
    setError(null);
    try {
      await updateCampaignMessagingInstructionsAction(campaignId, {
        prompt: text,
        brief: briefText,
        aiInstructions: instructionsText,
        tone: selectedTone,
        msgLength: selectedLength,
      });
      onSaved(text, briefText, instructionsText, selectedTone, selectedLength, activeFields);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  async function saveAndRegeneratePending() {
    setRegenerating(true);
    setError(null);
    try {
      const res = await saveAiInstructionsAndRegeneratePendingAction(campaignId, {
        aiInstructions: instructionsText,
        tone: selectedTone,
        msgLength: selectedLength,
        brief: briefText,
        personalizationFields: activeFields,
        activeStepKey,
      });
      onSaved(text, briefText, instructionsText, selectedTone, selectedLength, activeFields);
      if (onRegeneratedPending) {
        onRegeneratedPending(res);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply and regenerate.');
    } finally {
      setRegenerating(false);
    }
  }
  async function reset() {
    setResetting(true);
    setError(null);
    try {
      const defaultText = await getDefaultPersonalizationPromptAction();
      setText(defaultText);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed.');
    } finally {
      setResetting(false);
    }
  }

  const busy = saving || resetting || regenerating;

  return (
    <Modal
      isOpen
      onClose={onClose}
      size="lg"
      title="AI Instructions and Settings"
      subtitle={`${campaignName} · Applies to pending cadence steps`}
      busy={busy}
      footer={
        <>
          {error && (
            <p className="lsq-error lsq-msg-footer-note" role="alert">
              {error}
            </p>
          )}
          <Button hierarchy="tertiary" onClick={reset} loading={resetting} disabled={saving || regenerating} className="lsq-msg-footer-start">
            {resetting ? 'Resetting…' : 'Reset to Default'}
          </Button>
          <Button hierarchy="secondary" onClick={onClose} disabled={saving || regenerating}>
            Cancel
          </Button>
          <Button hierarchy="secondary" onClick={save} loading={saving} disabled={!dirty || regenerating}>
            {saving ? 'Saving…' : 'Save Only'}
          </Button>
          <Button hierarchy="primary" onClick={saveAndRegeneratePending} loading={regenerating} disabled={saving}>
            {regenerating ? 'Regenerating…' : 'Save and Regenerate Pending'}
          </Button>
        </>
      }
    >
      <div className="lsq-stack lsq-stack--lg">
        <section className="lsq-stack lsq-stack--sm" aria-labelledby="prompt-rules">
          <h3 className="lsq-msg-section-title" id="prompt-rules">
            Always Applied
          </h3>
          <div className="lsq-msgbox">
            <ul className="lsq-msg-rules">
              {ALWAYS_TRUE.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </div>
        </section>

        <div className="lsq-grid">
          <Field label="Tone">
            {(p) => (
              <select {...p} className="lsq-select" value={selectedTone} onChange={(e) => setSelectedTone(e.target.value)}>
                {TONE_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Length">
            {(p) => (
              <select {...p} className="lsq-select" value={selectedLength} onChange={(e) => setSelectedLength(e.target.value)}>
                {LENGTH_OPTIONS.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>

        <div className="lsq-stack lsq-stack--sm" role="group" aria-labelledby="prompt-fields">
          <div className="lsq-cluster lsq-cluster--between">
            <span className="lsq-label" id="prompt-fields">
              Fields used per contact
            </span>
            <span className="lsq-msg-count">
              {activeFields.length} of {PERSONALIZATION_FIELD_OPTIONS.length} active
            </span>
          </div>
          <div className="lsq-chips">
            {PERSONALIZATION_FIELD_OPTIONS.map((f) => {
              const isChecked = activeFields.includes(f.id);
              return (
                <button
                  key={f.id}
                  type="button"
                  className="lsq-msg-chip"
                  aria-pressed={isChecked}
                  title={f.blurb}
                  onClick={() => setActiveFields((prev) => (isChecked ? prev.filter((id) => id !== f.id) : [...prev, f.id]))}
                >
                  <Icon name={isChecked ? 'check' : 'plus'} size={12} />
                  {f.label}
                </button>
              );
            })}
          </div>
        </div>

        <Field label="Instructions and touchpoint guidance">
          {(p) => (
            <textarea
              {...p}
              className="lsq-input"
              rows={3}
              value={instructionsText}
              onChange={(e) => {
                setInstructionsText(e.target.value);
                setBriefText(e.target.value);
              }}
              placeholder="e.g. Lead with the operational problem the role owns, vary the angle by seniority, keep the tone practical."
            />
          )}
        </Field>

        <Field label="Prompt override" hint="Save and Regenerate Pending rewrites copy across all unsent cadence steps.">
          {(p) => <textarea {...p} className="lsq-input" rows={3} value={text} onChange={(e) => setText(e.target.value)} />}
        </Field>
      </div>
    </Modal>
  );
}
