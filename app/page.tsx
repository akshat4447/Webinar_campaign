import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import { PageHeader } from '@/components/ui/PageHeader';
import { db } from '@/lib/db';
import { statusMeta } from '@/lib/demo-data';
import { getCampaignCardStats, getListKpis } from '@/lib/campaignCardStats';
import { getAttendeeChannelBreakdownAcrossCampaigns } from '@/lib/attendeeChannels';
import { campaignCadenceHref, campaignLandingHref, campaignOverviewHref, campaignPrimaryCta } from '@/lib/campaignRoutes';
import { NewCampaignButton } from './NewCampaignButton';
import { CampaignCardMenu } from './CampaignCardMenu';

type ViewId = 'all' | 'upcoming' | 'completed' | 'draft' | 'archived';

const VIEWS: { id: ViewId; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'completed', label: 'Completed' },
  { id: 'draft', label: 'Drafts' },
  { id: 'archived', label: 'Archived' },
];

/** "Upcoming" means anything not yet finished — a draft is upcoming work even
 *  though it has no date. Archived is a separate axis from status: a live or
 *  completed campaign can be archived and its status is untouched either way. */
function whereFor(view: ViewId) {
  if (view === 'archived') return { archived: true };
  if (view === 'upcoming') return { archived: false, status: { in: ['live', 'draft'] } };
  if (view === 'completed') return { archived: false, status: 'completed' };
  if (view === 'draft') return { archived: false, status: 'draft' };
  return { archived: false };
}

function isViewId(value: string | undefined): value is ViewId {
  return VIEWS.some((v) => v.id === value);
}

export const dynamic = 'force-dynamic';

