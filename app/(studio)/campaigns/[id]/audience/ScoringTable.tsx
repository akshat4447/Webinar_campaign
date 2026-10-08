'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Checkbox } from '@/components/ui/Checkbox';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { NavButton } from '@/components/ui/NavButton';
import { setApprovalAction, bulkSetApprovalAction, updateContactPhoneAction, exportScoredContactsAction } from '@/lib/actions/scoring';
import { verifyInferredEmailsAction } from '@/lib/actions/enrichment';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/Toast';
import type { Contact } from '@/lib/generated/prisma/client';

function scoreBadgeColor(score: number): string {
  if (score >= 85) return 'success';
  if (score >= 70) return 'blue';
  return 'warning';
}

function initials(name: string): string {
  return name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();
}

function sourceColor(source: string): string {
  if (source === 'LinkedIn') return 'gray blue';
  if (source === 'LinkedIn+Apollo') return 'blue light';
  return 'gray';
}

export function ScoringTable({
  campaignId,
  contacts: initialContacts,
  threshold,
  locked = false,
  totalMatching,
  totalApproved,
  filter,
}: {
  campaignId: string;
  contacts: Contact[];
  threshold: number;
  locked?: boolean;
  /** Rows matching the active search/band filter across the whole campaign —
   *  not just this page. The header used to report `contacts.length`, which is
   *  the page size, so a 5,000-contact campaign read "50 of 50 contacts". */
  totalMatching: number;
  /** Approved across the whole campaign, for the same reason. */
  totalApproved: number;
  /** The active filter, so "Export all matching" can reproduce it server-side. */
  filter: { q: string; band: string };
}) {
  const { showToast } = useToast();
  const [contacts, setContacts] = useState(initialContacts);
  const [seen, setSeen] = useState(initialContacts);
  const [verifying, setVerifying] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Search, band filter and paging are executed by the database now and arrive
  // as props, so a new page must replace local state rather than be filtered
  // on top of.
  if (seen !== initialContacts) {
    setSeen(initialContacts);
    setContacts(initialContacts);
  }
  const router = useRouter();

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const unverifiedCount = contacts.filter((c) => c.emailSimulated && !c.emailVerified).length;

  async function verifyInferred() {
    const prev = contacts;
    const targetIds = contacts.filter((c) => c.emailSimulated && !c.emailVerified).map((c) => c.id);
    setVerifying(true);
    try {
      // The action returns only a count of rows actually verified server-side
      // (there's a race if something else touched these contacts between
      // render and click) — not the ids, so we can only trust the optimistic
      // update when that count covers every contact we expected to affect.
      // A short count means some of these weren't verified; router.refresh()
      // below reconciles local state with the real outcome via the seen/
      // initialContacts resync above instead of guessing which ones changed.
      const count = await verifyInferredEmailsAction(campaignId);
      if (count >= targetIds.length && targetIds.length > 0) {
        setContacts((cs) => cs.map((c) => (targetIds.includes(c.id) ? { ...c, emailVerified: true } : c)));
      } else if (count > 0) {
        showToast(`Verified ${count} of ${targetIds.length} inferred email${targetIds.length === 1 ? '' : 's'} — refreshing to show the rest.`);
      } else {
        showToast('No inferred emails were verified.');
      }
      router.refresh();
    } catch (err) {
      setContacts(prev);
      showToast(err instanceof Error ? err.message : 'Failed to verify inferred emails.');
    } finally {
      setVerifying(false);
    }
  }

  // "Filtered" is now simply the page the server sent. Campaign-wide totals
  // come in as props — counting `contacts` here only ever described this page.
  const filtered = contacts;
  const allFilteredApproved = filtered.length > 0 && filtered.every((c) => c.approved);

  async function toggle(c: Contact) {
    const prev = contacts;
    const next = !c.approved;
    setContacts((cs) => cs.map((x) => (x.id === c.id ? { ...x, approved: next } : x)));
    try {
      await setApprovalAction(c.id, next);
    } catch (err) {
      setContacts(prev);
      showToast(err instanceof Error ? err.message : 'Failed to update approval.');
    }
  }

  async function bulkSet(checked: boolean) {
    const prev = contacts;
    const ids = filtered.map((c) => c.id);
    setContacts((cs) => cs.map((x) => (ids.includes(x.id) ? { ...x, approved: checked } : x)));
    try {
      await bulkSetApprovalAction(ids, checked, campaignId);
      // This only ever covered the current page; saying so out loud stops it
      // reading as "approved everyone" on a paginated list.
      showToast(`${checked ? 'Approved' : 'Un-approved'} ${ids.length} contact${ids.length === 1 ? '' : 's'} on this page.`);
    } catch (err) {
      setContacts(prev);
      showToast(err instanceof Error ? err.message : 'Failed to update approvals in bulk.');
    }
  }

  async function exportCsv() {
    setExporting(true);
    try {
      // Fetched from the server rather than serialized from `contacts`: that
      // is only the current 50-row page, so the export silently handed over a
      // fraction of the list the operator thought they were exporting.
      const res = await exportScoredContactsAction(campaignId, filter);
      const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const head = ['Name', 'Account', 'Title', 'Function', 'Seniority', 'Vertical', 'Email', 'Source', 'Score', 'Approved'];
      const lines = [head.map(esc).join(',')].concat(
        res.rows.map((c) =>
          [c.name, c.account, c.title, c.function, c.seniority, c.vertical, c.email ?? '', c.source, c.score ?? '', c.approved ? 'Yes' : 'No']
            .map(esc)
            .join(',')
        )
      );
      const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'scored-invite-list.csv';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 3000);
      showToast(`Exported ${res.rows.length.toLocaleString()} contact${res.rows.length === 1 ? '' : 's'}.`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not export the list.');
    } finally {
      setExporting(false);
    }
  }

  return (
    <section className="lsq-card" aria-labelledby="aud-table">
      <div className="lsq-card__header">
        <div>
          <h2 className="lsq-card__title" id="aud-table">Scored Invite List</h2>
          <p className="lsq-card__sub">
            Showing {filtered.length.toLocaleString()} of {totalMatching.toLocaleString()} contact{totalMatching === 1 ? '' : 's'}
            {(filter.q || filter.band !== 'all') && ' matching this filter'}
          </p>
        </div>
        <Badge color={locked ? 'gray' : 'blue light'} text={`${totalApproved.toLocaleString()} approved in this campaign`} />
      </div>

      {!locked && unverifiedCount > 0 && (
        <div className="lsq-card__body">
          <div className="lsq-banner lsq-banner--warning" role="status">
            <Icon name="warning" size={16} />
            <div className="lsq-grow">
              <p className="lsq-banner__title">
                {unverifiedCount} inferred email{unverifiedCount === 1 ? '' : 's'} need verification
              </p>
              <p className="lsq-banner__body">
                Pattern-guessed from a name and company by enrichment, not supplied by the source. They can&apos;t be sent to until confirmed.
              </p>
              <div className="lsq-banner__actions">
                <Button hierarchy="secondary" size="sm" onClick={verifyInferred} loading={verifying}>
                  {verifying ? 'Verifying…' : `Verify ${unverifiedCount} email${unverifiedCount === 1 ? '' : 's'}`}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="lsq-table-wrap" tabIndex={0} role="region" aria-label="Scrollable table">
        <table className="lsq-table lsq-ov-table--aud">
          <thead>
            <tr>
              <th scope="col">
                {locked ? (
                  <span className="lsq-sr-only">Approval</span>
                ) : (
                  <Checkbox
                    checked={allFilteredApproved}
                    onChange={bulkSet}
                    size={16}
                    aria-label={`Approve all ${filtered.length} contacts on this page`}
                  />
                )}
              </th>
              <th scope="col">Contact</th>
              <th scope="col">Account · vertical</th>
              <th scope="col">Title / function</th>
              <th scope="col">Source</th>
              <th scope="col">Mobile (SMS/WA)</th>
              <th scope="col">Relevance</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => {
              const score = c.score ?? 0;
              const why = [c.explanation, c.personaNote].filter(Boolean) as string[];
              const open = expanded.has(c.id);
              return (
                <tr key={c.id} data-approved={c.approved}>
                  <td>
                    {locked ? (
                      <Badge color={c.approved ? 'success' : 'gray'} text={c.approved ? 'Approved' : 'Not approved'} />
                    ) : (
                      <Checkbox
                        checked={c.approved}
                        onChange={() => toggle(c)}
                        aria-label={`${c.approved ? 'Un-approve' : 'Approve'} ${c.name}${c.account ? ` at ${c.account}` : ''}`}
                      />
                    )}
                  </td>
                  <td>
                    <div className="lsq-ov-contact">
                      <span className="lsq-avatar" aria-hidden="true">{initials(c.name)}</span>
                      <div>
                        <div className="lsq-ov-contact__name">{c.name}</div>
                        <div className="lsq-ov-contact__meta" data-warn={c.emailSimulated && !c.emailVerified}>
                          {c.seniority} ·{' '}
                          {c.emailSimulated
                            ? c.emailVerified
                              ? 'inferred · verified'
                              : 'inferred · needs verification'
                            : c.missingInfo
                            ? 'email missing'
                            : 'verified email'}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>
                    {c.account}
                    <span className="lsq-ov-sub">{c.vertical}</span>
                  </td>
                  <td>
                    {c.title}
                    <span className="lsq-ov-sub">{c.function}</span>
                  </td>
                  <td>
                    <Badge color={sourceColor(c.source)} text={c.source} />
                  </td>
                  <td>
                    {locked ? (
                      <span className="lsq-ov-subtle">{c.phone ?? '—'}</span>
                    ) : (
                      <PhoneCell
                        contactId={c.id}
                        initial={c.phone ?? ''}
                        onChange={(phone) => setContacts((cs) => cs.map((x) => (x.id === c.id ? { ...x, phone: phone || null } : x)))}
                      />
                    )}
                  </td>
                  <td className="lsq-ov-score">
                    <div className="lsq-ov-score__line">
                      <Badge color={scoreBadgeColor(score)} text={String(score)} />
                      <div className="lsq-progress" aria-hidden="true">
                        <div className="lsq-progress__bar" style={{ width: `${score}%` }} />
                      </div>
                      {score >= threshold && <Badge color="success" text="Auto" />}
                    </div>
                    {why.length > 0 && (
                      <div className="lsq-ov-score__why">
                        <button
                          type="button"
                          className="lsq-linkbtn"
                          aria-expanded={open}
                          aria-controls={`why-${c.id}`}
                          onClick={() => toggleExpanded(c.id)}
                        >
                          {open ? 'Hide explanation' : 'Why this score'}
                        </button>
                        {open && (
                          <div id={`why-${c.id}`}>
                            {why.map((line, i) => (
                              <p key={i} className="lsq-ov-why">{line}</p>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && <p className="lsq-empty__body">No contacts match these filters.</p>}
      </div>

      <div className="lsq-card__footer">
        <Button hierarchy="secondary" icon={<Icon name="download" size={16} />} onClick={exportCsv} loading={exporting}>
          {exporting ? 'Exporting…' : `Export All ${totalMatching.toLocaleString()} (.csv)`}
        </Button>
        {/* Was "Approve & continue to messaging": it only navigates, so the
            label promised a bulk approval that never happened. */}
        {!locked && <NavButton href={`/campaigns/${campaignId}/messaging`}>Continue To Messaging</NavButton>}
      </div>
    </section>
  );
}

/** Inline mobile editor — saves on blur/Enter; feeds the SMS/WhatsApp channels. */
function PhoneCell({ contactId, initial, onChange }: { contactId: string; initial: string; onChange: (phone: string) => void }) {
  const [draft, setDraft] = useState(initial);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (draft.trim() === initial.trim()) return;
    setState('saving');
    const res = await updateContactPhoneAction(contactId, draft);
    if (!res.ok) {
      setState('error');
      setError(res.error ?? 'Could not save.');
      return;
    }
    onChange(draft.trim());
    setState('saved');
    setError(null);
    setTimeout(() => setState('idle'), 1500);
  }

  return (
    <div className="lsq-ov-phone">
      <input
        className="lsq-input"
        type="tel"
        aria-label="Mobile number"
        value={draft}
        placeholder="Add mobile"
        onChange={(e) => {
          setDraft(e.target.value);
          if (state === 'saved') setState('idle');
        }}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
      {state === 'saving' && <span className="lsq-ov-phone__state" role="status">Saving…</span>}
      {state === 'saved' && <span className="lsq-ov-phone__state" data-tone="good" role="status">Saved</span>}
      {state === 'error' && <span className="lsq-ov-phone__state" data-tone="bad" role="alert">{error}</span>}
    </div>
  );
}
