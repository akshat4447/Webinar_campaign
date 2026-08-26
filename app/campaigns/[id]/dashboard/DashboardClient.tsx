'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Drawer, type DrawerContent } from '@/components/ui/Drawer';

type BreakdownMode = 'persona' | 'scoreband' | 'source' | 'vertical';

interface FunnelStage {
  label: string;
  value: number;
  pctOfTotal: number;
  stepConversion: number | null;
}

interface ScoreBand {
  label: string;
  contacts: number;
  approved: number;
  attended: number;
  approvalRate: number | null;
  attendanceRate: number | null;
}

interface Kpi {
  label: string;
  value: string;
  sub: string;
  tone: 'accent' | 'good' | 'warn' | 'neutral';
}

interface Row {
  label: string;
  count: number;
  pct: number;
  failed?: number;
}

interface AccountRow {
  account: string;
  contactCount: number;
  approved: number;
  attended: number;
  topScore: number;
  action: string;
  actionColor: string;
}

// Sequential single-hue ramp, lightness-monotonic (verified), used only to shade
// a rate column. Single-hue sequential avoids the categorical-palette problem of
// same-hue series being indistinguishable under colour-vision deficiency.
const RAMP = ['#EBF1FF', '#C7D9FF', '#8FB3FF', '#4E86FF', '#1463FF'];
function rampFor(pct: number | null): { bg: string; fg: string } {
  if (pct === null) return { bg: 'transparent', fg: 'var(--n50)' };
  const i = Math.min(RAMP.length - 1, Math.floor((pct / 100) * RAMP.length));
  return { bg: RAMP[i], fg: i >= 3 ? '#fff' : 'var(--n80)' };
}

const toneColor: Record<Kpi['tone'], string> = {
  accent: 'var(--accent-500)',
  good: 'var(--success-700)',
  warn: 'var(--warning-700)',
  neutral: 'var(--n90)',
};

