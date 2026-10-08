'use client';

import { useEffect } from 'react';

/**
 * Closes a dialog on Escape — the behaviour every modal in this app is
 * expected to have, factored out because it was hand-rolled in eight of them
 * and simply missing from three others, so whether Escape worked depended on
 * which modal you happened to open.
 *
 * `enabled` is false while an action is in flight, matching the existing
 * convention that a modal mid-save shouldn't vanish out from under the
 * request.
 */
export function useEscapeKey(onEscape: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onEscape();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onEscape, enabled]);
}
