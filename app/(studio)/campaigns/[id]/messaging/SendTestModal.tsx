'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { sendTestMessageAction } from '@/lib/actions/testSend';
import type { Channel } from '@/lib/channels';

const CHANNEL_LABEL: Record<Channel, string> = { email: 'Email', linkedin: 'LinkedIn', sms: 'SMS', whatsapp: 'WhatsApp' };

export function SendTestModal({
  campaignId,
  channel,
  stepLabel,
  subject,
  body,
  onClose,
}: {
  campaignId: string;
  channel: Channel;
  stepLabel: string;
  subject: string | null;
  body: string;
  onClose: () => void;
}) {
  const isEmail = channel === 'email';
  const [recipient, setRecipient] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function handleSend() {
    if (!recipient.trim()) return;
    setSending(true);
    setResult(null);

    const res = await sendTestMessageAction({
      campaignId,
      channel,
      recipient: recipient.trim(),
      subject,
      body,
    });

    setSending(false);
    if (res.ok) {
      setResult({ ok: true, message: res.detail || 'Test message sent.' });
    } else {
      setResult({ ok: false, message: res.error || 'Failed to send the test message.' });
    }
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Send Test Message"
      subtitle={`${CHANNEL_LABEL[channel]} · ${stepLabel}`}
      busy={sending}
      footer={
        <>
          <Button hierarchy="secondary" onClick={onClose} disabled={sending}>
            Done
          </Button>
          <Button hierarchy="primary" onClick={handleSend} loading={sending} disabled={!recipient.trim()}>
            {sending ? 'Sending…' : 'Send Test'}
          </Button>
        </>
      }
    >
      <div className="lsq-stack">
        <Field
          label={isEmail ? 'Recipient email address' : 'Recipient mobile or WhatsApp number'}
          hint={
            isEmail
              ? 'A live preview email is sent through the campaign gateway, with [TEST PREVIEW] in the subject.'
              : 'Use E.164 format with the country code, for example +91 for India.'
          }
        >
          {(p) => (
            <input
              {...p}
              className="lsq-input"
              type={isEmail ? 'email' : 'tel'}
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder={isEmail ? 'name@company.com' : '+919876543210'}
              disabled={sending}
            />
          )}
        </Field>

        <div className="lsq-stack lsq-stack--sm">
          <p className="lsq-msg-section-title">Preview Copy</p>
          <div className="lsq-msgbox">
            {subject && <p className="lsq-msg-section-title">Subject: {subject}</p>}
            <div className="lsq-msg-scroll">{body}</div>
          </div>
        </div>

        {result && (
          <div className={`lsq-banner lsq-banner--${result.ok ? 'success' : 'error'}`} role={result.ok ? 'status' : 'alert'}>
            <p className="lsq-banner__body">{result.message}</p>
          </div>
        )}
      </div>
    </Modal>
  );
}
