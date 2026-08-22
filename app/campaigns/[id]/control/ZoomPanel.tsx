'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { importAttendanceAction } from '@/lib/actions/attendance';
import type { AttendanceImportResult } from '@/lib/attendance';

// No Zoom API — this parses the real "Participants Report" CSV Zoom lets any
// host export after a webinar, matches by email, and pushes real attend/no-show
// sends + a LeadSquared engagement activity for each match.
export function ZoomPanel({ campaignId }: { campaignId: string }) {
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

  return (
    <div style={{ background: '#fff', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)', padding: '16px 18px' }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--n90)', marginBottom: 10 }}>Zoom attendance (CSV import, no API)</div>
      {result?.ok ? (
        <div style={{ fontSize: 12.5, color: 'var(--success-700)', lineHeight: 1.6 }}>
          ✓ {result.attendedCount} attended · {result.noShowCount} no-show — real attend/no-show sends queued and pushed to
          LeadSquared as engagement activities.
        </div>
      ) : (
        <>
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
          {result && !result.ok && <div style={{ fontSize: 12, color: 'var(--danger-500)', marginTop: 8 }}>{result.error}</div>}
          <div style={{ fontSize: 11, color: 'var(--n50)', marginTop: 8, lineHeight: 1.5 }}>
            Export the Participants Report from Zoom after the webinar and drop it here.
          </div>
        </>
      )}
    </div>
  );
}
