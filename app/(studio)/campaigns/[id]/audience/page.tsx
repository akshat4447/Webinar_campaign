import { db } from '@/lib/db';
import type { Prisma } from '@/lib/generated/prisma/client';
import { isCampaignCompleted, isSetupLocked } from '@/lib/campaignLifecycle';
import { ScoringHeader } from './ScoringHeader';
import { ScoringTable } from './ScoringTable';
import { RunScoringPrompt } from './RunScoringPrompt';
import { AudienceControls, type Band } from './AudienceControls';
import { LeadSquaredListSyncCard } from '@/components/wizard/LeadSquaredListSyncCard';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';

const PAGE_SIZE = 50;

// Score bands. Ranges are half-open and contiguous so every scored contact
// lands in exactly one — overlapping bands would double-count the distribution.
const BANDS: { id: string; label: string; min: number; max: number; color: string }[] = [
  { id: 'high', label: 'High 85+', min: 85, max: 101, color: 'var(--success-500)' },
  { id: 'good', label: 'Good 70–84', min: 70, max: 85, color: 'var(--accent-500)' },
  { id: 'low', label: 'Below 70', min: -1, max: 70, color: 'var(--n40)' },
];

function AudienceHeader({ sub, locked, completed }: { sub: string; locked: boolean; completed: boolean }) {
  return (
    <header className="lsq-page-header">
      <div className="lsq-page-header__text">
        <p className="lsq-page-header__eyebrow">Audience</p>
        <div className="lsq-ov-titlerow">
          <h1 className="lsq-page-header__title">Audience</h1>
          {locked && <Badge color={completed ? 'success' : 'blue'} text={completed ? 'Completed, read-only' : 'Launched, setup locked'} dot />}
        </div>
        <p className="lsq-page-header__sub">{sub}</p>
      </div>
    </header>
  );
}

