'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Field } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import { formatLsqDate } from '@/lib/dateFormat';
import {
  getSuppressionListAction,
  addSuppressionAction,
  removeSuppressionAction,
} from '@/lib/actions/netcore';

interface SuppressionListModalProps {
  onClose: () => void;
  onChanged?: () => void;
}

interface SuppressionItem {
  id: string;
  email: string;
  reason: string;
  provider: string;
  detail: string | null;
  createdAt: string | Date;
}

type ReasonFilter = 'all' | 'bounce' | 'unsubscribe' | 'spam' | 'manual';

export function SuppressionListModal({ onClose, onChanged }: SuppressionListModalProps) {
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<SuppressionItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(15);
  const [search, setSearch] = useState('');
  const [activeReason, setActiveReason] = useState<ReasonFilter>('all');
  const [counts, setCounts] = useState<Record<string, number>>({ bounce: 0, unsubscribe: 0, spam: 0, manual: 0 });
  const [refreshNonce, setRefreshNonce] = useState(0);

  // Add form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newReason, setNewReason] = useState<'bounce' | 'unsubscribe' | 'spam' | 'manual'>('manual');
  const [newDetail, setNewDetail] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Remove confirmation state
  const [emailToRemove, setEmailToRemove] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    let canceled = false;
    getSuppressionListAction({
      search: search.trim() || undefined,
      reason: activeReason === 'all' ? undefined : activeReason,
      page,
      pageSize,
    })
      .then((res) => {
        if (canceled) return;
        setItems(res.items);
        setTotal(res.total);
        setCounts(res.counts);
        setLoading(false);
      })
      .catch(() => {
        if (canceled) return;
        showToast('Failed to load suppression list');
        setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [search, activeReason, page, pageSize, refreshNonce, showToast]);

  // Modal closes on Escape / backdrop / X through this one handler, so peel the innermost layer first:
  // the removal confirm, then the add form, then the dialog itself.
  function handleClose() {
    if (emailToRemove) setEmailToRemove(null);
    else if (showAddForm) setShowAddForm(false);
    else onClose();
  }

  async function handleAdd() {
    if (!newEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail.trim())) {
      setAddError('Please enter a valid email address');
      return;
    }
    setAddError(null);
    setAdding(true);
    try {
      const res = await addSuppressionAction(newEmail.trim().toLowerCase(), newReason, newDetail.trim() || undefined);
      if (res.ok) {
        showToast(`Added ${newEmail.trim()} to suppression list`);
        setNewEmail('');
        setNewDetail('');
        setShowAddForm(false);
        setRefreshNonce((n) => n + 1);
        onChanged?.();
      } else {
        setAddError(res.error || 'Failed to add suppression');
      }
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Failed to add suppression');
    } finally {
      setAdding(false);
    }
  }

  async function handleRemoveConfirm() {
    if (!emailToRemove) return;
    setRemoving(true);
    try {
      const res = await removeSuppressionAction(emailToRemove);
      if (res.ok) {
        showToast(`Removed ${emailToRemove} from suppression list`);
        setEmailToRemove(null);
        setRefreshNonce((n) => n + 1);
        onChanged?.();
      } else {
        showToast(res.error || 'Failed to remove suppression');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to remove');
    } finally {
      setRemoving(false);
    }
  }

  const [exporting, setExporting] = useState(false);

  async function handleExportCsv() {
    if (total === 0) {
      showToast('No suppression records to export');
      return;
    }
    setExporting(true);
    try {
      // `items` is only the current page (pageSize rows) — export needs every
      // row matching the active search/reason filter, or the file silently
      // drops everything past the first page with no indication anything's
      // missing, for a feature whose whole point is proving who was excluded.
      const res = await getSuppressionListAction({
        search: search.trim() || undefined,
        reason: activeReason === 'all' ? undefined : activeReason,
        page: 1,
        pageSize: total,
      });
      const headers = ['Email', 'Reason', 'Provider', 'Diagnostic Detail', 'Added At'];
      const rows = res.items.map((i) => [
        `"${i.email}"`,
        `"${i.reason}"`,
        `"${i.provider}"`,
        `"${(i.detail || '').replace(/"/g, '""')}"`,
        `"${new Date(i.createdAt).toISOString()}"`,
      ]);
      const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `email-suppression-list-${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      showToast(`Exported ${res.items.length.toLocaleString()} record${res.items.length === 1 ? '' : 's'} to CSV`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to export CSV');
    } finally {
      setExporting(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function getReasonBadge(reason: string) {
    switch (reason.toLowerCase()) {
      case 'bounce':
        return <Badge color="error" text="Bounce" />;
      case 'unsubscribe':
        return <Badge color="warning" text="Unsubscribe" />;
      case 'spam':
        return <Badge color="purple" text="Spam complaint" />;
      case 'manual':
      default:
        return <Badge color="gray" text="Manual" />;
    }
  }

  return (
    <>
      <Modal
        isOpen
        onClose={handleClose}
        size="lg"
        title="Email Suppression List"
        subtitle="Suppressed recipients are skipped before outbound cadence dispatch to protect sender reputation."
        footer={
          <div className="lsq-int-pager">
            <span className="lsq-hint">
              Showing {items.length > 0 ? ((page - 1) * pageSize + 1).toLocaleString() : 0}–{Math.min(page * pageSize, total).toLocaleString()} of {total.toLocaleString()} suppressed emails
            </span>
            <div className="lsq-cluster">
              <Button hierarchy="secondary" size="sm" icon={<Icon name="chevron-left" size={16} />} disabled={page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                Previous
              </Button>
              <span className="lsq-hint">Page {page} of {totalPages}</span>
              <Button hierarchy="secondary" size="sm" icon={<Icon name="chevron-right" size={16} />} iconPosition="trailing" disabled={page >= totalPages || loading} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
                Next
              </Button>
            </div>
          </div>
        }
      >
        <div className="lsq-stack">
          <div className="lsq-toolbar">
            <div className="lsq-int-filters" role="group" aria-label="Filter by reason">
              {(
                [
                  { id: 'all', label: `All (${total.toLocaleString()})` },
                  { id: 'bounce', label: `Bounces (${(counts.bounce ?? 0).toLocaleString()})` },
                  { id: 'unsubscribe', label: `Unsubscribed (${(counts.unsubscribe ?? 0).toLocaleString()})` },
                  { id: 'spam', label: `Spam (${(counts.spam ?? 0).toLocaleString()})` },
                  { id: 'manual', label: `Manual (${(counts.manual ?? 0).toLocaleString()})` },
                ] as const
              ).map((tab) => {
                const active = activeReason === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    aria-pressed={active}
                    className={`lsq-btn lsq-btn--sm ${active ? 'lsq-btn--secondary-color' : 'lsq-btn--secondary'}`}
                    onClick={() => {
                      setActiveReason(tab.id);
                      setPage(1);
                    }}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            <div className="lsq-toolbar__group">
              <Button hierarchy="secondary" size="sm" icon={<Icon name="download" size={16} />} onClick={handleExportCsv} disabled={total === 0} loading={exporting}>
                {exporting ? 'Exporting…' : `Export CSV${total > 0 ? ` (${total.toLocaleString()})` : ''}`}
              </Button>
              <Button
                hierarchy="primary"
                size="sm"
                icon={<Icon name={showAddForm ? 'close' : 'plus'} size={16} />}
                onClick={() => {
                  setShowAddForm((prev) => !prev);
                  setAddError(null);
                }}
              >
                {showAddForm ? 'Cancel' : 'Add Email'}
              </Button>
            </div>
          </div>

          {showAddForm && (
            <div className="lsq-int-block">
              <p className="lsq-int-block__title">Add email to suppression list</p>
              <div className="lsq-int-add">
                <Field label="Email address" required error={addError}>
                  {(p) => (
                    <input {...p} className="lsq-input" type="email" placeholder="prospect@company.com" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
                  )}
                </Field>
                <Field label="Reason">
                  {(p) => (
                    <select
                      {...p}
                      className="lsq-select"
                      value={newReason}
                      onChange={(e) => setNewReason(e.target.value as 'bounce' | 'unsubscribe' | 'spam' | 'manual')}
                    >
                      <option value="manual">Manual</option>
                      <option value="bounce">Bounce</option>
                      <option value="unsubscribe">Unsubscribe</option>
                      <option value="spam">Spam complaint</option>
                    </select>
                  )}
                </Field>
                <Field label="Detail or note" optional>
                  {(p) => (
                    <input {...p} className="lsq-input" type="text" placeholder="e.g. Requested removal via phone" value={newDetail} onChange={(e) => setNewDetail(e.target.value)} />
                  )}
                </Field>
              </div>
              <div>
                <Button hierarchy="primary" size="sm" onClick={handleAdd} loading={adding}>
                  {adding ? 'Adding…' : 'Add Suppression'}
                </Button>
              </div>
            </div>
          )}

          <div className="lsq-search lsq-int-search">
            <Icon name="search" size={16} />
            <input
              className="lsq-input"
              type="search"
              aria-label="Search suppressed emails"
              placeholder="Search suppressed emails by address"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>

          {loading ? (
            <div className="lsq-empty" role="status">
              <span className="lsq-spinner" aria-hidden="true" />
              <p className="lsq-empty__body">Loading suppression list…</p>
            </div>
          ) : items.length === 0 ? (
            <div className="lsq-empty">
              <span className="lsq-empty__icon" aria-hidden="true"><Icon name="shield" size={32} /></span>
              <p className="lsq-empty__title">{search ? 'No Matching Suppressed Emails' : 'No Suppressed Emails Found'}</p>
              <p className="lsq-empty__body">
                {search
                  ? 'Try a different search or clear the filter.'
                  : 'Bounced recipients and unsubscribes will appear here automatically.'}
              </p>
            </div>
          ) : (
            <div className="lsq-table-wrap lsq-int-table-scroll">
              <table className="lsq-table">
                <thead>
                  <tr>
                    <th scope="col">Email</th>
                    <th scope="col">Reason</th>
                    <th scope="col">Detail</th>
                    <th scope="col">Added</th>
                    <th scope="col"><span className="lsq-sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td className="lsq-cell-primary">{item.email}</td>
                      <td>{getReasonBadge(item.reason)}</td>
                      <td className="lsq-cell-secondary lsq-cell-truncate" title={item.detail || ''}>{item.detail || '—'}</td>
                      <td className="lsq-cell-secondary lsq-int-nowrap">{formatLsqDate(new Date(item.createdAt))}</td>
                      <td className="lsq-int-right">
                        <Button hierarchy="destructive-outline" size="sm" ariaLabel={`Remove ${item.email} from the suppression list`} onClick={() => setEmailToRemove(item.email)}>
                          Remove
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Modal>

      {/* Confirmation Dialog for Removal */}
      {emailToRemove && (
        <ConfirmDialog
          title="Remove from suppression list?"
          message={`Are you sure you want to remove ${emailToRemove} from the suppression list?\n\nThis will re-enable outbound email delivery to this address for upcoming campaign cadences.`}
          confirmLabel={removing ? 'Removing…' : 'Re-activate / Remove'}
          busy={removing}
          onConfirm={handleRemoveConfirm}
          onClose={() => setEmailToRemove(null)}
        />
      )}
    </>
  );
}
