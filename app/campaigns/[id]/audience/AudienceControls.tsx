'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { approveAboveThresholdAction } from '@/lib/actions/scoring';

// Search, band filter and paging all live in the URL and are executed by the
// database, not by filtering an array in the browser. At the scale this is
// built for — thousands of contacts — shipping every row to the client and
// filtering there is what makes a page feel broken.

export interface Band {
  id: string;
  label: string;
  count: number;
  color: string;
}

export function AudienceControls({
  campaignId,
  q,
  band,
  bands,
  total,
  threshold,
  page,
  pageSize,
  shown,
}: {
  campaignId: string;
  q: string;
  band: string;
  bands: Band[];
  total: number;
  threshold: number;
  page: number;
  pageSize: number;
  shown: number;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [draft, setDraft] = useState(q);
  const [busy, setBusy] = useState(false);

  const scoredTotal = bands.reduce((a, b) => a + b.count, 0);

  function navigate(next: Record<string, string>) {
    const params = new URLSearchParams({ ...(q ? { q } : {}), ...(band !== 'all' ? { band } : {}), ...next });
    if (params.get('page') === '0') params.delete('page');
    router.push(`/campaigns/${campaignId}/audience${params.toString() ? `?${params}` : ''}`);
  }

  const from = total === 0 ? 0 : page * pageSize + 1;
  const to = page * pageSize + shown;

  return (
    <>
      {scoredTotal > 0 && (
        <div className="lsq-card" style={{ padding: '16px 20px', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 'var(--fs-label-1)', fontWeight: 'var(--fw-bold)', color: 'var(--n90)' }}>Score distribution</div>
            <Button
              size="sm"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const r = await approveAboveThresholdAction(campaignId);
                setBusy(false);
                showToast(`${r.approved.toLocaleString()} contact${r.approved === 1 ? '' : 's'} approved at ${threshold} and above.`);
                router.refresh();
              }}
            >
              Approve all ≥ {threshold}
            </Button>
          </div>

          <div style={{ display: 'flex', height: 12, borderRadius: 'var(--radius-full)', overflow: 'hidden', marginBottom: 10 }}>
            {bands.map((b) => (
              <span
                key={b.id}
                title={`${b.label}: ${b.count}`}
                style={{ width: `${scoredTotal ? (b.count / scoredTotal) * 100 : 0}%`, background: b.color }}
              />
            ))}
          </div>

          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
            {bands.map((b) => (
              <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-label-1)' }}>
                <span style={{ width: 9, height: 9, borderRadius: 2, background: b.color, flexShrink: 0 }} />
                <span className="lsq-num" style={{ fontWeight: 'var(--fw-bold)' }}>{b.count.toLocaleString()}</span>
                <span style={{ color: 'var(--n50)' }}>{b.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            navigate({ q: draft, page: '0' });
          }}
          style={{ flex: 1, minWidth: 200, display: 'flex', gap: 8 }}
        >
          <input
            className="lsq-input"
            type="search"
            aria-label="Search contacts"
            placeholder="Search name, title or account…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            style={{ height: 34 }}
          />
          <button type="submit" className="lsq-btn lsq-btn--secondary lsq-btn--sm">
            Search
          </button>
        </form>

        {[{ id: 'all', label: `All ${total.toLocaleString()}` }, ...bands.map((b) => ({ id: b.id, label: `${b.label} (${b.count.toLocaleString()})` }))].map((f) => {
          const active = f.id === band;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => navigate({ band: f.id, page: '0' })}
              style={{
                padding: '6px 12px',
                borderRadius: 'var(--radius-sm)',
                fontSize: 'var(--fs-label-1)',
                fontWeight: 'var(--fw-semibold)',
                border: 'none',
                cursor: 'pointer',
                background: active ? 'var(--accent-50)' : 'var(--n10)',
                color: active ? 'var(--accent-700)' : 'var(--n60)',
              }}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {total > pageSize && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12 }}>
          <span style={{ fontSize: 'var(--fs-label-1)', color: 'var(--n50)' }} className="lsq-num">
            Showing {from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button hierarchy="secondary" size="sm" disabled={page === 0} onClick={() => navigate({ page: String(page - 1) })}>
              Previous
            </Button>
            <Button hierarchy="secondary" size="sm" disabled={to >= total} onClick={() => navigate({ page: String(page + 1) })}>
              Next
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
