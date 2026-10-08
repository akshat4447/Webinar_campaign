'use client';

import { useState, useTransition, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/Toast';
import { Modal } from '@/components/ui/Modal';
import { Field } from '@/components/ui/Field';
import {
  type LinkedInToolEventSummary,
  type LinkedInToolParticipant,
  markLinkedInSendAction,
  setLinkedInProfileAction,
  verifyLinkedInQueueAction,
  bulkResolveLinkedInProfilesAction,
} from '@/lib/actions/linkedin';
import { LinkedInFastRunnerModal } from '@/components/cadence/LinkedInFastRunnerModal';
import { profileUrl, peopleSearchUrl } from '@/lib/linkedinUrl';

interface LinkedInHubClientProps {
  events: LinkedInToolEventSummary[];
  initialSelectedEventId: string | null;
  initialQueue: LinkedInToolParticipant[];
}

export function LinkedInHubClient({
  events,
  initialSelectedEventId,
  initialQueue,
}: LinkedInHubClientProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const [, startTransition] = useTransition();

  const [selectedEventId, setSelectedEventId] = useState<string>(
    initialSelectedEventId || (events[0]?.id ?? '')
  );
  const [queue, setQueue] = useState<LinkedInToolParticipant[]>(initialQueue);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTab, setFilterTab] = useState<'all' | 'pending' | 'sent' | 'skipped'>('pending');

  // Fast-Runner HUD Modal State
  const [fastRunnerOpen, setFastRunnerOpen] = useState(false);

  // Edit LinkedIn Profile Modal State
  const [editProfileContact, setEditProfileContact] = useState<LinkedInToolParticipant | null>(null);
  const [profileInput, setProfileInput] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  // Action busy states
  const [resolvingProfiles, setResolvingProfiles] = useState(false);
  const [verifyingApollo, setVerifyingApollo] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpanded = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const currentEvent = useMemo(
    () => events.find((e) => e.id === selectedEventId) || events[0] || null,
    [events, selectedEventId]
  );

  // Switch selected event
  function handleEventChange(eventId: string) {
    setSelectedEventId(eventId);
    startTransition(() => {
      router.push(`/linkedin?event=${encodeURIComponent(eventId)}`);
    });
  }

  // Filter queue by search and tab
  const filteredParticipants = useMemo(() => {
    return queue.filter((p) => {
      // Tab filter
      if (filterTab !== 'all' && p.status !== filterTab) {
        return false;
      }
      // Search filter
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        p.name.toLowerCase().includes(q) ||
        p.account.toLowerCase().includes(q) ||
        p.title.toLowerCase().includes(q)
      );
    });
  }, [queue, filterTab, searchQuery]);

  // Aggregate stats from current queue
  const stats = useMemo(() => {
    const total = queue.length;
    const sent = queue.filter((p) => p.status === 'sent').length;
    const skipped = queue.filter((p) => p.status === 'skipped').length;
    const pending = total - sent - skipped;
    const directProfiles = queue.filter((p) => p.slug).length;
    const verified = queue.filter((p) => p.checkStatus === 'verified').length;
    const noProfile = total - directProfiles;
    const overLimit = queue.filter((p) => p.exceedsLimit && p.status === 'pending').length;
    const pct = total > 0 ? Math.round(((sent + skipped) / total) * 100) : 0;
    return { total, sent, skipped, pending, directProfiles, verified, noProfile, overLimit, pct };
  }, [queue]);

  // 1-Click Open & Copy Action
  async function handleOpenAndCopy(participant: LinkedInToolParticipant) {
    if (!selectedEventId) return;

    // 1. Copy message text to clipboard
    const textToCopy = participant.message;
    let copyOk = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(textToCopy);
        copyOk = true;
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
        copyOk = true;
      } finally {
        document.body.removeChild(ta);
      }
    }

    if (copyOk) {
      setCopiedId(participant.id);
      setTimeout(() => setCopiedId(null), 1500);
    }

    // 2. Open LinkedIn destination in a new tab synchronously during user gesture
    const targetUrl = participant.slug
      ? profileUrl(participant.slug)
      : participant.destinationUrl || peopleSearchUrl(participant.name, participant.account);

    const win = window.open(targetUrl, '_blank', 'noopener');
    if (!win) {
      showToast('Your browser blocked the new tab. Allow pop-ups for this app and try again.');
      return;
    }

    // 3. Optimistic local state update
    setQueue((prev) =>
      prev.map((item) =>
        item.id === participant.id
          ? { ...item, status: 'sent', sentAt: new Date().toISOString() }
          : item
      )
    );

    showToast(`Opened ${participant.name}'s LinkedIn and copied the message.`);

    // 4. Background persistence to database
    try {
      const res = await markLinkedInSendAction(selectedEventId, participant.id, 'sent');
      if (!res.ok) {
        showToast(res.error || 'Failed to persist sent status to database.');
      }
    } catch (err) {
      console.error('Failed to mark sent in DB:', err);
    }
  }

  // Mark sent manually without opening
  async function handleMarkStatus(participantId: string, status: 'sent' | 'skipped' | 'pending') {
    if (!selectedEventId) return;

    setQueue((prev) =>
      prev.map((item) =>
        item.id === participantId
          ? { ...item, status, sentAt: status === 'sent' ? new Date().toISOString() : null }
          : item
      )
    );

    if (status === 'pending') {
      showToast('Reset to pending.');
      return;
    }

    try {
      const res = await markLinkedInSendAction(selectedEventId, participantId, status);
      if (res.ok) {
        showToast(status === 'sent' ? 'Marked as sent.' : 'Marked as skipped.');
      } else {
        showToast(res.error || 'Failed to update status.');
      }
    } catch {
      showToast('Error recording status.');
    }
  }

  // Copy draft text only
  async function handleCopyOnly(participant: LinkedInToolParticipant) {
    try {
      await navigator.clipboard.writeText(participant.message);
      setCopiedId(participant.id);
      showToast('Message copied.');
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      showToast('Could not copy to clipboard.');
    }
  }

  // Run Bulk Profile Resolver
  async function handleResolveProfiles() {
    if (!selectedEventId) return;
    setResolvingProfiles(true);
    try {
      const res = await bulkResolveLinkedInProfilesAction(selectedEventId);
      if (res.ok) {
        showToast(res.summary || 'Profiles updated.');
        startTransition(() => {
          router.refresh();
        });
      } else {
        showToast(res.error || 'Failed to resolve profiles.');
      }
    } catch {
      showToast('Failed to run profile resolution.');
    } finally {
      setResolvingProfiles(false);
    }
  }

  // Run Apollo Verification
  async function handleVerifyApollo() {
    if (!selectedEventId) return;
    setVerifyingApollo(true);
    try {
      const res = await verifyLinkedInQueueAction(selectedEventId);
      if (res.ok) {
        showToast(
          `Apollo check complete: ${res.verified ?? 0} verified, ${res.notFound ?? 0} not found.`
        );
        startTransition(() => {
          router.refresh();
        });
      } else {
        showToast(res.error || 'Apollo verification failed.');
      }
    } catch {
      showToast('Failed to run Apollo verification.');
    } finally {
      setVerifyingApollo(false);
    }
  }

  // Save edited LinkedIn profile slug
  async function handleSaveEditedProfile() {
    if (!selectedEventId || !editProfileContact || !profileInput.trim()) return;
    setSavingProfile(true);
    try {
      const res = await setLinkedInProfileAction(selectedEventId, editProfileContact.id, profileInput.trim());
      if (res.ok) {
        setQueue((prev) =>
          prev.map((p) =>
            p.id === editProfileContact.id
              ? {
                  ...p,
                  slug: res.slug,
                  linkedinId: res.slug,
                  destinationUrl: profileUrl(res.slug),
                  destinationKind: 'profile',
                }
              : p
          )
        );
        showToast(`Saved LinkedIn profile: ${res.slug}`);
        setEditProfileContact(null);
        setProfileInput('');
      } else {
        showToast(res.error || 'Invalid LinkedIn URL');
      }
    } catch {
      showToast('Error saving profile');
    } finally {
      setSavingProfile(false);
    }
  }

  // Initial progress map for Fast-Runner modal
  const fastRunnerProgress = useMemo(() => {
    const map: Record<string, string> = {};
    for (const p of queue) {
      if (p.status !== 'pending') {
        map[p.id] = p.status;
      }
    }
    return map;
  }, [queue]);

  // Synchronize progress updates back from Fast-Runner
  function handleFastRunnerUpdate(updated: Record<string, string>) {
    setQueue((prev) =>
      prev.map((item) => {
        const nextStatus = updated[item.id];
        if (nextStatus && nextStatus !== item.status) {
          return {
            ...item,
            status: nextStatus as 'sent' | 'skipped',
            sentAt: nextStatus === 'sent' ? new Date().toISOString() : item.sentAt,
          };
        }
        return item;
      })
    );
  }

  const tabs = [
    { id: 'pending', label: 'Pending', count: stats.pending },
    { id: 'sent', label: 'Sent', count: stats.sent },
    { id: 'skipped', label: 'Skipped', count: stats.skipped },
    { id: 'all', label: 'All', count: stats.total },
  ] as const;

  return (
    <div className="lsq-int-scroll">
      <div className="lsq-page">
        <header className="lsq-page-header">
          <div className="lsq-page-header__text">
            <p className="lsq-page-header__eyebrow">LinkedIn Outreach</p>
            <h1 className="lsq-page-header__title">Send LinkedIn Messages</h1>
            <p className="lsq-page-header__sub">
              Review each draft, open the profile and paste. Nothing is posted automatically, so every message is sent by a person.
            </p>
          </div>
          <div className="lsq-page-header__actions">
            <Button hierarchy="secondary" icon={<Icon name="search" size={16} />} loading={resolvingProfiles} disabled={!selectedEventId} onClick={handleResolveProfiles} title="Look up each contact's LinkedIn profile address">
              Find Profiles
            </Button>
            <Button hierarchy="secondary" icon={<Icon name="check" size={16} />} loading={verifyingApollo} disabled={!selectedEventId} onClick={handleVerifyApollo} title="Confirm each profile with Apollo before sending">
              Check With Apollo
            </Button>
            <Button hierarchy="primary" icon={<Icon name="play" size={16} />} disabled={stats.pending === 0} onClick={() => setFastRunnerOpen(true)} title="Step through pending messages one at a time">
              Start Guided Send
            </Button>
          </div>
        </header>

        {events.length === 0 ? (
          <div className="lsq-card lsq-empty">
            <p className="lsq-empty__title">No Webinars Yet</p>
            <p className="lsq-empty__body">Create a webinar and add LinkedIn to its cadence to queue messages here.</p>
          </div>
        ) : (
          <>
            <section className="lsq-card" aria-label="Webinar and progress">
              <div className="lsq-card__body lsq-stack">
                <div className="lsq-toolbar">
                  <div className="lsq-toolbar__group">
                    <label htmlFor="event-select" className="lsq-label">Webinar</label>
                    <select id="event-select" className="lsq-select lsq-int-event-select" value={selectedEventId} onChange={(e) => handleEventChange(e.target.value)}>
                      {events.map((ev) => (
                        <option key={ev.id} value={ev.id}>
                          {ev.name}{ev.date ? ` · ${ev.date}` : ''} · {ev.sentCount}/{ev.totalApproved} sent
                        </option>
                      ))}
                    </select>
                    {currentEvent?.hasLinkedInStep ? <Badge color="success" text="In Cadence" /> : <Badge color="gray" text="Not In Cadence" />}
                  </div>
                  {currentEvent && (
                    <div className="lsq-toolbar__group">
                      <Link href={`/campaigns/${currentEvent.id}/cadence`} className="lsq-linkbtn">Open Cadence</Link>
                      <Link href={`/campaigns/${currentEvent.id}/results`} className="lsq-linkbtn">Open Results</Link>
                    </div>
                  )}
                </div>

                <div>
                  <div className="lsq-cluster lsq-cluster--between lsq-int-progress-head">
                    <strong>{stats.sent + stats.skipped} of {stats.total} done</strong>
                    <span className="lsq-hint">{stats.pct}%</span>
                  </div>
                  <div className="lsq-progress lsq-progress--success" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={stats.pct} aria-label="Outreach progress">
                    <div className="lsq-progress__bar" style={{ width: `${stats.pct}%` }} />
                  </div>
                </div>

                <div className="lsq-chips">
                  <span className="lsq-chip"><strong>{stats.pending}</strong> pending</span>
                  <span className="lsq-chip"><strong>{stats.sent}</strong> sent</span>
                  <span className="lsq-chip"><strong>{stats.skipped}</strong> skipped</span>
                  <span className="lsq-chip"><strong>{stats.directProfiles}</strong> with a profile</span>
                  {stats.noProfile > 0 && <span className="lsq-chip"><strong>{stats.noProfile}</strong> need a profile</span>}
                  {stats.overLimit > 0 && <span className="lsq-chip lsq-chip--danger"><strong>{stats.overLimit}</strong> over 300 characters</span>}
                  <span className="lsq-chip"><strong>{stats.verified}</strong> verified</span>
                </div>
              </div>
            </section>

            <div className="lsq-toolbar">
              <div className="lsq-tabs" role="tablist" aria-label="Outreach status">
                {tabs.map((tab) => (
                  <button key={tab.id} type="button" role="tab" aria-selected={filterTab === tab.id} className="lsq-tab" onClick={() => setFilterTab(tab.id)}>
                    {tab.label} <span className="lsq-hint">{tab.count}</span>
                  </button>
                ))}
              </div>
              <div className="lsq-search">
                <Icon name="search" size={16} />
                <input className="lsq-input" type="search" aria-label="Search people" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search name, title or company" />
              </div>
            </div>

            {filteredParticipants.length === 0 ? (
              <div className="lsq-card lsq-empty">
                <p className="lsq-empty__title">{searchQuery ? 'No Matches' : filterTab === 'pending' ? 'Nothing Left To Send' : 'Nothing Here'}</p>
                <p className="lsq-empty__body">
                  {searchQuery ? 'Clear the search to see everyone in this view.' : filterTab === 'pending' ? 'Every person in this queue has been sent or skipped.' : 'No one has this status yet.'}
                </p>
              </div>
            ) : (
              <ul className="lsq-rows" aria-label="People to message">
                {filteredParticipants.map((p) => {
                  const initials = p.name.split(' ').filter(Boolean).slice(0, 2).map((x) => x[0]?.toUpperCase()).join('');
                  const isSent = p.status === 'sent';
                  const isSkipped = p.status === 'skipped';
                  const isOpen = expanded.has(p.id);
                  const long = p.message.length > 220 || p.message.split('\n').length > 4;
                  return (
                    <li key={p.id} className="lsq-orow" data-status={p.status}>
                      <div className="lsq-orow__who">
                        <span className="lsq-avatar" aria-hidden="true">{initials || '?'}</span>
                        <div className="lsq-grow">
                          <p className="lsq-orow__name">{p.name}</p>
                          <p className="lsq-orow__meta">{p.title} · {p.account}</p>
                          <div className="lsq-orow__tags">
                            {p.score !== null ? <Badge color={p.score >= 80 ? 'success' : p.score >= 60 ? 'blue' : 'gray'} text={`Score ${p.score}`} /> : <Badge color="gray" text="Unscored" />}
                            {p.checkStatus === 'verified' && <Badge color="success" text="Verified" />}
                            {isSent ? <Badge color="success" text="Sent" dot /> : isSkipped ? <Badge color="gray" text="Skipped" dot /> : <Badge color="blue" text="Pending" dot />}
                          </div>
                          <p className="lsq-orow__meta lsq-int-links">
                            {p.slug ? (
                              <a href={profileUrl(p.slug)} target="_blank" rel="noopener noreferrer" className="lsq-linkbtn">in/{p.slug}</a>
                            ) : (
                              <a href={peopleSearchUrl(p.name, p.account)} target="_blank" rel="noopener noreferrer" className="lsq-linkbtn">Search on LinkedIn</a>
                            )}
                            {' · '}
                            <button type="button" className="lsq-linkbtn" onClick={() => { setEditProfileContact(p); setProfileInput(p.slug ? `https://linkedin.com/in/${p.slug}` : ''); }}>
                              {p.slug ? 'Change profile' : 'Add profile'}
                            </button>
                          </p>
                        </div>
                      </div>

                      <div className="lsq-orow__msg">
                        <div className="lsq-msgbox" data-clamp={long && !isOpen ? 'true' : 'false'} id={`msg-${p.id}`}>{p.message}</div>
                        <div className="lsq-orow__foot" data-over={p.exceedsLimit ? 'true' : 'false'}>
                          <span>
                            {p.charCount} of 300 characters{p.exceedsLimit ? '. LinkedIn trims connection notes at 300, so send this as a message after connecting or shorten it.' : ''}
                            {p.personalized ? ' · Personalized' : ''}
                          </span>
                          {long && (
                            <button type="button" className="lsq-linkbtn" onClick={() => toggleExpanded(p.id)} aria-expanded={isOpen} aria-controls={`msg-${p.id}`}>
                              {isOpen ? 'Show less' : 'Show full message'}
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="lsq-orow__actions">
                        {!isSent && (
                          <Button hierarchy="primary" size="sm" icon={<Icon name="external" size={16} />} onClick={() => handleOpenAndCopy(p)} title="Copy the message and open LinkedIn in a new tab">
                            Open &amp; Copy
                          </Button>
                        )}
                        <div className="lsq-orow__icons">
                          <Button hierarchy="tertiary" size="sm" iconPosition="only" icon={<Icon name={copiedId === p.id ? 'check' : 'copy'} size={16} />} ariaLabel={`Copy message for ${p.name}`} title="Copy message" onClick={() => handleCopyOnly(p)} />
                          {!isSent && (
                            <Button hierarchy="tertiary" size="sm" iconPosition="only" icon={<Icon name="check" size={16} />} ariaLabel={`Mark ${p.name} as sent`} title="Mark as sent without opening LinkedIn" onClick={() => handleMarkStatus(p.id, 'sent')} />
                          )}
                          {!isSent && (
                            <Button hierarchy="tertiary" size="sm" iconPosition="only" icon={<Icon name={isSkipped ? 'undo' : 'skip'} size={16} />} ariaLabel={isSkipped ? `Unskip ${p.name}` : `Skip ${p.name}`} title={isSkipped ? 'Move back to pending' : 'Skip this person'} onClick={() => handleMarkStatus(p.id, isSkipped ? 'pending' : 'skipped')} />
                          )}
                          {isSent && (
                            <Button hierarchy="tertiary" size="sm" icon={<Icon name="undo" size={16} />} onClick={() => handleMarkStatus(p.id, 'pending')}>
                              Undo
                            </Button>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </div>

      {/* Fast-Runner HUD Modal */}
      {selectedEventId && (
        <LinkedInFastRunnerModal
          campaignId={selectedEventId}
          campaignTitle={currentEvent?.name || 'Webinar Outreach'}
          queue={queue.map((p) => ({
            id: p.id,
            name: p.name,
            title: p.title,
            account: p.account,
            url: p.destinationUrl,
            message: p.message,
            personalized: p.personalized,
            personalizedInvalid: p.personalizedInvalid,
            slug: p.slug,
            checkStatus: p.checkStatus,
            checkNote: p.checkNote,
          }))}
          initialProgress={fastRunnerProgress}
          isOpen={fastRunnerOpen}
          onClose={() => setFastRunnerOpen(false)}
          onProgressUpdate={handleFastRunnerUpdate}
        />
      )}

      {/* Edit Profile Slug Modal */}
      {editProfileContact && (
        <Modal
          isOpen={!!editProfileContact}
          onClose={() => setEditProfileContact(null)}
          title={`LinkedIn Profile For ${editProfileContact.name}`}
        >
          <div className="lsq-stack lsq-stack--lg">
            <p className="lsq-hint">
              Paste the direct profile address, for example <code>https://linkedin.com/in/username</code>. It is saved so future sends open the profile directly.
            </p>

            <Field label="LinkedIn profile address">
              {(p) => (
                <input {...p} className="lsq-input" type="url" value={profileInput} onChange={(e) => setProfileInput(e.target.value)} placeholder="https://www.linkedin.com/in/username" autoFocus />
              )}
            </Field>

            <div className="lsq-cluster lsq-int-end">
              <Button hierarchy="secondary" size="sm" onClick={() => setEditProfileContact(null)}>
                Cancel
              </Button>
              <Button hierarchy="primary" size="sm" disabled={savingProfile} onClick={handleSaveEditedProfile}>
                {savingProfile ? 'Saving…' : 'Save Profile'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
