'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import { isCampaignCompleted } from '@/lib/campaignLifecycle';
import { markCampaignCompletedAction, reopenCampaignAction } from '@/lib/actions/lifecycle';
import { syncZoomAttendanceAction } from '@/lib/actions/attendance';
import { ImportAttendanceModal } from './ImportAttendanceModal';
import { PostEventClient } from '../post-event/PostEventClient';
import type { Campaign } from '@/lib/generated/prisma/client';
import type { AccountEngagementRow, PostEventStats } from '@/lib/postEvent';

export function ResultsClient({
  campaignId,
  campaign,
  stats,
  accounts,
}: {
  campaignId: string;
  campaign: Campaign;
  stats: PostEventStats;
  accounts: AccountEngagementRow[];
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [syncingZoom, setSyncingZoom] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);

  const completed = isCampaignCompleted(campaign.status);

  async function handleSyncZoom() {
    setSyncingZoom(true);
    try {
      const res = await syncZoomAttendanceAction(campaignId);
      if (res.ok) {
        showToast(`Zoom attendance synced: ${res.attendedCount ?? 0} attended, ${res.noShowCount ?? 0} no-show.`);
        router.refresh();
      } else {
        showToast(res.error || 'Failed to sync Zoom attendance.');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Zoom sync failed.');
    } finally {
      setSyncingZoom(false);
    }
  }

  async function confirmMarkCompleted() {
    setBusy(true);
    try {
      await markCampaignCompletedAction(campaign.id);
      setConfirming(false);
      showToast('Webinar marked completed. Messaging, audience and cadence are now read-only.');
      router.refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to mark webinar completed.');
    } finally {
      setBusy(false);
    }
  }

  async function confirmReopen() {
    setBusy(true);
    try {
      await reopenCampaignAction(campaign.id);
      setConfirming(false);
      showToast('Webinar reopened. It is no longer marked completed.');
      router.refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to reopen webinar.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="lsq-card" aria-labelledby="res-outcomes">
        <div className="lsq-card__header">
          <div>
            <h2 className="lsq-card__title" id="res-outcomes">Post-Webinar Outcomes &amp; SDR Follow-Up</h2>
            <p className="lsq-card__sub">
              Attendance imported from Zoom or a CSV, recording follow-up tracks, and high-intent accounts for SDR handoff.
            </p>
          </div>
          {completed && <Badge color="success" text="Webinar completed" dot />}
        </div>
        <div className="lsq-card__body lsq-toolbar">
          <div className="lsq-toolbar__group">
            <Button hierarchy="secondary" size="sm" icon={<Icon name="upload" size={14} />} onClick={() => setShowImportModal(true)}>
              Import Attendance CSV
            </Button>
            {campaign.zoomMeetingId && (
              <Button
                hierarchy="secondary"
                size="sm"
                icon={<Icon name="refresh" size={14} />}
                onClick={handleSyncZoom}
                loading={syncingZoom}
              >
                {syncingZoom ? 'Syncing Zoom' : 'Sync Zoom Now'}
              </Button>
            )}
            <Link href={`/linkedin?event=${campaignId}`} className="lsq-btn lsq-btn--sm lsq-btn--secondary">
              <Icon name="linkedin" size={14} />
              LinkedIn Outreach Hub
            </Link>
          </div>
          <div className="lsq-toolbar__group">
            {completed ? (
              <Button hierarchy="secondary" size="sm" icon={<Icon name="undo" size={14} />} onClick={() => setConfirming(true)}>
                Reopen Webinar
              </Button>
            ) : (
              <Button hierarchy="primary" size="sm" icon={<Icon name="check-circle" size={14} />} onClick={() => setConfirming(true)}>
                Mark Webinar as Completed
              </Button>
            )}
          </div>
        </div>
      </section>

      {showImportModal && (
        <ImportAttendanceModal
          campaignId={campaignId}
          onClose={() => setShowImportModal(false)}
          onSuccess={() => router.refresh()}
        />
      )}

      {confirming && !completed && (
        <ConfirmDialog
          title="Mark Webinar as Completed?"
          message="This finalizes this webinar. Messaging, audience and cadence switch to a locked, read-only view. The webinar can be reopened later if this was done by mistake."
          confirmLabel="Mark as Completed"
          destructive={false}
          busy={busy}
          onConfirm={confirmMarkCompleted}
          onClose={() => setConfirming(false)}
        />
      )}

      {confirming && completed && (
        <ConfirmDialog
          title="Reopen This Webinar?"
          message="This moves the campaign back to live and unlocks messaging, audience and cadence for editing again. Only do this if it was marked completed by mistake, or if outreach is resuming (for example a rescheduled session)."
          confirmLabel="Reopen"
          destructive
          busy={busy}
          onConfirm={confirmReopen}
          onClose={() => setConfirming(false)}
        />
      )}

      <PostEventClient
        campaignId={campaignId}
        stats={stats}
        accounts={accounts}
      />
    </>
  );
}
