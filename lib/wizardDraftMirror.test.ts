import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { clearMirror, readMirror, writeMirror } from './wizardDraftMirror';

// No browser in the unit environment: a small in-memory Storage stands in for storage.
function fakeStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    get length() { return m.size; },
  };
}

describe('wizard draft mirror', () => {
  let storage: ReturnType<typeof fakeStorage>;
  beforeEach(() => {
    storage = fakeStorage();
    vi.stubGlobal('window', { localStorage: storage });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('round-trips unsaved edits per draft', () => {
    writeMirror('c1', { patch: { title: 'Hello' }, baseRevision: 3, step: 1 }, 111);
    expect(readMirror('c1')).toEqual({ patch: { title: 'Hello' }, baseRevision: 3, step: 1, savedAt: 111 });
    expect(readMirror('c2')).toBeNull();
    expect(readMirror(null)).toBeNull();
  });

  it('removes the backup when nothing is waiting any more', () => {
    writeMirror('c1', { patch: { title: 'Hello' }, baseRevision: 0, step: 0 });
    writeMirror('c1', { patch: {}, baseRevision: 1, step: 0 });
    expect(readMirror('c1')).toBeNull();
    expect(storage.length).toBe(0);
  });

  it('keeps a not-yet-created draft under its own key', () => {
    writeMirror(null, { patch: { title: 'Draft' }, baseRevision: 0, step: 0 });
    expect(storage.getItem('wizard-draft:new')).toBeTruthy();
    clearMirror(null);
    expect(readMirror(null)).toBeNull();
  });

  it('treats stored data as untrusted input', () => {
    storage.setItem('wizard-draft:c1', JSON.stringify({ patch: { title: 'ok', status: 'live', cadenceStatus: 'running' }, baseRevision: 'x' }));
    expect(readMirror('c1')?.patch).toEqual({ title: 'ok' });
    storage.setItem('wizard-draft:c1', 'not json');
    expect(readMirror('c1')).toBeNull();
  });

  it('never throws when storage is unavailable', () => {
    vi.stubGlobal('window', { get localStorage(): never { throw new Error('blocked'); } });
    expect(() => writeMirror('c1', { patch: { title: 'x' }, baseRevision: 0, step: 0 })).not.toThrow();
    expect(readMirror('c1')).toBeNull();
    expect(() => clearMirror('c1')).not.toThrow();
  });
});
