import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DraftSaveQueue, type SaveRequest } from './draftSaveQueue';
import type { SaveDraftResult } from './wizardDraft';

type Send = (req: SaveRequest) => Promise<SaveDraftResult>;

function makeQueue(send: Send, over: Partial<ConstructorParameters<typeof DraftSaveQueue>[0]> = {}) {
  const created: string[] = [];
  const remote: string[][] = [];
  const pendings: unknown[] = [];
  const q = new DraftSaveQueue({
    campaignId: 'c1', baseRevision: 0, step: 0, createToken: 'tok', send,
    onCreated: (id) => created.push(id), onRemoteChange: (g) => remote.push(g), onPending: (p) => pendings.push(p),
    now: () => 1000, ...over,
  });
  return { q, created, remote, pendings };
}

const saved = (revision: number, extra: Partial<Extract<SaveDraftResult, { status: 'saved' }>> = {}): SaveDraftResult =>
  ({ status: 'saved', campaignId: 'c1', revision, created: false, remoteGroups: [], ...extra });

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('DraftSaveQueue', () => {
  it('waits for a pause in typing, then sends one merged patch', async () => {
    const send = vi.fn<Send>(async () => saved(1));
    const { q } = makeQueue(send);
    q.update({ title: 'a' });
    q.update({ title: 'ab' });
    q.update({ description: 'x' });
    expect(q.getState().status).toBe('dirty');
    await vi.advanceTimersByTimeAsync(799);
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].patch).toEqual({ title: 'ab', description: 'x' });
    expect(send.mock.calls[0][0].baseRevision).toBe(0);
    expect(q.getState()).toEqual({ status: 'saved', at: 1000 });
    expect(q.hasUnsaved()).toBe(false);
  });

  it('keeps one request in flight and carries edits made meanwhile into the next', async () => {
    let release!: (r: SaveDraftResult) => void;
    const send = vi.fn<Send>()
      .mockImplementationOnce(() => new Promise((r) => { release = r; }))
      .mockImplementation(async () => saved(2));
    const { q } = makeQueue(send);
    q.update({ title: 'one' });
    await vi.advanceTimersByTimeAsync(800);
    expect(send).toHaveBeenCalledTimes(1);
    q.update({ title: 'one two' });
    await vi.advanceTimersByTimeAsync(2000);
    expect(send).toHaveBeenCalledTimes(1); // still waiting on the first
    release(saved(1));
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(800);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0].patch).toEqual({ title: 'one two' });
    expect(send.mock.calls[1][0].groupBases).toEqual({ title: 1 });
    expect(q.hasUnsaved()).toBe(false);
  });

  it('retries after 1s, 3s and 10s, then shows an error with a manual retry', async () => {
    const send = vi.fn<Send>(async () => { throw new Error('offline'); });
    const { q } = makeQueue(send);
    q.update({ title: 'abc' });
    await vi.advanceTimersByTimeAsync(800);
    expect(send).toHaveBeenCalledTimes(1);
    expect(q.getState()).toEqual({ status: 'retrying', attempt: 1 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(send).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3000);
    expect(send).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(send).toHaveBeenCalledTimes(4);
    expect(q.getState()).toEqual({ status: 'error', message: 'offline' });
    expect(q.hasUnsaved()).toBe(true); // the edit is still held, not lost

    send.mockImplementation(async () => saved(1));
    expect(await q.retry()).toBe(true);
    expect(send.mock.calls[4][0].patch).toEqual({ title: 'abc' });
    expect(q.getState().status).toBe('saved');
  });

  it('flush sends immediately and resolves true; false when the save fails', async () => {
    const send = vi.fn<Send>(async () => saved(1));
    const { q } = makeQueue(send);
    q.update({ title: 'abc' });
    expect(await q.flush()).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);

    send.mockImplementation(async () => { throw new Error('down'); });
    q.update({ title: 'abcd' });
    expect(await q.flush()).toBe(false);
    expect(q.hasUnsaved()).toBe(true);
  });

  it('records a step change even when no field changed', async () => {
    const send = vi.fn<Send>(async () => saved(1));
    const { q } = makeQueue(send);
    q.setStep(2);
    expect(await q.flush()).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatchObject({ step: 2, patch: {} });
    await q.flush();
    expect(send).toHaveBeenCalledTimes(1); // nothing new to say
  });

  it('creates nothing until enough is typed, then creates with a stable token', async () => {
    const send = vi.fn<Send>(async (req) => saved(1, { campaignId: 'new1', created: req.campaignId === null }));
    const { q, created } = makeQueue(send, { campaignId: null });
    q.update({ title: 'ab' });
    await vi.advanceTimersByTimeAsync(2000);
    expect(send).not.toHaveBeenCalled();
    expect(await q.flush()).toBe(true); // nothing to persist yet is not a failure
    q.update({ title: 'abc' });
    await vi.advanceTimersByTimeAsync(800);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatchObject({ campaignId: null, createToken: 'tok', patch: { title: 'abc' } });
    expect(created).toEqual(['new1']);
    expect(q.currentCampaignId).toBe('new1');
    q.update({ title: 'abcd' });
    await vi.advanceTimersByTimeAsync(800);
    expect(send.mock.calls[1][0].campaignId).toBe('new1');
  });

  it('stops on a conflict, keeps the edit, and keepMine resends against the newer revision', async () => {
    const send = vi.fn<Send>()
      .mockResolvedValueOnce({ status: 'conflict', campaignId: 'c1', revision: 7, groups: ['title'] })
      .mockResolvedValue(saved(8));
    const { q } = makeQueue(send);
    q.update({ title: 'mine' });
    await vi.advanceTimersByTimeAsync(800);
    expect(q.getState()).toEqual({ status: 'conflict', groups: ['title'] });
    q.update({ description: 'more' });
    await vi.advanceTimersByTimeAsync(5000);
    expect(send).toHaveBeenCalledTimes(1); // nothing is sent while the conflict stands
    expect(await q.keepMine()).toBe(true);
    // Only the clashing group counts as seen; the base the draft was loaded at is untouched.
    expect(send.mock.calls[1][0].baseRevision).toBe(0);
    expect(send.mock.calls[1][0].groupBases).toEqual({ title: 7 });
    expect(send.mock.calls[1][0].patch).toEqual({ title: 'mine', description: 'more' });
  });

  it('learns the revision of its own writes per group, and stays behind on groups another tab changed', async () => {
    const send = vi.fn<Send>()
      .mockResolvedValueOnce(saved(6, { remoteGroups: ['title'] })) // another tab changed the title meanwhile
      .mockResolvedValue(saved(7));
    const { q, remote } = makeQueue(send, { baseRevision: 5 });
    q.update({ description: 'a' });
    await vi.advanceTimersByTimeAsync(800);
    expect(remote).toEqual([['title']]);
    q.update({ description: 'ab' });
    await vi.advanceTimersByTimeAsync(800);
    // The description is this tab's own (written at 6): saving it again must not look like a clash with itself.
    expect(send.mock.calls[1][0].groupBases).toEqual({ description: 6 });
    expect(send.mock.calls[1][0].baseRevision).toBe(5);
    // The title was never seen here, so it is still at the load-time revision.
    q.update({ title: 'mine' });
    await vi.advanceTimersByTimeAsync(800);
    expect(send.mock.calls[2][0].groupBases).toEqual({ description: 7 });
    expect(send.mock.calls[2][0].baseRevision).toBe(5);
  });

  it('goes terminal when the webinar has launched or is gone, and stops sending', async () => {
    const send = vi.fn<Send>(async () => ({ status: 'locked', campaignId: 'c1' }));
    const { q } = makeQueue(send);
    q.update({ title: 'abc' });
    await vi.advanceTimersByTimeAsync(800);
    expect(q.getState()).toEqual({ status: 'locked', campaignId: 'c1' });
    q.update({ title: 'abcd' });
    await vi.advanceTimersByTimeAsync(5000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(await q.flush()).toBe(false);
  });

  it('reports unsaved edits for the unload beacon, including what is still in flight', async () => {
    let release!: (r: SaveDraftResult) => void;
    const send = vi.fn<Send>(() => new Promise((r) => { release = r; }));
    const { q } = makeQueue(send);
    expect(q.unsavedRequest()).toBeNull();
    q.update({ title: 'abc' });
    await vi.advanceTimersByTimeAsync(800);
    q.update({ description: 'late' });
    expect(q.unsavedRequest()).toMatchObject({ campaignId: 'c1', patch: { title: 'abc', description: 'late' } });
    release(saved(1));
    await vi.advanceTimersByTimeAsync(0);
  });

  it('mirrors the unsaved set to the on-device backup as it changes', async () => {
    const send = vi.fn<Send>(async () => saved(1));
    const { q, pendings } = makeQueue(send);
    q.update({ title: 'abc' });
    expect(pendings.at(-1)).toEqual({ title: 'abc' });
    await q.flush();
    expect(pendings.at(-1)).toEqual({});
  });
});

