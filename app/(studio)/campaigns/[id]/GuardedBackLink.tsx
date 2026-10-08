'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { hasUnsavedChanges, getUnsavedChangesMessage } from '@/lib/unsavedChangesGuard';

/** The "All webinars" link back out of a campaign's workspace — same
 *  unsaved-changes guard as WorkspaceTabs, since leaving the workspace
 *  entirely discards an in-progress cadence edit exactly as switching tabs
 *  does. See lib/unsavedChangesGuard.ts. */
export function GuardedBackLink() {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      {confirming && (
        <ConfirmDialog
          title="Leave this webinar?"
          message={getUnsavedChangesMessage()}
          confirmLabel="Discard and leave"
          destructive
          onConfirm={() => {
            setConfirming(false);
            router.push('/');
          }}
          onClose={() => setConfirming(false)}
        />
      )}
      <Link
        href="/"
        className="lsq-res-back"
        onClick={(e) => {
          if (hasUnsavedChanges()) {
            e.preventDefault();
            setConfirming(true);
          }
        }}
      >
        <Icon name="arrow-left" size={14} />
        All webinars
      </Link>
    </>
  );
}
