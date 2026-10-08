'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { broadcastWebinarReminderAction } from '@/lib/actions/broadcastReminder';

interface BroadcastReminderModalProps {
  campaignId: string;
  campaignName: string;
  webinarDate?: string;
  registeredCount: number;
  onClose: () => void;
  onSuccess?: () => void;
}

const PRESETS = [
  {
    label: 'Doors Open (T-15m)',
    channel: 'all' as const,
    subject: 'We are opening the doors! {{topic}} starts in 15 minutes',
    message: 'Hi {{firstName}}, we are opening the doors now for {{topic}}! Click your personal link to join the session live: {{zoomLink}}\n\nSee you inside!',
  },
  {
    label: 'Starting in 1 Hour',
    channel: 'email' as const,
    subject: 'Starting in 1 hour: {{topic}}',
    message: 'Hi {{firstName}},\n\nQuick reminder that our live session on {{topic}} goes live in 60 minutes.\n\nSave your access link: {{zoomLink}}\n\nLooking forward to having you with us!',
  },
  {
    label: 'Live Now — Join Here',
    channel: 'all' as const,
    subject: 'We are live right now: {{topic}}',
    message: 'Hi {{firstName}}, we just went live with {{topic}}! Click to enter the room right now: {{zoomLink}}',
  },
  {
    label: 'Custom Broadcast',
    channel: 'email' as const,
    subject: 'Important update for {{topic}}',
    message: 'Hi {{firstName}},\n\nHere is an update regarding our upcoming session on {{topic}}.\n\nYour live join link: {{zoomLink}}\n\nBest,\nThe Event Team',
  },
];

export function BroadcastReminderModal({

  campaignId,
  campaignName,
  webinarDate,
  registeredCount,
  onClose,
  onSuccess,
}: BroadcastReminderModalProps) {
  const { showToast } = useToast();

  const [channel, setChannel] = useState<'all' | 'email' | 'whatsapp' | 'sms'>('all');
  const [subject, setSubject] = useState(PRESETS[0].subject);
  const [message, setMessage] = useState(PRESETS[0].message);
  const [busy, setBusy] = useState(false);

  function applyPreset(presetIndex: number) {
    const p = PRESETS[presetIndex];
    if (!p) return;
    setChannel(p.channel);
    setSubject(p.subject);
    setMessage(p.message);
  }

  function insertToken(token: string) {
    setMessage((prev) => `${prev} {{${token}}}`);
  }

  async function handleSendBroadcast() {
    if (!message.trim()) {
      showToast('Please enter a reminder message');
      return;
    }

    if (registeredCount === 0) {
      showToast('No registered attendees found to send broadcast to');
      return;
    }

    setBusy(true);
    try {
      const res = await broadcastWebinarReminderAction(campaignId, {
        channel,
        subject,
        message,
      });

      if (res.ok) {
        showToast(`Broadcast reminder dispatched to ${res.sentCount} recipient(s).`);
        onSuccess?.();
        onClose();
      } else {
        showToast(res.error || 'Failed to send broadcast reminder');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Broadcast send failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      busy={busy}
      size="lg"
      title="Broadcast Live Reminder"
      subtitle={`Send an instant, on-demand live push to all registered attendees for \u201c${campaignName}\u201d${webinarDate ? ` (${webinarDate})` : ''}.`}
      footer={
        <>
          <span className="lsq-res-footnote">
            Recipients: <strong>{registeredCount.toLocaleString()} attendees</strong>
          </span>
          <Button hierarchy="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            hierarchy="primary"
            icon={<Icon name="send" size={16} />}
            loading={busy}
            onClick={handleSendBroadcast}
            disabled={registeredCount === 0 || !message.trim()}
          >
            {busy ? 'Dispatching Broadcast' : `Send Live Broadcast (${registeredCount.toLocaleString()})`}
          </Button>
        </>
      }
    >
      <div className="lsq-stack">
        <div className="lsq-cluster">
          <Badge color="green" text={`${registeredCount.toLocaleString()} confirmed attendees`} />
        </div>

        <div className="lsq-field">
          <span className="lsq-label" id="bcast-presets">Quick Templates</span>
          <div className="lsq-chips" role="group" aria-labelledby="bcast-presets">
            {PRESETS.map((p, idx) => (
              <Button key={p.label} hierarchy="secondary" size="sm" onClick={() => applyPreset(idx)}>
                {p.label}
              </Button>
            ))}
          </div>
        </div>

        <fieldset className="lsq-res-fieldset">
          <legend className="lsq-label">Target Channel</legend>
          <div className="lsq-res-options">
            {[
              { id: 'all', label: 'All channels (email, WhatsApp, SMS)' },
              { id: 'email', label: 'Email only' },
              { id: 'whatsapp', label: 'WhatsApp only' },
              { id: 'sms', label: 'SMS only' },
            ].map((c) => (
              <label key={c.id} className="lsq-check">
                <input
                  type="radio"
                  name="reminder_channel"
                  value={c.id}
                  checked={channel === c.id}
                  onChange={() => setChannel(c.id as 'all' | 'email' | 'whatsapp' | 'sms')}
                />
                <span>{c.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {(channel === 'all' || channel === 'email') && (
          <Field label="Subject Line">
            {(p) => <input type="text" className="lsq-input" {...p} value={subject} onChange={(e) => setSubject(e.target.value)} />}
          </Field>
        )}

        <Field label="Message Content">
          {(p) => <textarea className="lsq-input" rows={5} {...p} value={message} onChange={(e) => setMessage(e.target.value)} />}
        </Field>
        <div className="lsq-cluster">
          <span className="lsq-hint">Insert token:</span>
          {['firstName', 'zoomLink', 'topic'].map((tok) => (
            <button key={tok} type="button" className="lsq-linkbtn" onClick={() => insertToken(tok)}>
              +{tok}
            </button>
          ))}
        </div>

        <div className="lsq-banner lsq-banner--neutral" role="note">
          <Icon name="info" size={16} />
          <p className="lsq-banner__body">
            Each attendee will receive a personalized link (<code className="lsq-code">&#123;&#123;zoomLink&#125;&#125;</code>) so Zoom logs individual join duration.
          </p>
        </div>
      </div>
    </Modal>
  );
}
