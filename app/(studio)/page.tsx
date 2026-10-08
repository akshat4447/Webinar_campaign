import { db } from '@/lib/db';
import { getCampaignCardStats, getCampaignCardCounts, getListKpis } from '@/lib/campaignCardStats';
import { getAttendeeChannelBreakdownAcrossCampaigns } from '@/lib/attendeeChannels';
import { NewCampaignButton } from './NewCampaignButton';
import { WebinarViewControls } from './WebinarViewControls';

// `upcoming` is no longer a tab but stays a valid ?view= value so older bookmarks keep working.
type ViewId = 'all' | 'upcoming' | 'completed' | 'draft' | 'live' | 'archived';

const VIEWS: { id: ViewId; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'draft', label: 'Draft' },
  { id: 'live', label: 'Live' },
  { id: 'completed', label: 'Completed' },
  { id: 'archived', label: 'Archived' },
];
const VALID_VIEWS: ViewId[] = ['upcoming', ...VIEWS.map((v) => v.id)];

/** "Upcoming" means anything not yet finished — a draft is upcoming work even
 *  though it has no date. Archived is a separate axis from status: a live or
 *  completed campaign can be archived and its status is untouched either way. */
function whereFor(view: ViewId) {
  if (view === 'archived') return { archived: true };
  if (view === 'upcoming') return { archived: false, status: { in: ['live', 'draft'] }, scheduledAt: { gt: new Date() } };
  if (view === 'completed') return { archived: false, status: 'completed' };
  if (view === 'draft') return { archived: false, status: 'draft' };
  if (view === 'live') return { archived: false, status: 'live' };
  return { archived: false };
}

function isViewId(value: string | undefined): value is ViewId {
  return VALID_VIEWS.some((id) => id === value);
}

export const dynamic = 'force-dynamic';

export default async function WebinarsPage(props: PageProps<'/'>) {
  const { view: rawView, page: rawPage } = await props.searchParams;
  const view: ViewId = isViewId(typeof rawView === 'string' ? rawView : undefined)
    ? (rawView as ViewId)
    : 'all';

  const page = Math.max(1, Math.min(100_000, Math.floor(Number(rawPage)) || 1));
  const [campaigns, counts] = await Promise.all([
    db.campaign.findMany({
      where: whereFor(view),
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * 50, take: 50,
      // Scoped to what the cards/table (WebinarViewControls and friends) and
      // the card-stat/KPI helpers below actually read — large free-text
      // fields like scoringPrompt/personalizationPrompt/brief/aiInstructions
      // otherwise got pulled and serialized into the RSC payload for every
      // campaign in the list, unused by any of it.
      select: {
        id: true,
        name: true,
        vertical: true,
        date: true,
        timezone: true,
        scheduledAt: true,
        createdAt: true,
        status: true,
        archived: true,
        speakerName: true,
        registrations: true,
        invites: true,
        attendance: true,
        demoRequests: true,
        speakers: { select: { name: true }, orderBy: [{ order: 'asc' }, { id: 'asc' }] },
      },
    }),
    Promise.all(VIEWS.map((v) => db.campaign.count({ where: whereFor(v.id) }))),
  ]);

  // Six grouped queries for the whole page rather than six per card.
  const cardCounts = await getCampaignCardCounts(campaigns.map((c) => c.id));
  const cards = campaigns.map((c) => ({ campaign: c, stats: getCampaignCardStats(c, cardCounts.get(c.id)) }));

  // Live attendance figures for the KPI row, so it agrees with the cards rather
  // than relying only on the stored summary fields. Single grouped query avoids 2N per-campaign round trips.
  // Attendance is rated against REGISTERED (lib/attendanceRate.ts), so the KPI
  // row needs those two counts — which getCampaignCardCounts already fetched
  // for the cards, keeping the header and the grid on identical numbers.
  const attendedByCampaign = new Map<string, { attended: number; registered: number }>();
  for (const c of campaigns) {
    const counts = cardCounts.get(c.id);
    attendedByCampaign.set(c.id, {
      attended: counts?.attended ?? 0,
      registered: counts?.registered ?? 0,
    });
  }
  const kpis = getListKpis(campaigns, attendedByCampaign);
  const attendeeChannelBreakdown = await getAttendeeChannelBreakdownAcrossCampaigns(campaigns.map((c) => c.id));

  const viewLabel = VIEWS.find((v) => v.id === view)?.label ?? 'Upcoming';

  return (
    <main className="lsq-home-main">
      <div className="lsq-page lsq-home-page">
        <header className="lsq-page-header">
          <div className="lsq-page-header__text">
            <h1 className="lsq-page-header__title">Webinars</h1>
            <p className="lsq-page-header__sub">
              {campaigns.length.toLocaleString()} {campaigns.length === 1 ? 'webinar' : 'webinars'} in this view. Create an event, bring the audience, and track it in one place.
            </p>
          </div>
          <div className="lsq-page-header__actions">
            <NewCampaignButton />
          </div>
        </header>

        <section aria-labelledby="home-totals" className="lsq-stack lsq-stack--sm">
          <h2 id="home-totals" className="lsq-sr-only">Totals for the {viewLabel} view</h2>
          <div className="lsq-home-kpis">
            {kpis.map((k) => (
              <div key={k.label} className="lsq-card lsq-stat">
                <p className="lsq-stat__label">{k.label}</p>
                <p className="lsq-stat__value">{k.value}</p>
              </div>
            ))}
          </div>
          <p className="lsq-home-scope">
            Totals cover the webinars on this page across all dates. The dashboard reports a selectable date range, so its figures can differ.
          </p>
        </section>

        {attendeeChannelBreakdown.length > 0 && (
          <section className="lsq-card" aria-labelledby="home-channels">
            <div className="lsq-card__header">
              <div>
                <h2 className="lsq-card__title" id="home-channels">Attendees by Invite Channel</h2>
                <p className="lsq-card__sub">
                  Across the webinars on this page. A contact invited on more than one channel counts under each.
                </p>
              </div>
            </div>
            <div className="lsq-card__body">
              <ul className="lsq-home-channels">
                {attendeeChannelBreakdown.map((d) => (
                  <li key={d.label}>
                    <p className="lsq-home-channels__label">{d.label}</p>
                    <p className="lsq-home-channels__value">
                      {d.attended.toLocaleString()} attended <span>({d.pctOfAttendees}%)</span>
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}

        <WebinarViewControls
          cards={cards}
          currentView={view}
          statusViews={VIEWS.map((v, i) => ({
            id: v.id,
            label: v.label,
            href: v.id === 'all' ? '/' : `/?view=${v.id}`,
            count: counts[i],
            active: v.id === view,
          }))}
        />
        <nav aria-label="Webinar pages" className="lsq-toolbar">
          {page > 1 && <a className="lsq-btn lsq-btn--secondary" href={`/?view=${view}&page=${page - 1}`}>Previous</a>}
          <span>Page {page}</span>
          {campaigns.length === 50 && <a className="lsq-btn lsq-btn--secondary" href={`/?view=${view}&page=${page + 1}`}>Next</a>}
        </nav>
      </div>
    </main>
  );
}
