'use client';

import { useState } from 'react';
import { updateScheduleConfigAction } from '@/lib/actions/schedule';
import type { Campaign } from '@/lib/generated/prisma/client';

export function ScheduleConfig({ campaign }: { campaign: Campaign }) {
  const [window_, setWindow] = useState(campaign.scheduleWindow);
  const [frequency, setFrequency] = useState(campaign.frequency);
  const [dailyLimit, setDailyLimit] = useState(campaign.dailyLimit);

  const gapLabel = frequency === 'aggressive' ? 'invite, +2d nudge, +4d final call' : frequency === 'relaxed' ? 'invite, +6d nudge, +10d final call' : 'invite, +4d nudge, +7d final call';

  return (
    <div style={{ background: '#fff', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)', padding: '18px 20px' }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--n90)', marginBottom: 14 }}>Scheduling configuration</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 14 }}>
        <div style={{ gridColumn: '1 / -1' }}>
          <div style={{ fontSize: 12, color: 'var(--n60)', marginBottom: 6 }}>Send window</div>
          <input
            className="lsq-input"
            type="text"
            value={window_}
            onChange={(e) => setWindow(e.target.value)}
            onBlur={() => updateScheduleConfigAction(campaign.id, { scheduleWindow: window_ })}
            style={{ height: 38 }}
          />
        </div>
        <div>
          <div style={{ fontSize: 12, color: 'var(--n60)', marginBottom: 6 }}>Cadence preset</div>
          <select
            className="lsq-select"
            value={frequency}
            onChange={(e) => {
              setFrequency(e.target.value);
              updateScheduleConfigAction(campaign.id, { frequency: e.target.value });
            }}
            style={{ width: '100%', height: 38, borderRadius: 'var(--radius-sm)', boxShadow: 'inset 0 0 0 1px var(--border-default)', padding: '0 32px 0 12px', fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--n90)', background: '#fff', border: 'none' }}
          >
            <option value="balanced">Balanced</option>
            <option value="aggressive">Aggressive</option>
            <option value="relaxed">Relaxed</option>
          </select>
        </div>
        <div>
          <div style={{ fontSize: 12, color: 'var(--n60)', marginBottom: 6 }}>Daily send limit</div>
          <input
            className="lsq-input"
            type="number"
            value={dailyLimit}
            onChange={(e) => setDailyLimit(Number(e.target.value))}
            onBlur={() => updateScheduleConfigAction(campaign.id, { dailyLimit })}
            style={{ height: 38 }}
          />
        </div>
      </div>
      <div style={{ fontSize: 12, color: 'var(--n60)', marginTop: 12 }}>Gap between steps: {gapLabel} · editable per-step below.</div>
    </div>
  );
}
