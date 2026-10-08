'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { CampaignDetailsForm } from '../setup/CampaignDetailsForm';
import { getSetupEditImpactAction, resetCampaignForEditAction, type SetupEditImpact } from '@/lib/actions/setup';
import { impactMessage, hasSetupEditImpact } from '@/lib/setupEditImpact';
import type { Campaign, Speaker } from '@/lib/generated/prisma/client';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

export function EditSetupModal({
  campaign,
  serverNow,
  isOpen,
  onClose,
}: {
  campaign: Campaign & { speakers?: Speaker[] };
  serverNow: number;
  isOpen: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [impact, setImpact] = useState<SetupEditImpact | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    if (isOpen && impact === null) {
      void getSetupEditImpactAction(campaign.id).then(setImpact);
    }
  }, [isOpen, impact, campaign.id]);

  async function handleResetAll() {
    setResetting(true);
    try {
      await resetCampaignForEditAction(campaign.id);
      setShowResetConfirm(false);
      onClose();
      router.refresh();
    } finally {
      setResetting(false);
    }
  }

  if (!isOpen) return null;

  return (
    <>
      <Modal
        isOpen={isOpen}
        // While the confirmation is up, Escape and the backdrop belong to it, not to this dialog.
        onClose={() => {
          if (!showResetConfirm) onClose();
        }}
        title="Edit Webinar Setup"
        subtitle="Update title, speakers, schedule and links. Contacts, scores and approved drafts are kept."
        size="lg"
        footer={
          <>
            {impact && hasSetupEditImpact(impact) && (
              <span className="lsq-ov-foot-start">
                <Button hierarchy="destructive-outline" size="sm" onClick={() => setShowResetConfirm(true)}>
                  Clear Audience Scores &amp; Message Drafts
                </Button>
              </span>
            )}
            <Button
              onClick={() => {
                onClose();
                router.refresh();
              }}
            >
              Done Editing
            </Button>
          </>
        }
      >
        <CampaignDetailsForm
          campaign={campaign}
          serverNow={serverNow}
          onDone={() => {
            onClose();
            router.refresh();
          }}
        />
      </Modal>

      {showResetConfirm && impact && (
        <ConfirmDialog
          title="Clear Audience Scores & Drafts?"
          message={impactMessage(impact)}
          confirmLabel={resetting ? 'Resetting…' : 'Clear All Downstream Work'}
          destructive
          busy={resetting}
          onConfirm={handleResetAll}
          onClose={() => setShowResetConfirm(false)}
        />
      )}
    </>
  );
}
