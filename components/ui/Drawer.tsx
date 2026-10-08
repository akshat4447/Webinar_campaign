'use client';

import { useEffect } from 'react';
import { Icon } from './Icon';
import { useModalFocus } from '@/lib/useModalFocus';

export interface DrawerContent {
  title: string;
  subtitle: string;
  columns: string[];
  rows: string[][];
  notes?: string[];
}

export function Drawer({ content, onClose }: { content: DrawerContent | null; onClose: () => void }) {
  useEffect(() => {
    if (!content) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [content, onClose]);

  const dialogRef = useModalFocus<HTMLDivElement>(!!content);

  if (!content) return null;
  return (
    <>
      <div className="lsq-overlay" role="presentation" onClick={onClose} />
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="drawer-title" aria-describedby="drawer-subtitle" className="lsq-drawer">
        <div className="lsq-modal__header">
          <div style={{ minWidth: 0 }}>
            <h2 className="lsq-modal__title" id="drawer-title" style={{ overflowWrap: 'anywhere' }}>{content.title}</h2>
            <p className="lsq-modal__sub" id="drawer-subtitle" style={{ overflowWrap: 'anywhere' }}>{content.subtitle}</p>
          </div>
          <button type="button" className="lsq-icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="lsq-modal__body">
          <div className="lsq-table-wrap" tabIndex={0} role="region" aria-label="Scrollable table">
            <table className="lsq-table">
              <thead>
                <tr>
                  {content.columns.map((col) => (
                    <th key={col} scope="col">{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {content.rows.map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) => (
                      <td key={j} style={{ overflowWrap: 'anywhere' }}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {content.notes && (
            <div className="lsq-stack lsq-stack--sm" style={{ marginTop: 'var(--space-16)' }}>
              {content.notes.map((note, i) => (
                <p key={i} className="lsq-hint" style={{ background: 'var(--surface-subtle)', borderRadius: 'var(--radius-md)', padding: 'var(--space-12)', overflowWrap: 'anywhere' }}>
                  {note}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
