'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { importAttendanceAction, importAttendanceFromZoomAction } from '@/lib/actions/attendance';
import type { AttendanceImportResult } from '@/lib/attendance';

// Two ways in: pull straight from Zoom's reporting API when a meeting is
// linked, or import the "Participants Report" CSV any host can export by hand.
// The CSV path is kept even when Zoom is linked — the reporting API needs a
// paid plan and can simply be unavailable, and a hand export always works.
export function ZoomPanel({ campaignId, hasLinkedMeeting }: { campaignId: string; hasLinkedMeeting: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AttendanceImportResult | null>(null);
  const router = useRouter();

  async function handleFile(file: File) {
    setBusy(true);
    const fd = new FormData();
    fd.set('file', file);
    const res = await importAttendanceAction(campaignId, fd);
    setBusy(false);
    setResult(res);
    if (res.ok) router.refresh();
  }

  async function pullFromZoom() {
    setBusy(true);
    const res = await importAttendanceFromZoomAction(campaignId);
    setBusy(false);
    setResult(res);
    if (res.ok) router.refresh();
  }

  return (
    <div style={{ background: '#fff', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)', padding: '16px 18px' }}>
      <div style={{ fontSize: 'var(--fs-label-1)', fontWeight: 700, color: 'var(--n90)', marginBottom: 10 }}>Zoom attendance</div>
      {result?.ok ? (
        <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--success-700)', lineHeight: 1.6 }}>
          ✓ {result.attendedCount} attended · {result.noShowCount} no-show — real attend/no-show sends queued and pushed to
          LeadSquared as engagement activities.
        </div>
      ) : (
        <>
          {hasLinkedMeeting && (
            <Button hierarchy="secondary" size="sm" fullWidth onClick={pullFromZoom} disabled={busy} style={{ marginBottom: 8 }}>
              {busy ? 'Pulling…' : 'Pull attendance from Zoom'}
            </Button>
          )}
          <input
            ref={inputRef}
            type="file"
            accept=".csv"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />
          <Button hierarchy="secondary" size="sm" fullWidth onClick={() => inputRef.current?.click()} disabled={busy}>
            {busy ? 'Importing…' : 'Upload attendance report (.csv)'}
          </Button>
          {result && !result.ok && <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--danger-500)', marginTop: 8 }}>{result.error}</div>}
          <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n50)', marginTop: 8, lineHeight: 1.5 }}>
            {hasLinkedMeeting
              ? "Zoom's reporting API needs a paid plan — if the pull fails or looks incomplete, export the Participants Report from Zoom and drop it here instead."
              : 'No Zoom meeting linked. Export the Participants Report from Zoom after the webinar and drop it here.'}
          </div>
        </>
      )}
    </div>
  );
}
