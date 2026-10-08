'use client';

import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { workspaceTabs } from '@/lib/demo-data';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { hasUnsavedChanges, getUnsavedChangesMessage, subscribeUnsavedChanges } from '@/lib/unsavedChangesGuard';

export function WorkspaceTabs({
  campaignId,
  completedTabs = {},
}: {
  campaignId: string;
  completedTabs?: Record<string, boolean>;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const active = pathname.split('/').pop();

  // Mirrors the module-singleton guard into local state, both to re-render
  // this component when it changes (for the dot below) and to read it — the
  // guard itself lives outside React because the editor publishing it (e.g.
  // CadenceGroups) and this tab switcher reading it are in different branches
  // of the tree, both under a layout that doesn't otherwise share state
  // between them.
  const [dirty, setDirty] = useState(false);
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  useEffect(() => subscribeUnsavedChanges((isDirty) => setDirty(isDirty)), []);

  function handleTabClick(e: React.MouseEvent, href: string) {
    if (href === pathname) return;
    if (!hasUnsavedChanges()) return;
    e.preventDefault();
    setPendingHref(href);
  }

  return (
    <>
      {pendingHref && (
        <ConfirmDialog
          title="Leave this tab?"
          message={getUnsavedChangesMessage()}
          confirmLabel="Discard and leave"
          destructive
          onConfirm={() => {
            const href = pendingHref;
            setPendingHref(null);
            setDirty(false);
            router.push(href);
          }}
          onClose={() => setPendingHref(null)}
        />
      )}
      <nav className="lsq-res-tabbar" aria-label="Campaign sections">
        <div className="lsq-tabs">
          {workspaceTabs.map((tab) => {
            const isActive = tab.id === active;
            const href = `/campaigns/${campaignId}/${tab.id}`;
            // Only some stages have an unambiguous "done" signal — see the layout.
            // A dot rather than a tick keeps the tab row quiet; the point is to
            // show progress at a glance, not to decorate every label.
            const isComplete = !isActive && completedTabs[tab.id];
            return (
              <Link
                key={tab.id}
                href={href}
                onClick={(e) => handleTabClick(e, href)}
                className="lsq-tab"
                data-active={isActive ? 'true' : 'false'}
                aria-current={isActive ? 'page' : undefined}
              >
                {tab.label}
                {isActive && dirty && (
                  <span
                    role="img"
                    aria-label="unsaved changes"
                    title="Unsaved changes on this tab"
                    className="lsq-tab__dot lsq-tab__dot--warn"
                  />
                )}
                {isComplete && <span role="img" aria-label="complete" className="lsq-tab__dot" />}
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
