'use client';

import React, { useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import type { SpeakerInput } from '@/lib/speakerUtils';

interface Props {
  speakers: SpeakerInput[];
  onChange: (speakers: SpeakerInput[]) => void;
  /**
   * Fired at each logical save point — immediately after add/remove/reorder/
   * primary-change, and on blur of a text field — rather than on every
   * keystroke like onChange. The parent should persist to the server here.
   * Falls back to onChange when omitted, so this stays a drop-in-safe prop.
   */
  onCommit?: (speakers: SpeakerInput[]) => void;
  disabled?: boolean;
  /** Id for the section heading, so the surrounding card can reference it with aria-labelledby. */
  headingId?: string;
}

export function SpeakerListEditor({ speakers, onChange, onCommit, disabled, headingId }: Props) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const commitNow = onCommit ?? onChange;

  const handleAdd = () => {
    const nextOrder = speakers.length;
    const isFirst = speakers.length === 0;
    const newSpeaker: SpeakerInput = {
      name: '',
      title: '',
      company: '',
      bio: '',
      linkedinUrl: '',
      isPrimary: isFirst,
      order: nextOrder,
    };
    const updated = [...speakers, newSpeaker];
    onChange(updated);
    setEditingIndex(updated.length - 1);
  };

  const handleUpdate = (index: number, patch: Partial<SpeakerInput>) => {
    const updated = speakers.map((s, i) => (i === index ? { ...s, ...patch } : s));
    onChange(updated);
  };

  // Text-field edits update local state on every keystroke via handleUpdate
  // above (so the input stays responsive) but only reach the server here, on
  // blur — matching every sibling field in CampaignDetailsForm.
  const handleFieldBlur = () => {
    commitNow(speakers);
  };

  const handleRemove = (index: number) => {
    const wasPrimary = speakers[index]?.isPrimary;
    const updated = speakers.filter((_, i) => i !== index);
    if (wasPrimary && updated.length > 0) {
      updated[0] = { ...updated[0], isPrimary: true };
    }
    const next = updated.map((s, i) => ({ ...s, order: i }));
    onChange(next);
    commitNow(next);
    if (editingIndex === index) {
      setEditingIndex(null);
    } else if (editingIndex !== null && editingIndex > index) {
      setEditingIndex(editingIndex - 1);
    }
  };

  const handleSetPrimary = (index: number) => {
    const updated = speakers.map((s, i) => ({
      ...s,
      isPrimary: i === index,
    }));
    onChange(updated);
    commitNow(updated);
  };

  const handleMove = (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= speakers.length) return;
    const updated = [...speakers];
    const temp = updated[index];
    updated[index] = updated[targetIndex];
    updated[targetIndex] = temp;
    const next = updated.map((s, i) => ({ ...s, order: i }));
    onChange(next);
    commitNow(next);
    if (editingIndex === index) setEditingIndex(targetIndex);
    else if (editingIndex === targetIndex) setEditingIndex(index);
  };

  return (
    <div className="lsq-stack">
      <div className="lsq-cluster lsq-cluster--between">
        <div>
          <h2 className="lsq-card__title" id={headingId}>Speakers and Panelists</h2>
          <p className="lsq-card__sub">The primary speaker is the keynote and appears first in messages and on the landing page.</p>
        </div>
        {!disabled && (
          <Button hierarchy="secondary" size="sm" icon={<Icon name="plus" size={14} />} onClick={handleAdd}>
            Add Speaker
          </Button>
        )}
      </div>

      {speakers.length === 0 && (
        <div className="lsq-wiz-empty">
          <p className="lsq-hint">No speakers added yet. Use Add Speaker to add a keynote speaker or panelist.</p>
        </div>
      )}

      {speakers.length > 0 && (
        <ul className="lsq-rows">
          {speakers.map((spk, idx) => {
            const isEditing = editingIndex === idx;
            const displayName = spk.name.trim() || 'Untitled speaker';
            return (
              <li key={idx} className="lsq-wiz-speaker" data-primary={spk.isPrimary ? 'true' : undefined}>
                <div className="lsq-wiz-speaker__row">
                  <button
                    type="button"
                    className="lsq-wiz-speaker__toggle"
                    aria-expanded={isEditing}
                    onClick={() => setEditingIndex(isEditing ? null : idx)}
                  >
                    <span className="lsq-avatar" aria-hidden="true">
                      {spk.name.trim() ? spk.name.trim().charAt(0).toUpperCase() : '?'}
                    </span>
                    <span className="lsq-wiz-speaker__who">
                      <span className="lsq-wiz-speaker__name">
                        {displayName}
                        {spk.isPrimary && <Badge color="blue" text="Keynote / Primary" />}
                      </span>
                      {(spk.title || spk.company) && (
                        <span className="lsq-wiz-speaker__meta">{[spk.title, spk.company].filter(Boolean).join(' at ')}</span>
                      )}
                    </span>
                  </button>

                  {!disabled && (
                    <div className="lsq-wiz-speaker__actions">
                      <Button
                        hierarchy="tertiary"
                        size="sm"
                        iconPosition="only"
                        icon={<Icon name="arrow-up" size={14} />}
                        ariaLabel={`Move ${displayName} up`}
                        disabled={idx === 0}
                        onClick={() => handleMove(idx, 'up')}
                      />
                      <Button
                        hierarchy="tertiary"
                        size="sm"
                        iconPosition="only"
                        icon={<Icon name="arrow-down" size={14} />}
                        ariaLabel={`Move ${displayName} down`}
                        disabled={idx === speakers.length - 1}
                        onClick={() => handleMove(idx, 'down')}
                      />
                      <Button hierarchy="secondary" size="sm" onClick={() => setEditingIndex(isEditing ? null : idx)}>
                        {isEditing ? 'Done' : 'Edit'}
                      </Button>
                      <Button
                        hierarchy="tertiary"
                        size="sm"
                        iconPosition="only"
                        icon={<Icon name="trash" size={14} />}
                        ariaLabel={`Remove ${displayName}`}
                        onClick={() => handleRemove(idx)}
                      />
                    </div>
                  )}
                </div>

                {isEditing && (
                  <div className="lsq-wiz-speaker__form lsq-stack">
                    <div className="lsq-grid">
                      <Field label="Full name" required>
                        {(p) => (
                          <input
                            {...p}
                            type="text"
                            className="lsq-input"
                            placeholder="e.g. Dr. Sarah Chen"
                            value={spk.name}
                            onChange={(e) => handleUpdate(idx, { name: e.target.value })}
                            onBlur={handleFieldBlur}
                            disabled={disabled}
                          />
                        )}
                      </Field>
                      <Field label="Job title">
                        {(p) => (
                          <input
                            {...p}
                            type="text"
                            className="lsq-input"
                            placeholder="e.g. VP of AI Research"
                            value={spk.title || ''}
                            onChange={(e) => handleUpdate(idx, { title: e.target.value })}
                            onBlur={handleFieldBlur}
                            disabled={disabled}
                          />
                        )}
                      </Field>
                      <Field label="Company or organization">
                        {(p) => (
                          <input
                            {...p}
                            type="text"
                            className="lsq-input"
                            placeholder="e.g. Acme Health"
                            value={spk.company || ''}
                            onChange={(e) => handleUpdate(idx, { company: e.target.value })}
                            onBlur={handleFieldBlur}
                            disabled={disabled}
                          />
                        )}
                      </Field>
                      <Field label="LinkedIn profile URL">
                        {(p) => (
                          <input
                            {...p}
                            type="url"
                            className="lsq-input"
                            placeholder="https://linkedin.com/in/..."
                            value={spk.linkedinUrl || ''}
                            onChange={(e) => handleUpdate(idx, { linkedinUrl: e.target.value })}
                            onBlur={handleFieldBlur}
                            disabled={disabled}
                          />
                        )}
                      </Field>
                    </div>

                    <Field label="Short bio or session hook">
                      {(p) => (
                        <textarea
                          {...p}
                          className="lsq-input"
                          rows={2}
                          placeholder="Brief background or the specific perspective this speaker brings to the session."
                          value={spk.bio || ''}
                          onChange={(e) => handleUpdate(idx, { bio: e.target.value })}
                          onBlur={handleFieldBlur}
                          disabled={disabled}
                        />
                      )}
                    </Field>

                    <div className="lsq-cluster lsq-cluster--between">
                      <label className="lsq-check">
                        <input
                          type="radio"
                          name="primary_speaker"
                          checked={spk.isPrimary}
                          onChange={() => handleSetPrimary(idx)}
                          disabled={disabled}
                        />
                        <span>Set as keynote or primary speaker</span>
                      </label>
                      <Button size="sm" onClick={() => setEditingIndex(null)}>
                        Done
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
