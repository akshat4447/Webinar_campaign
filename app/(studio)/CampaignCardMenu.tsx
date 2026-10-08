'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/ui/Icon';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import { useEscapeKey } from '@/lib/useEscapeKey';
import { archiveCampaignAction, deleteCampaignAction } from '@/lib/actions/campaigns';

export function CampaignCardMenu({ campaignId, campaignName, archived }: { campaignId: string; campaignName: string; archived: boolean }) {
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [panelPos, setPanelPos] = useState<{ top: number; right: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const router = useRouter();
  const { showToast } = useToast();

  const closeMenu = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);
  useEscapeKey(closeMenu, open);

  // The panel is fixed-positioned from the trigger so a scrolling table wrapper never clips it;
  // that means it must close when the page scrolls or resizes underneath it.
  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function dismiss() {
      setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    window.addEventListener('resize', dismiss);
    window.addEventListener('scroll', dismiss, true);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('scroll', dismiss, true);
    };
  }, [open]);

  function toggleMenu() {
    if (open) return setOpen(false);
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setPanelPos({ top: rect.bottom + 4, right: Math.max(8, window.innerWidth - rect.right) });
    setOpen(true);
  }

  async function toggleArchive() {
    setOpen(false);
    const next = !archived;
    setArchiving(true);
    try {
      await archiveCampaignAction(campaignId, next);
      // archiveCampaignAction toggles the same `archived` boolean either way,
      // so "undo" is just calling it again — Toast only supports a plain
      // message (no action button), so point at where to do that instead of
      // fabricating an inline undo control the component doesn't support.
      showToast(
        next
          ? `"${campaignName}" archived — undo from the Archived view.`
          : `"${campaignName}" restored from the archive.`
      );
      router.refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : `Failed to ${next ? 'archive' : 'unarchive'} "${campaignName}".`);
    } finally {
      setArchiving(false);
    }
  }

  async function confirmedDelete() {
    setBusy(true);
    try {
      await deleteCampaignAction(campaignId);
      setConfirmDelete(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={ref} className="lsq-home-menu">
      <button
        ref={triggerRef}
        type="button"
        className="lsq-icon-btn"
        aria-label={`Actions for ${campaignName}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggleMenu}
      >
        <Icon name="more" size={16} />
      </button>

      {open && panelPos && (
        <div className="lsq-home-menu__panel" role="menu" aria-label={`Actions for ${campaignName}`} style={{ top: panelPos.top, right: panelPos.right }}>
          <button
            type="button"
            role="menuitem"
            onClick={toggleArchive}
            disabled={archiving}
            autoFocus
            className="lsq-menu__item lsq-home-menu__item"
          >
            {archiving ? (archived ? 'Restoring…' : 'Archiving…') : archived ? 'Unarchive' : 'Archive'}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setConfirmDelete(true);
            }}
            className="lsq-menu__item lsq-home-menu__item lsq-home-menu__item--danger"
          >
            Delete
          </button>
        </div>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete "${campaignName}"?`}
          message="This permanently removes its contacts, templates, schedule, personalized copy, and activity log. This can't be undone."
          confirmLabel="Delete"
          destructive
          busy={busy}
          onConfirm={confirmedDelete}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </div>
  );
}
