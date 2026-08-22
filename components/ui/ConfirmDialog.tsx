'use client';

import { Button } from './Button';

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  destructive = false,
  busy = false,
  onConfirm,
  onClose,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(16,20,25,0.45)', zIndex: 1200 }} />
      <div
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 420,
          maxHeight: 'calc(100vh - 48px)',
          background: '#fff',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-panel)',
          zIndex: 1201,
          overflow: 'hidden',
          padding: '20px 22px',
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--n90)', marginBottom: 8 }}>{title}</div>
        <div style={{ fontSize: 13, color: 'var(--n70)', lineHeight: 1.55, marginBottom: 20 }}>{message}</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button hierarchy="secondary" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button hierarchy={destructive ? 'destructive-outline' : 'primary'} size="sm" onClick={onConfirm} disabled={busy}>
            {busy ? 'Working…' : confirmLabel}
          </Button>
        </div>
      </div>
    </>
  );
}
