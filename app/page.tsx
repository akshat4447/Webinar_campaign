import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import { db } from '@/lib/db';
import { statusMeta } from '@/lib/demo-data';
import { getCampaignCardStats } from '@/lib/campaignCardStats';
import { getPersonaLearning } from '@/lib/personaLearning';
import { NewCampaignButton } from './NewCampaignButton';
import { CampaignCardMenu } from './CampaignCardMenu';

export default async function LandingPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view } = await searchParams;
  const archivedView = view === 'archived';

  const [campaigns, activeCount, archivedCount, personaLearning] = await Promise.all([
    db.campaign.findMany({ where: { archived: archivedView }, orderBy: { createdAt: 'asc' } }),
    db.campaign.count({ where: { archived: false } }),
    db.campaign.count({ where: { archived: true } }),
    getPersonaLearning(),
  ]);
  const cards = await Promise.all(campaigns.map(async (c) => ({ campaign: c, stats: await getCampaignCardStats(c) })));

  return (
    <main style={{ flex: 1, overflowY: 'auto', padding: '32px 40px 48px 40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--n90)', letterSpacing: '-0.01em' }}>Webinars</div>
          <div style={{ fontSize: 13, color: 'var(--n60)', marginTop: 3 }}>Every campaign the agent is running, drafting, or has already closed out</div>
        </div>
        <NewCampaignButton />
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 20 }}>
        <Link
          href="/"
          style={{
            padding: '7px 14px',
            borderRadius: 'var(--radius-md)',
            fontSize: 12.5,
            fontWeight: 600,
            textDecoration: 'none',
            background: !archivedView ? 'var(--accent-50)' : 'transparent',
            color: !archivedView ? 'var(--accent-700)' : 'var(--n60)',
          }}
        >
          All webinars ({activeCount})
        </Link>
        <Link
          href="/?view=archived"
          style={{
            padding: '7px 14px',
            borderRadius: 'var(--radius-md)',
            fontSize: 12.5,
            fontWeight: 600,
            textDecoration: 'none',
            background: archivedView ? 'var(--accent-50)' : 'transparent',
            color: archivedView ? 'var(--accent-700)' : 'var(--n60)',
          }}
        >
          Archived ({archivedCount})
        </Link>
      </div>

      {cards.length === 0 && (
        <div style={{ background: '#fff', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)', padding: '32px 24px', textAlign: 'center', fontSize: 13, color: 'var(--n60)', marginBottom: 24 }}>
          {archivedView ? 'No archived webinars.' : 'No webinars yet — create one to get started.'}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(268px, 1fr))', gap: 16 }}>
        {cards.map(({ campaign: c, stats }) => {
          const meta = statusMeta[c.status as keyof typeof statusMeta] ?? statusMeta.draft;
          return (
            <Link key={c.id} href={`/campaigns/${c.id}/${c.status === 'completed' ? 'dashboard' : 'setup'}`} style={{ textDecoration: 'none', position: 'relative', display: 'block' }}>
              <CampaignCardMenu campaignId={c.id} campaignName={c.name} archived={c.archived} />
              <div
                style={{
                  background: '#fff',
                  borderRadius: 'var(--radius-lg)',
                  boxShadow: 'var(--shadow-card)',
                  padding: '18px 20px',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  height: '100%',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <Badge color={meta.color} text={meta.label} dot />
                  <span style={{ fontSize: 11.5, color: 'var(--n60)' }}>{c.vertical}</span>
                </div>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--n90)', marginBottom: 4, lineHeight: 1.35, overflowWrap: 'anywhere' }}>{c.name}</div>
                <div style={{ fontSize: 12, color: 'var(--n60)', marginBottom: 14 }}>{c.date}</div>
                <div style={{ display: 'flex', gap: 20, paddingTop: 12, marginTop: 'auto', borderTop: '1px solid var(--border-subtle)' }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--n60)', whiteSpace: 'nowrap' }}>{stats.l1}</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--n90)', marginTop: 2, overflowWrap: 'anywhere' }}>{stats.v1}</div>
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--n60)', whiteSpace: 'nowrap' }}>{stats.l2}</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--n90)', marginTop: 2, overflowWrap: 'anywhere' }}>{stats.v2}</div>
                  </div>
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      <div style={{ marginTop: 24, background: '#fff', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)', padding: '18px 20px' }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--n90)', marginBottom: 4 }}>Approval rate by persona</div>
        <div style={{ fontSize: 12, color: 'var(--n60)', marginBottom: 14 }}>
          Share of scored contacts approved, by seniority and function, across every webinar with at least {3} scored contacts in
          that persona — a track record to inform scoring criteria by hand, not an automatic feedback loop.
        </div>
        {personaLearning.length === 0 ? (
          <div style={{ fontSize: 12.5, color: 'var(--n60)' }}>Not enough scored contacts yet — run scoring on a campaign to see persona trends here.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {personaLearning.map((row) => (
              <div key={row.label} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 200, fontSize: 12.5, color: 'var(--n70)', flexShrink: 0, overflowWrap: 'anywhere' }}>
                  {row.label} <span style={{ color: 'var(--n50)' }}>({row.sampleSize})</span>
                </div>
                <div style={{ flex: 1, background: 'var(--n20)', borderRadius: 'var(--radius-full)', height: 8, overflow: 'hidden' }}>
                  <div style={{ width: `${row.pct}%`, height: '100%', background: 'var(--accent-500)', borderRadius: 'var(--radius-full)' }} />
                </div>
                <div style={{ width: 40, textAlign: 'right', fontSize: 12.5, fontWeight: 700, color: 'var(--n90)' }}>{row.pct}%</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