export default async function AudiencePage(props: PageProps<'/campaigns/[id]/audience'>) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const q = (typeof sp.q === 'string' ? sp.q : '').trim();
  const band = typeof sp.band === 'string' ? sp.band : 'all';
  const page = Math.max(0, Number.parseInt(typeof sp.page === 'string' ? sp.page : '0', 10) || 0);

  const campaign = await db.campaign.findUniqueOrThrow({ where: { id } });
  const completed = isCampaignCompleted(campaign.status);
  const setupLocked = isSetupLocked(campaign);
  const totalContacts = await db.contact.count({ where: { campaignId: id } });

  if (totalContacts === 0) {
    if (setupLocked) {
      return (
        <main className="lsq-ov-main">
          <div className="lsq-page lsq-page--narrow">
            <AudienceHeader sub="The audience is a read-only record." locked completed={completed} />
            <div className="lsq-card">
              <div className="lsq-empty">
                <span className="lsq-empty__icon" aria-hidden="true"><Icon name="lock" size={24} /></span>
                <h2 className="lsq-empty__title">No Audience Imported</h2>
                <p className="lsq-empty__body">
                  {completed ? 'No contacts were imported before this webinar was marked completed.' : 'No contacts were imported before this webinar launched, so there is no audience to show.'}
                </p>
              </div>
            </div>
          </div>
        </main>
      );
    }
    const { LeadImportCard } = await import('../setup/LeadImportCard');
    return (
      <main className="lsq-ov-main">
        <div className="lsq-page lsq-page--narrow">
          <header className="lsq-page-header">
            <div className="lsq-page-header__text">
              <p className="lsq-page-header__eyebrow">Audience</p>
              <h1 className="lsq-page-header__title">Import Audience</h1>
              <p className="lsq-page-header__sub">Upload a CSV file or import contacts from LeadSquared to start scoring personas.</p>
            </div>
          </header>
          <LeadImportCard campaignId={id} existingContactCount={0} existingScoredCount={0} />
        </div>
      </main>
    );
  }

  const scoredCount = await db.contact.count({ where: { campaignId: id, score: { not: null } } });
  if (scoredCount === 0) {
    if (setupLocked) {
      return (
        <main className="lsq-ov-main">
          <div className="lsq-page lsq-page--narrow">
            <AudienceHeader sub={`${totalContacts.toLocaleString()} contacts imported, none scored.`} locked completed={completed} />
            <div className="lsq-card">
              <div className="lsq-empty">
                <span className="lsq-empty__icon" aria-hidden="true"><Icon name="lock" size={24} /></span>
                <h2 className="lsq-empty__title">No Scoring Run</h2>
                <p className="lsq-empty__body">
                  {completed ? 'Scoring was never run before this webinar was completed.' : 'Scoring was never run before this webinar launched.'}
                </p>
              </div>
            </div>
          </div>
        </main>
      );
    }
    return (
      <main className="lsq-ov-main">
        <RunScoringPrompt campaignId={id} contactCount={totalContacts} />
      </main>
    );
  }

  const selectedBand = BANDS.find((b) => b.id === band);
  const where: Prisma.ContactWhereInput = {
    campaignId: id,
    ...(selectedBand ? { score: { gte: selectedBand.min, lt: selectedBand.max } } : {}),
    // Postgres `contains` is case-sensitive by default (unlike SQLite's,
    // which always matched case-insensitively) — `mode: 'insensitive'`
    // keeps this search behaving the same regardless of how a name/account
    // was capitalized on import.
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { title: { contains: q, mode: 'insensitive' } },
            { account: { contains: q, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [matching, contacts, bandCounts, accounts, verifiedEmails, flagged, approvedCount] = await Promise.all([
    db.contact.count({ where }),
    db.contact.findMany({
      where,
      orderBy: [{ score: 'desc' }, { name: 'asc' }],
      skip: page * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    Promise.all(
      BANDS.map((b) => db.contact.count({ where: { campaignId: id, score: { gte: b.min, lt: b.max } } }))
    ),
    db.contact.findMany({ where: { campaignId: id }, select: { account: true }, distinct: ['account'] }),
    db.contact.count({ where: { campaignId: id, missingInfo: false } }),
    db.contact.count({ where: { campaignId: id, missingInfo: true } }),
    db.contact.count({ where: { campaignId: id, approved: true } }),
  ]);

  const bands: Band[] = BANDS.map((b, i) => ({ id: b.id, label: b.label, count: bandCounts[i], color: b.color }));

  const summary = [
    { label: 'Accounts', value: accounts.length.toLocaleString(), sub: `${totalContacts.toLocaleString()} contacts` },
    { label: 'Scored', value: scoredCount.toLocaleString(), sub: `${Math.round((scoredCount / totalContacts) * 100)}% of imported` },
    { label: 'Approved', value: approvedCount.toLocaleString(), sub: `threshold ${campaign.scoringThreshold}` },
    { label: 'Verified emails', value: verifiedEmails.toLocaleString(), sub: flagged ? `${flagged} flagged for review` : 'none flagged' },
  ];

  return (
    <main className="lsq-ov-main">
      <div className="lsq-page">
        <AudienceHeader
          sub={`${scoredCount.toLocaleString()} of ${totalContacts.toLocaleString()} contacts scored by Claude. Approved contacts go on to messaging.`}
          locked={setupLocked}
          completed={completed}
        />

        <ScoringHeader campaign={campaign} scoredCount={scoredCount} approvedCount={approvedCount} completed={setupLocked} />

        <section aria-label="Audience summary">
          <div className="lsq-grid lsq-grid--narrow">
            {summary.map((s) => (
              <div key={s.label} className="lsq-card lsq-stat">
                <p className="lsq-stat__label">{s.label}</p>
                <p className="lsq-stat__value">{s.value}</p>
                <p className="lsq-stat__note">{s.sub}</p>
              </div>
            ))}
          </div>
        </section>

        {setupLocked ? (
          <div className="lsq-banner lsq-banner--neutral" role="status">
            <Icon name="lock" size={16} />
            <p className="lsq-banner__body">
              {completed ? 'This webinar is completed, so the audience is a read-only record.' : 'This webinar has launched, so the audience and approvals are locked. Only cadence steps that have not sent yet can still change.'}
            </p>
          </div>
        ) : (
          <LeadSquaredListSyncCard campaignId={id} campaignTitle={campaign.name} />
        )}

        <AudienceControls
          campaignId={id}
          q={q}
          band={band}
          bands={bands}
          total={matching}
          threshold={campaign.scoringThreshold}
          page={page}
          pageSize={PAGE_SIZE}
          shown={contacts.length}
          completed={setupLocked}
        />

        {contacts.length === 0 ? (
          <div className="lsq-card">
            <div className="lsq-empty">
              <span className="lsq-empty__icon" aria-hidden="true"><Icon name="search" size={24} /></span>
              <h2 className="lsq-empty__title">No Contacts Match</h2>
              <p className="lsq-empty__body">No contacts match this search.</p>
            </div>
          </div>
        ) : (
          <ScoringTable
            campaignId={id}
            contacts={contacts}
            threshold={campaign.scoringThreshold}
            locked={setupLocked}
            totalMatching={matching}
            totalApproved={approvedCount}
            filter={{ q, band }}
          />
        )}
      </div>
    </main>
  );
}
