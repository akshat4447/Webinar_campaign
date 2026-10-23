import {
  groupsInPatch,
  isEmptyPatch,
  mergePatches,
  shouldCreateDraft,
  subtractPatch,
  type DraftPatch,
} from '@/lib/wizardDraft';
import type { SaveDraftResult } from '@/lib/wizardDraft';

// The browser half of the wizard's autosave, with no React in it so the timing rules can be tested.
//
//  - Edits are merged into one pending patch; a pause of `debounceMs` sends it.
//  - Only one request is ever in flight. Edits made meanwhile wait for the next one.
//  - A failed request is retried after 1 s, 3 s and 10 s, then the status turns to an error with a Retry button.
//  - A conflict (another tab changed the same field) stops sending until the person chooses.
//  - Nothing is created until the patch is substantial enough (see shouldCreateDraft).

export type DraftSaveState =
  | { status: 'idle' }
  | { status: 'dirty' }
  | { status: 'saving' }
  | { status: 'saved'; at: number }
  | { status: 'retrying'; attempt: number }
  | { status: 'error'; message: string }
  | { status: 'conflict'; groups: string[] }
  | { status: 'locked'; campaignId: string }
  | { status: 'gone' };

export interface SaveRequest {
  campaignId: string | null;
  step: number;
  patch: DraftPatch;
  baseRevision: number;
  /** Per group, the revision of this client's own latest write or resolved conflict. */
  groupBases: Record<string, number>;
  createToken: string;
}

export interface DraftSaveQueueOptions {
  campaignId: string | null;
  baseRevision: number;
  step: number;
  createToken: string;
  send: (req: SaveRequest) => Promise<SaveDraftResult>;
  onCreated?: (campaignId: string) => void;
  /** Another tab changed fields this save did not touch: this one is now behind. */
  onRemoteChange?: (groups: string[]) => void;
  /** Called whenever the set of unsaved edits changes, for the on-device backup. */
  onPending?: (pending: DraftPatch, ctx: { campaignId: string | null; baseRevision: number; step: number; createToken: string }) => void;
  debounceMs?: number;
  backoffMs?: readonly number[];
  now?: () => number;
}

export const DEFAULT_DEBOUNCE_MS = 800;
export const DEFAULT_BACKOFF_MS = [1000, 3000, 10_000] as const;

export class DraftSaveQueue {
  private state: DraftSaveState = { status: 'idle' };
  private listeners = new Set<() => void>();
  private pending: DraftPatch = {};
  private inFlight: DraftPatch | null = null;
  private stepDirty = false;
  private campaignId: string | null;
  private base: number;
  private step: number;
  private conflictRevision: number | null = null;
  private conflictGroups: string[] = [];
  /** What this tab has seen of each group: advanced only by its own writes and by conflicts it resolves. */
  private groupBases: Record<string, number> = {};
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;
  private readonly debounceMs: number;
  private readonly backoff: readonly number[];
  private handlers: { onCreated?: (campaignId: string) => void; onRemoteChange?: (groups: string[]) => void } = {};

  constructor(private readonly opts: DraftSaveQueueOptions) {
    this.campaignId = opts.campaignId;
    this.base = opts.baseRevision;
    this.step = opts.step;
    this.debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.backoff = opts.backoffMs ?? DEFAULT_BACKOFF_MS;
  }

  /** Callbacks that follow the component's latest props; called in addition to the ones given at construction. */
  setHandlers(handlers: { onCreated?: (campaignId: string) => void; onRemoteChange?: (groups: string[]) => void }): void {
    this.handlers = handlers;
  }

  // --- observable state ---------------------------------------------------------------------------------

  getState = (): DraftSaveState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(next: DraftSaveState) {
    this.state = next;
    for (const l of this.listeners) l();
  }

  get currentCampaignId(): string | null { return this.campaignId; }
  get revision(): number { return this.base; }

