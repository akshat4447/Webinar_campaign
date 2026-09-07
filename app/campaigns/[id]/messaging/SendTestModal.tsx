'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { sendTestMessageAction } from '@/lib/actions/testSend';
import type { Channel } from '@/lib/channels';

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

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !sending) {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, sending]);

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
      setResult({ ok: true, message: res.detail || 'Test preview dispatched successfully!' });
    } else {
      setResult({ ok: false, message: res.error || 'Failed to dispatch test message.' });
    }
  }

  return (
    <>
      <div onClick={sending ? undefined : onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(16,20,25,0.45)', zIndex: 1200 }} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="send-test-title"
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 500,
          maxWidth: 'calc(100vw - 32px)',
          boxSizing: 'border-box',
          maxHeight: 'calc(100vh - 48px)',
          background: '#fff',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-panel)',
          zIndex: 1201,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{ flexShrink: 0, padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div id="send-test-title" style={{ fontSize: 'var(--fs-body)', fontWeight: 700, color: 'var(--n90)' }}>
              Send Live Test Preview
            </div>
            <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n60)', marginTop: 2 }}>
              Channel: <strong style={{ textTransform: 'capitalize' }}>{channel}</strong> · {stepLabel}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            disabled={sending}
            style={{ cursor: 'pointer', border: 'none', background: 'transparent', padding: 4, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <Icon name="close" size={16} style={{ color: 'var(--n60)' }} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: 'block', fontSize: 'var(--fs-label-1)', fontWeight: 600, color: 'var(--n80)', marginBottom: 6 }}>
              {isEmail ? 'Your Email Address' : 'Your Mobile / WhatsApp Number'}
            </label>
            <input
              type={isEmail ? 'email' : 'tel'}
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder={isEmail ? 'e.g. you@company.com' : 'e.g. +919876543210'}
              disabled={sending}
              style={{
                width: '100%',
                padding: '9px 12px',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-subtle)',
                fontSize: 'var(--fs-body)',
                boxSizing: 'border-box',
              }}
            />
            <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n50)', marginTop: 4 }}>
              {isEmail
                ? 'We will send a live preview email via LeadSquared with [TEST PREVIEW] in the subject.'
                : 'Enter in E.164 international format with country code (e.g. +91 for India).'}
            </div>
          </div>

          {/* Message Preview Box */}
          <div style={{ background: 'var(--n10)', borderRadius: 'var(--radius-md)', padding: '12px 14px', marginBottom: 14 }}>
            <div style={{ fontSize: 'var(--fs-label-2)', fontWeight: 700, color: 'var(--n60)', textTransform: 'uppercase', marginBottom: 6 }}>
              Preview Copy
            </div>
            {subject && (
              <div style={{ fontSize: 'var(--fs-label-1)', fontWeight: 600, color: 'var(--n90)', marginBottom: 6 }}>
                Subject: {subject}
              </div>
            )}
            <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--n70)', whiteSpace: 'pre-wrap', lineHeight: 1.5, maxHeight: 160, overflowY: 'auto' }}>
              {body}
            </div>
          </div>

          {result && (
            <div
              style={{
                padding: '10px 14px',
                borderRadius: 'var(--radius-md)',
                marginBottom: 14,
                fontSize: 'var(--fs-label-1)',
                background: result.ok ? 'var(--success-100)' : 'var(--danger-100)',
                color: result.ok ? 'var(--success-700)' : 'var(--danger-700)',
              }}
            >
              {result.message}
            </div>
          )}
        </div>

        <div style={{ flexShrink: 0, padding: '14px 20px', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <Button hierarchy="secondary" size="md" onClick={onClose} disabled={sending}>
            Done
          </Button>
          <Button hierarchy="primary" size="md" onClick={handleSend} disabled={sending || !recipient.trim()}>
            {sending ? 'Dispatching…' : 'Send Test Now'}
          </Button>
        </div>
      </div>
    </>
  );
}
