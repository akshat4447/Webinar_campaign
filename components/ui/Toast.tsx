'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

// Transient confirmation for an action that produced no visible change on the
// page — "Approved 3,240 contacts", "Template saved". Anything the user can
// still act on (an error they must fix, a queue they must review) belongs in
// the page itself, not here: a toast that disappears cannot be a control.
//
// One toast at a time, deliberately. A stack invites firing several at once,
// which is how a UI ends up telling the user five things they didn't ask about.

const DURATION_MS = 2600;

interface ToastApi {
  showToast: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  // Bumped on every call so a repeat of the same text still re-triggers the
  // entry animation instead of sitting there looking stale.
  const [nonce, setNonce] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((next: string) => {
    if (timer.current) clearTimeout(timer.current);
    setMessage(next);
    setNonce((n) => n + 1);
    timer.current = setTimeout(() => setMessage(null), DURATION_MS);
  }, []);

  // Without this, navigating away mid-toast leaves a timer holding a setState
  // on an unmounted tree.
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {message && (
        <div
          key={nonce}
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed',
            bottom: 22,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'var(--n90)',
            color: 'var(--text-inverse)',
            padding: '10px 18px',
            borderRadius: 'var(--radius-sm)',
            fontSize: 'var(--fs-label-1)',
            fontWeight: 'var(--fw-semibold)',
            boxShadow: 'var(--shadow-panel)',
            // Above the chat widget (1000) so a confirmation is never hidden
            // behind it.
            zIndex: 1100,
            maxWidth: 'calc(100vw - 48px)',
            textAlign: 'center',
            animation: 'lsq-toast-in var(--dur-medium) var(--ease-standard)',
          }}
        >
          {message}
        </div>
      )}
    </ToastContext.Provider>
  );
}
