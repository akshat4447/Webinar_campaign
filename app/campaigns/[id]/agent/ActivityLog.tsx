const STATUS_BY_DOT: Record<string, { label: string; bg: string; fg: string }> = {
  'var(--success-500)': { label: 'Done', bg: 'var(--success-100)', fg: 'var(--success-700)' },
  'var(--warning-700)': { label: 'Attention', bg: 'var(--warning-100)', fg: 'var(--warning-700)' },
  'var(--accent-500)': { label: 'Running', bg: 'var(--accent-50)', fg: 'var(--accent-700)' },
};

interface LogRow {
  id: string;
  text: string;
  dot: string;
  createdAt: Date;
}

/**
 * The numbered activity log the prototype shows on Agent run.
 *
 * Every entry already carries a semantic colour (`dot`) from whichever action
 * wrote it — success green, warning amber, or the default accent for a
 * plain informational entry. Rather than adding a schema column for a status
 * label, this maps the colour that already exists onto one, so a log entry
 * written before this checkpoint renders exactly the same as one written
 * after it.
 */
export function ActivityLog({ entries }: { entries: LogRow[] }) {
  return (
    <div style={{ background: '#fff', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)', padding: '18px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ fontSize: 'var(--fs-body)', fontWeight: 700, color: 'var(--n90)' }}>Agent activity</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-label-2)', fontWeight: 700, color: 'var(--success-700)' }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--success-500)', flexShrink: 0 }} />
          Live · real-time to LeadSquared
        </div>
      </div>

      {entries.length === 0 ? (
        <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--n60)' }}>No activity yet.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {entries.map((e, i) => {
            const status = STATUS_BY_DOT[e.dot] ?? STATUS_BY_DOT['var(--accent-500)'];
            // Oldest first, numbered from 1 — the log reads top-to-bottom as
            // the order things actually happened, and the ordinal is a real
            // sequence number, not a decoration.
            const ordinal = i + 1;
            return (
              <div
                key={e.id}
                style={{
                  display: 'flex',
                  gap: 14,
                  padding: '11px 0',
                  borderBottom: i < entries.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                }}
              >
                <div
                  style={{
                    width: 22,
                    height: 22,
                    flexShrink: 0,
                    borderRadius: '50%',
                    background: status.bg,
                    color: status.fg,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 'var(--fs-caption)',
                    fontWeight: 700,
                  }}
                >
                  {ordinal}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--n80)', lineHeight: 1.5, overflowWrap: 'anywhere' }}>{e.text}</div>
                  <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n50)', marginTop: 2 }}>
                    {e.createdAt.toLocaleString('en-GB', { hour12: false })}
                  </div>
                </div>
                <span
                  style={{
                    fontSize: 'var(--fs-label-2)',
                    fontWeight: 700,
                    borderRadius: 'var(--radius-full)',
                    padding: '3px 10px',
                    height: 'fit-content',
                    background: status.bg,
                    color: status.fg,
                    flexShrink: 0,
                  }}
                >
                  {status.label}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
