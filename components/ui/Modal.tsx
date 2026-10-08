'use client';

import { useId } from 'react';
import { useEscapeKey } from '@/lib/useEscapeKey';
import { useModalFocus } from '@/lib/useModalFocus';
import { Icon } from './Icon';

/**
 * The one dialog shell. White card, 12px radius, system shadow, dimmed canvas behind (no blur).
 * Put the primary action in `footer` so every dialog reads the same: Cancel on the left of the primary button.
 *
 * `size` picks 420 / 560 / 760px. `busy` stops Escape and the backdrop from closing mid-save.
 */
export function Modal({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = 'md',
  busy = false,
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
  busy?: boolean;
}) {
  useEscapeKey(onClose, isOpen && !busy);
  const dialogRef = useModalFocus<HTMLDivElement>(isOpen);
  const titleId = useId();
  const subId = useId();

  if (!isOpen) return null;

  return (
    <>
      <div className="lsq-overlay" role="presentation" onClick={busy ? undefined : onClose} />
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitle ? subId : undefined}
        className={`lsq-modal${size === 'sm' ? ' lsq-modal--sm' : size === 'lg' ? ' lsq-modal--lg' : ''}`}
      >
        <div className="lsq-modal__header">
          <div style={{ minWidth: 0 }}>
            <h2 className="lsq-modal__title" id={titleId}>{title}</h2>
            {subtitle && <p className="lsq-modal__sub" id={subId}>{subtitle}</p>}
          </div>
          <button type="button" className="lsq-icon-btn" onClick={onClose} disabled={busy} aria-label="Close dialog">
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="lsq-modal__body">{children}</div>
        {footer && <div className="lsq-modal__footer">{footer}</div>}
      </div>
    </>
  );
}
