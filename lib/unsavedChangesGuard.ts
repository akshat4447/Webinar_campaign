'use client';

/**
 * A tiny cross-component signal for "don't navigate away from this tab
 * without asking" — module-singleton state (shared by every client component
 * in the same page load, no context/provider needed) rather than React state,
 * because the two ends of this live in different parts of the component tree:
 * the editor that knows whether it's dirty (e.g. CadenceGroups, deep inside
 * one workspace tab's page) and the tab switcher that needs to know before it
 * navigates (WorkspaceTabs, rendered by the shared layout above every tab).
 *
 * Client-side route changes (clicking a `<Link>` to another workspace tab)
 * don't fire `beforeunload` — that only covers a full page unload/reload —
 * so an editor with unsaved edits (cadence timing, a toggle) needs this to
 * warn before an in-app tab switch discards them.
 */

type Listener = (dirty: boolean, message: string) => void;

let dirty = false;
let message = 'You have unsaved changes. Leave this page and discard them?';
const listeners = new Set<Listener>();

export function setUnsavedChanges(isDirty: boolean, msg?: string): void {
  dirty = isDirty;
  if (msg) message = msg;
  for (const l of listeners) l(dirty, message);
}

export function hasUnsavedChanges(): boolean {
  return dirty;
}

export function getUnsavedChangesMessage(): string {
  return message;
}

export function subscribeUnsavedChanges(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
