'use client';

import { useEffect, useRef } from 'react';

const dialogs: HTMLElement[] = [];

/**
 * Moves focus into a dialog when it opens and restores it to whatever had
 * focus before (almost always the button that triggered it) when it closes —
 * the other half of accessible modal behavior alongside Escape-to-close
 * (`useEscapeKey`). Without this, opening any of this app's modals left focus
 * sitting on the trigger button behind the now-visible backdrop, so a
 * keyboard or screen-reader user had no way to tell the dialog was there,
 * let alone reach its fields.
 *
 * Focuses the dialog container itself (via the returned ref — put it on the
 * outermost dialog `<div>` together with `tabIndex={-1}`) rather than
 * guessing which inner control should get focus first: that varies per
 * dialog, and guessing wrong risks landing focus on a destructive default
 * action.
 */
export function useModalFocus<T extends HTMLElement>(active = true) {
  const ref = useRef<T | null>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;
    const dialog = ref.current;
    if (!dialog) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    dialogs.push(dialog);
    const background: { element: HTMLElement; inert: boolean }[] = [];
    let branch: HTMLElement = dialog;
    while (branch.parentElement) {
      for (const sibling of branch.parentElement.children) {
        if (sibling !== branch && sibling instanceof HTMLElement && !['SCRIPT', 'STYLE', 'LINK'].includes(sibling.tagName)) {
          background.push({ element: sibling, inert: sibling.inert });
          sibling.inert = true;
        }
      }
      branch = branch.parentElement;
    }
    dialog.focus();
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter(el => el.getClientRects().length > 0);
    const onKey = (event: KeyboardEvent) => {
      if (dialogs.at(-1) !== dialog || event.key !== 'Tab') return;
      const elements = focusable();
      const first = elements[0];
      const last = elements.at(-1);
      if (!first || !last) { event.preventDefault(); dialog.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) { event.preventDefault(); first.focus(); }
    };
    const onFocus = (event: FocusEvent) => {
      if (dialogs.at(-1) === dialog && !dialog.contains(event.target as Node)) dialog.focus();
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('focusin', onFocus, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('focusin', onFocus, true);
      const index = dialogs.indexOf(dialog);
      if (index >= 0) dialogs.splice(index, 1);
      for (const { element, inert } of background) element.inert = inert;
      previouslyFocused.current?.focus?.();
    };
  }, [active]);

  return ref;
}
