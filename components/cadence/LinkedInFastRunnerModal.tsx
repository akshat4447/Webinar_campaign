'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { markLinkedInSendAction } from '@/lib/actions/linkedin';
import { profileUrl, peopleSearchUrl } from '@/lib/linkedinUrl';
import type { LinkedInQueueItem } from '@/lib/linkedinQueueItem';

interface LinkedInFastRunnerModalProps {
  campaignId: string;
  campaignTitle?: string;
  queue: LinkedInQueueItem[];
  initialProgress: Record<string, string>;
  isOpen: boolean;
  onClose: () => void;
  onProgressUpdate?: (updatedProgress: Record<string, string>) => void;
}

export function LinkedInFastRunnerModal({
  campaignId,
  campaignTitle = 'Webinar Outreach',
  queue,
  initialProgress,
  isOpen,
  onClose,
  onProgressUpdate,
}: LinkedInFastRunnerModalProps) {
  const { showToast } = useToast();
  const [progress, setProgress] = useState<Record<string, string>>(initialProgress);
  const [index, setIndex] = useState(0);
  const [filterPendingOnly, setFilterPendingOnly] = useState(true);
  const [copiedFlash, setCopiedFlash] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [hasOpenedCurrent, setHasOpenedCurrent] = useState(false);
  const [oneClickFastMode, setOneClickFastMode] = useState(false);

  const [prevInitialProgress, setPrevInitialProgress] = useState(initialProgress);
  if (prevInitialProgress !== initialProgress) {
    setPrevInitialProgress(initialProgress);
    setProgress(initialProgress);
  }

  // Compute filtered queue: pending only or all
  const displayQueue = filterPendingOnly
    ? queue.filter((item) => !progress[item.id] || progress[item.id] === 'pending')
    : queue;

  // Safe current item clamped to bounds
  const current = displayQueue[Math.min(index, Math.max(0, displayQueue.length - 1))];

  const [prevCurrentId, setPrevCurrentId] = useState<string | undefined>(current?.id);
  if (prevCurrentId !== current?.id) {
    setPrevCurrentId(current?.id);
    setHasOpenedCurrent(false);
  }

  const totalSent = queue.filter((q) => progress[q.id] === 'sent').length;
  const totalSkipped = queue.filter((q) => progress[q.id] === 'skipped').length;
  const totalPending = queue.length - totalSent - totalSkipped;
  const percentComplete = queue.length > 0 ? Math.round(((totalSent + totalSkipped) / queue.length) * 100) : 0;

  const copyToClipboard = useCallback(async (textToCopy: string) => {
    let copySuccess = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(textToCopy);
        copySuccess = true;
      }
    } catch {
      const ta = document.createElement('textarea');
      ta.value = textToCopy;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        copySuccess = true;
      } finally {
        document.body.removeChild(ta);
      }
    }

    if (copySuccess) {
      setCopiedFlash(true);
      setTimeout(() => setCopiedFlash(false), 1500);
    }
    return copySuccess;
  }, []);

  const openProfileTab = useCallback((item: LinkedInQueueItem) => {
    const targetUrl = item.slug ? profileUrl(item.slug) : item.url || peopleSearchUrl(item.name, item.account);
    const opened = window.open(targetUrl, '_blank', 'noopener');
    if (!opened) {
      showToast('Popup blocked — allow popups for this site, then try again.');
      return false;
    }
    return true;
  }, [showToast]);

  const confirmSentAndAdvance = useCallback(async () => {
    if (!current || processing) return;
    setProcessing(true);

    const previousProgress = progress;
    const updated = { ...progress, [current.id]: 'sent' };
    setProgress(updated);
    onProgressUpdate?.(updated);

    try {
      const res = await markLinkedInSendAction(campaignId, current.id, 'sent');
      if (!res.ok) {
        setProgress(previousProgress);
        onProgressUpdate?.(previousProgress);
        showToast(res.error || 'Could not record this LinkedIn send — try again.');
        setProcessing(false);
        return;
      }
      showToast(`Recorded ${current.name} as sent. Next person is ready.`);
    } catch {
      setProgress(previousProgress);
      onProgressUpdate?.(previousProgress);
      showToast('Could not record this LinkedIn send — try again.');
      setProcessing(false);
      return;
    }
    setProcessing(false);
    setHasOpenedCurrent(false);

    if (!filterPendingOnly) {
      setIndex((i) => Math.min(i + 1, displayQueue.length - 1));
    }
  }, [current, processing, progress, campaignId, onProgressUpdate, showToast, filterPendingOnly, displayQueue.length]);

  /**
   * Action handler:
   * If oneClickFastMode is true: opens tab + copies + confirms sent + advances.
   * If two-step mode (default):
   *   Step 1: opens tab + copies text, turns button into "Confirm Sent & Next".
   *   Step 2: confirms sent to system, advances to next profile.
   */
  const handleSendAndNext = useCallback(async () => {
    if (!current || processing) return;

    if (oneClickFastMode) {
      await copyToClipboard(current.message);
      const opened = openProfileTab(current);
      if (!opened) return;
      await confirmSentAndAdvance();
      return;
    }

    if (!hasOpenedCurrent) {
      await copyToClipboard(current.message);
      const opened = openProfileTab(current);
      if (opened) {
        setHasOpenedCurrent(true);
        showToast(`Opened ${current.name}'s LinkedIn and copied the draft. Paste it there, then confirm.`);
      }
      return;
    }

    await confirmSentAndAdvance();
  }, [current, processing, oneClickFastMode, hasOpenedCurrent, copyToClipboard, openProfileTab, confirmSentAndAdvance, showToast]);

  const handleSkip = useCallback(async () => {
    if (!current || processing) return;
    setProcessing(true);

    const previousProgress = progress;
    const updated = { ...progress, [current.id]: 'skipped' };
    setProgress(updated);
    onProgressUpdate?.(updated);

    try {
      const res = await markLinkedInSendAction(campaignId, current.id, 'skipped');
      if (!res.ok) {
        setProgress(previousProgress);
        onProgressUpdate?.(previousProgress);
        showToast(res.error || 'Could not record this skip — try again.');
        setProcessing(false);
        return;
      }
      showToast(`Skipped ${current.name}.`);
    } catch (err) {
      setProgress(previousProgress);
      onProgressUpdate?.(previousProgress);
      console.error('Failed to record LinkedIn skip:', err);
      showToast('Could not record this skip — try again.');
      setProcessing(false);
      return;
    }
    setProcessing(false);
    setHasOpenedCurrent(false);

    if (!filterPendingOnly) {
      setIndex((i) => Math.min(i + 1, displayQueue.length - 1));
    }
  }, [current, processing, progress, campaignId, onProgressUpdate, showToast, filterPendingOnly, displayQueue.length]);

  const handlePrevious = useCallback(() => {
    setHasOpenedCurrent(false);
    setIndex((i) => Math.max(0, i - 1));
  }, []);

  /**
   * Keyboard shortcuts:
   * Enter / Space -> Send & Next
   * S or ArrowRight -> Skip
   * ArrowLeft -> Previous
   * Escape -> Close (handled by the Modal shell)
   */
  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(e: KeyboardEvent) {
      // Don't intercept if typing in an input or textarea
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        return;
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        void handleSendAndNext();
      } else if (e.key === 's' || e.key === 'S' || e.key === 'ArrowRight') {
        e.preventDefault();
        void handleSkip();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handlePrevious();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleSendAndNext, handleSkip, handlePrevious]);

  const stepTwo = !oneClickFastMode && hasOpenedCurrent;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="lg"
      title="Guided LinkedIn Send"
      subtitle={`${campaignTitle} \u00b7 ${totalPending.toLocaleString()} pending out of ${queue.length.toLocaleString()} approved recipient${queue.length === 1 ? '' : 's'}`}
    >
      <div className="lsq-stack">
        <div className="lsq-res-runner-progress">
          <div className="lsq-toolbar">
            <p className="lsq-res-runner-counts">
              <strong>{totalSent.toLocaleString()}</strong> sent &middot; <strong>{totalSkipped.toLocaleString()}</strong> skipped &middot; <strong>{totalPending.toLocaleString()}</strong> pending
            </p>
            <div className="lsq-toolbar__group">
              <Badge color="blue" text="Manual send, fast confirm" />
              <label className="lsq-check">
                <input
                  type="checkbox"
                  checked={filterPendingOnly}
                  onChange={(e) => {
                    setFilterPendingOnly(e.target.checked);
                    setIndex(0);
                  }}
                />
                Pending only
              </label>
              <strong className="lsq-res-runner-pct">{percentComplete}% done</strong>
            </div>
          </div>
          <div className="lsq-progress" role="progressbar" aria-label="Queue progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentComplete}>
            <div className="lsq-progress__bar" style={{ width: `${percentComplete}%` }} />
          </div>
        </div>

        {queue.length === 0 ? (
          <div className="lsq-empty">
            <Icon name="users" size={32} />
            <h3 className="lsq-empty__title">No Approved Contacts in Queue</h3>
            <p className="lsq-empty__body">
              To send LinkedIn messages, contacts must be approved in the Audience tab first. Once approved, personalized drafts and verified profiles will appear here ready to send.
            </p>
            <div className="lsq-cluster">
              {campaignId && (
                <a href={`/campaigns/${campaignId}/audience`} className="lsq-btn lsq-btn--md lsq-btn--primary">
                  Go to Audience
                </a>
              )}
              <Button hierarchy="secondary" size="md" onClick={onClose}>
                Close
              </Button>
            </div>
          </div>
        ) : !current ? (
          <div className="lsq-empty">
            <Icon name="check-circle" size={32} />
            <h3 className="lsq-empty__title">All LinkedIn Touches Completed</h3>
            <p className="lsq-empty__body">
              All approved contacts in this queue have been processed. Total {totalSent.toLocaleString()} messages sent.
            </p>
            <Button hierarchy="secondary" size="md" onClick={() => setFilterPendingOnly(false)}>
              Review All Processed Contacts
            </Button>
          </div>
        ) : (
          <>
            <div className="lsq-res-recipient">
              <div className="lsq-cluster lsq-cluster--between">
                <div className="lsq-res-recipient__who">
                  <div className="lsq-cluster">
                    <span className="lsq-res-recipient__name">{current.name}</span>
                    {current.checkStatus === 'verified' && <Badge color="green" text="Apollo verified" dot />}
                    {current.checkStatus === 'mismatch' && <Badge color="amber" text="Job changed" dot />}
                  </div>
                  <p className="lsq-res-recipient__role">
                    <strong>{current.title}</strong> at <strong>{current.account}</strong>
                  </p>
                </div>
                {current.slug ? (
                  <a href={profileUrl(current.slug)} target="_blank" rel="noreferrer" className="lsq-tag">
                    <Icon name="linkedin" size={14} />
                    linkedin.com/in/{current.slug}
                  </a>
                ) : (
                  <span className="lsq-hint">No direct URL. Opens people search.</span>
                )}
              </div>
            </div>

            <div className="lsq-field">
              <div className="lsq-cluster lsq-cluster--between">
                <div className="lsq-cluster">
                  <span className="lsq-label">Personalized Message Draft</span>
                  {current.personalized && <Badge color="purple light" text="AI personalized" />}
                </div>
                {copiedFlash && (
                  <span role="status">
                    <Badge color="success" text="Copied to clipboard" />
                  </span>
                )}
              </div>
              <div className="lsq-msgbox lsq-res-draft" data-copied={copiedFlash ? 'true' : 'false'}>
                {current.message}
              </div>
            </div>

            <div className="lsq-res-action" data-state={stepTwo ? 'done' : 'open'}>
              <Button hierarchy="primary" size="lg" fullWidth loading={processing} onClick={handleSendAndNext}>
                {processing
                  ? 'Processing'
                  : oneClickFastMode
                    ? 'Open Profile And Continue (Enter)'
                    : !hasOpenedCurrent
                      ? 'Step 1: Open Profile And Copy Draft (Enter)'
                      : 'Step 2: Confirm Sent And Continue (Enter)'}
              </Button>

              <div className="lsq-toolbar">
                <p className="lsq-res-action__hint">
                  {stepTwo ? (
                    <span>
                      <strong>Profile opened and draft copied.</strong> Paste into the LinkedIn message box, click Send on LinkedIn, then click <strong>Confirm Sent</strong> above (or press <strong>Enter</strong>) to record it in analytics and load the next contact.
                    </span>
                  ) : (
                    <span>
                      <strong>Assisted manual send:</strong> opens the profile in a new tab and copies the draft to the clipboard. The send itself happens on LinkedIn, which protects the account.
                    </span>
                  )}
                </p>
                <div className="lsq-toolbar__group">
                  {stepTwo && (
                    <Button
                      hierarchy="tertiary"
                      size="sm"
                      onClick={() => {
                        void copyToClipboard(current.message);
                        openProfileTab(current);
                      }}
                    >
                      Re-open / Copy
                    </Button>
                  )}
                  <Button hierarchy="tertiary" size="sm" icon={<Icon name="arrow-left" size={14} />} onClick={handlePrevious} disabled={index === 0}>
                    Back
                  </Button>
                  <Button hierarchy="secondary" size="sm" icon={<Icon name="skip" size={14} />} onClick={handleSkip} disabled={processing}>
                    Skip (S)
                  </Button>
                </div>
              </div>

              <label className="lsq-check lsq-res-action__mode">
                <input type="checkbox" checked={oneClickFastMode} onChange={(e) => setOneClickFastMode(e.target.checked)} />
                <span>One-click mode: record as sent and continue as soon as the profile opens</span>
              </label>
            </div>

            <p className="lsq-res-kbds" aria-label="Keyboard shortcuts">
              <span><kbd className="lsq-res-kbd">Enter</kbd> Send and next</span>
              <span><kbd className="lsq-res-kbd">S</kbd> Skip</span>
              <span><kbd className="lsq-res-kbd">Left</kbd> Previous</span>
              <span><kbd className="lsq-res-kbd">Esc</kbd> Close</span>
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}
