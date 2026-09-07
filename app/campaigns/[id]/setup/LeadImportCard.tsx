'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { Drawer, type DrawerContent } from '@/components/ui/Drawer';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
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
  const [mode, setMode] = useState<'csv' | 'lsq'>('csv');
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CsvImportResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const [lists, setLists] = useState<LsqList[] | null>(null);
  const [listsError, setListsError] = useState<string | null>(null);
  const [selectedListId, setSelectedListId] = useState('');
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

  useEffect(() => {
    if (mode === 'lsq' && lists === null) {
      fetchLsqListsAction()
        .then((ls) => {
          setLists(ls);
          if (ls.length > 0) setSelectedListId(ls[0].ListId);
        })
        .catch((err) => setListsError(String(err)));
    }
  }, [mode, lists]);

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
      console.error('Failed to analyze CSV mapping:', err);
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
      console.error('Failed to set campaign list:', err);
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

  const tabBtn = (active: boolean): React.CSSProperties => ({
    padding: '6px 12px',
    borderRadius: 'var(--radius-sm)',
    fontSize: 'var(--fs-label-1)',
    fontWeight: 600,
    cursor: 'pointer',
    background: active ? '#fff' : 'transparent',
    color: active ? 'var(--n90)' : 'var(--n60)',
    boxShadow: active ? 'var(--shadow-xs)' : 'none',
  });

  return (
    <div style={{ background: '#fff', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)', padding: '18px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ fontSize: 'var(--fs-body)', fontWeight: 700, color: 'var(--n90)' }}>Lead import</div>
        <div style={{ display: 'flex', background: 'var(--n10)', borderRadius: 'var(--radius-md)', padding: 3, gap: 2 }}>
          <div onClick={() => setMode('csv')} style={tabBtn(mode === 'csv')}>
            Upload CSV
          </div>
          <div onClick={() => setMode('lsq')} style={tabBtn(mode === 'lsq')}>
            LeadSquared list
          </div>
        </div>
      </div>

      {mode === 'csv' ? (
        <>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.tsv,.txt"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) requestFile(f);
              e.target.value = '';
            }}
          />
          <div
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
            style={{
              border: dragging ? '1.5px dashed var(--accent-500)' : '1.5px dashed var(--border-default)',
              borderRadius: 'var(--radius-lg)',
              padding: 18,
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              background: dragging ? 'var(--accent-50)' : 'var(--n10)',
              cursor: 'pointer',
            }}
          >
            <div style={{ width: 40, height: 40, borderRadius: 'var(--radius-md)', background: 'var(--n20)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Icon name="upload" size={18} style={{ color: 'var(--accent-500)' }} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 'var(--fs-label-1)', fontWeight: 600, color: 'var(--n90)', overflowWrap: 'anywhere' }}>
                {busy ? 'Parsing…' : result?.ok ? `${result.rowCount} contacts imported` : 'Drop a .csv here or click to choose a file'}
              </div>
              <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n50)', marginTop: 4, overflowWrap: 'anywhere' }}>
                {result?.ok
                  ? `${result.headers?.length ?? 0} columns detected · ${result.dupes ?? 0} duplicates merged · ${result.withEmail ?? 0} with a usable email`
                  : 'Columns for name, email, company and title are detected automatically.'}
              </div>
              {result && !result.ok && <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--danger-500)', marginTop: 4 }}>{result.error}</div>}
            </div>
            {result?.ok && <Badge color="success" text="Parsed" />}
          </div>
        </>
      ) : null}

      {mode === 'csv' && result?.ok && (
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <Button hierarchy="tertiary" size="sm" onClick={() => setMappingOpen(true)}>
            View column mapping
          </Button>
          <Button hierarchy="tertiary" size="sm" onClick={() => inputRef.current?.click()}>
            Replace file
          </Button>
        </div>
      )}

      {mode === 'csv' && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border-subtle)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            <Button hierarchy="secondary-color" size="sm" onClick={runCheck} disabled={checking}>
              {checking ? 'Checking…' : '\u2726 Check fields against LeadSquared'}
            </Button>
            <span style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n60)' }}>
              Pairs your columns with real LSQ fields and type-checks the values before anything is written.
            </span>
          </div>

          {check && !check.ok && <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--danger-500)' }}>{check.error}</div>}

          {check?.ok && (
            <div style={{ background: 'var(--n10)', borderRadius: 'var(--radius-md)', padding: 12, fontSize: 'var(--fs-label-1)' }}>
              <div style={{ color: 'var(--n60)', marginBottom: 8 }}>
                Matched against {check.lsqFieldCount} LeadSquared fields.
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
                {check.mappings.map((m) => (
                  <div key={m.header} style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ color: 'var(--n80)', fontWeight: 600 }}>{m.header}</span>
                    <span style={{ color: 'var(--n50)' }}>&rarr;</span>
                    <span style={{ fontFamily: 'monospace', color: 'var(--n90)' }}>{m.schemaName}</span>
                    <Badge color={m.confidence === 'high' ? 'success' : m.confidence === 'medium' ? 'warning' : 'error'} text={m.confidence} />
                    <span style={{ color: 'var(--n60)' }}>{m.reason}</span>
                  </div>
                ))}
              </div>
              {check.unmapped.length > 0 && (
                <div style={{ color: 'var(--n60)', marginBottom: 8 }}>
                  Kept on the contact but not written to LeadSquared (no good field match): <strong>{check.unmapped.join(', ')}</strong>
                </div>
              )}
              <div style={{ color: check.report.issues.length ? 'var(--danger-500)' : 'var(--success-700)', fontWeight: 600 }}>
                {check.report.issues.length === 0
                  ? `All ${check.report.checked} values look writable.`
                  : `${check.report.issues.length} value(s) across ${check.report.badRows} row(s) would be rejected \u2014 fix these first:`}
              </div>
              {check.report.issues.slice(0, 8).map((i, n) => (
                <div key={n} style={{ color: 'var(--n70)', marginTop: 3 }}>
                  Row {i.row}, &ldquo;{i.header}&rdquo; = {i.value} &mdash; {i.problem}
                </div>
              ))}
            </div>
          )}

          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--n60)', marginBottom: 6 }}>
              Destination list in LeadSquared {destSaving && <span style={{ color: 'var(--n50)' }}>&middot; saving…</span>}
            </div>
            <select
              className="lsq-select"
              value={destListId}
              onFocus={() => { if (!destLists) void loadDestLists(); }}
              onChange={(e) => void chooseDestList(e.target.value)}
              style={{ width: '100%', height: 34, fontSize: 'var(--fs-label-1)' }}
            >
              <option value="">Do not add to any LeadSquared list (default)</option>
              {destLists?.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} ({l.members} members)
                </option>
              ))}
            </select>
            <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n50)', marginTop: 5 }}>
              Only static lists accept additions. Contacts are upserted to LeadSquared leads directly without auto-creating lists.
            </div>
          </div>
        </div>
      )}

      {mode === 'lsq' ? (
        <div style={{ display: 'flex', gap: 10, alignItems: 'end' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--n60)', marginBottom: 6 }}>Source list</div>
            {listsError ? (
              <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--danger-500)' }}>{listsError}</div>
            ) : (
              <select
                className="lsq-select"
                value={selectedListId}
                onChange={(e) => setSelectedListId(e.target.value)}
                style={{ width: '100%', height: 38, borderRadius: 'var(--radius-sm)', boxShadow: 'inset 0 0 0 1px var(--border-default)', padding: '0 32px 0 12px', fontFamily: 'var(--font-body)', fontSize: 'var(--fs-label-1)', color: 'var(--n90)', background: '#fff', border: 'none' }}
              >
                {lists === null && <option>Loading lists…</option>}
                {lists?.length === 0 && <option>No lists found</option>}
                {lists?.map((l) => (
                  <option key={l.ListId} value={l.ListId}>
                    {l.ListName} ({l.MemberCount})
                  </option>
                ))}
              </select>
            )}
          </div>
          <Button hierarchy="secondary" onClick={requestFetchList} disabled={busy || !selectedListId}>
            {busy ? 'Fetching…' : 'Fetch contacts'}
          </Button>
        </div>
      ) : null}

      {mode === 'lsq' && result && (
        <div style={{ marginTop: 12, fontSize: 'var(--fs-label-1)', color: result.ok ? 'var(--success-700)' : 'var(--danger-500)' }}>
          {result.ok ? `✓ ${result.rowCount} contacts fetched from LeadSquared` : result.error}
        </div>
      )}

      <div style={{ marginTop: 16, display: 'flex', gap: 10, background: 'var(--n10)', borderRadius: 'var(--radius-md)', padding: '12px 14px' }}>
        <Icon name="InformationProperty1Outline" size={16} style={{ color: 'var(--n60)', flexShrink: 0, marginTop: 1 }} />
        <div style={{ minWidth: 0, fontSize: 'var(--fs-label-1)', color: 'var(--n70)', lineHeight: 1.5 }}>
          Gaps in the source data — missing titles, verticals, contact details — get filled by the enrichment step below.
        </div>
      </div>

      <Drawer content={mappingOpen ? mappingDrawer(result) : null} onClose={() => setMappingOpen(false)} />

      {confirmingCsv && pendingFile && (
        <ConfirmDialog
          title="Replace all imported contacts?"
          message={reimportWarning(existingContactCount, existingScoredCount)}
          confirmLabel="Replace contacts"
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
          title="Replace all imported contacts?"
          message={reimportWarning(existingContactCount, existingScoredCount)}
          confirmLabel="Replace contacts"
          destructive
          busy={busy}
          onConfirm={handleFetchList}
          onClose={() => setConfirmingLsq(false)}
        />
      )}
    </div>
  );
}

function reimportWarning(contactCount: number, scoredCount: number): string {
  const parts = [`This campaign already has ${contactCount} imported contact${contactCount === 1 ? '' : 's'}. Importing again replaces all of them —`];
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
    title: 'Column mapping',
    subtitle: `${result.rowCount} rows · ${result.headers?.length ?? 0} columns · ${result.dupes ?? 0} duplicates merged`,
    columns: ['Field', 'Matched column'],
    rows: (result.columnMap ?? []).map((m) => [m.role, m.header]),
    notes: unmapped.length ? [`Not matched to any field: ${unmapped.join(', ')} — kept as metadata only.`] : ['Every field the agent needs was matched from the header row.'],
  };
}