  private get terminal(): boolean {
    return this.state.status === 'locked' || this.state.status === 'gone';
  }

  /** True while any edit has not been confirmed saved (waiting, in flight, or failed). */
  hasUnsaved(): boolean {
    return this.inFlight !== null || !isEmptyPatch(this.pending) || (this.stepDirty && this.campaignId !== null);
  }

  /** Everything not yet confirmed, in the shape the unload beacon posts. */
  unsavedRequest(): SaveRequest | null {
    const patch = this.inFlight ? mergePatches(this.inFlight, this.pending) : this.pending;
    if (isEmptyPatch(patch) && !(this.stepDirty && this.campaignId)) return null;
    if (!this.campaignId && !shouldCreateDraft(patch)) return null;
    return { campaignId: this.campaignId, step: this.step, patch, baseRevision: this.base, groupBases: { ...this.groupBases }, createToken: this.opts.createToken };
  }

  // --- input --------------------------------------------------------------------------------------------

  /** Records edits. Sent after a pause, or sooner by flush(). */
  update(patch: DraftPatch): void {
    if (this.terminal || isEmptyPatch(patch)) return;
    this.pending = mergePatches(this.pending, patch);
    this.reportPending();
    if (this.state.status === 'conflict') return; // held until the person chooses
    if (this.state.status === 'retrying') return; // the scheduled retry carries it
    if (this.state.status === 'error') {
      // The automatic attempts ran out earlier. New typing is a fresh reason to try again (the network may be back).
      this.attempt = 0;
    }
    if (this.state.status !== 'saving') this.set({ status: 'dirty' });
    this.schedule();
  }

  /**
   * The draft was created some other way (the Continue button on step one). From now on edits are saved to it
   * instead of creating a second one.
   */
  adopt(campaignId: string, revision: number): void {
    if (this.campaignId !== null) return;
    this.campaignId = campaignId;
    this.base = revision;
    if (this.stepDirty || !isEmptyPatch(this.pending)) this.schedule(0);
  }

  /** The wizard moved to another step; it is recorded with the next save (and a save is queued for it). */
  setStep(step: number): void {
    if (step === this.step) return;
    this.step = step;
    this.stepDirty = true;
    if (!this.terminal && this.state.status !== 'conflict') this.schedule(0);
  }

