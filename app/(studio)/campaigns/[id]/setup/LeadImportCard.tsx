'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { Field } from '@/components/ui/Field';
import { Drawer, type DrawerContent } from '@/components/ui/Drawer';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import { importCsvAction, fetchLsqListsAction, importFromLsqListAction, analyzeCsvMappingAction, getStaticListsAction, setCampaignListAction, type CsvImportResult } from '@/lib/actions/setup';
import type { LsqList } from '@/lib/leadsquared';

export function LeadImportCard({
  campaignId,
  existingContactCount,
  existingScoredCount,
}: {
  campaignId: string;
  existingContactCount: number;
  existingScoredCount: number;
}) {
  const { showToast } = useToast();
  const [mode, setMode] = useState<'csv' | 'lsq'>('csv');
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CsvImportResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const [lists, setLists] = useState<LsqList[] | null>(null);
  const [listsError, setListsError] = useState<string | null>(null);
  const [selectedListId, setSelectedListId] = useState('');
  const [tenantInfo, setTenantInfo] = useState<{ host: string; senderEmail?: string } | null>(null);
  const [refreshingLists, setRefreshingLists] = useState(false);
  const [listSearch, setListSearch] = useState('');
  const [mappingOpen, setMappingOpen] = useState(false);

  // A re-import replaces every contact for this campaign — including whatever's
  // already been scored, approved, or personalized. That work only exists once,
  // so a confirmation gates it instead of one misclick silently discarding it.
  // Only the *first* import (no contacts yet) skips the prompt.
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [confirmingCsv, setConfirmingCsv] = useState(false);

  // AI field-mapping check + destination list (CSV mode)
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<Awaited<ReturnType<typeof analyzeCsvMappingAction>> | null>(null);
  const [destLists, setDestLists] = useState<Array<{ id: string; name: string; members: number }> | null>(null);
  const [destListId, setDestListId] = useState('');
  const [destSaving, setDestSaving] = useState(false);
  const [confirmingLsq, setConfirmingLsq] = useState(false);
  const hasExisting = existingContactCount > 0;

  async function loadLists(isRefresh = false) {
    if (isRefresh) setRefreshingLists(true);
    setListsError(null);
    try {
      const res = await fetchLsqListsAction();
      if (!res.ok) {
        setListsError(res.error || 'Failed to fetch LeadSquared lists.');
        return;
      }
      setLists(res.lists);
      setTenantInfo({ host: res.tenantHost, senderEmail: res.senderEmail });
      if (res.lists.length > 0) {
        // Auto-select first list with members, or fallback to first list
        const withMembers = res.lists.find((l) => (l.MemberCount ?? 0) > 0);
        const best = withMembers || res.lists[0];
        if (!selectedListId || !res.lists.some((l) => l.ListId === selectedListId)) {
          setSelectedListId(best.ListId);
        }
      }
      if (isRefresh) {
        showToast(`Refreshed ${res.lists.length} lists from LeadSquared.`);
      }
    } catch (err) {
      setListsError(err instanceof Error ? err.message : String(err));
    } finally {
      if (isRefresh) setRefreshingLists(false);
    }
  }

  // Lists are fetched when the operator opens the LeadSquared tab, not from an
  // effect — an effect that kicks off a state-setting fetch re-renders needlessly.
  function openLsqTab() {
    setMode('lsq');
    if (lists === null) void loadLists(false);
  }

  function requestFile(file: File) {
    if (hasExisting) {
      setPendingFile(file);
      setConfirmingCsv(true);
      return;
    }
    handleFile(file);
  }

  /**
   * Reads the chosen file in the browser and asks the server to pair its
   * headers with real LeadSquared fields, then type-check the values. Runs
   * before any import, so problems surface while they're still cheap to fix.
   */
  async function runCheck() {
    const file = pendingFile ?? inputRef.current?.files?.[0];
    if (!file) return;
    setChecking(true);
    setCheck(null);
    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
      const split = (l: string) => l.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
      const headers = split(lines[0] ?? '');
      const rows = lines.slice(1, 51).map((l) => {
        const cells = split(l);
        return Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? '']));
      });
      setCheck(await analyzeCsvMappingAction(headers, rows));
    } catch (err) {
      // Previously console-only: the spinner stopped, nothing rendered, and the
      // operator just clicked "Check fields" again and again.
      console.error('Failed to analyze CSV mapping:', err);
      showToast(err instanceof Error ? err.message : 'Could not check these fields against LeadSquared.');
    } finally {
      setChecking(false);
    }
  }

  async function loadDestLists() {
    const res = await getStaticListsAction();
    if (res.ok) setDestLists(res.lists);
  }

  async function chooseDestList(listId: string) {
    setDestListId(listId);
    setDestSaving(true);
    try {
      await setCampaignListAction(campaignId, listId || null);
    } catch (err) {
      // Same silent-failure shape: "saving…" disappeared and the select kept
      // showing a destination list that was never actually saved.
      console.error('Failed to set campaign list:', err);
      setDestListId('');
      showToast(err instanceof Error ? err.message : 'Could not save that destination list. It is unchanged.');
    } finally {
      setDestSaving(false);
    }
  }

  async function handleFile(file: File) {
    setConfirmingCsv(false);
    setPendingFile(null);
    setBusy(true);
    setResult(null);
    try {
      const fd = new FormData();
      fd.set('file', file);
      const res = await importCsvAction(campaignId, fd);
      setResult(res);
      router.refresh();
    } catch (err) {
      setResult({ ok: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  function requestFetchList() {
    if (!selectedListId) return;
    if (hasExisting) {
      setConfirmingLsq(true);
      return;
    }
    handleFetchList();
  }

  async function handleFetchList() {
    if (!selectedListId) return;
    setConfirmingLsq(false);
    setBusy(true);
    setResult(null);
    try {
      const list = lists?.find((l) => l.ListId === selectedListId);
      const res = await importFromLsqListAction(campaignId, selectedListId, list?.ListName ?? selectedListId);
      setResult(res);
      router.refresh();
    } catch (err) {
      setResult({ ok: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  const filteredLists = (lists ?? []).filter((l) => {
    if (!listSearch.trim()) return true;
    return l.ListName.toLowerCase().includes(listSearch.trim().toLowerCase());
  });
  const listsWithMembers = filteredLists.filter((l) => (l.MemberCount ?? 0) > 0);
  const listsWithoutMembers = filteredLists.filter((l) => (l.MemberCount ?? 0) === 0);
  const selectedList = lists?.find((l) => l.ListId === selectedListId);

  const importedCount = result?.ok ? (result.imported ?? result.rowCount ?? 0) : 0;
  const issues = result?.ok ? (result.issues ?? []) : [];

  return (
    <section className="lsq-card" aria-labelledby="lead-import-title">
      <div className="lsq-card__header">
        <div>
          <h2 className="lsq-card__title" id="lead-import-title">Lead Import</h2>
          <p className="lsq-card__sub">Bring in contacts from a CSV file or an existing LeadSquared list.</p>
        </div>
        <div className="lsq-segmented" role="tablist" aria-label="Lead import source">
          <button type="button" role="tab" aria-selected={mode === 'csv'} onClick={() => setMode('csv')}>
            Upload CSV
          </button>
          <button type="button" role="tab" aria-selected={mode === 'lsq'} onClick={openLsqTab}>
            LeadSquared List
          </button>
        </div>
      </div>

      <div className="lsq-card__body lsq-stack lsq-stack--lg">
        {mode === 'csv' && (
          <>
            <input
              ref={inputRef}
              type="file"
              accept=".csv,.tsv,.txt"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) requestFile(f);
                e.target.value = '';
              }}
            />
            <div
              // Was a plain div+onClick over a display:none input, which made
              // importing contacts — the app's entry point — reachable by mouse
              // only. Now it's a real button to assistive tech and to the Tab key.
              role="button"
              tabIndex={0}
              aria-label="Choose or drop a CSV file to import contacts"
              className="lsq-wiz-drop"
              data-dragging={dragging ? 'true' : undefined}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  inputRef.current?.click();
                }
              }}
              onClick={() => inputRef.current?.click()}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const f = e.dataTransfer.files?.[0];
                if (f) requestFile(f);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
            >
              <span className="lsq-wiz-drop__icon" aria-hidden="true">
                <Icon name="upload" size={18} />
              </span>
              <div className="lsq-grow">
                <p className="lsq-wiz-drop__title">
                  {busy
                    ? 'Parsing'
                    : result?.ok
                      ? `${importedCount.toLocaleString()} contact${importedCount === 1 ? '' : 's'} imported`
                      : 'Drop a .csv here or click to choose a file'}
                </p>
                <p className="lsq-hint">
                  {result?.ok
                    ? 'Choose another file to replace the imported contacts.'
                    : 'Columns for name, email, company and title are detected automatically.'}
                </p>
              </div>
              {result?.ok && <Badge color="success" text="Parsed" />}
            </div>

            {result && !result.ok && (
              <div className="lsq-banner lsq-banner--error" role="alert">
                <span className="lsq-banner__icon" aria-hidden="true"><Icon name="error" size={16} /></span>
                <p className="lsq-banner__body">{result.error}</p>
              </div>
            )}

            {result?.ok && (
              <div className="lsq-stack">
                <div className="lsq-grid lsq-grid--narrow" role="group" aria-label="Import summary">
                  <div className="lsq-wiz-stat">
                    <p className="lsq-wiz-stat__label">Imported</p>
                    <p className="lsq-wiz-stat__value">{importedCount.toLocaleString()}</p>
                  </div>
                  <div className="lsq-wiz-stat">
                    <p className="lsq-wiz-stat__label">Duplicates merged</p>
                    <p className="lsq-wiz-stat__value">{(result.dupes ?? 0).toLocaleString()}</p>
                  </div>
                  <div className="lsq-wiz-stat">
                    <p className="lsq-wiz-stat__label">With usable email</p>
                    <p className="lsq-wiz-stat__value">{(result.withEmail ?? 0).toLocaleString()}</p>
                  </div>
                  <div className="lsq-wiz-stat">
                    <p className="lsq-wiz-stat__label">Columns detected</p>
                    <p className="lsq-wiz-stat__value">{(result.headers?.length ?? 0).toLocaleString()}</p>
                  </div>
                  {!!result.skippedBlank && (
                    <div className="lsq-wiz-stat">
                      <p className="lsq-wiz-stat__label">Blank rows skipped</p>
                      <p className="lsq-wiz-stat__value">{result.skippedBlank.toLocaleString()}</p>
                    </div>
                  )}
                  <div className="lsq-wiz-stat" data-tone={issues.length > 0 ? 'warn' : undefined}>
                    <p className="lsq-wiz-stat__label">Rows to review</p>
                    <p className="lsq-wiz-stat__value">{issues.length.toLocaleString()}</p>
                  </div>
                </div>

                {issues.length > 0 && (
                  <div className="lsq-banner lsq-banner--warning">
                    <span className="lsq-banner__icon" aria-hidden="true"><Icon name="warning" size={16} /></span>
                    <div className="lsq-grow">
                      <p className="lsq-banner__title">
                        {issues.length} row{issues.length === 1 ? '' : 's'} need a look
                      </p>
                      <div className="lsq-table-wrap lsq-wiz-scroll">
                        <table className="lsq-table">
                          <thead>
                            <tr>
                              <th scope="col">Row</th>
                              <th scope="col">Issue</th>
                            </tr>
                          </thead>
                          <tbody>
                            {issues.map((i, n) => (
                              <tr key={`${i.row}-${i.kind}-${n}`}>
                                <td className="lsq-cell-primary">{i.row}</td>
                                <td>{i.message}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}

                <div className="lsq-cluster">
                  <Button hierarchy="tertiary" size="sm" onClick={() => setMappingOpen(true)}>
                    View Column Mapping
                  </Button>
                  <Button hierarchy="tertiary" size="sm" onClick={() => inputRef.current?.click()}>
                    Replace File
                  </Button>
                </div>
              </div>
            )}

            <hr className="lsq-divider" />

            <div className="lsq-stack">
              <div className="lsq-cluster">
                <Button hierarchy="secondary-color" size="sm" icon={<Icon name="sparkle" size={14} />} onClick={runCheck} disabled={checking}>
                  {checking ? 'Checking' : 'Check Fields Against LeadSquared'}
                </Button>
                <span className="lsq-hint lsq-grow">
                  Pairs columns with real LeadSquared fields and type-checks the values before anything is written.
                </span>
              </div>

              {check && !check.ok && (
                <div className="lsq-banner lsq-banner--error" role="alert">
                  <span className="lsq-banner__icon" aria-hidden="true"><Icon name="error" size={16} /></span>
                  <p className="lsq-banner__body">{check.error}</p>
                </div>
              )}

              {check?.ok && (
                <div className="lsq-wiz-panel lsq-stack">
                  <p className="lsq-hint">Matched against {check.lsqFieldCount} LeadSquared fields.</p>
                  <div className="lsq-table-wrap" tabIndex={0} role="region" aria-label="Scrollable table">
                    <table className="lsq-table">
                      <thead>
                        <tr>
                          <th scope="col">Column</th>
                          <th scope="col">LeadSquared field</th>
                          <th scope="col">Match</th>
                          <th scope="col">Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {check.mappings.map((m) => (
                          <tr key={m.header}>
                            <td className="lsq-cell-primary lsq-cell-truncate" title={m.header}>{m.header}</td>
                            <td className="lsq-cell-truncate"><span className="lsq-wiz-code-inline">{m.schemaName}</span></td>
                            <td><Badge color={m.confidence === 'high' ? 'success' : m.confidence === 'medium' ? 'warning' : 'error'} text={m.confidence} /></td>
                            <td className="lsq-cell-secondary">{m.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {check.unmapped.length > 0 && (
                    <p className="lsq-hint">
                      Kept on the contact but not written to LeadSquared (no good field match): <strong>{check.unmapped.join(', ')}</strong>
                    </p>
                  )}
                  <p className={check.report.issues.length ? 'lsq-error' : 'lsq-hint'} role={check.report.issues.length ? 'alert' : undefined}>
                    <strong>
                      {check.report.issues.length === 0
                        ? `All ${check.report.checked} values look writable.`
                        : `${check.report.issues.length} value(s) across ${check.report.badRows} row(s) would be rejected. Fix these first:`}
                    </strong>
                  </p>
                  {check.report.issues.length > 0 && (
                    <ul className="lsq-wiz-list">
                      {check.report.issues.slice(0, 8).map((i, n) => (
                        <li key={n} className="lsq-hint">
                          Row {i.row}, &ldquo;{i.header}&rdquo; = {i.value}: {i.problem}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              <Field
                label="Destination list in LeadSquared"
                hint={
                  destSaving
                    ? 'Saving the destination list.'
                    : 'Only static lists accept additions. Contacts are upserted to LeadSquared leads directly without auto-creating lists.'
                }
              >
                {(p) => (
                  <select
                    {...p}
                    className="lsq-select"
                    value={destListId}
                    onFocus={() => {
                      if (!destLists) void loadDestLists();
                    }}
                    onChange={(e) => void chooseDestList(e.target.value)}
                  >
                    <option value="">Do not add to any LeadSquared list (default)</option>
                    {destLists?.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name} ({l.members} members)
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            </div>
          </>
        )}

        {mode === 'lsq' && (
          <div className="lsq-stack">
            <div className="lsq-toolbar lsq-wiz-panel">
              <div className="lsq-toolbar__group">
                <Badge color="success" dot text="Connected" />
                <span className="lsq-hint">Tenant</span>
                <span className="lsq-wiz-code-inline">{tenantInfo?.host || 'api-in21.leadsquared.com'}</span>
                {tenantInfo?.senderEmail && <span className="lsq-hint">({tenantInfo.senderEmail})</span>}
              </div>
              <div className="lsq-toolbar__group">
                <Button
                  hierarchy="tertiary"
                  size="sm"
                  icon={<Icon name="refresh" size={14} />}
                  onClick={() => void loadLists(true)}
                  disabled={refreshingLists || busy}
                  title="Fetch latest lists from LeadSquared"
                >
                  {refreshingLists ? 'Refreshing' : 'Refresh Lists'}
                </Button>
                <a className="lsq-linkbtn lsq-wiz-extlink" href="/integrations" target="_blank" rel="noopener noreferrer">
                  Switch tenant
                  <Icon name="external" size={14} />
                </a>
              </div>
            </div>

            {lists && lists.length > 5 && (
              <div className="lsq-search lsq-wiz-search">
                <Icon name="search" size={16} />
                <input
                  type="text"
                  className="lsq-input"
                  aria-label="Filter lists by name"
                  placeholder="Filter lists"
                  value={listSearch}
                  onChange={(e) => setListSearch(e.target.value)}
                />
              </div>
            )}

            {listsError ? (
              <div className="lsq-banner lsq-banner--error" role="alert">
                <span className="lsq-banner__icon" aria-hidden="true"><Icon name="error" size={16} /></span>
                <p className="lsq-banner__body">{listsError}</p>
              </div>
            ) : (
              <div className="lsq-wiz-inputrow">
                <div className="lsq-grow">
                  <Field label="Source list">
                    {(p) => (
                      <select {...p} className="lsq-select" value={selectedListId} onChange={(e) => setSelectedListId(e.target.value)}>
                        {lists === null && <option>Loading lists from LeadSquared</option>}
                        {lists !== null && filteredLists.length === 0 && <option>No matching lists found</option>}
                        {listsWithMembers.length > 0 && (
                          <optgroup label={`Active lists with leads (${listsWithMembers.length})`}>
                            {listsWithMembers.map((l) => (
                              <option key={l.ListId} value={l.ListId}>
                                {l.ListName} ({l.MemberCount} {l.MemberCount === 1 ? 'lead' : 'leads'}) [{l.ListType}]
                              </option>
                            ))}
                          </optgroup>
                        )}
                        {listsWithoutMembers.length > 0 && (
                          <optgroup label={`Empty or other lists (${listsWithoutMembers.length})`}>
                            {listsWithoutMembers.map((l) => (
                              <option key={l.ListId} value={l.ListId}>
                                {l.ListName} (0 leads) [{l.ListType}]
                              </option>
                            ))}
                          </optgroup>
                        )}
                      </select>
                    )}
                  </Field>
                </div>
                <Button hierarchy="secondary" onClick={requestFetchList} disabled={busy || !selectedListId || refreshingLists}>
                  {busy ? 'Fetching' : 'Fetch Contacts'}
                </Button>
              </div>
            )}

            {selectedList && (
              <div className="lsq-cluster">
                <span className="lsq-hint">Selected</span>
                <strong className="lsq-wiz-wrap">{selectedList.ListName}</strong>
                <Badge
                  color={(selectedList.MemberCount ?? 0) > 0 ? 'success' : 'gray'}
                  text={`${selectedList.MemberCount ?? 0} ${(selectedList.MemberCount ?? 0) === 1 ? 'lead' : 'leads'}`}
                />
                <Badge
                  color={selectedList.ListType?.toLowerCase() === 'dynamic' ? 'blue' : 'gray'}
                  text={selectedList.ListType?.toLowerCase() === 'dynamic' ? 'Dynamic query list' : 'Static list'}
                />
                {selectedList.ListDescription && <span className="lsq-hint lsq-wiz-wrap">{selectedList.ListDescription}</span>}
              </div>
            )}

            {result && (
              <div className={`lsq-banner ${result.ok ? 'lsq-banner--success' : 'lsq-banner--error'}`} role={result.ok ? 'status' : 'alert'}>
                <span className="lsq-banner__icon" aria-hidden="true">
                  <Icon name={result.ok ? 'check-circle' : 'error'} size={16} />
                </span>
                <p className="lsq-banner__body">
                  {result.ok ? `${result.rowCount} contacts fetched from LeadSquared` : result.error}
                </p>
              </div>
            )}
          </div>
        )}

        <div className="lsq-banner lsq-banner--neutral">
          <span className="lsq-banner__icon" aria-hidden="true"><Icon name="info" size={16} /></span>
          <p className="lsq-banner__body">
            Gaps in the source data, such as missing titles, verticals or contact details, get filled by the enrichment step.
          </p>
        </div>
      </div>

      <Drawer content={mappingOpen ? mappingDrawer(result) : null} onClose={() => setMappingOpen(false)} />

      {confirmingCsv && pendingFile && (
        <ConfirmDialog
          title="Replace All Imported Contacts?"
          message={reimportWarning(existingContactCount, existingScoredCount)}
          confirmLabel="Replace Contacts"
          destructive
          busy={busy}
          onConfirm={() => handleFile(pendingFile)}
          onClose={() => {
            setConfirmingCsv(false);
            setPendingFile(null);
          }}
        />
      )}

      {confirmingLsq && (
        <ConfirmDialog
          title="Replace All Imported Contacts?"
          message={reimportWarning(existingContactCount, existingScoredCount)}
          confirmLabel="Replace Contacts"
          destructive
          busy={busy}
          onConfirm={handleFetchList}
          onClose={() => setConfirmingLsq(false)}
        />
      )}
    </section>
  );
}

function reimportWarning(contactCount: number, scoredCount: number): string {
  const parts = [`This campaign already has ${contactCount} imported contact${contactCount === 1 ? '' : 's'}. Importing again replaces all of them,`];
  parts.push(
    scoredCount > 0
      ? `including ${scoredCount} that ${scoredCount === 1 ? 'has' : 'have'} already been scored, along with any approvals and personalized copy tied to them.`
      : 'along with any approvals or personalized copy tied to them.'
  );
  return parts.join(' ') + " This can't be undone.";
}

function mappingDrawer(result: CsvImportResult | null): DrawerContent | null {
  if (!result?.ok) return null;
  const mappedRoles = new Set((result.columnMap ?? []).map((m) => m.header));
  const unmapped = (result.headers ?? []).filter((h) => !mappedRoles.has(h));
  return {
    title: 'Column Mapping',
    subtitle: `${result.rowCount} rows | ${result.headers?.length ?? 0} columns | ${result.dupes ?? 0} duplicates merged`,
    columns: ['Field', 'Matched column'],
    rows: (result.columnMap ?? []).map((m) => [m.role, m.header]),
    notes: unmapped.length ? [`Not matched to any field: ${unmapped.join(', ')}. Kept as metadata only.`] : ['Every field the agent needs was matched from the header row.'],
  };
}
