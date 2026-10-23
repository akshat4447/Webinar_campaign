'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { saveWizardDraftAction } from '@/lib/actions/wizardDraft';
import { DraftSaveQueue, type DraftSaveState, type SaveRequest } from '@/lib/draftSaveQueue';
import { clearMirror, writeMirror } from '@/lib/wizardDraftMirror';
import { setUnsavedChanges } from '@/lib/unsavedChangesGuard';
import type { SaveDraftResult } from '@/lib/wizardDraft';

const IDLE: DraftSaveState = { status: 'idle' };

const LEAVE_MESSAGE = 'Some changes have not been saved to the server yet. Leave this page anyway?';

/** Posts what is still unsaved in a way that survives the page unloading (a server action would be cancelled). */
function postOnUnload(req: SaveRequest) {
  const body = JSON.stringify(req);
  try {
    void fetch('/api/wizard/draft', { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'application/json' } }).catch(() => undefined);
  } catch {
    try {
      navigator.sendBeacon?.('/api/wizard/draft', new Blob([body], { type: 'application/json' }));
    } catch {
      /* nothing more can be done while unloading */
    }
  }
}

/**
 * Autosave for the creation wizard. The timing and retry rules live in DraftSaveQueue; this wires it to the
 * server action, the page lifecycle (hide, unload, unmount), the on-device backup and the leave-page guard.
 */
export function useDraftAutosave(opts: {
  campaignId: string | null;
  baseRevision: number;
  step: number;
  onCreated: (campaignId: string) => void;
  onRemoteChange?: (groups: string[]) => void;
}) {
  const [queue] = useState(
    () =>
      new DraftSaveQueue({
        campaignId: opts.campaignId,
        baseRevision: opts.baseRevision,
        step: opts.step,
        createToken: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `t${Date.now()}${Math.random().toString(36).slice(2)}`,
        send: (req): Promise<SaveDraftResult> => saveWizardDraftAction(req),
        // The backup kept under "new" belongs to a draft that now has a real id.
        onCreated: () => clearMirror(null),
        onPending: (patch, ctx) => writeMirror(ctx.campaignId, { patch, baseRevision: ctx.baseRevision, step: ctx.step, ...(ctx.campaignId ? {} : { createToken: ctx.createToken }) }),
      }),
  );

  // Callbacks follow the latest props without recreating the queue.
  useEffect(() => {
    queue.setHandlers({ onCreated: opts.onCreated, onRemoteChange: opts.onRemoteChange });
    // After the wizard unmounts a late "created" must not navigate: the person has already gone elsewhere.
    return () => queue.setHandlers({});
  });

  const state = useSyncExternalStore(queue.subscribe, queue.getState, () => IDLE);

  useEffect(() => {
    queue.setStep(opts.step);
  }, [queue, opts.step]);

  // A draft made by the Continue button arrives as a prop; later edits must go to it, not create another.
  useEffect(() => {
    if (opts.campaignId) queue.adopt(opts.campaignId, opts.baseRevision);
  }, [queue, opts.campaignId, opts.baseRevision]);

  useEffect(() => {
    const onPageHide = () => {
      const req = queue.unsavedRequest();
      if (req) postOnUnload(req);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') void queue.flush();
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      // A pause in typing is covered by the pagehide post. Only a save that is known to be failing, or that
      // clashes with another tab, is worth interrupting the person for.
      const s = queue.getState().status;
      if (queue.hasUnsaved() && (s === 'error' || s === 'retrying' || s === 'conflict')) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('beforeunload', onBeforeUnload);
      // Leaving through the app (the sidebar, a link) unmounts the wizard: send what is waiting first.
      queue.stop();
      void queue.flush();
    };
  }, [queue]);

  // The in-app guard other pages read: only a save that is failing counts as "unsaved".
  useEffect(() => {
    const failing = state.status === 'error' || state.status === 'retrying' || state.status === 'conflict';
    setUnsavedChanges(failing, LEAVE_MESSAGE);
    return () => setUnsavedChanges(false);
  }, [state.status]);

  return { queue, state };
}