export function DashboardClient({
  kpis,
  funnel,
  scoreBands,
  stepBreakdown,
  channelBreakdown,
  breakdownData,
  accountBreakdown,
  attended,
  approved,
  attendanceImported,
  drawers,
}: {
  kpis: Kpi[];
  funnel: FunnelStage[];
  scoreBands: ScoreBand[];
  stepBreakdown: Row[];
  channelBreakdown: Array<{ label: string; sent: number; queued: number; failed: number }>;
  breakdownData: Record<BreakdownMode, Row[]>;
  accountBreakdown: AccountRow[];
  attended: number;
  approved: number;
  attendanceImported: boolean;
  drawers: Record<string, DrawerContent>;
}) {
  const [breakdownMode, setBreakdownMode] = useState<BreakdownMode>('persona');
  const [drawer, setDrawer] = useState<DrawerContent | null>(null);
  const [showTable, setShowTable] = useState(false);

  const noShow = Math.max(0, approved - attended);
  const attendPct = approved > 0 ? Math.round((attended / approved) * 100) : 0;
  const maxFunnel = Math.max(1, ...funnel.map((f) => f.value));

  const toggle = (active: boolean): React.CSSProperties => ({
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* KPI row — the headline numbers, read before any chart */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
        {kpis.map((k) => (
          <div key={k.label} style={{ background: '#fff', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)', padding: '16px 18px' }}>
            <div style={{ fontSize: 'var(--fs-label-2)', fontWeight: 600, color: 'var(--n60)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{k.label}</div>
            <div style={{ fontSize: 'var(--fs-heading-2)', fontWeight: 700, color: toneColor[k.tone], marginTop: 6, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>
              {k.value}
            </div>
            <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n60)', marginTop: 3 }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Funnel — horizontal so long stage names fit, with stage-to-stage conversion */}
      <div style={{ background: '#fff', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)', padding: '18px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 'var(--fs-label-1)', fontWeight: 700, color: 'var(--n90)' }}>Campaign funnel</div>
            <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n60)', marginTop: 2 }}>Percentages are conversion from the previous stage. Click any row for the records behind it.</div>
          </div>
          <div onClick={() => setShowTable((s) => !s)} style={{ fontSize: 'var(--fs-label-2)', fontWeight: 600, color: 'var(--accent-500)', cursor: 'pointer' }}>
            {showTable ? 'Show chart' : 'Show as table'}
          </div>
        </div>

        {showTable ? (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-label-1)', minWidth: 420 }}>
              <thead>
                <tr>
                  <th style={th}>Stage</th>
                  <th style={{ ...th, textAlign: 'right' }}>Contacts</th>
                  <th style={{ ...th, textAlign: 'right' }}>Step conversion</th>
                  <th style={{ ...th, textAlign: 'right' }}>Of total</th>
                </tr>
              </thead>
              <tbody>
                {funnel.map((f) => (
                  <tr key={f.label} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '9px 12px 9px 0', color: 'var(--n90)', fontWeight: 600 }}>{f.label}</td>
                    <td style={{ ...num }}>{f.value}</td>
                    <td style={{ ...num, color: 'var(--n60)' }}>{f.stepConversion === null ? '—' : `${f.stepConversion}%`}</td>
                    <td style={{ ...num, color: 'var(--n60)' }}>{f.pctOfTotal}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {funnel.map((f) => {
              const dropped = f.stepConversion !== null && f.stepConversion < 100;
              return (
                <div
                  key={f.label}
                  onClick={() => setDrawer(drawers[f.label] ?? null)}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', borderRadius: 'var(--radius-sm)' }}
                >
                  <div style={{ width: 108, flexShrink: 0, fontSize: 'var(--fs-label-1)', color: 'var(--n70)' }}>{f.label}</div>
                  <div style={{ flex: 1, minWidth: 0, height: 22, background: 'var(--n10)', borderRadius: 4, overflow: 'hidden', position: 'relative' }}>
                    <div
                      style={{
                        width: `${Math.max(1.5, (f.value / maxFunnel) * 100)}%`,
                        height: '100%',
                        background: 'var(--accent-500)',
                        borderRadius: '0 4px 4px 0',
                      }}
                    />
                  </div>
                  <div style={{ width: 52, textAlign: 'right', fontSize: 'var(--fs-label-1)', fontWeight: 700, color: 'var(--n90)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{f.value}</div>
                  <div
                    style={{
                      width: 58,
                      textAlign: 'right',
                      fontSize: 'var(--fs-label-2)',
                      fontWeight: 600,
                      color: f.stepConversion === null ? 'var(--n40)' : dropped ? 'var(--warning-700)' : 'var(--success-700)',
                      fontVariantNumeric: 'tabular-nums',
                      flexShrink: 0,
                    }}
                  >
                    {f.stepConversion === null ? '—' : `${f.stepConversion}%`}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* The advanced read: is the score predictive? */}
      <div style={{ background: '#fff', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)', padding: '18px 20px' }}>
        <div style={{ fontSize: 'var(--fs-label-1)', fontWeight: 700, color: 'var(--n90)' }}>Is the score predictive?</div>
        <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n60)', marginTop: 2, marginBottom: 14 }}>
          Outcomes grouped by the relevance score Claude assigned. If scoring is working, approval and attendance should fall as
          the band drops.
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-label-1)', minWidth: 520 }}>
            <thead>
              <tr>
                <th style={th}>Score band</th>
                <th style={{ ...th, textAlign: 'right' }}>Contacts</th>
                <th style={{ ...th, textAlign: 'right' }}>Approved</th>
                <th style={{ ...th, textAlign: 'right' }}>Approval rate</th>
                <th style={{ ...th, textAlign: 'right' }}>Attended</th>
              </tr>
            </thead>
            <tbody>
              {scoreBands.map((b) => {
                const shade = rampFor(b.approvalRate);
                return (
                  <tr key={b.label} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '10px 12px 10px 0', color: 'var(--n90)', fontWeight: 600, whiteSpace: 'nowrap' }}>{b.label}</td>
                    <td style={num}>{b.contacts}</td>
                    <td style={num}>{b.approved}</td>
                    <td style={{ ...num, paddingRight: 0 }}>
                      <span
                        style={{
                          display: 'inline-block',
                          minWidth: 46,
                          padding: '2px 8px',
                          borderRadius: 'var(--radius-full)',
                          background: shade.bg,
                          color: shade.fg,
                          fontWeight: 600,
                          fontSize: 'var(--fs-label-1)',
                        }}
                      >
                        {b.approvalRate === null ? '—' : `${b.approvalRate}%`}
                      </span>
                    </td>
                    <td style={{ ...num, color: attendanceImported ? 'var(--n70)' : 'var(--n40)' }}>{attendanceImported ? b.attended : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!attendanceImported && (
          <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n50)', marginTop: 10 }}>
            Attendance is blank until a Zoom participants report is imported from Control Center.
          </div>
        )}
      </div>

      {channelBreakdown.length > 0 && (
        <div style={{ background: '#fff', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)', padding: '18px 20px' }}>
          <div style={{ fontSize: 'var(--fs-label-1)', fontWeight: 700, color: 'var(--n90)', marginBottom: 4 }}>Delivery by channel</div>
          <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n60)', marginBottom: 14 }}>
            Every step counted, not just the invite — the funnel above stays invite-only so its stage percentages remain meaningful.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
            {channelBreakdown.map((c) => (
              <div key={c.label} style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: '12px 14px' }}>
                <div style={{ fontSize: 'var(--fs-label-2)', fontWeight: 600, color: 'var(--n60)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>{c.label}</div>
                <div style={{ fontSize: 'var(--fs-heading-2)', fontWeight: 700, color: 'var(--n90)', fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>{c.sent}</div>
                <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n60)', marginTop: 4 }}>
                  sent
                  {c.queued > 0 && <span> · {c.queued} queued</span>}
                  {c.failed > 0 && <span style={{ color: 'var(--danger-500)' }}> · {c.failed} failed</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.6fr) minmax(0, 1fr)', gap: 16 }}>
        <div style={{ background: '#fff', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)', padding: '18px 20px' }}>
          <div style={{ fontSize: 'var(--fs-label-1)', fontWeight: 700, color: 'var(--n90)', marginBottom: 14 }}>Real sends by cadence step</div>
          {stepBreakdown.length === 0 ? (
            <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--n60)' }}>No sends have gone out yet — launch the cadence from Schedule.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {stepBreakdown.map((row) => (
                <div key={row.label} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 124, fontSize: 'var(--fs-label-1)', color: 'var(--n70)', flexShrink: 0 }}>{row.label}</div>
                  <div style={{ flex: 1, background: 'var(--n10)', borderRadius: 4, height: 14, overflow: 'hidden' }}>
                    <div style={{ width: `${Math.max(1.5, row.pct)}%`, height: '100%', background: 'var(--accent-500)', borderRadius: '0 4px 4px 0' }} />
                  </div>
                  <div style={{ width: 34, textAlign: 'right', fontSize: 'var(--fs-label-1)', fontWeight: 700, color: 'var(--n90)', fontVariantNumeric: 'tabular-nums' }}>{row.count}</div>
                  <div style={{ width: 58, textAlign: 'right', fontSize: 'var(--fs-label-2)', color: row.failed ? 'var(--danger-500)' : 'var(--n40)', fontVariantNumeric: 'tabular-nums' }}>
                    {row.failed ? `${row.failed} failed` : '—'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ background: '#fff', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)', padding: '18px 20px' }}>
          <div style={{ fontSize: 'var(--fs-label-1)', fontWeight: 700, color: 'var(--n90)', marginBottom: 14 }}>Attended vs. no-show</div>
          {!attendanceImported ? (
            <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--n60)' }}>Import a Zoom attendance report from Control Center to see this.</div>
          ) : (
            <>
              <div style={{ display: 'flex', height: 14, borderRadius: 4, overflow: 'hidden', gap: 2 }}>
                <div style={{ width: `${attendPct}%`, background: 'var(--accent-500)', borderRadius: '4px 0 0 4px' }} />
                <div style={{ flex: 1, background: 'var(--n20)', borderRadius: '0 4px 4px 0' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, fontSize: 'var(--fs-label-1)', color: 'var(--n60)' }}>
                <span>
                  <strong style={{ color: 'var(--accent-500)', fontSize: 'var(--fs-body)' }}>{attended}</strong> attended
                </span>
                <span>
                  <strong style={{ color: 'var(--n70)', fontSize: 'var(--fs-body)' }}>{noShow}</strong> no-show
                </span>
              </div>
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border-subtle)', fontSize: 'var(--fs-label-2)', color: 'var(--n60)' }}>
                {attendPct}% of approved contacts attended.
              </div>
            </>
          )}
        </div>
      </div>

      <div style={{ background: '#fff', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)', padding: '18px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 12, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 'var(--fs-label-1)', fontWeight: 700, color: 'var(--n90)' }}>Segment breakdown</div>
          <div style={{ display: 'flex', background: 'var(--n10)', borderRadius: 'var(--radius-md)', padding: 3, gap: 2 }}>
            {(['persona', 'scoreband', 'source', 'vertical'] as BreakdownMode[]).map((m) => (
              <div key={m} onClick={() => setBreakdownMode(m)} style={toggle(breakdownMode === m)}>
                {m === 'scoreband' ? 'Score band' : m[0].toUpperCase() + m.slice(1)}
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          {breakdownData[breakdownMode].slice(0, 8).map((row) => (
            <div key={row.label} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 190, fontSize: 'var(--fs-label-1)', color: 'var(--n70)', flexShrink: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={row.label}>
                {row.label}
              </div>
              <div style={{ flex: 1, background: 'var(--n10)', borderRadius: 4, height: 14, overflow: 'hidden' }}>
                <div style={{ width: `${Math.max(1.5, row.pct)}%`, height: '100%', background: 'var(--accent-500)', borderRadius: '0 4px 4px 0' }} />
              </div>
              <div style={{ width: 34, textAlign: 'right', fontSize: 'var(--fs-label-1)', fontWeight: 700, color: 'var(--n90)', fontVariantNumeric: 'tabular-nums' }}>{row.count}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ background: '#fff', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)', overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)', gap: 12 }}>
          <div>
            <div style={{ fontSize: 'var(--fs-label-1)', fontWeight: 700, color: 'var(--n90)' }}>Top accounts by best-scoring contact</div>
            <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n60)', marginTop: 2 }}>Where the SDR team should start.</div>
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-label-1)', minWidth: 560 }}>
            <thead>
              <tr>
                <th style={{ ...th, paddingLeft: 20 }}>Account</th>
                <th style={{ ...th, textAlign: 'right' }}>Top score</th>
                <th style={{ ...th, textAlign: 'right' }}>Contacts</th>
                <th style={{ ...th, textAlign: 'right' }}>Approved</th>
                <th style={{ ...th, textAlign: 'right' }}>Attended</th>
                <th style={{ ...th, paddingRight: 20 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {accountBreakdown.map((row) => (
                <tr key={row.account} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                  <td style={{ padding: '11px 12px 11px 20px', color: 'var(--n90)', fontWeight: 600 }}>{row.account}</td>
                  <td style={num}>{row.topScore || '—'}</td>
                  <td style={num}>{row.contactCount}</td>
                  <td style={num}>{row.approved}</td>
                  <td style={{ ...num, color: attendanceImported ? 'var(--n70)' : 'var(--n40)' }}>{attendanceImported ? row.attended : '—'}</td>
                  <td style={{ padding: '11px 20px 11px 12px' }}>
                    <Badge color={row.actionColor} text={row.action} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Drawer content={drawer} onClose={() => setDrawer(null)} />
    </div>
  );
}

const th: React.CSSProperties = {
  padding: '0 12px 8px 0',
  textAlign: 'left',
  fontSize: 'var(--fs-label-2)',
  fontWeight: 600,
  color: 'var(--n60)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  borderBottom: '1px solid var(--border-subtle)',
};

const num: React.CSSProperties = {
  padding: '10px 12px 10px 0',
  textAlign: 'right',
  color: 'var(--n80)',
  fontVariantNumeric: 'tabular-nums',
};
