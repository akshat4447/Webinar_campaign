'use client';

import { useEffect } from 'react';
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
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, busy]);

  return (
    <>
      <div onClick={busy ? undefined : onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(16,20,25,0.45)', zIndex: 1200 }} />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 420,
          maxWidth: 'calc(100vw - 32px)',
          boxSizing: 'border-box',
          maxHeight: 'calc(100vh - 48px)',
          background: '#fff',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-panel)',
          zIndex: 1201,
          overflow: 'hidden',
          padding: '20px 22px',
        }}
      >
        <div id="confirm-dialog-title" style={{ fontSize: 'var(--fs-body)', fontWeight: 700, color: 'var(--n90)', marginBottom: 8 }}>{title}</div>
        <div id="confirm-dialog-message" style={{ fontSize: 'var(--fs-label-1)', color: 'var(--n70)', lineHeight: 1.55, marginBottom: 20 }}>{message}</div>
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
