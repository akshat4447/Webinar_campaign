'use client';

import { useEffect } from 'react';
import { Icon } from './Icon';

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

  if (!content) return null;
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(16,20,25,0.45)', zIndex: 1200 }} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
        aria-describedby="drawer-subtitle"
        style={{
          position: 'fixed',
          top: 12,
          right: 12,
          bottom: 12,
          width: 480,
          maxWidth: 'calc(100vw - 24px)',
          boxSizing: 'border-box',
          background: '#fff',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-panel)',
          zIndex: 1201,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div style={{ flexShrink: 0, padding: '18px 20px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'start', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div id="drawer-title" style={{ fontSize: 'var(--fs-body)', fontWeight: 700, color: 'var(--n90)', overflowWrap: 'anywhere' }}>{content.title}</div>
            <div id="drawer-subtitle" style={{ fontSize: 'var(--fs-label-1)', color: 'var(--n60)', marginTop: 3, overflowWrap: 'anywhere' }}>{content.subtitle}</div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{ cursor: 'pointer', width: 28, height: 28, borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, border: 'none', background: 'transparent', padding: 0 }}
          >
            <Icon name="close" size={16} style={{ color: 'var(--n60)' }} />
          </button>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px 24px 20px' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-label-1)' }}>
              <thead>
                <tr>
                  {content.columns.map((col) => (
                    <th key={col} style={{ padding: '8px 10px', textAlign: 'left', fontSize: 'var(--fs-label-2)', fontWeight: 600, color: 'var(--n60)', textTransform: 'uppercase', letterSpacing: '0.03em', whiteSpace: 'nowrap' }}>
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {content.rows.map((row, i) => (
                  <tr key={i} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                    {row.map((cell, j) => (
                      <td key={j} style={{ padding: 10, color: 'var(--n80)', verticalAlign: 'top', overflowWrap: 'anywhere' }}>
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {content.notes && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
              {content.notes.map((note, i) => (
                <div key={i} style={{ fontSize: 'var(--fs-label-1)', color: 'var(--n70)', lineHeight: 1.55, background: 'var(--n10)', borderRadius: 'var(--radius-sm)', padding: '10px 12px', overflowWrap: 'anywhere' }}>
                  {note}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
