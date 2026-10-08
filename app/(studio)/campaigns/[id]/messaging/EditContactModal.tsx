'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { updateContactFieldsAction, regeneratePersonalizedAction } from '@/lib/actions/personalize';

export interface EditableContactFields {
  id: string;
  name: string;
  title: string | null;
  seniority: string | null;
  function: string | null;
  account: string | null;
  vertical: string | null;
  personaNote: string | null;
}

interface EditContactModalProps {
  isOpen: boolean;
  onClose: () => void;
  campaignId: string;
  activeStepKey: string;
  contact: EditableContactFields;
  onSavedAndRegenerated: (
    updatedContact: EditableContactFields,
    newDraft?: {
      id: string;
      subject: string | null;
      body: string;
      rationale: string | null;
      status: string;
      linkStale: boolean;
    }
  ) => void;
}

export function EditContactModal({
  isOpen,
  onClose,
  campaignId,
  activeStepKey,
  contact,
  onSavedAndRegenerated,
}: EditContactModalProps) {
  const [name, setName] = useState(contact.name || '');
  const [title, setTitle] = useState(contact.title || '');
  const [seniority, setSeniority] = useState(contact.seniority || '');
  const [func, setFunc] = useState(contact.function || '');
  const [account, setAccount] = useState(contact.account || '');
  const [vertical, setVertical] = useState(contact.vertical || '');
  const [personaNote, setPersonaNote] = useState(contact.personaNote || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSaveAndRegenerate() {
    setBusy(true);
    setError(null);
    try {
      const updateRes = await updateContactFieldsAction(campaignId, contact.id, {
        name,
        title,
        seniority,
        function: func,
        account,
        vertical,
        personaNote,
      });

      if (!updateRes.ok) {
        throw new Error('Failed to update contact attributes in database.');
      }

      const regenRes = await regeneratePersonalizedAction(campaignId, contact.id, activeStepKey);
      if (!regenRes.ok) {
        // The field update above already succeeded and isn't rolled back —
        // only the regeneration failed, so say so distinctly rather than
        // reporting full success (regeneratePersonalizedAction returns
        // {ok:false, error} rather than throwing, so this wouldn't otherwise
        // surface at all).
        setError(regenRes.error || 'Saved the contact, but the message could not be regenerated. Use Regenerate on the recipient.');
        return;
      }

      onSavedAndRegenerated(
        {
          id: contact.id,
          name,
          title,
          seniority,
          function: func,
          account,
          vertical,
          personaNote,
        },
        regenRes.messages?.[0]
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save and regenerate contact message');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Edit Contact Fields"
      subtitle={`Attributes for ${contact.name}. Saving rewrites the message for this contact.`}
      busy={busy}
      footer={
        <>
          <Button hierarchy="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button hierarchy="primary" onClick={handleSaveAndRegenerate} loading={busy}>
            {busy ? 'Rewriting…' : 'Save and Regenerate'}
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

        <div className="lsq-grid">
          <Field label="Full name">{(p) => <input {...p} className="lsq-input" value={name} onChange={(e) => setName(e.target.value)} />}</Field>
          <Field label="Company">{(p) => <input {...p} className="lsq-input" value={account} onChange={(e) => setAccount(e.target.value)} />}</Field>
          <Field label="Job title">{(p) => <input {...p} className="lsq-input" value={title} onChange={(e) => setTitle(e.target.value)} />}</Field>
          <Field label="Seniority">
            {(p) => (
              <select {...p} className="lsq-select" value={seniority} onChange={(e) => setSeniority(e.target.value)}>
                <option value="">Keep current</option>
                <option value="Executive">Executive (CXO / VP)</option>
                <option value="Director">Director / Head</option>
                <option value="Manager">Manager / Team Lead</option>
                <option value="Individual Contributor">Individual Contributor / Practitioner</option>
              </select>
            )}
          </Field>
          <Field label="Department or function">
            {(p) => (
              <input {...p} className="lsq-input" value={func} placeholder="e.g. Engineering, Product, Marketing" onChange={(e) => setFunc(e.target.value)} />
            )}
          </Field>
          <Field label="Industry">
            {(p) => (
              <input {...p} className="lsq-input" value={vertical} placeholder="e.g. Enterprise SaaS, FinTech" onChange={(e) => setVertical(e.target.value)} />
            )}
          </Field>
        </div>

        <Field label="Persona notes" hint="Pain points and observations the AI draws on for this contact.">
          {(p) => (
            <textarea
              {...p}
              className="lsq-input"
              rows={3}
              value={personaNote}
              placeholder="e.g. Recently migrated infrastructure to GCP. Focused on Kubernetes cost reduction."
              onChange={(e) => setPersonaNote(e.target.value)}
            />
          )}
        </Field>
      </div>
    </Modal>
  );
}