export default async function WebinarsPage(props: PageProps<'/'>) {
  const { view: rawView } = await props.searchParams;
  const view: ViewId = isViewId(typeof rawView === 'string' ? rawView : undefined)
    ? (rawView as ViewId)
    : 'all';

  const [campaigns, counts] = await Promise.all([
    db.campaign.findMany({ where: whereFor(view), orderBy: { createdAt: 'desc' } }),
    Promise.all(VIEWS.map((v) => db.campaign.count({ where: whereFor(v.id) }))),
  ]);

  const cards = await Promise.all(
    campaigns.map(async (c) => ({ campaign: c, stats: await getCampaignCardStats(c) }))
  );

  // Live attendance figures for the KPI row, so it agrees with the cards rather
  // than relying only on the stored summary fields.
  const attendanceRows = await db.contact.groupBy({
    by: ['campaignId'],
    where: { campaignId: { in: campaigns.map((c) => c.id) } },
    _count: true,
  });
  const attendedByCampaign = new Map<string, { attended: number; approved: number }>();
  await Promise.all(
    attendanceRows.map(async (row) => {
      const [attended, approved] = await Promise.all([
        db.contact.count({ where: { campaignId: row.campaignId, attended: true } }),
        db.contact.count({ where: { campaignId: row.campaignId, approved: true } }),
      ]);
      attendedByCampaign.set(row.campaignId, { attended, approved });
    })
  );
  const kpis = getListKpis(campaigns, attendedByCampaign);
  const attendeeChannelBreakdown = await getAttendeeChannelBreakdownAcrossCampaigns(campaigns.map((c) => c.id));

  return (
    <main style={{ flex: 1, overflowY: 'auto', padding: '32px 40px 48px 40px' }}>
      <div style={{ maxWidth: 1080, margin: '0 auto' }}>
        <PageHeader
          title="Your webinars"
          subtitle="Create an event, bring the audience, and track it — all in one place."
          actions={<NewCampaignButton />}
        />

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: 14,
            marginBottom: 28,
          }}
        >
          {kpis.map((k) => (
            <div key={k.label} className="lsq-card" style={{ padding: '16px 18px' }}>
              <div
                style={{
                  fontSize: 'var(--fs-label-2)',
                  fontWeight: 'var(--fw-bold)',
                  color: 'var(--n50)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
              >
                {k.label}
              </div>
              <div
                className="lsq-num"
                style={{
                  fontSize: 'var(--fs-heading-2)',
                  fontWeight: 'var(--fw-bold)',
                  color: 'var(--n90)',
                  marginTop: 8,
                  letterSpacing: '-0.02em',
                }}
              >
                {k.value}
              </div>
            </div>
          ))}
        </div>

        {attendeeChannelBreakdown.length > 0 && (
          <div style={{ background: '#fff', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)', padding: '14px 20px', marginBottom: 20 }}>
            <div style={{ fontSize: 'var(--fs-label-1)', fontWeight: 700, color: 'var(--n90)', marginBottom: 2 }}>Attendees by invite channel</div>
            <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n60)', marginBottom: 10 }}>
              Across every webinar in this view. A contact invited on more than one channel counts under each.
            </div>
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
              {attendeeChannelBreakdown.map((d) => (
                <div key={d.label}>
                  <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n50)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{d.label}</div>
                  <div style={{ fontSize: 'var(--fs-label-1)', fontWeight: 600, color: 'var(--n80)', marginTop: 2 }}>
                    {d.attended} attended <span style={{ color: 'var(--n50)', fontWeight: 400 }}>({d.pctOfAttendees}%)</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
          {VIEWS.map((v, i) => {
            const active = v.id === view;
            return (
              <Link
                key={v.id}
                href={v.id === 'all' ? '/' : `/?view=${v.id}`}
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
                {v.label} ({counts[i]})
              </Link>
            );
          })}
        </div>

        {cards.length === 0 && (
          <div
            className="lsq-card"
            style={{
              padding: '32px 24px',
              textAlign: 'center',
              fontSize: 'var(--fs-label-1)',
              color: 'var(--n60)',
              marginBottom: 24,
            }}
          >
            {view === 'archived'
              ? 'No archived webinars.'
              : view === 'all'
                ? 'No webinars yet — create one to get started.'
                : 'No webinars match this filter.'}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
          {cards.map(({ campaign: c, stats }) => {
            const meta = statusMeta[c.status as keyof typeof statusMeta] ?? statusMeta.draft;
            return (
              <div
                key={c.id}
                className="lsq-card"
                style={{ padding: 20, display: 'flex', flexDirection: 'column' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <Badge color={meta.color} text={meta.label} dot />
                  <span
                    style={{
                      fontSize: 'var(--fs-label-2)',
                      color: 'var(--n50)',
                      marginLeft: 'auto',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {c.vertical}
                  </span>
                  <CampaignCardMenu campaignId={c.id} campaignName={c.name} archived={c.archived} />
                </div>

                <div
                  style={{
                    fontSize: 'var(--fs-button-1)',
                    fontWeight: 'var(--fw-bold)',
                    color: 'var(--n90)',
                    marginBottom: 4,
                    lineHeight: 1.35,
                    overflowWrap: 'anywhere',
                  }}
                >
                  {c.name}
                </div>
                <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--n60)', marginBottom: 16 }}>{c.date}</div>

                <div
                  style={{
                    display: 'flex',
                    gap: 20,
                    padding: '14px 0',
                    borderTop: '1px solid var(--border-subtle)',
                    borderBottom: '1px solid var(--border-subtle)',
                    marginBottom: 14,
                    marginTop: 'auto',
                  }}
                >
                  {stats.map((s) => (
                    <div key={s.label} style={{ minWidth: 0, flex: 1 }}>
                      <div
                        style={{
                          fontSize: 'var(--fs-label-2)',
                          fontWeight: 'var(--fw-semibold)',
                          color: 'var(--n50)',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {s.label}
                      </div>
                      <div
                        className="lsq-num"
                        style={{
                          fontSize: 'var(--fs-heading-4)',
                          fontWeight: 'var(--fw-bold)',
                          color: 'var(--n90)',
                          marginTop: 2,
                          overflowWrap: 'anywhere',
                        }}
                      >
                        {s.value}
                      </div>
                    </div>
                  ))}
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
                  <Link
                    href={campaignLandingHref(c)}
                    className="lsq-btn lsq-btn--primary lsq-btn--sm"
                    style={{ flex: 1, textDecoration: 'none' }}
                  >
                    {campaignPrimaryCta(c.status)}
                  </Link>
                  <Link
                    href={campaignOverviewHref(c.id)}
                    className="lsq-btn lsq-btn--secondary lsq-btn--sm"
                    style={{ textDecoration: 'none' }}
                  >
                    Overview
                  </Link>
                  <Link
                    href={campaignCadenceHref(c.id)}
                    className="lsq-btn lsq-btn--secondary lsq-btn--sm"
                    style={{ textDecoration: 'none' }}
                  >
                    Cadence
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}