describe('DraftSaveQueue adopting a draft made elsewhere', () => {
  it('saves to the adopted draft instead of creating a second one', async () => {
    const send = vi.fn<Send>(async () => saved(4, { campaignId: 'c9' }));
    const { q } = makeQueue(send, { campaignId: null });
    q.setStep(1); // Continue on step one created the draft and moved on
    q.adopt('c9', 3);
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatchObject({ campaignId: 'c9', baseRevision: 3, step: 1 });
    q.adopt('other', 0); // a draft is only ever adopted once
    expect(q.currentCampaignId).toBe('c9');
  });
});

describe('DraftSaveQueue after the automatic retries ran out', () => {
  it('tries again when the person keeps typing, without needing the Retry button', async () => {
    const send = vi.fn<Send>(async () => { throw new Error('offline'); });
    const { q } = makeQueue(send);
    q.update({ title: 'abc' });
    await vi.advanceTimersByTimeAsync(800 + 1000 + 3000 + 10_000);
    expect(q.getState().status).toBe('error');
    const calls = send.mock.calls.length;
    send.mockImplementation(async () => saved(1));
    q.update({ title: 'abcd' });
    await vi.advanceTimersByTimeAsync(800);
    expect(send.mock.calls.length).toBe(calls + 1);
    expect(send.mock.calls.at(-1)![0].patch).toEqual({ title: 'abcd' });
    expect(q.getState().status).toBe('saved');
  });
});