  private schedule(ms = this.debounceMs) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.cycle();
    }, ms);
  }

  private reportPending() {
    this.opts.onPending?.(this.unsavedPatch(), { campaignId: this.campaignId, baseRevision: this.base, step: this.step, createToken: this.opts.createToken });
  }

  private unsavedPatch(): DraftPatch {
    return this.inFlight ? mergePatches(this.inFlight, this.pending) : this.pending;
  }

  // --- sending ------------------------------------------------------------------------------------------

  private shouldSend(): boolean {
    if (this.campaignId) return !isEmptyPatch(this.pending) || this.stepDirty;
    return shouldCreateDraft(this.pending);
  }

  /** Sends whatever is waiting, once (after any request already in flight). */
  private async cycle(): Promise<void> {
    if (this.running) {
      await this.running;
      return;
    }
    if (this.terminal || this.state.status === 'conflict' || !this.shouldSend()) return;
    this.running = this.sendOnce().finally(() => {
      this.running = null;
    });
    await this.running;
  }

  private async sendOnce(): Promise<void> {
    const patch = this.pending;
    const sentStep = this.step;
    this.inFlight = patch;
    this.pending = {};
    this.set({ status: 'saving' });
    let result: SaveDraftResult;
    try {
      result = await this.opts.send({
        campaignId: this.campaignId,
        step: sentStep,
        patch,
        baseRevision: this.base,
        groupBases: { ...this.groupBases },
        createToken: this.opts.createToken,
      });
    } catch (err) {
      // Nothing was confirmed: the edits go back to waiting and a retry is scheduled.
      this.pending = mergePatches(patch, this.pending);
      this.inFlight = null;
      this.failed(err instanceof Error ? err.message : 'The save did not reach the server.');
      return;
    }
    this.inFlight = null;

    switch (result.status) {
      case 'saved': {
        const created = this.campaignId === null;
        this.campaignId = result.campaignId;
        this.attempt = 0;
        // This tab now knows the current value of every group it just wrote. Groups other tabs changed stay
        // at the older revision, so saving them later is a conflict instead of a silent overwrite.
        if (created) this.base = 1;
        for (const g of groupsInPatch(patch)) this.groupBases[g] = result.revision;
        if (result.remoteGroups.length > 0) {
          this.opts.onRemoteChange?.(result.remoteGroups);
          this.handlers.onRemoteChange?.(result.remoteGroups);
        }
        if (sentStep === this.step) this.stepDirty = false;
        this.pending = subtractPatch(this.pending, patch);
        this.reportPending();
        if (created) {
          this.opts.onCreated?.(result.campaignId);
          this.handlers.onCreated?.(result.campaignId);
        }
        if (this.hasUnsaved() && this.shouldSend()) {
          this.set({ status: 'dirty' });
          this.schedule();
        } else {
          this.set({ status: 'saved', at: (this.opts.now ?? Date.now)() });
        }
        return;
      }
      case 'skipped':
        // Not enough typed to create a draft yet: keep the edits and wait for more.
        this.pending = mergePatches(patch, this.pending);
        this.set({ status: 'idle' });
        return;
      case 'conflict':
        this.pending = mergePatches(patch, this.pending);
        this.conflictRevision = result.revision;
        this.conflictGroups = result.groups;
        this.set({ status: 'conflict', groups: result.groups });
        return;
      case 'locked':
        this.set({ status: 'locked', campaignId: result.campaignId });
        return;
      case 'gone':
        this.set({ status: 'gone' });
        return;
    }
  }

  private failed(message: string) {
    this.attempt += 1;
    if (this.attempt <= this.backoff.length) {
      this.set({ status: 'retrying', attempt: this.attempt });
      if (this.retryTimer) clearTimeout(this.retryTimer);
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        void this.cycle();
      }, this.backoff[this.attempt - 1]);
    } else {
      this.set({ status: 'error', message });
    }
  }

  /**
   * Sends everything now and resolves true once nothing is left unsaved. Used before changing step and before
   * Continue, so a failure is reported instead of silently moving on.
   */
  async flush(): Promise<boolean> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    for (let i = 0; i < 5; i += 1) {
      if (this.terminal || this.state.status === 'conflict') return false;
      if (this.state.status === 'error') {
        this.attempt = 0;
      }
      await this.cycle();
      if (!this.hasUnsaved() || !this.shouldSend()) return !this.hasUnsavedRequired();
      if (this.state.status === 'error' || this.state.status === 'retrying') return false;
    }
    return !this.hasUnsavedRequired();
  }

  /** Edits that are waiting but cannot be sent yet (too little typed to create a draft) do not block moving on. */
  private hasUnsavedRequired(): boolean {
    return this.inFlight !== null || (this.campaignId !== null && (!isEmptyPatch(this.pending) || this.stepDirty));
  }

  /** The person pressed Retry after the automatic attempts ran out. */
  retry(): Promise<boolean> {
    this.attempt = 0;
    return this.flush();
  }

  /** Conflict: keep this tab's version and overwrite the other tab's change. */
  keepMine(): Promise<boolean> {
    // Only the clashing groups are taken as seen; anything else another tab changed stays unseen.
    if (this.conflictRevision !== null) for (const g of this.conflictGroups) this.groupBases[g] = this.conflictRevision;
    this.conflictRevision = null;
    this.conflictGroups = [];
    this.set({ status: 'dirty' });
    return this.flush();
  }

  /** Stops timers when the wizard unmounts. Pending edits are flushed by the caller first. */
  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.timer = null;
    this.retryTimer = null;
  }
}
