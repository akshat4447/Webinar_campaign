'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/ui/Icon';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { archiveCampaignAction, deleteCampaignAction } from '@/lib/actions/campaigns';

export function CampaignCardMenu({ campaignId, campaignName, archived }: { campaignId: string; campaignName: string; archived: boolean }) {
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  async function toggleArchive() {
    setOpen(false);
    await archiveCampaignAction(campaignId, !archived);
    router.refresh();
  }

  async function confirmedDelete() {
    setBusy(true);
    await deleteCampaignAction(campaignId);
    setBusy(false);
    setConfirmDelete(false);
    router.refresh();
  }

  return (
    <div
      ref={ref}
      className="lsq-reveal"
      data-open={open || confirmDelete ? 'true' : 'false'}
      // Positioned by the card's own header row rather than absolutely: the
      // card carries its own CTAs now, so it is no longer one big anchor that
      // this had to sit on top of.
      style={{ position: 'relative', flexShrink: 0 }}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        aria-label="Campaign actions"
        onClick={() => setOpen((v) => !v)}
        className="lsq-btn lsq-btn--tertiary"
        style={{
          width: 26,
          height: 26,
          padding: 0,
          borderRadius: 'var(--radius-sm)',
          background: open ? 'var(--n20)' : 'var(--surface-card)',
          color: 'var(--text-secondary)',
        }}
      >
        <Icon name="more" size={16} />
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 30,
            right: 0,
            background: '#fff',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-panel)',
            padding: 'var(--space-4)',
            minWidth: 140,
          }}
        >
          <button
            type="button"
            onClick={toggleArchive}
            className="lsq-row"
            style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 'var(--radius-sm)', border: 'none', background: 'transparent', fontSize: 'var(--fs-label-1)', fontWeight: 'var(--fw-semibold)', color: 'var(--text-primary)' }}
          >
            {archived ? 'Unarchive' : 'Archive'}
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setConfirmDelete(true);
            }}
            className="lsq-row"
            style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 'var(--radius-sm)', border: 'none', background: 'transparent', fontSize: 'var(--fs-label-1)', fontWeight: 'var(--fw-semibold)', color: 'var(--text-danger)' }}
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
