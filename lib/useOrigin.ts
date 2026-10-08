import { useSyncExternalStore } from 'react';

const emptySubscribe = () => () => {};

/**
 * SSR-safe hook to get window.location.origin.
 * Uses useSyncExternalStore to guarantee identical SSR output without hydration mismatch.
 */
export function useOrigin(): string {
  return useSyncExternalStore(
    emptySubscribe,
    () => (typeof window !== 'undefined' ? window.location.origin : ''),
    () => ''
  );
}
