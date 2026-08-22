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
      style={{ position: 'absolute', top: 10, right: 10, zIndex: 5 }}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <button
        type="button"
        aria-label="Campaign actions"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: 26,
          height: 26,
          border: 'none',
          borderRadius: 'var(--radius-sm)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          background: open ? 'var(--n20)' : 'rgba(255,255,255,0.85)',
          color: 'var(--n70)',
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
            padding: 4,
            minWidth: 140,
          }}
        >
          <button
            type="button"
            onClick={toggleArchive}
            style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 'var(--radius-sm)', border: 'none', background: 'transparent', fontSize: 12.5, fontWeight: 600, color: 'var(--n80)', cursor: 'pointer' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--n10)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            {archived ? 'Unarchive' : 'Archive'}
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setConfirmDelete(true);
            }}
            style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 'var(--radius-sm)', border: 'none', background: 'transparent', fontSize: 12.5, fontWeight: 600, color: 'var(--danger-500)', cursor: 'pointer' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--n10)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
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
