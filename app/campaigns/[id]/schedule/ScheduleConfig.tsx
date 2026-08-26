'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { updateScheduleConfigAction } from '@/lib/actions/schedule';
import { parseSendWindow, formatSendWindow } from '@/lib/sendWindow';
import type { Campaign } from '@/lib/generated/prisma/client';

function toTimeInput(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function fromTimeInput(value: string): number {
  const [h, m] = value.split(':').map(Number);
  return h * 60 + m;
}

export function ScheduleConfig({ campaign }: { campaign: Campaign }) {
  // Older campaigns may still hold the legacy free-text display string —
  // parseSendWindow reads both that and the canonical "HH:MM–HH:MM" this form
  // now writes, falling back to a full-day window if neither parses.
  const parsedInitial = parseSendWindow(campaign.scheduleWindow) ?? { startMinutes: 0, endMinutes: 24 * 60 };
  const [start, setStart] = useState(toTimeInput(parsedInitial.startMinutes));
  const [end, setEnd] = useState(toTimeInput(parsedInitial.endMinutes));
  const [frequency, setFrequency] = useState(campaign.frequency);
  const [dailyLimit, setDailyLimit] = useState(campaign.dailyLimit);
  const [dailyLimitError, setDailyLimitError] = useState<string | null>(null);
  const router = useRouter();

  const windowLabel = formatSendWindow({ startMinutes: fromTimeInput(start), endMinutes: fromTimeInput(end) });

  function saveWindow(nextStart: string, nextEnd: string) {
    const canonical = `${nextStart}–${nextEnd}`;
    updateScheduleConfigAction(campaign.id, { scheduleWindow: canonical });
  }

  const gapLabel = frequency === 'aggressive' ? 'invite, +2d nudge, +4d final call' : frequency === 'relaxed' ? 'invite, +6d nudge, +10d final call' : 'invite, +4d nudge, +7d final call';

  // Preset changes rewrite the nudge/final-call step offsets on the server —
  // refresh so the Cadence schedule list below reflects the new dates right away.
  async function selectFrequency(next: string) {
    setFrequency(next);
    await updateScheduleConfigAction(campaign.id, { frequency: next });
    router.refresh();
  }

  async function saveDailyLimit(value: number) {
    const res = await updateScheduleConfigAction(campaign.id, { dailyLimit: value });
    setDailyLimitError(res.ok ? null : res.error);
  }

  return (
    <div style={{ background: '#fff', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)', padding: '18px 20px' }}>
      <div style={{ fontSize: 'var(--fs-body)', fontWeight: 700, color: 'var(--n90)', marginBottom: 14 }}>Scheduling configuration</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 14 }}>
        <div style={{ gridColumn: '1 / -1' }}>
          <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--n60)', marginBottom: 6 }}>Send window (local time) — enforced, not just a label</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              className="lsq-input"
              type="time"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              onBlur={() => saveWindow(start, end)}
              style={{ height: 38, flex: 1 }}
            />
            <span style={{ fontSize: 'var(--fs-label-1)', color: 'var(--n60)' }}>to</span>
            <input
              className="lsq-input"
              type="time"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              onBlur={() => saveWindow(start, end)}
              style={{ height: 38, flex: 1 }}
            />
          </div>
          <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n50)', marginTop: 4 }}>
            {windowLabel} · a send whose time has come but falls outside this window waits for the next tick inside it.
          </div>
        </div>
        <div>
          <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--n60)', marginBottom: 6 }}>Cadence preset</div>
          <select
            className="lsq-select"
            value={frequency}
            onChange={(e) => selectFrequency(e.target.value)}
            style={{ width: '100%', height: 38, borderRadius: 'var(--radius-sm)', boxShadow: 'inset 0 0 0 1px var(--border-default)', padding: '0 32px 0 12px', fontFamily: 'var(--font-body)', fontSize: 'var(--fs-label-1)', color: 'var(--n90)', background: '#fff', border: 'none' }}
          >
            <option value="balanced">Balanced</option>
            <option value="aggressive">Aggressive</option>
            <option value="relaxed">Relaxed</option>
          </select>
        </div>
        <div>
          <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--n60)', marginBottom: 6 }}>Daily send limit</div>
          <input
            className="lsq-input"
            type="number"
            min={0}
            value={dailyLimit}
            onChange={(e) => setDailyLimit(Number(e.target.value))}
            onBlur={() => saveDailyLimit(dailyLimit)}
            style={{ height: 38 }}
          />
          {dailyLimitError && <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--danger-500)', marginTop: 4 }}>{dailyLimitError}</div>}
        </div>
      </div>
      <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--n60)', marginTop: 12 }}>
        Gap between steps: {gapLabel} · editable per-step below. Enforced: sends pause once {dailyLimit}/day is hit and resume the next day.
      </div>
    </div>
  );
}
