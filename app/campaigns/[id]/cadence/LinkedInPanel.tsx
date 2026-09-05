'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Badge } from '@/components/ui/Badge';
import { markLinkedInSendAction, setLinkedInProfileAction, verifyLinkedInQueueAction } from '@/lib/actions/linkedin';
import { composeUrl, profileUrl, peopleSearchUrl } from '@/lib/linkedinUrl';
import type { VerificationStatus } from '@/lib/apolloVerify';

export interface LinkedInQueueItem {
  id: string;
  name: string;
  title: string;
  account: string;
  url: string;
  message: string;
  personalized?: boolean;
  /** True when the personalized draft failed validation (missing link, leftover
   *  {{token}}) — the queue falls back to the message shown, but a human still
   *  needs to know their "personalized" draft for this recipient was actually
   *  rejected rather than intentionally generic. */
  personalizedInvalid?: boolean;
  slug?: string | null;
  /** Apollo people-match verdict taken before this person may be contacted. */
  checkStatus?: VerificationStatus | null;
  checkNote?: string | null;
}

export function LinkedInPanel({
  campaignId,
  queue,
  initialProgress,
}: {
  campaignId: string;
  queue: LinkedInQueueItem[];
  initialProgress: Record<string, string>;
}) {
  const [profileDraft, setProfileDraft] = useState('');
  const [profileError, setProfileError] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifySummary, setVerifySummary] = useState<string | null>(null);
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const [progress, setProgress] = useState<Record<string, string>>(initialProgress);
  const [steps, setSteps] = useState<Record<string, { copied?: boolean; opened?: boolean }>>({});
  const [open, setOpen] = useState(false);

  const verifiedCount = queue.filter((q) => q.checkStatus === 'verified').length;
  const failedCount = queue.filter((q) => q.checkStatus === 'mismatch' || q.checkStatus === 'not_found' || q.checkStatus === 'error').length;
  const uncheckedCount = queue.length - verifiedCount - failedCount;

  async function verifyQueue() {
    setVerifying(true);
    setVerifySummary(null);
    const res = await verifyLinkedInQueueAction(campaignId);
    setVerifySummary(
      res.ok
        ? `${res.usedLiveApi ? 'Apollo checked' : 'No Apollo key — skipped'} · ${res.verified ?? 0} verified · ${res.mismatch ?? 0} job-changed · ${res.notFound ?? 0} not found${res.errors ? ` · ${res.errors} errors` : ''}`
        : res.error ?? 'Verification failed.'
    );
    setVerifying(false);
    router.refresh();
  }

  const sentCount = queue.filter((q) => progress[q.id] === 'sent').length;
  const pending = queue.filter((q) => !progress[q.id]);
  const pct = queue.length ? Math.round((sentCount / queue.length) * 100) : 0;
  const current = queue[Math.min(index, Math.max(0, queue.length - 1))];
  const curSteps = current ? steps[current.id] ?? {} : {};

  /**
   * Copies the draft and opens LinkedIn in one gesture.
   *
   * Ordering is load-bearing: the clipboard write is *started* before
   * window.open but deliberately not awaited. Awaiting first makes the popup
   * look un-initiated by the user and it gets blocked; opening first steals
   * focus and the clipboard write then fails on an unfocused document. Firing
   * both inside the same gesture avoids each failure mode.
   */
  function openInLinkedIn(item: LinkedInQueueItem) {
    const writing = navigator.clipboard?.writeText(item.message);
    const url = item.slug ? composeUrl(item.slug) : peopleSearchUrl(item.name, item.account);
    window.open(url, '_blank', 'noopener');
    setSteps((st) => ({ ...st, [item.id]: { ...st[item.id], copied: true, opened: true } }));

    // Older/permission-denied paths: fall back to a hidden textarea so the
    // message still reaches the clipboard rather than silently not copying.
    writing?.catch(() => {
      const ta = document.createElement('textarea');
      ta.value = item.message;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
      } finally {
        document.body.removeChild(ta);
      }
    });
  }

  async function saveProfile(contactId: string) {
    setSavingProfile(true);
    setProfileError(null);
    const res = await setLinkedInProfileAction(campaignId, contactId, profileDraft);
    setSavingProfile(false);
    if (!res.ok) {
      setProfileError(res.error);
      return;
    }
    setProfileDraft('');
    router.refresh();
  }

  async function mark(contactId: string, status: 'sent' | 'skipped') {
    setProgress((p) => ({ ...p, [contactId]: status }));
    await markLinkedInSendAction(campaignId, contactId, status);
  }

  function next() {
    setIndex((i) => Math.min(i + 1, queue.length - 1));
  }

  return (
    <>
      <div style={{ background: '#fff', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)', padding: '16px 18px' }}>
        <div style={{ fontSize: 'var(--fs-label-1)', fontWeight: 700, color: 'var(--n90)', marginBottom: 4 }}>LinkedIn touches · manual</div>
        <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--n60)', lineHeight: 1.5, marginBottom: 10 }}>
          {queue.length} draft{queue.length === 1 ? '' : 's'} ready ·{' '}
          <span style={{ color: 'var(--success-700)' }}>{verifiedCount} Apollo-verified</span>
          {uncheckedCount > 0 && ` · ${uncheckedCount} unchecked`}
          {failedCount > 0 && <span style={{ color: 'var(--warning-700)' }}> · {failedCount} failed verification</span>}
        </div>

        <Button hierarchy="secondary" size="sm" fullWidth onClick={verifyQueue} disabled={verifying} style={{ marginBottom: 12 }}>
          {verifying ? 'Verifying with Apollo…' : queue.some((q) => !q.checkStatus) ? 'Verify queue with Apollo' : 'Re-verify queue'}
        </Button>
        {verifySummary && (
          <div style={{ fontSize: 'var(--fs-label-2)', color: verifySummary.startsWith('No') || verifySummary.includes('errors') ? 'var(--warning-700)' : 'var(--n70)', marginBottom: 12, lineHeight: 1.5 }}>
            {verifySummary}
          </div>
        )}

        <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n60)', marginBottom: 12 }}>
          Sends are manual by design — scripted LinkedIn outreach breaches their terms. Apollo verification keeps the queue honest.
        </div>

        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n60)' }}>
            {sentCount} of {queue.length} sent
          </span>
          {pending.length > 0 && <span style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n50)' }}>{pending.length} pending</span>}
        </div>
        <div style={{ height: 6, background: 'var(--n20)', borderRadius: 'var(--radius-full)', overflow: 'hidden', marginBottom: 12 }}>
          <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent-500)', borderRadius: 'var(--radius-full)' }} />
        </div>

        <Button hierarchy="secondary" size="sm" fullWidth onClick={() => setOpen(true)} disabled={queue.length === 0}>
          {queue.length === 0 ? 'No approved contacts yet' : 'Open send queue'}
        </Button>
      </div>

      {open && current && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(16,20,25,0.45)', zIndex: 1200 }} />
          <div
            style={{
              position: 'fixed',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              width: 560,
              maxHeight: 'calc(100vh - 48px)',
              background: '#fff',
              borderRadius: 'var(--radius-lg)',
              boxShadow: 'var(--shadow-panel)',
              zIndex: 1201,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            <div style={{ flexShrink: 0, padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 'var(--fs-body)', fontWeight: 700, color: 'var(--n90)' }}>LinkedIn send queue</div>
                <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--n60)', marginTop: 2 }}>
                  Manual send · {sentCount} of {queue.length} sent
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close"
                style={{ cursor: 'pointer', width: 28, height: 28, borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', background: 'transparent', padding: 0 }}
              >
                <Icon name="close" size={16} style={{ color: 'var(--n60)' }} />
              </button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '18px 20px 22px 20px' }}>
                <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 'var(--fs-body)', fontWeight: 700, color: 'var(--n90)' }}>{current.name}</div>
                      <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--n60)' }}>
                        {current.title} · {current.account}
                      </div>
                    </div>
                    <Button hierarchy="tertiary" size="sm" onClick={next}>
                      Next
                    </Button>
                  </div>
                  {current.checkStatus && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, flexWrap: 'wrap' }} title={current.checkNote ?? undefined}>
                      {current.checkStatus === 'verified' && <Badge color="success" text="Apollo verified" dot />}
                      {current.checkStatus === 'mismatch' && <Badge color="error" text="Job change detected" dot />}
                      {current.checkStatus === 'not_found' && <Badge color="error" text="Not found on Apollo" dot />}
                      {current.checkStatus === 'error' && <Badge color="warning" text="Verification lookup failed" dot />}
                      {current.checkStatus !== 'verified' && (
                        <span style={{ fontSize: 'var(--fs-label-2)', color: 'var(--warning-700)', lineHeight: 1.4 }}>{current.checkNote}</span>
                      )}
                    </div>
                  )}
                  {current.personalized && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
                      {current.personalizedInvalid ? (
                        <Badge color="error" text="Personalized draft invalid — showing the template instead" />
                      ) : (
                        <Badge color="blue light" text="Personalized for this person" />
                      )}
                      <span style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n50)' }}>Edit it on the Personalize tab.</span>
                    </div>
                  )}
                  <div style={{ background: 'var(--n10)', borderRadius: 'var(--radius-sm)', padding: 14, fontSize: 'var(--fs-label-1)', color: 'var(--n80)', lineHeight: 1.6, whiteSpace: 'pre-wrap', marginBottom: 14 }}>
                    {current.message}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <Button hierarchy="primary" size="md" fullWidth onClick={() => openInLinkedIn(current)}>
                      Copy message &amp; open LinkedIn
                    </Button>

                    <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n60)', lineHeight: 1.55 }}>
                      {curSteps.opened
                        ? 'Paste it into the message box (⌘V), read it over, and press Send in LinkedIn. Then confirm below.'
                        : current.slug
                        ? 'Opens their message composer with the text on your clipboard — paste, review, send.'
                        : 'Opens a LinkedIn search for this person with the text on your clipboard. Add their profile URL below to jump straight to them next time.'}
                    </div>

                    {current.slug && (
                      <button
                        type="button"
                        onClick={() => window.open(profileUrl(current.slug!), '_blank', 'noopener')}
                        style={{ alignSelf: 'flex-start', background: 'none', border: 'none', padding: 0, fontSize: 'var(--fs-label-2)', fontWeight: 600, color: 'var(--accent-500)', cursor: 'pointer', textDecoration: 'underline' }}
                      >
                        Open their profile instead
                      </button>
                    )}

                    {!current.slug && (
                      <div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <input
                            className="lsq-input"
                            type="text"
                            value={profileDraft}
                            onChange={(e) => setProfileDraft(e.target.value)}
                            placeholder="linkedin.com/in/their-name"
                            style={{ flex: 1, minWidth: 0 }}
                          />
                          <Button hierarchy="secondary" size="sm" onClick={() => saveProfile(current.id)} disabled={!profileDraft.trim() || savingProfile}>
                            {savingProfile ? 'Saving…' : 'Save'}
                          </Button>
                        </div>
                        {profileError && <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--danger-500)', marginTop: 6 }}>{profileError}</div>}
                      </div>
                    )}

                    <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 12 }}>
                      <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n50)', marginBottom: 8, lineHeight: 1.5 }}>
                        LinkedIn doesn&apos;t tell us when a message actually goes out — confirm here and the queue moves on.
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <Button
                          hierarchy={curSteps.opened ? 'primary' : 'secondary'}
                          size="sm"
                          onClick={async () => {
                            await mark(current.id, 'sent');
                            next();
                          }}
                        >
                          I sent it
                        </Button>
                        <Button
                          hierarchy="tertiary"
                          size="sm"
                          onClick={async () => {
                            await mark(current.id, 'skipped');
                            next();
                          }}
                        >
                          Skip
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>

              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 'var(--fs-label-2)', fontWeight: 600, color: 'var(--n60)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>Queue</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {queue.map((q, i) => (
                    <div
                      key={q.id}
                      onClick={() => setIndex(i)}
                      className={i === index ? undefined : 'lsq-row'}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', background: i === index ? 'var(--n10)' : 'transparent' }}
                    >
                      <span style={{ width: 18, fontSize: 'var(--fs-label-2)', color: 'var(--n50)', flexShrink: 0 }}>{i + 1}</span>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--fs-label-1)', fontWeight: 600, color: 'var(--n90)', overflowWrap: 'anywhere' }}>{q.name}</span>
                      {q.personalized && (q.personalizedInvalid ? <Badge color="error" text="Invalid" /> : <Badge color="blue light" text="Personalized" />)}
                      <span style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n60)' }}>{q.account}</span>
                      <Badge
                        color={progress[q.id] === 'sent' ? 'success' : progress[q.id] === 'skipped' ? 'gray' : 'blue'}
                        text={progress[q.id] === 'sent' ? 'Sent' : progress[q.id] === 'skipped' ? 'Skipped' : 'Queued'}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
