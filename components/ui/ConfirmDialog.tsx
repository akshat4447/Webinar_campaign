'use client';

import { useId } from 'react';
import { Button } from './Button';
import { useEscapeKey } from '@/lib/useEscapeKey';
import { useModalFocus } from '@/lib/useModalFocus';

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  destructive = false,
  busy = false,
  secondaryAction,
  onConfirm,
  onClose,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  destructive?: boolean;
  busy?: boolean;
  secondaryAction?: { label: string; onClick: () => void };
  onConfirm: () => void;
  onClose: () => void;
}) {
  useEscapeKey(onClose, !busy);
  const dialogRef = useModalFocus<HTMLDivElement>();
  const titleId = useId();
  const msgId = useId();

  return (
    <>
      <div className="lsq-overlay" role="presentation" onClick={busy ? undefined : onClose} />
      <div ref={dialogRef} tabIndex={-1} role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={msgId} className="lsq-modal lsq-modal--sm">
        <div className="lsq-modal__body">
          <h2 className="lsq-modal__title" id={titleId}>{title}</h2>
          <p className="lsq-modal__sub" id={msgId} style={{ marginTop: 'var(--space-8)' }}>{message}</p>
        </div>
        <div className="lsq-modal__footer">
          <Button hierarchy="secondary" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
          {secondaryAction && (
            <Button hierarchy="secondary" size="sm" onClick={secondaryAction.onClick} disabled={busy}>{secondaryAction.label}</Button>
          )}
          <Button hierarchy={destructive ? 'destructive' : 'primary'} size="sm" onClick={onConfirm} loading={busy}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </>
  );
}
