'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { importAttendanceListAction } from '@/lib/actions/attendance';

interface ImportAttendanceModalProps {
  campaignId: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function ImportAttendanceModal({ campaignId, onClose, onSuccess }: ImportAttendanceModalProps) {
  const { showToast } = useToast();
  const [textInput, setTextInput] = useState('');
  const [defaultDuration, setDefaultDuration] = useState('60');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function parseInput(): { email: string; watchMinutes: number }[] {
    const lines = textInput.split('\n');
    const records: { email: string; watchMinutes: number }[] = [];
    const seen = new Set<string>();

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      // Check for comma, tab, or space separation: email [duration]
      const parts = trimmed.split(/[\t,; ]+/).map((p) => p.trim()).filter(Boolean);
      if (parts.length === 0) continue;

      const emailCandidate = parts.find((p) => p.includes('@'));
      if (!emailCandidate) continue;

      const email = emailCandidate.toLowerCase().replace(/[<>"]/g, '');
      if (seen.has(email)) continue;
      seen.add(email);

      // Duration: search other parts for integer
      let duration = Number(defaultDuration) || 60;
      const numPart = parts.find((p) => p !== emailCandidate && /^\d+$/.test(p));
      if (numPart) {
        duration = parseInt(numPart, 10);
      }

      records.push({ email, watchMinutes: duration });
    }
    return records;
  }

  const parsed = parseInput();

  async function handleImport() {
    if (parsed.length === 0) {
      setError('No valid email addresses found in the input.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const result = await importAttendanceListAction(campaignId, parsed);
      if (!result.ok) {
        setError(result.error || 'Failed to import attendance.');
        return;
      }

      showToast(
        `Imported attendance: ${result.attendedCount ?? 0} attended, ${result.noShowCount ?? 0} no-show.`
      );
      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed.');
    } finally {
      setBusy(false);
    }
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result;
      if (typeof content === 'string') {
        setTextInput(content);
      }
    };
    reader.readAsText(file);
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      busy={busy}
      size="lg"
      title="Import Attendee List"
      subtitle="Paste participant emails or upload a CSV to mark attendees and trigger follow-up cadences."
      footer={
        <>
          <Button hierarchy="secondary" size="md" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            hierarchy="primary"
            size="md"
            icon={<Icon name="upload" size={16} />}
            loading={busy}
            onClick={handleImport}
            disabled={parsed.length === 0}
          >
            {busy ? 'Importing' : `Import ${parsed.length.toLocaleString()} Attendee${parsed.length === 1 ? '' : 's'}`}
          </Button>
        </>
      }
    >
      <div className="lsq-stack">
        {error && (
          <div className="lsq-banner lsq-banner--error" role="alert">
            <Icon name="error" size={16} />
            <p className="lsq-banner__body">{error}</p>
          </div>
        )}

        <Field label="Attendee Emails and Watch Duration (Minutes)" hint="One attendee per line. Add the watch time after the email, separated by a comma or space.">
          {(p) => (
            <textarea
              className="lsq-input lsq-res-mono"
              rows={8}
              {...p}
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              placeholder={'sarah.connor@acme.com, 45\njohn.doe@enterprise.com, 60\nelena@cyberdefense.com'}
            />
          )}
        </Field>

        <div className="lsq-cluster">
          <label className="lsq-btn lsq-btn--sm lsq-btn--secondary lsq-res-file">
            <Icon name="upload" size={14} />
            Upload CSV File
            <input type="file" accept=".csv,.txt" onChange={handleFileUpload} className="lsq-sr-only" />
          </label>
        </div>

        <div className="lsq-cluster">
          <label className="lsq-label" htmlFor="import-default-duration">Default watch time</label>
          <input
            id="import-default-duration"
            type="number"
            className="lsq-input lsq-res-narrow"
            min={1}
            max={360}
            value={defaultDuration}
            onChange={(e) => setDefaultDuration(e.target.value)}
          />
          <span className="lsq-hint">minutes, used when a row has none</span>
        </div>

        <div className="lsq-banner lsq-banner--neutral" role="status">
          <Icon name="info" size={16} />
          <div>
            <p className="lsq-banner__body">
              Detected unique attendees: <strong>{parsed.length.toLocaleString()}</strong>
            </p>
            <p className="lsq-hint">Registrants not in this list will be marked no-show.</p>
          </div>
        </div>
      </div>
    </Modal>
  );
}
