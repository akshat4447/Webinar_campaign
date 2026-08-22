'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { Drawer, type DrawerContent } from '@/components/ui/Drawer';
import { importCsvAction, fetchLsqListsAction, importFromLsqListAction, type CsvImportResult } from '@/lib/actions/setup';
import type { LsqList } from '@/lib/leadsquared';

export function LeadImportCard({ campaignId }: { campaignId: string }) {
  const [mode, setMode] = useState<'csv' | 'lsq'>('csv');
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CsvImportResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [lists, setLists] = useState<LsqList[] | null>(null);
  const [listsError, setListsError] = useState<string | null>(null);
  const [selectedListId, setSelectedListId] = useState('');
  const [mappingOpen, setMappingOpen] = useState(false);

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

  async function handleFile(file: File) {
    setBusy(true);
    setResult(null);
    const fd = new FormData();
    fd.set('file', file);
    const res = await importCsvAction(campaignId, fd);
    setResult(res);
    setBusy(false);
  }

  async function handleFetchList() {
    if (!selectedListId) return;
    setBusy(true);
    setResult(null);
    const list = lists?.find((l) => l.ListId === selectedListId);
    const res = await importFromLsqListAction(campaignId, selectedListId, list?.ListName ?? selectedListId);
    setResult(res);
    setBusy(false);
  }

  const tabBtn = (active: boolean): React.CSSProperties => ({
    padding: '6px 12px',
    borderRadius: 'var(--radius-sm)',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    background: active ? '#fff' : 'transparent',
    color: active ? 'var(--n90)' : 'var(--n60)',
    boxShadow: active ? 'var(--shadow-xs)' : 'none',
  });

  return (
    <div style={{ background: '#fff', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)', padding: '18px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--n90)' }}>Lead import</div>
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
              if (f) handleFile(f);
              e.target.value = '';
            }}
          />
          <div
            onClick={() => inputRef.current?.click()}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const f = e.dataTransfer.files?.[0];
              if (f) handleFile(f);
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
              <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--n90)', overflowWrap: 'anywhere' }}>
                {busy ? 'Parsing…' : result?.ok ? `${result.rowCount} contacts imported` : 'Drop a .csv here or click to choose a file'}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--n50)', marginTop: 4, overflowWrap: 'anywhere' }}>
                {result?.ok
                  ? `${result.headers?.length ?? 0} columns detected · ${result.dupes ?? 0} duplicates merged · ${result.withEmail ?? 0} with a usable email`
                  : 'Columns for name, email, company and title are detected automatically.'}
              </div>
              {result && !result.ok && <div style={{ fontSize: 12, color: 'var(--danger-500)', marginTop: 4 }}>{result.error}</div>}
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

      {mode === 'lsq' ? (
        <div style={{ display: 'flex', gap: 10, alignItems: 'end' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: 'var(--n60)', marginBottom: 6 }}>Source list</div>
            {listsError ? (
              <div style={{ fontSize: 12.5, color: 'var(--danger-500)' }}>{listsError}</div>
            ) : (
              <select
                className="lsq-select"
                value={selectedListId}
                onChange={(e) => setSelectedListId(e.target.value)}
                style={{ width: '100%', height: 38, borderRadius: 'var(--radius-sm)', boxShadow: 'inset 0 0 0 1px var(--border-default)', padding: '0 32px 0 12px', fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--n90)', background: '#fff', border: 'none' }}
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
          <Button hierarchy="secondary" onClick={handleFetchList} disabled={busy || !selectedListId}>
            {busy ? 'Fetching…' : 'Fetch contacts'}
          </Button>
        </div>
      ) : null}

      {mode === 'lsq' && result && (
        <div style={{ marginTop: 12, fontSize: 12.5, color: result.ok ? 'var(--success-700)' : 'var(--danger-500)' }}>
          {result.ok ? `✓ ${result.rowCount} contacts fetched from LeadSquared` : result.error}
        </div>
      )}

      <div style={{ marginTop: 16, display: 'flex', gap: 10, background: 'var(--n10)', borderRadius: 'var(--radius-md)', padding: '12px 14px' }}>
        <Icon name="InformationProperty1Outline" size={16} style={{ color: 'var(--n60)', flexShrink: 0, marginTop: 1 }} />
        <div style={{ minWidth: 0, fontSize: 12, color: 'var(--n70)', lineHeight: 1.5 }}>
          Gaps in the source data — missing titles, verticals, contact details — get filled by the enrichment step below.
        </div>
      </div>

      <Drawer content={mappingOpen ? mappingDrawer(result) : null} onClose={() => setMappingOpen(false)} />
    </div>
  );
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
