import { db } from '@/lib/db';
import type { Prisma } from '@/lib/generated/prisma/client';
import { ScoringHeader } from './ScoringHeader';
import { ScoringTable } from './ScoringTable';
import { RunScoringPrompt } from './RunScoringPrompt';
import { AudienceControls, type Band } from './AudienceControls';

const PAGE_SIZE = 50;

// Score bands. Ranges are half-open and contiguous so every scored contact
// lands in exactly one — overlapping bands would double-count the distribution.
const BANDS: { id: string; label: string; min: number; max: number; color: string }[] = [
  { id: 'high', label: 'High 85+', min: 85, max: 101, color: 'var(--success-500)' },
  { id: 'good', label: 'Good 70–84', min: 70, max: 85, color: 'var(--accent-500)' },
  { id: 'low', label: 'Below 70', min: -1, max: 70, color: 'var(--n40)' },
];

export default async function AudiencePage(props: PageProps<'/campaigns/[id]/audience'>) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const q = (typeof sp.q === 'string' ? sp.q : '').trim();
  const band = typeof sp.band === 'string' ? sp.band : 'all';
  const page = Math.max(0, Number.parseInt(typeof sp.page === 'string' ? sp.page : '0', 10) || 0);

  const campaign = await db.campaign.findUniqueOrThrow({ where: { id } });
  const totalContacts = await db.contact.count({ where: { campaignId: id } });

  if (totalContacts === 0) {
    return (
      <main style={{ flex: 1, overflowY: 'auto', padding: '28px 36px 48px 36px' }}>
        <div style={{ textAlign: 'center', color: 'var(--n60)', fontSize: 'var(--fs-label-1)', marginTop: 48 }}>
          No contacts imported yet — start a webinar from the wizard, or import on Setup.
        </div>
      </main>
    );
  }

  const scoredCount = await db.contact.count({ where: { campaignId: id, score: { not: null } } });
  if (scoredCount === 0) {
    return (
      <main style={{ flex: 1, overflowY: 'auto', padding: '28px 36px 48px 36px' }}>
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
    <main style={{ flex: 1, overflowY: 'auto', padding: '28px 36px 48px 36px' }}>
      <ScoringHeader campaign={campaign} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14, marginBottom: 16 }}>
        {summary.map((s) => (
          <div key={s.label} className="lsq-card" style={{ padding: '14px 16px' }}>
            <div style={{ fontSize: 'var(--fs-label-2)', fontWeight: 'var(--fw-bold)', color: 'var(--n50)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              {s.label}
            </div>
            <div className="lsq-num" style={{ fontSize: 'var(--fs-heading-2)', fontWeight: 'var(--fw-bold)', color: 'var(--n90)', marginTop: 5 }}>
              {s.value}
            </div>
            <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n50)', marginTop: 1 }}>{s.sub}</div>
          </div>
        ))}
      </div>

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
      />

      {contacts.length === 0 ? (
        <div className="lsq-card" style={{ padding: '28px 24px', textAlign: 'center', fontSize: 'var(--fs-label-1)', color: 'var(--n60)' }}>
          No contacts match this search.
        </div>
      ) : (
        <ScoringTable campaignId={id} contacts={contacts} threshold={campaign.scoringThreshold} />
      )}
    </main>
  );
}
