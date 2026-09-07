'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import { setSendModeAction } from '@/lib/actions/integrations';

export function DeliverySettingsBar({
  initialSendMode,
  deliveryItems,
}: {
  initialSendMode: 'sandbox' | 'live';
  deliveryItems: Array<{ label: string; value: string }>;
}) {
  const [mode, setMode] = useState<'sandbox' | 'live'>(initialSendMode);
  const [confirmingLive, setConfirmingLive] = useState(false);
  const [busy, setBusy] = useState(false);
  const { showToast } = useToast();
  const router = useRouter();

  async function handleToggleMode(newMode: 'sandbox' | 'live') {
    setBusy(true);
    try {
      const res = await setSendModeAction(newMode);
      if (res.ok) {
        setMode(res.mode);
        showToast(
          res.mode === 'live'
            ? 'Live Production Mode active: Outbound messages deliver directly to prospects.'
            : 'Sandbox Mode active: Outbound messages redirect to allowlisted test phone & email.'
        );
        router.refresh();
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to update send mode.');
    } finally {
      setBusy(false);
      setConfirmingLive(false);
    }
  }

  return (
    <>
      <div
        style={{
          background: '#fff',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-card)',
          padding: '16px 22px',
          marginBottom: 20,
          border: mode === 'live' ? '1px solid rgba(70, 202, 123, 0.4)' : '1px solid var(--border-subtle)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 12, flexWrap: 'wrap' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 'var(--fs-label-1)', fontWeight: 700, color: 'var(--n90)' }}>Delivery & Environment Controls</span>
              <Badge
                color={mode === 'live' ? 'success' : 'warning'}
                text={mode === 'live' ? '⚡ Live Production' : '🛡️ Sandbox Protected'}
              />
            </div>
            <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n60)', marginTop: 3 }}>
              {mode === 'live'
                ? 'Outbound cadence messages deliver directly to genuine prospective attendee inboxes and mobile devices.'
                : 'Outbound emails and messages are held in sandbox and redirected to your configured allowlisted test contact.'}
            </div>
          </div>

          <div>
            {mode === 'sandbox' ? (
              <Button
                size="sm"
                hierarchy="primary"
                onClick={() => setConfirmingLive(true)}
                disabled={busy}
              >
                {busy ? 'Switching…' : 'Switch to Live Mode'}
              </Button>
            ) : (
              <Button
                size="sm"
                hierarchy="secondary"
                onClick={() => handleToggleMode('sandbox')}
                disabled={busy}
              >
                {busy ? 'Switching…' : 'Switch to Sandbox Mode'}
              </Button>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', paddingTop: 10, borderTop: '1px solid var(--border-subtle)' }}>
          {deliveryItems.map((d) => (
            <div key={d.label}>
              <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n50)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {d.label}
              </div>
              <div style={{ fontSize: 'var(--fs-label-1)', fontWeight: 600, color: 'var(--n80)', marginTop: 2 }}>
                {d.value}
              </div>
            </div>
          ))}
        </div>
      </div>

      {confirmingLive && (
        <ConfirmDialog
          title="Enable Live Production Sending?"
          message="In Live Production mode, emails, WhatsApp messages, and SMS sent by automated cadences will be dispatched directly to real prospects. Ensure you have tested your templates and verified your sender credentials before proceeding."
          confirmLabel={busy ? 'Activating…' : 'Activate Live Mode'}
          destructive={false}
          busy={busy}
          onConfirm={() => handleToggleMode('live')}
          onClose={() => setConfirmingLive(false)}
        />
      )}
    </>
  );
}
