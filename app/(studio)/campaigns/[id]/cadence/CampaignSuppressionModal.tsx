'use client';

import { useEffect, useState, useMemo } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { formatLsqDate } from '@/lib/dateFormat';
import {
  getCampaignSuppressionsAction,
  addCampaignSuppressionAction,
  bulkAddCampaignSuppressionAction,
  removeCampaignSuppressionAction,
} from '@/lib/actions/campaignSuppression';
import { getSuppressionListAction } from '@/lib/actions/netcore';

interface CampaignSuppressionModalProps {
  campaignId: string;
  campaignName: string;
  onClose: () => void;
  onChanged?: () => void;
}

interface CampaignSuppressionItem {
  id: string;
  email: string;
  reason: string;
  source: string;
  createdAt: string | Date;
}

interface GlobalSuppressionItem {
  id: string;
  email: string;
  reason: string;
  provider: string;
  createdAt: string | Date;
}

export function CampaignSuppressionModal({
  campaignId,
  campaignName,
  onClose,
  onChanged,
}: CampaignSuppressionModalProps) {
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<'campaign' | 'global'>('campaign');

  // Campaign items state
  const [loading, setLoading] = useState(true);
  const [campaignItems, setCampaignItems] = useState<CampaignSuppressionItem[]>([]);
  const [search, setSearch] = useState('');
  const [selectedReasonFilter, setSelectedReasonFilter] = useState<string>('all');
  const [refreshKey, setRefreshKey] = useState(0);

  // Single add form
  const [showAddForm, setShowAddForm] = useState(false);
  const [newTarget, setNewTarget] = useState('');
  const [newReason, setNewReason] = useState('competitor');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Bulk import section
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkReason, setBulkReason] = useState('csv_import');
  const [bulkImporting, setBulkImporting] = useState(false);

  // Remove confirmation
  const [itemToRemove, setItemToRemove] = useState<CampaignSuppressionItem | null>(null);
  const [removing, setRemoving] = useState(false);

  // Global suppression items state
  const [globalItems, setGlobalItems] = useState<GlobalSuppressionItem[]>([]);
  const [globalTotal, setGlobalTotal] = useState(0);
  const [globalLoading, setGlobalLoading] = useState(false);

  // Load campaign suppressions
  useEffect(() => {
    let canceled = false;
    getCampaignSuppressionsAction(campaignId, search.trim() || undefined)
      .then((res) => {
        if (canceled) return;
        if (res.ok && res.items) {
          setCampaignItems(res.items);
        } else {
          showToast(res.error || 'Failed to load webinar suppression list');
        }
      })
      .catch(() => {
        if (canceled) return;
        showToast('Failed to load webinar suppression list');
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });

    return () => {
      canceled = true;
    };
  }, [campaignId, search, refreshKey, showToast]);

  // Load global suppressions on tab switch
  useEffect(() => {
    if (activeTab !== 'global') return;
    let canceled = false;
    getSuppressionListAction({ page: 1, pageSize: 50 })
      .then((res) => {
        if (canceled) return;
        setGlobalItems(res.items);
        setGlobalTotal(res.total);
      })
      .catch(() => {
        if (canceled) return;
      })
      .finally(() => {
        if (!canceled) setGlobalLoading(false);
      });

    return () => {
      canceled = true;
    };
  }, [activeTab]);

  // Escape peels back one layer at a time: the remove confirmation (which handles its own Escape),
  // then an open add/bulk form, then the dialog itself. Modal wires this to Escape, the close
  // button and the backdrop.
  const handleDismiss = () => {
    if (itemToRemove) return;
    if (showAddForm) setShowAddForm(false);
    else if (showBulkImport) setShowBulkImport(false);
    else onClose();
  };

  // Metrics
  const stats = useMemo(() => {
    const total = campaignItems.length;
    const domains = campaignItems.filter((i) => i.email.startsWith('@')).length;
    const emails = total - domains;
    return { total, domains, emails };
  }, [campaignItems]);

  // Filtered campaign items
  const filteredCampaignItems = useMemo(() => {
    if (selectedReasonFilter === 'all') return campaignItems;
    return campaignItems.filter((item) => item.reason.toLowerCase() === selectedReasonFilter.toLowerCase());
  }, [campaignItems, selectedReasonFilter]);

  async function handleAddSingle(e?: React.FormEvent) {
    if (e) e.preventDefault();
    setAddError(null);
    const trimmed = newTarget.trim();
    if (!trimmed) {
      setAddError('Enter an email (for example user@domain.com) or a domain (for example @competitor.com)');
      return;
    }

    setAdding(true);
    try {
      const res = await addCampaignSuppressionAction(campaignId, trimmed, newReason);
      if (!res.ok) {
        setAddError(res.error || 'Failed to add exclusion');
        setAdding(false);
        return;
      }
      showToast(`Added "${trimmed}" to webinar exclusion list`);
      setNewTarget('');
      setShowAddForm(false);
      setRefreshKey((k) => k + 1);
      onChanged?.();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Error adding exclusion');
    } finally {
      setAdding(false);
    }
  }

  async function handleBulkImport() {
    if (!bulkText.trim()) {
      showToast('Enter or upload a list of emails or domains');
      return;
    }

    setBulkImporting(true);
    try {
      const res = await bulkAddCampaignSuppressionAction(campaignId, bulkText, bulkReason);
      if (!res.ok) {
        showToast(res.error || 'Bulk import failed');
      } else {
        showToast(`Added ${res.added} exclusion target(s) to this webinar`);
        setBulkText('');
        setShowBulkImport(false);
        setRefreshKey((k) => k + 1);
        onChanged?.();
      }
    } catch {
      showToast('Error during bulk import');
    } finally {
      setBulkImporting(false);
    }
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (text) {
        setBulkText(text);
      }
    };
    reader.readAsText(file);
  }

  async function handleConfirmRemove() {
    if (!itemToRemove) return;
    setRemoving(true);
    try {
      const res = await removeCampaignSuppressionAction(campaignId, itemToRemove.id);
      if (res.ok) {
        showToast(`Removed "${itemToRemove.email}" from webinar exclusion list`);
        setCampaignItems((prev) => prev.filter((i) => i.id !== itemToRemove.id));
        setItemToRemove(null);
        onChanged?.();
      } else {
        showToast(res.error || 'Failed to remove exclusion');
      }
    } catch {
      showToast('Failed to remove exclusion');
    } finally {
      setRemoving(false);
    }
  }

  const reasonLabel = (r: string) => r.replace(/_/g, ' ');

  return (
    <>
      <Modal
        isOpen
        onClose={handleDismiss}
        busy={!!itemToRemove}
        size="lg"
        title="Webinar Suppression & Exclusion List"
        subtitle={`Configure exclusion rules for ${campaignName}. Matching contacts are prevented from receiving outreach sends for this webinar.`}
        footer={
          <>
            <span className="lsq-hint lsq-res-footnote">
              Exclusions prevent cadence outreach sends for this webinar while registered attendees stay eligible for reminders.
            </span>
            <Button hierarchy="secondary" size="md" onClick={onClose}>
              Done
            </Button>
          </>
        }
      >
        <div className="lsq-stack">
          <div className="lsq-tabs" role="tablist" aria-label="Suppression lists">
            <button type="button" role="tab" id="supp-tab-campaign" aria-selected={activeTab === 'campaign'} aria-controls="supp-panel" className="lsq-tab" onClick={() => setActiveTab('campaign')}>
              This Webinar&apos;s Exclusions
              <Badge color={activeTab === 'campaign' ? 'blue' : 'gray'} text={stats.total.toLocaleString()} />
            </button>
            <button type="button" role="tab" id="supp-tab-global" aria-selected={activeTab === 'global'} aria-controls="supp-panel" className="lsq-tab" onClick={() => setActiveTab('global')}>
              Global Account Suppression
              <Badge color={activeTab === 'global' ? 'blue' : 'gray'} text={globalTotal.toLocaleString()} />
            </button>
          </div>

          <div id="supp-panel" role="tabpanel" aria-labelledby={activeTab === 'campaign' ? 'supp-tab-campaign' : 'supp-tab-global'} className="lsq-stack">
            {activeTab === 'campaign' ? (
              <>
                <div className="lsq-grid lsq-grid--narrow">
                  <div className="lsq-res-tile">
                    <p className="lsq-stat__label">Total Excluded</p>
                    <p className="lsq-stat__value">{stats.total.toLocaleString()}</p>
                  </div>
                  <div className="lsq-res-tile">
                    <p className="lsq-stat__label">Domain wildcards</p>
                    <p className="lsq-stat__value">{stats.domains.toLocaleString()}</p>
                  </div>
                  <div className="lsq-res-tile">
                    <p className="lsq-stat__label">Specific lead emails</p>
                    <p className="lsq-stat__value">{stats.emails.toLocaleString()}</p>
                  </div>
                </div>

                <div className="lsq-toolbar">
                  <div className="lsq-toolbar__group lsq-grow">
                    <div className="lsq-search">
                      <Icon name="search" size={16} />
                      <input
                        type="text"
                        className="lsq-input"
                        aria-label="Search exclusions"
                        placeholder="Search exclusions"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </div>
                    <select
                      className="lsq-select"
                      aria-label="Filter by reason"
                      value={selectedReasonFilter}
                      onChange={(e) => setSelectedReasonFilter(e.target.value)}
                    >
                      <option value="all">All Reasons</option>
                      <option value="competitor">Competitor</option>
                      <option value="existing_client">Existing Client</option>
                      <option value="external_registrant">External Registrant</option>
                      <option value="internal_staff">Internal Team</option>
                      <option value="manual">Manual</option>
                      <option value="csv_import">CSV Import</option>
                    </select>
                  </div>

                  <div className="lsq-toolbar__group">
                    <Button
                      hierarchy="secondary"
                      size="sm"
                      icon={<Icon name="upload" size={14} />}
                      onClick={() => {
                        setShowBulkImport(!showBulkImport);
                        if (showAddForm) setShowAddForm(false);
                      }}
                    >
                      Bulk Import CSV
                    </Button>
                    <Button
                      hierarchy="primary"
                      size="sm"
                      icon={<Icon name="plus" size={14} />}
                      onClick={() => {
                        setShowAddForm(!showAddForm);
                        if (showBulkImport) setShowBulkImport(false);
                      }}
                    >
                      Add Exclusion
                    </Button>
                  </div>
                </div>

                {showAddForm && (
                  <form onSubmit={handleAddSingle} className="lsq-res-subform">
                    <div className="lsq-cluster lsq-cluster--between">
                      <h3 className="lsq-res-subform__title">Add Single Exclusion to This Webinar</h3>
                      <Button hierarchy="tertiary" size="sm" onClick={() => setShowAddForm(false)}>
                        Cancel
                      </Button>
                    </div>

                    <div className="lsq-grid lsq-grid--wide">
                      <Field label="Email or domain" error={addError} hint="Prepend with @ (like @competitor.com) to exclude every address under that domain.">
                        {(p) => (
                          <input
                            type="text"
                            className="lsq-input lsq-res-mono"
                            {...p}
                            placeholder="alex@competitor.com or @competitor.com"
                            value={newTarget}
                            onChange={(e) => setNewTarget(e.target.value)}
                            disabled={adding}
                            autoFocus
                          />
                        )}
                      </Field>
                      <Field label="Reason">
                        {(p) => (
                          <select className="lsq-select" {...p} value={newReason} onChange={(e) => setNewReason(e.target.value)} disabled={adding}>
                            <option value="competitor">Competitor</option>
                            <option value="existing_client">Existing Client</option>
                            <option value="external_registrant">External Registrant</option>
                            <option value="internal_staff">Internal Team</option>
                            <option value="manual">Manual Exclusion</option>
                          </select>
                        )}
                      </Field>
                    </div>
                    <div className="lsq-cluster">
                      <Button hierarchy="primary" size="sm" type="submit" loading={adding}>
                        {adding ? 'Adding' : 'Add'}
                      </Button>
                    </div>
                  </form>
                )}

                {showBulkImport && (
                  <div className="lsq-res-subform">
                    <div className="lsq-cluster lsq-cluster--between">
                      <h3 className="lsq-res-subform__title">Bulk Import Exclusion List (CSV or Text)</h3>
                      <Button hierarchy="tertiary" size="sm" onClick={() => setShowBulkImport(false)}>
                        Cancel
                      </Button>
                    </div>

                    <Field label="Emails or domains" hint="Separate with commas or new lines.">
                      {(p) => (
                        <textarea
                          rows={4}
                          className="lsq-input lsq-res-mono"
                          {...p}
                          placeholder={'partner1@example.com\n@competitor.com\nclient@acme.com'}
                          value={bulkText}
                          onChange={(e) => setBulkText(e.target.value)}
                          disabled={bulkImporting}
                        />
                      )}
                    </Field>

                    <div className="lsq-toolbar">
                      <div className="lsq-toolbar__group">
                        <label className="lsq-btn lsq-btn--sm lsq-btn--secondary lsq-res-file">
                          <Icon name="upload" size={14} />
                          Upload .csv / .txt
                          <input type="file" accept=".csv,.txt" onChange={handleFileUpload} className="lsq-sr-only" />
                        </label>
                        <select className="lsq-select" aria-label="Reason for imported rows" value={bulkReason} onChange={(e) => setBulkReason(e.target.value)}>
                          <option value="csv_import">CSV Import</option>
                          <option value="competitor">Competitor</option>
                          <option value="existing_client">Existing Client</option>
                          <option value="external_registrant">External Registrant</option>
                        </select>
                      </div>
                      <Button hierarchy="primary" size="sm" onClick={handleBulkImport} loading={bulkImporting} disabled={!bulkText.trim()}>
                        {bulkImporting ? 'Importing' : 'Import to Webinar'}
                      </Button>
                    </div>
                  </div>
                )}

                {loading ? (
                  <div className="lsq-empty" role="status">
                    <span className="lsq-spinner" aria-hidden="true" />
                    <p className="lsq-empty__body">Loading webinar suppression list</p>
                  </div>
                ) : filteredCampaignItems.length === 0 ? (
                  <div className="lsq-empty">
                    <span className="lsq-empty__icon"><Icon name="shield" size={32} /></span>
                    <h3 className="lsq-empty__title">No webinar-specific exclusions found</h3>
                    <p className="lsq-empty__body">
                      {search
                        ? 'No exclusions matched the search query.'
                        : 'Add emails or competitor domains above to exclude them from this webinar.'}
                    </p>
                  </div>
                ) : (
                  <div className="lsq-table-wrap" tabIndex={0} role="region" aria-label="Scrollable table">
                    <table className="lsq-table">
                      <thead>
                        <tr>
                          <th scope="col">Target pattern</th>
                          <th scope="col">Reason</th>
                          <th scope="col">Source</th>
                          <th scope="col">Added</th>
                          <th scope="col"><span className="lsq-sr-only">Actions</span></th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredCampaignItems.map((item) => {
                          const isDomain = item.email.startsWith('@');
                          return (
                            <tr key={item.id}>
                              <td>
                                <div className="lsq-cluster">
                                  <span className="lsq-cell-primary lsq-res-mono">{item.email}</span>
                                  {isDomain && <Badge color="amber" text="Domain wildcard" />}
                                </div>
                              </td>
                              <td>
                                <Badge color={item.reason === 'competitor' ? 'red' : 'blue'} text={reasonLabel(item.reason)} />
                              </td>
                              <td className="lsq-cell-secondary">{item.source}</td>
                              <td className="lsq-cell-secondary">{formatLsqDate(new Date(item.createdAt))}</td>
                              <td>
                                <div className="lsq-res-cell-end">
                                  <Button hierarchy="secondary" size="sm" ariaLabel={`Remove ${item.email}`} onClick={() => setItemToRemove(item)}>
                                    Remove
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="lsq-banner lsq-banner--neutral" role="note">
                  <Icon name="info" size={16} />
                  <p className="lsq-banner__body">
                    These emails are suppressed globally across <strong>all webinars</strong> due to hard bounces, spam complaints, or unsubscribes recorded by Netcore Cloud and LeadSquared.
                  </p>
                </div>

                {globalLoading ? (
                  <div className="lsq-empty" role="status">
                    <span className="lsq-spinner" aria-hidden="true" />
                    <p className="lsq-empty__body">Loading global suppression list</p>
                  </div>
                ) : globalItems.length === 0 ? (
                  <div className="lsq-empty">
                    <p className="lsq-empty__body">No global suppression records.</p>
                  </div>
                ) : (
                  <div className="lsq-table-wrap" tabIndex={0} role="region" aria-label="Scrollable table">
                    <table className="lsq-table">
                      <thead>
                        <tr>
                          <th scope="col">Suppressed email</th>
                          <th scope="col">Reason</th>
                          <th scope="col">Gateway</th>
                          <th scope="col">Timestamp</th>
                        </tr>
                      </thead>
                      <tbody>
                        {globalItems.map((item) => (
                          <tr key={item.id}>
                            <td className="lsq-cell-primary lsq-res-mono">{item.email}</td>
                            <td>
                              <Badge color="red" text={item.reason} />
                            </td>
                            <td className="lsq-cell-secondary">{item.provider}</td>
                            <td className="lsq-cell-secondary">{formatLsqDate(new Date(item.createdAt))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </Modal>

      {itemToRemove && (
        <ConfirmDialog
          title="Remove Webinar Exclusion?"
          message={`Remove "${itemToRemove.email}" from this webinar's exclusion list? This address will become eligible to receive outreach for this campaign if re-approved.`}
          confirmLabel={removing ? 'Removing' : 'Remove Exclusion'}
          destructive={true}
          busy={removing}
          onConfirm={handleConfirmRemove}
          onClose={() => setItemToRemove(null)}
        />
      )}
    </>
  );
}
