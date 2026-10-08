import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import { DashboardWebinarsTable } from './DashboardWebinarsTable';
import {
  getCrossCampaignLearnings,
  getDashboardKpis,
  getPersonaLearning,
  getRegistrationsByChannel,
  getRegistrationsTrend,
  getWebinarsInRange,
  type DashboardRange,
} from '@/lib/analytics';

// `label` is the short control text, `window` the full phrase used wherever a figure is shown so the
// time window is never implicit (the webinar list reports all dates; this page reports one window).
const RANGES: { id: DashboardRange; label: string; window: string }[] = [
  { id: '30d', label: '30 days', window: 'Last 30 days' },
  { id: '90d', label: '90 days', window: 'Last 90 days' },
  { id: '6m', label: '6 months', window: 'Last 6 months' },
  { id: 'all', label: 'All time', window: 'All time' },
];

function isRange(v: string | undefined): v is DashboardRange {
  return RANGES.some((r) => r.id === v);
}

export const dynamic = 'force-dynamic';

export default async function DashboardPage(props: PageProps<'/dashboard'>) {
  const { range: rawRange } = await props.searchParams;
  const range: DashboardRange = isRange(typeof rawRange === 'string' ? rawRange : undefined) ? (rawRange as DashboardRange) : '30d';

  const [kpis, trend, channels, webinarsInRange, personas, learnings] = await Promise.all([
    getDashboardKpis(range),
    getRegistrationsTrend(range),
    getRegistrationsByChannel(range),
    getWebinarsInRange(range),
    getPersonaLearning(),
    getCrossCampaignLearnings(range),
  ]);
  const { rows: webinars, totalCount: webinarsTotalCount } = webinarsInRange;

  const maxTrend = Math.max(1, ...trend.map((t) => t.count));
  const maxChannel = Math.max(1, ...channels.map((c) => c.count));
  const windowLabel = RANGES.find((r) => r.id === range)?.window ?? 'Last 30 days';
  // The trend is always whole calendar months (trailing 6 for any bounded range), not the selected window,
  // so its label says so instead of repeating the window and contradicting the key figures above.
  const trendWindow = range === 'all' ? 'All time, by calendar month' : 'Trailing 6 calendar months, independent of the selected range';
  const trendTotal = trend.reduce((sum, t) => sum + t.count, 0);

  return (
    <main className="lsq-home-main">
      <div className="lsq-page lsq-home-page">
        <header className="lsq-page-header">
          <div className="lsq-page-header__text">
            <h1 className="lsq-page-header__title">Dashboard</h1>
            <p className="lsq-page-header__sub">
              {windowLabel}
              {range === 'all' ? ', across every webinar.' : ', compared with the prior period of equal length. The webinar list shows totals across all dates.'}
            </p>
          </div>
          <div className="lsq-page-header__actions">
            <nav className="lsq-home-range" aria-label="Date range">
              <span className="lsq-label" id="dash-range-label">Date range</span>
              <div className="lsq-segmented lsq-home-views" role="group" aria-labelledby="dash-range-label">
                {RANGES.map((r) => (
                  <Link
                    key={r.id}
                    href={r.id === '30d' ? '/dashboard' : `/dashboard?range=${r.id}`}
                    aria-current={r.id === range ? 'page' : undefined}
                  >
                    {r.label}
                  </Link>
                ))}
              </div>
            </nav>
          </div>
        </header>

        <section aria-labelledby="dash-kpis" className="lsq-stack lsq-stack--sm">
          <h2 id="dash-kpis" className="lsq-sr-only">Key figures, {windowLabel}</h2>
          <div className="lsq-home-kpis lsq-home-kpis--dash">
            {kpis.map((k) => {
              const good = k.delta !== null && k.delta > 0;
              const bad = k.delta !== null && k.delta < 0;
              return (
                <div key={k.label} className="lsq-card lsq-stat">
                  <p className="lsq-stat__label">{k.label}</p>
                  <p className="lsq-stat__value">{k.value}</p>
                  <p className={`lsq-stat__note${good ? ' lsq-stat__note--up' : bad ? ' lsq-stat__note--down' : ''}`}>
                    {k.delta === null
                      ? range === 'all'
                        ? 'No prior period'
                        : '—'
                      : `${k.delta > 0 ? '+' : ''}${k.delta}${k.deltaKind === 'points' ? ' pts' : '%'} vs. prior period`}
                  </p>
                </div>
              );
            })}
          </div>
        </section>

        <div className="lsq-grid lsq-grid--wide">
          <section className="lsq-card" aria-labelledby="dash-trend">
            <div className="lsq-card__header">
              <div>
                <h2 className="lsq-card__title" id="dash-trend">Registrations Over Time</h2>
                <p className="lsq-card__sub">Monthly totals across every webinar. {trendWindow}.</p>
              </div>
              <Badge color="blue light" text={`${trendTotal.toLocaleString()} total`} />
            </div>
            <div className="lsq-card__body">
              {trend.every((t) => t.count === 0) ? (
                <p className="lsq-hint">No registrations recorded in this window.</p>
              ) : (
                <ol className="lsq-home-bars" aria-label="Registrations per month">
                  {trend.map((t) => {
                    const hasData = t.count > 0;
                    return (
                      <li key={t.label} className="lsq-home-bar" title={`${t.label}: ${t.count.toLocaleString()} registrations`}>
                        <span className="lsq-home-bar__value">
                          {hasData ? (t.count >= 1000 ? `${(t.count / 1000).toFixed(1)}k` : t.count.toLocaleString()) : '0'}
                        </span>
                        <div className="lsq-home-bar__track">
                          <div className="lsq-home-bar__fill" data-empty={hasData ? undefined : 'true'} style={{ height: `${hasData ? Math.max(3, (t.count / maxTrend) * 100) : 0}%` }} />
                        </div>
                        <span className="lsq-home-bar__label">{t.label}</span>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          </section>

          <section className="lsq-card" aria-labelledby="dash-channels">
            <div className="lsq-card__header">
              <div>
                <h2 className="lsq-card__title" id="dash-channels">Registrations by Channel</h2>
                <p className="lsq-card__sub">Breakdown by registration source and channel. {windowLabel}.</p>
              </div>
            </div>
            <div className="lsq-card__body">
              {channels.length === 0 ? (
                <p className="lsq-hint">No registrations in this window.</p>
              ) : (
                <ul className="lsq-home-barlist">
                  {channels.map((c) => (
                    <li key={c.label} className="lsq-home-barrow lsq-home-barrow--count">
                      <span className="lsq-home-barrow__label">{c.label}</span>
                      <div className="lsq-progress" role="presentation">
                        <div className="lsq-progress__bar" style={{ width: `${Math.max(1.5, (c.count / maxChannel) * 100)}%` }} />
                      </div>
                      <span className="lsq-home-barrow__value">{c.count.toLocaleString()}</span>
                      <span className="lsq-home-barrow__pct">{c.pct}%</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>

        <DashboardWebinarsTable webinars={webinars} totalCount={webinarsTotalCount} windowLabel={windowLabel} />

        <div className="lsq-grid lsq-grid--wide">
          <section className="lsq-card" aria-labelledby="dash-personas">
            <div className="lsq-card__header">
              <div>
                <h2 className="lsq-card__title" id="dash-personas">Persona Approval Rates</h2>
                <p className="lsq-card__sub">Share of scored contacts approved by seniority and function across all webinars, all dates.</p>
              </div>
            </div>
            <div className="lsq-card__body">
              {personas.length === 0 ? (
                <p className="lsq-hint">Not enough scored contacts yet. Run scoring on a campaign to see persona trends here.</p>
              ) : (
                <ul className="lsq-home-barlist">
                  {personas.map((row) => (
                    <li key={row.label} className="lsq-home-barrow lsq-home-barrow--pct">
                      <span className="lsq-home-barrow__label">
                        {row.label} <span className="lsq-home-barrow__count">({row.sampleSize})</span>
                      </span>
                      <div className="lsq-progress" role="presentation">
                        <div className="lsq-progress__bar" style={{ width: `${row.pct}%` }} />
                      </div>
                      <span className="lsq-home-barrow__value">{row.pct}%</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section className="lsq-card" aria-labelledby="dash-learning">
            <div className="lsq-card__header">
              <div>
                <h2 className="lsq-card__title" id="dash-learning">Campaign-over-Campaign Learning</h2>
                <p className="lsq-card__sub">Conversion rates across vertical markets and lead sources. {windowLabel}.</p>
              </div>
            </div>
            <div className="lsq-card__body">
              {learnings.length === 0 ? (
                <p className="lsq-hint">Not enough scored contacts yet to surface a pattern.</p>
              ) : (
                <ul className="lsq-home-barlist">
                  {learnings.map((row) => (
                    <li key={`${row.dimension}-${row.label}`} className="lsq-home-barrow lsq-home-barrow--pct">
                      <span className="lsq-home-barrow__label">
                        {row.label} <span className="lsq-home-barrow__count">({row.sampleSize})</span>
                        <span className="lsq-home-barrow__sub">{row.dimension}</span>
                      </span>
                      <div className="lsq-progress" role="presentation">
                        <div className="lsq-progress__bar" style={{ width: `${row.pct}%` }} />
                      </div>
                      <span className="lsq-home-barrow__value">{row.pct}%</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
