'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Icon } from '@/components/ui/Icon';
import { wizardResumeHref, wizardStepLabel } from '@/lib/wizardDraft';

// Goes to the wizard rather than creating a blank campaign on click. Creating
// first meant every mis-click left an "Untitled webinar" draft behind; the
// wizard only writes a row once there is a title to write.
//
// When a draft was worked on recently, starting another is probably a slip: ask whether to continue that one.
export function NewCampaignButton({ recentDraft }: { recentDraft?: { id: string; name: string; wizardStep: number } | null }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);

  return (
    <>
      <Button icon={<Icon name="plus" size={16} />} onClick={() => (recentDraft ? setAsking(true) : router.push('/campaigns/new'))}>
        New Webinar
      </Button>
      {asking && recentDraft && (
        <ConfirmDialog
          title="Draft In Progress"
          message={`${recentDraft.name} is still being set up (${wizardStepLabel(recentDraft.wizardStep)}). Continue it, or start a new webinar.`}
          confirmLabel="Continue Draft"
          secondaryAction={{ label: 'Start New', onClick: () => router.push('/campaigns/new') }}
          onConfirm={() => router.push(wizardResumeHref(recentDraft))}
          onClose={() => setAsking(false)}
        />
      )}
    </>
  );
}
