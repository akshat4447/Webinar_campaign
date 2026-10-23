'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { formatLsqTime } from '@/lib/dateFormat';
import { describeGroups } from '@/lib/wizardDraft';
import type { DraftSaveState } from '@/lib/draftSaveQueue';

/** "just now", "3 min ago", then the clock time: the same wording at every size. */
export function savedAgo(at: number, now: number): string {
  const sec = Math.max(0, Math.round((now - at) / 1000));
  if (sec < 45) return 'Saved just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `Saved ${min} min ago`;
  return `Saved at ${formatLsqTime(new Date(at))}`;
}

/**
 * The always-visible answer to "is my work safe?". One polite live region, plain words, and a button for
 * every state the person can act on. A failure is never silent and never blames them.
 */
export function DraftSaveStatus({
  state,
  onRetry,
  onKeepMine,
  onReload,
  remoteChanged,
}: {
  state: DraftSaveState;
  onRetry: () => void;
  onKeepMine: () => void;
  onReload: () => void;
  /** Another tab changed fields this tab did not touch. */
  remoteChanged: boolean;
}) {
  // Re-render now and then so "2 min ago" stays true.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  let text = '';
  let tone: 'quiet' | 'warn' | 'bad' = 'quiet';
  let actions: React.ReactNode = null;

  switch (state.status) {
    case 'dirty':
    case 'saving':
      text = 'Saving';
      break;
    case 'saved':
      text = remoteChanged ? 'Saved. This draft was also changed in another tab' : savedAgo(state.at, now);
      tone = remoteChanged ? 'warn' : 'quiet';
      if (remoteChanged) actions = <Button hierarchy="tertiary-color" size="sm" onClick={onReload}>Reload</Button>;
      break;
    case 'retrying':
      text = 'Could not save. Trying again';
      tone = 'warn';
      break;
    case 'error':
      text = 'We could not save. Changes are kept on this device';
      tone = 'bad';
      actions = <Button hierarchy="tertiary-color" size="sm" onClick={onRetry}>Retry</Button>;
      break;
    case 'conflict':
      text = `Updated in another tab: ${describeGroups(state.groups)}`;
      tone = 'warn';
      actions = (
        <>
          <Button hierarchy="tertiary-color" size="sm" onClick={onKeepMine}>Keep Mine</Button>
          <Button hierarchy="tertiary-color" size="sm" onClick={onReload}>Reload</Button>
        </>
      );
      break;
    case 'locked':
      text = 'This webinar has launched, so it can no longer be edited here';
      tone = 'bad';
      break;
    case 'gone':
      text = 'This draft was deleted or archived';
      tone = 'bad';
      break;
    case 'idle':
      break;
  }

  return (
    <div className="lsq-draft-status" data-tone={tone}>
      <p className="lsq-draft-status__text" role="status" aria-live="polite">{text}</p>
      {actions && <div className="lsq-cluster lsq-draft-status__actions">{actions}</div>}
    </div>
  );
}
