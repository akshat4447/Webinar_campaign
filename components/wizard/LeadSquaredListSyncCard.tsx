'use client';

import { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import {
  getLeadSquaredSuppressionConfigAction,
  createAndAttachLsqSuppressionListAction,
  updateCampaignSuppressionListsAction,
} from '@/lib/actions/lsqSuppression';
import type { LsqStaticListItem } from '@/lib/lsqSuppression';

interface LeadSquaredListSyncCardProps {
  campaignId: string;
  campaignTitle?: string;
  onChanged?: () => void;
}

export function LeadSquaredListSyncCard({
  campaignId,
  campaignTitle,
  onChanged,
}: LeadSquaredListSyncCardProps) {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [lists, setLists] = useState<LsqStaticListItem[]>([]);
  const [selectedSuppressionListId, setSelectedSuppressionListId] = useState<string>('');
  const [selectedExclusionListIds, setSelectedExclusionListIds] = useState<string[]>([]);
  const [registeredCount, setRegisteredCount] = useState(0);
  const [syncedCount, setSyncedCount] = useState(0);

  // Search filters
  const [suppressionSearch, setSuppressionSearch] = useState('');
  const [exclusionSearch, setExclusionSearch] = useState('');

  // New list creation state
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [newListDesc, setNewListDesc] = useState('');

  async function reloadConfig() {
    setRefreshing(true);
    setFetchError(null);
    try {
      const res = await getLeadSquaredSuppressionConfigAction(campaignId);
      if (res.ok) {
        setLists(res.lists);
        setSelectedSuppressionListId(res.suppressionListId || '');
        setSelectedExclusionListIds(res.exclusionListIds || []);
        setRegisteredCount(res.registeredCount);
        setSyncedCount(res.syncedToSuppressionCount);
        if (res.error) {
          setFetchError(res.error);
        }
      } else {
        setFetchError(res.error || 'Failed to fetch LeadSquared lists');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to connect to LeadSquared';
      setFetchError(msg);
      console.error('Failed to load LeadSquared suppression config:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    let canceled = false;
    getLeadSquaredSuppressionConfigAction(campaignId)
      .then((res) => {
        if (canceled) return;
        if (res.ok) {
          setLists(res.lists);
          setSelectedSuppressionListId(res.suppressionListId || '');
          setSelectedExclusionListIds(res.exclusionListIds || []);
          setRegisteredCount(res.registeredCount);
          setSyncedCount(res.syncedToSuppressionCount);
          if (res.error) setFetchError(res.error);
        } else if (res.error) {
          setFetchError(res.error);
        }
      })
      .catch((err) => {
        if (!canceled) {
          const msg = err instanceof Error ? err.message : 'Failed to connect to LeadSquared';
          setFetchError(msg);
          console.error('Failed to load LeadSquared suppression config:', err);
        }
      })
      .finally(() => {
        if (!canceled) {
          setLoading(false);
        }
      });

    return () => {
      canceled = true;
    };
  }, [campaignId]);

  async function handleSaveSettings() {
    setSaving(true);
    try {
      const res = await updateCampaignSuppressionListsAction(
        campaignId,
        selectedSuppressionListId || null,
        selectedExclusionListIds
      );
      if (res.ok) {
        showToast('LeadSquared suppression and exclusion lists updated.');
        onChanged?.();
        reloadConfig();
      } else {
        showToast(res.error || 'Failed to update settings');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Error updating settings');
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateNewList() {
    const trimmed = newListName.trim();
    if (!trimmed) {
      showToast('List name is required');
      return;
    }
    setCreating(true);
    try {
      const res = await createAndAttachLsqSuppressionListAction(
        campaignId,
        trimmed,
        newListDesc
      );
      if (res.ok && res.listId) {
        if (res.reused) {
          showToast(`Connected to existing LeadSquared list "${res.listName}".`);
        } else {
          showToast(`Created LeadSquared list "${res.listName}" and attached it as the suppression list.`);
        }
        setShowCreateDialog(false);
        setNewListName('');
        setNewListDesc('');
        onChanged?.();
        await reloadConfig();
      } else {
        showToast(res.error || 'Failed to create list in LeadSquared');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Error creating list');
    } finally {
      setCreating(false);
    }
  }

  function toggleExclusionList(listId: string) {
    setSelectedExclusionListIds((prev) =>
      prev.includes(listId) ? prev.filter((id) => id !== listId) : [...prev, listId]
    );
  }

  // Filtered suppression lists for the dropdown/selector
  const filteredSuppressionLists = useMemo(() => {
    if (!suppressionSearch.trim()) return lists;
    const q = suppressionSearch.toLowerCase();
    return lists.filter((l) => l.name.toLowerCase().includes(q));
  }, [lists, suppressionSearch]);

  // Filtered exclusion lists
  const filteredExclusionLists = useMemo(() => {
    // Sort so selected items appear at the top
    const sorted = [...lists].sort((a, b) => {
      const aSelected = selectedExclusionListIds.includes(a.id);
      const bSelected = selectedExclusionListIds.includes(b.id);
      if (aSelected && !bSelected) return -1;
      if (!aSelected && bSelected) return 1;
      return (b.memberCount ?? 0) - (a.memberCount ?? 0);
    });

    if (!exclusionSearch.trim()) return sorted;
    const q = exclusionSearch.toLowerCase();
    return sorted.filter((l) => l.name.toLowerCase().includes(q));
  }, [lists, exclusionSearch, selectedExclusionListIds]);

  // Check if new list name already matches an existing list
  const duplicateMatch = useMemo(() => {
    if (!newListName.trim()) return null;
    const target = newListName.trim().toLowerCase();
    return lists.find((l) => l.name.trim().toLowerCase() === target) || null;
  }, [lists, newListName]);

  // Current suppression list display object
  const currentSuppressionList = useMemo(() => {
    return lists.find((l) => l.id === selectedSuppressionListId);
  }, [lists, selectedSuppressionListId]);

  if (loading) {
    return (
      <section className="lsq-card" aria-busy="true" aria-label="LeadSquared list sync and suppression">
        <div className="lsq-card__body">
          <div className="lsq-cluster" role="status">
            <span className="lsq-spinner" aria-hidden="true" />
            <span>Fetching lists from the LeadSquared tenant</span>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="lsq-card" aria-labelledby="lsq-sync-title">
      <div className="lsq-card__header">
        <div>
          <div className="lsq-cluster">
            <h2 className="lsq-card__title" id="lsq-sync-title">LeadSquared List Sync and Suppression</h2>
            <Badge
              color={selectedSuppressionListId ? 'green' : 'amber'}
              text={selectedSuppressionListId ? 'Suppression active' : 'No list selected'}
            />
            <Badge color="gray" text={`${lists.length} static lists available`} />
          </div>
          <p className="lsq-card__sub">
            Automatically push confirmed registrants into a LeadSquared static list to exclude them from marketing blasts, and select existing CRM exclusion lists to filter out unwanted leads.
          </p>
        </div>

        <div className="lsq-cluster">
          <Button
            size="sm"
            hierarchy="secondary"
            icon={<Icon name="refresh" size={14} />}
            loading={refreshing}
            onClick={reloadConfig}
            disabled={saving}
            title="Fetch fresh list data from the LeadSquared tenant"
          >
            {refreshing ? 'Refreshing' : 'Refresh Lists'}
          </Button>

          <Button size="sm" hierarchy="primary" loading={saving} onClick={handleSaveSettings} disabled={refreshing}>
            {saving ? 'Saving' : 'Save Settings'}
          </Button>
        </div>
      </div>

      <div className="lsq-card__body lsq-stack lsq-stack--lg">
        {fetchError && (
          <div className="lsq-banner lsq-banner--error" role="alert">
            <span className="lsq-banner__icon" aria-hidden="true"><Icon name="warning" size={16} /></span>
            <div className="lsq-grow">
              <p className="lsq-banner__body">{fetchError}</p>
              <div className="lsq-banner__actions">
                <Button hierarchy="secondary" size="sm" onClick={reloadConfig}>
                  Retry Connection
                </Button>
              </div>
            </div>
          </div>
        )}

        <div className="lsq-grid lsq-grid--wide">
          {/* Section 1: Registrant suppression list */}
          <div className="lsq-wiz-panel lsq-stack">
            <div className="lsq-cluster lsq-cluster--between">
              <h3 className="lsq-wiz-panel__title">1. Registrant Suppression List</h3>
              {registeredCount > 0 && (
                <span className="lsq-hint">
                  {syncedCount}/{registeredCount} synced
                </span>
              )}
            </div>
            <p className="lsq-hint">
              Anyone who registers via 1-click link, Zoom or form is automatically added to this list in LeadSquared.
            </p>

            {currentSuppressionList ? (
              <div className="lsq-banner lsq-banner--success">
                <span className="lsq-banner__icon" aria-hidden="true"><Icon name="check-circle" size={16} /></span>
                <div className="lsq-grow">
                  <p className="lsq-banner__title">Attached suppression list</p>
                  <p className="lsq-banner__body lsq-wiz-wrap">
                    <strong>{currentSuppressionList.name}</strong>
                  </p>
                  <p className="lsq-hint">{currentSuppressionList.memberCount} existing member(s) in LeadSquared</p>
                </div>
                <Button hierarchy="tertiary" size="sm" title="Detach list" onClick={() => setSelectedSuppressionListId('')}>
                  Change or Detach
                </Button>
              </div>
            ) : (
              <div className="lsq-banner lsq-banner--warning">
                <span className="lsq-banner__icon" aria-hidden="true"><Icon name="info" size={16} /></span>
                <p className="lsq-banner__body">Select an existing list below or create a dedicated list for this webinar.</p>
              </div>
            )}

            <div className="lsq-search lsq-wiz-search">
              <Icon name="search" size={16} />
              <input
                type="text"
                className="lsq-input"
                aria-label="Filter suppression lists by name"
                placeholder="Filter lists by name"
                value={suppressionSearch}
                onChange={(e) => setSuppressionSearch(e.target.value)}
              />
            </div>

            <Field label="Suppression list">
              {(p) => (
                <select {...p} className="lsq-select" value={selectedSuppressionListId} onChange={(e) => setSelectedSuppressionListId(e.target.value)}>
                  <option value="">Choose an existing LeadSquared static list ({filteredSuppressionLists.length} matches)</option>
                  {filteredSuppressionLists.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name} ({l.memberCount} members)
                    </option>
                  ))}
                </select>
              )}
            </Field>

            <div>
              <Button
                hierarchy="tertiary-color"
                size="sm"
                icon={<Icon name="plus" size={14} />}
                onClick={() => {
                  setNewListName(`[Webinar] ${campaignTitle || 'Event'} - Registrants`);
                  setShowCreateDialog(true);
                }}
              >
                Create New List in LeadSquared
              </Button>
            </div>
          </div>

          {/* Section 2: Additional exclusion lists */}
          <div className="lsq-wiz-panel lsq-stack">
            <div className="lsq-cluster lsq-cluster--between">
              <h3 className="lsq-wiz-panel__title">2. Additional Exclusion Lists</h3>
              <div className="lsq-cluster">
                <Badge color={selectedExclusionListIds.length > 0 ? 'purple' : 'gray'} text={`${selectedExclusionListIds.length} active`} />
                {selectedExclusionListIds.length > 0 && (
                  <Button hierarchy="tertiary" size="sm" onClick={() => setSelectedExclusionListIds([])}>
                    Clear All
                  </Button>
                )}
              </div>
            </div>
            <p className="lsq-hint">
              Exclude leads on these CRM lists (for example competitors, existing clients or DND) from outreach. Applied as a preflight filter.
            </p>

            <div className="lsq-search lsq-wiz-search">
              <Icon name="search" size={16} />
              <input
                type="text"
                className="lsq-input"
                aria-label="Search exclusion lists"
                placeholder="Search exclusion lists, e.g. competitors or DND"
                value={exclusionSearch}
                onChange={(e) => setExclusionSearch(e.target.value)}
              />
            </div>

            {filteredExclusionLists.length === 0 ? (
              <p className="lsq-hint">
                {lists.length === 0 ? 'No static lists found on the connected LeadSquared tenant.' : 'No matching lists found.'}
              </p>
            ) : (
              <ul className="lsq-wiz-checkscroll" aria-label="Exclusion lists">
                {filteredExclusionLists.map((l) => {
                  const checked = selectedExclusionListIds.includes(l.id);
                  return (
                    <li key={l.id}>
                      <label className="lsq-check lsq-wiz-checkrow" data-checked={checked ? 'true' : undefined}>
                        <input type="checkbox" checked={checked} onChange={() => toggleExclusionList(l.id)} />
                        <span className="lsq-grow lsq-wiz-wrap">{l.name}</span>
                        <span className="lsq-hint">({l.memberCount})</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>

      <Modal
        isOpen={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        busy={creating}
        title={duplicateMatch ? 'Connect Existing List' : 'Create List in LeadSquared'}
        subtitle="Creates a new static list in the connected LeadSquared tenant, or links it if it already exists, and sets it as the registrant suppression list for this webinar."
        footer={
          <>
            <Button hierarchy="secondary" onClick={() => setShowCreateDialog(false)} disabled={creating}>
              Cancel
            </Button>
            <Button hierarchy="primary" onClick={handleCreateNewList} loading={creating} disabled={!newListName.trim()}>
              {creating ? 'Connecting to LeadSquared' : duplicateMatch ? 'Attach Existing List' : 'Create and Attach'}
            </Button>
          </>
        }
      >
        <div className="lsq-stack">
          <Field label="List name" required>
            {(p) => (
              <input
                {...p}
                type="text"
                className="lsq-input"
                value={newListName}
                onChange={(e) => setNewListName(e.target.value)}
                placeholder="[Webinar] Title - Registrants"
              />
            )}
          </Field>
          {duplicateMatch && (
            <div className="lsq-banner lsq-banner--success" role="status">
              <span className="lsq-banner__icon" aria-hidden="true"><Icon name="check-circle" size={16} /></span>
              <p className="lsq-banner__body">
                A list named <strong>&ldquo;{duplicateMatch.name}&rdquo;</strong> already exists in LeadSquared ({duplicateMatch.memberCount} members). It is linked as the suppression list instead of creating a duplicate.
              </p>
            </div>
          )}
          <Field label="Description" optional>
            {(p) => (
              <textarea
                {...p}
                className="lsq-input"
                value={newListDesc}
                onChange={(e) => setNewListDesc(e.target.value)}
                placeholder="Auto-created suppression list for webinar registrants"
                rows={2}
              />
            )}
          </Field>
        </div>
      </Modal>
    </section>
  );
}
