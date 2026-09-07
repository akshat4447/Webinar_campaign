import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import { PageHeader } from '@/components/ui/PageHeader';
import { statusMeta } from '@/lib/demo-data';
import { campaignLandingHref } from '@/lib/campaignRoutes';
import {
  DASH,
  getCrossCampaignLearnings,
  getDashboardKpis,
  getPersonaLearning,
  getPersonaRegistrationRate,
  getRegistrationsByChannel,
  getRegistrationsByInviteChannel,
  getRegistrationsTrend,
  getWebinarsInRange,
  type DashboardRange,
} from '@/lib/analytics';

const RANGES: { id: DashboardRange; label: string }[] = [
  { id: '30d', label: '30 days' },
  { id: '90d', label: '90 days' },
  { id: '6m', label: '6 months' },
  { id: 'all', label: 'All time' },
];

function isRange(v: string | undefined): v is DashboardRange {
  return RANGES.some((r) => r.id === v);
}

export const dynamic = 'force-dynamic';

export default async function DashboardPage(props: PageProps<'/dashboard'>) {
  const { range: rawRange } = await props.searchParams;
  const range: DashboardRange = isRange(typeof rawRange === 'string' ? rawRange : undefined) ? (rawRange as DashboardRange) : '30d';

  const [kpis, trend, channels, inviteChannels, webinars, personas, personaRegRates, learnings] = await Promise.all([
    getDashboardKpis(range),
    getRegistrationsTrend(range),
    getRegistrationsByChannel(range),
    getRegistrationsByInviteChannel(range),
    getWebinarsInRange(range),
    getPersonaLearning(),
    getPersonaRegistrationRate(),
    getCrossCampaignLearnings(),
  ]);

  const maxTrend = Math.max(1, ...trend.map((t) => t.count));
  const maxChannel = Math.max(1, ...channels.map((c) => c.count));
  const maxInviteChannel = Math.max(1, ...inviteChannels.map((c) => c.count));

  return (
    <main style={{ flex: 1, overflowY: 'auto', padding: '32px 40px 48px 40px' }}>
      <div style={{ maxWidth: 1080, margin: '0 auto' }}>
        <PageHeader title="Dashboard" subtitle="Everything across your webinars, in one place" />

        <div style={{ display: 'flex', gap: 4, marginBottom: 20, flexWrap: 'wrap' }}>
          {RANGES.map((r) => {
            const active = r.id === range;
            return (
              <Link
                key={r.id}
                href={r.id === '30d' ? '/dashboard' : `/dashboard?range=${r.id}`}
                className="lsq-nav"
                data-active={active ? 'true' : 'false'}
                style={{
                  padding: '7px 14px',
                  borderRadius: 'var(--radius-md)',
                  fontSize: 'var(--fs-label-1)',
                  fontWeight: 'var(--fw-semibold)',
                  textDecoration: 'none',
                  background: active ? 'var(--accent-50)' : 'transparent',
                  color: active ? 'var(--accent-700)' : 'var(--n60)',
                }}
              >
                {r.label}
              </Link>
            );
          })}
        </div>

        {/* 5 KPIs with period-over-period deltas */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 20 }}>
          {kpis.map((k) => {
            const good = k.delta !== null && k.delta > 0;
            const bad = k.delta !== null && k.delta < 0;
            return (
              <div key={k.label} className="lsq-card" style={{ padding: '16px 18px' }}>
                <div style={{ fontSize: 'var(--fs-label-2)', fontWeight: 600, color: 'var(--n60)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {k.label}
                </div>
                <div className="lsq-num" style={{ fontSize: 'var(--fs-heading-2)', fontWeight: 700, color: 'var(--n90)', marginTop: 6, letterSpacing: '-0.02em' }}>
                  {k.value}
                </div>
                <div
                  style={{
                    fontSize: 'var(--fs-label-2)',
                    fontWeight: 600,
                    marginTop: 4,
                    color: good ? 'var(--success-700)' : bad ? 'var(--warning-700)' : 'var(--n50)',
                  }}
                >
                  {k.delta === null
                    ? range === 'all'
                      ? 'No prior period'
                      : '—'
                    : `${k.delta > 0 ? '+' : ''}${k.delta}${k.deltaKind === 'points' ? ' pts' : '%'} vs. prior period`}
                </div>
              </div>
            );
          })}
        </div>

        {/* Registrations over time */}
        <div className="lsq-card" style={{ padding: '18px 20px', marginBottom: 20 }}>
          <div style={{ fontSize: 'var(--fs-label-1)', fontWeight: 700, color: 'var(--n90)', marginBottom: 4 }}>Registrations over time</div>
          <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n60)', marginBottom: 14 }}>
            {range === '30d' ? 'Daily' : range === '90d' ? 'Weekly' : 'Monthly'} totals across every webinar.
          </div>
          {trend.every((t) => t.count === 0) ? (
            <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--n60)' }}>No registrations in this range yet.</div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 120, overflowX: 'auto' }}>
              {trend.map((t) => (
                <div key={t.label} title={`${t.label}: ${t.count}`} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: '1 0 18px', minWidth: 18 }}>
                  <div style={{ width: '100%', maxWidth: 28, height: Math.max(2, (t.count / maxTrend) * 96), background: 'var(--chart-1)', borderRadius: '3px 3px 0 0' }} />
                  <div style={{ fontSize: 9, color: 'var(--n50)', marginTop: 4, whiteSpace: 'nowrap' }}>{t.label}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 16, marginBottom: 20 }}>
          {/* Registrations by channel */}
          <div className="lsq-card" style={{ padding: '18px 20px' }}>
            <div style={{ fontSize: 'var(--fs-label-1)', fontWeight: 700, color: 'var(--n90)', marginBottom: 14 }}>Registrations by channel</div>
            {channels.length === 0 ? (
              <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--n60)' }}>No registrations in this range yet.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {channels.map((c) => (
                  <div key={c.label} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 108, fontSize: 'var(--fs-label-1)', color: 'var(--n70)', flexShrink: 0 }}>{c.label}</div>
                    <div style={{ flex: 1, background: 'var(--n10)', borderRadius: 4, height: 14, overflow: 'hidden' }}>
                      <div style={{ width: `${Math.max(1.5, (c.count / maxChannel) * 100)}%`, height: '100%', background: 'var(--accent-500)', borderRadius: '0 4px 4px 0' }} />
                    </div>
                    <div style={{ width: 34, textAlign: 'right', fontSize: 'var(--fs-label-1)', fontWeight: 700, color: 'var(--n90)', fontVariantNumeric: 'tabular-nums' }}>{c.count}</div>
                    <div style={{ width: 34, textAlign: 'right', fontSize: 'var(--fs-label-2)', color: 'var(--n50)', fontVariantNumeric: 'tabular-nums' }}>{c.pct}%</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Persona conversion — moved from the webinars list page in C11 */}
          <div className="lsq-card" style={{ padding: '18px 20px' }}>
            <div style={{ fontSize: 'var(--fs-label-1)', fontWeight: 700, color: 'var(--n90)', marginBottom: 4 }}>Approval rate by persona</div>
            <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n60)', marginBottom: 14 }}>
              Share of scored contacts approved, by seniority and function, across every webinar with at least 3 scored contacts
              in that persona — a track record, not an automatic feedback loop.
            </div>
            {personas.length === 0 ? (
              <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--n60)' }}>
                Not enough scored contacts yet — run scoring on a campaign to see persona trends here.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {personas.map((row) => (
                  <div key={row.label} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 170, fontSize: 'var(--fs-label-1)', color: 'var(--n70)', flexShrink: 0, overflowWrap: 'anywhere' }}>
                      {row.label} <span style={{ color: 'var(--n50)' }}>({row.sampleSize})</span>
                    </div>
                    <div style={{ flex: 1, background: 'var(--n20)', borderRadius: 'var(--radius-full)', height: 8, overflow: 'hidden' }}>
                      <div style={{ width: `${row.pct}%`, height: '100%', background: 'var(--accent-500)', borderRadius: 'var(--radius-full)' }} />
                    </div>
                    <div style={{ width: 40, textAlign: 'right', fontSize: 'var(--fs-label-1)', fontWeight: 700, color: 'var(--n90)', fontVariantNumeric: 'tabular-nums' }}>{row.pct}%</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 16, marginBottom: 20 }}>
          {/* Registrations by invite channel — a different axis than "Registrations
              by channel" above: that one groups by how someone registered
              (one-click link / LinkedIn form / manual / import), this by which
              invite actually reached them. */}
          <div className="lsq-card" style={{ padding: '18px 20px' }}>
            <div style={{ fontSize: 'var(--fs-label-1)', fontWeight: 700, color: 'var(--n90)', marginBottom: 4 }}>Registrations by invite channel</div>
            <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n60)', marginBottom: 14 }}>
              Which invite (email/SMS/WhatsApp cadence step, or a LinkedIn form) reached each registrant. A contact invited on
              more than one channel counts under each.
            </div>
            {inviteChannels.length === 0 ? (
              <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--n60)' }}>No registrations in this range yet.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {inviteChannels.map((c) => (
                  <div key={c.label} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 108, fontSize: 'var(--fs-label-1)', color: 'var(--n70)', flexShrink: 0 }}>{c.label}</div>
                    <div style={{ flex: 1, background: 'var(--n10)', borderRadius: 4, height: 14, overflow: 'hidden' }}>
                      <div style={{ width: `${Math.max(1.5, (c.count / maxInviteChannel) * 100)}%`, height: '100%', background: 'var(--chart-1)', borderRadius: '0 4px 4px 0' }} />
                    </div>
                    <div style={{ width: 34, textAlign: 'right', fontSize: 'var(--fs-label-1)', fontWeight: 700, color: 'var(--n90)', fontVariantNumeric: 'tabular-nums' }}>{c.count}</div>
                    <div style={{ width: 34, textAlign: 'right', fontSize: 'var(--fs-label-2)', color: 'var(--n50)', fontVariantNumeric: 'tabular-nums' }}>{c.pct}%</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Registration rate by persona — a different question than "Approval
              rate by persona" above: of contacts actually invited, which
              persona registers best. Real computed rate, not a narrative claim. */}
          <div className="lsq-card" style={{ padding: '18px 20px' }}>
            <div style={{ fontSize: 'var(--fs-label-1)', fontWeight: 700, color: 'var(--n90)', marginBottom: 4 }}>Registration rate by persona</div>
            <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n60)', marginBottom: 14 }}>
              Share of invited contacts who registered, by seniority and function, across every webinar with at least 3
              invited contacts in that persona.
            </div>
            {personaRegRates.length === 0 ? (
              <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--n60)' }}>
                Not enough invited contacts yet — launch a cadence to see persona trends here.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {personaRegRates.map((row) => (
                  <div key={row.label} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 170, fontSize: 'var(--fs-label-1)', color: 'var(--n70)', flexShrink: 0, overflowWrap: 'anywhere' }}>
                      {row.label} <span style={{ color: 'var(--n50)' }}>({row.sampleSize})</span>
                    </div>
                    <div style={{ flex: 1, background: 'var(--n20)', borderRadius: 'var(--radius-full)', height: 8, overflow: 'hidden' }}>
                      <div style={{ width: `${row.pct}%`, height: '100%', background: 'var(--accent-500)', borderRadius: 'var(--radius-full)' }} />
                    </div>
                    <div style={{ width: 40, textAlign: 'right', fontSize: 'var(--fs-label-1)', fontWeight: 700, color: 'var(--n90)', fontVariantNumeric: 'tabular-nums' }}>{row.pct}%</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Campaign-over-campaign learnings — vertical and source, persona has its own panel above */}
        <div className="lsq-card" style={{ padding: '18px 20px', marginBottom: 20 }}>
          <div style={{ fontSize: 'var(--fs-label-1)', fontWeight: 700, color: 'var(--n90)', marginBottom: 4 }}>What the agent has learned</div>
          <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n60)', marginBottom: 14 }}>
            Approval rate by vertical and lead source, across every scored contact — the same track-record rule as
            persona: at least 3 scored contacts before a rate counts.
          </div>
          {learnings.length === 0 ? (
            <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--n60)' }}>Not enough scored contacts yet to surface a pattern.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {learnings.map((row) => (
                <div key={`${row.dimension}-${row.label}`} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 70, fontSize: 'var(--fs-label-2)', color: 'var(--n50)', flexShrink: 0, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    {row.dimension}
                  </div>
                  <div style={{ width: 140, fontSize: 'var(--fs-label-1)', color: 'var(--n70)', flexShrink: 0, overflowWrap: 'anywhere' }}>
                    {row.label} <span style={{ color: 'var(--n50)' }}>({row.sampleSize})</span>
                  </div>
                  <div style={{ flex: 1, background: 'var(--n20)', borderRadius: 'var(--radius-full)', height: 8, overflow: 'hidden' }}>
                    <div style={{ width: `${row.pct}%`, height: '100%', background: 'var(--accent-500)', borderRadius: 'var(--radius-full)' }} />
                  </div>
                  <div style={{ width: 40, textAlign: 'right', fontSize: 'var(--fs-label-1)', fontWeight: 700, color: 'var(--n90)', fontVariantNumeric: 'tabular-nums' }}>{row.pct}%</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Webinars in range */}
        <div className="lsq-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border-subtle)' }}>
            <div style={{ fontSize: 'var(--fs-label-1)', fontWeight: 700, color: 'var(--n90)' }}>Webinars in range</div>
          </div>
          {webinars.length === 0 ? (
            <div style={{ padding: '24px 20px', fontSize: 'var(--fs-label-1)', color: 'var(--n60)', textAlign: 'center' }}>No webinars in this range.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="lsq-table" style={{ width: '100%', minWidth: 660, fontSize: 'var(--fs-label-1)' }}>
                <thead>
                  <tr style={{ textAlign: 'left' }}>
                    <th style={{ padding: '10px 20px' }}>Webinar</th>
                    <th style={{ padding: '10px 20px' }}>Date</th>
                    <th style={{ padding: '10px 20px' }}>Status</th>
                    <th className="num" style={{ padding: '10px 20px' }}>Registered</th>
                    <th className="num" style={{ padding: '10px 20px' }}>Attendance</th>
                    <th className="num" style={{ padding: '10px 20px' }}>Demos</th>
                  </tr>
                </thead>
                <tbody>
                  {webinars.map((w) => (
                    <tr key={w.id}>
                      <td style={{ padding: '11px 20px', fontWeight: 600 }}>
                        <Link href={campaignLandingHref(w)} style={{ color: 'var(--n90)', textDecoration: 'none' }}>
                          {w.name}
                        </Link>
                      </td>
                      <td style={{ padding: '11px 20px', color: 'var(--n60)' }}>{w.date}</td>
                      <td style={{ padding: '11px 20px' }}>
                        {(() => {
                          const meta = statusMeta[w.status as keyof typeof statusMeta] ?? statusMeta.draft;
                          return <Badge color={meta.color} text={meta.label} dot />;
                        })()}
                      </td>
                      <td className="num" style={{ padding: '11px 20px' }}>{w.registered}</td>
                      <td className="num" style={{ padding: '11px 20px' }}>{w.attendanceRate}</td>
                      <td className="num" style={{ padding: '11px 20px' }}>{w.demoRequests || DASH}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
