import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import { db } from '@/lib/db';
import { statusMeta, personaLearning } from '@/lib/demo-data';
import { getCampaignCardStats } from '@/lib/campaignCardStats';
import { NewCampaignButton } from './NewCampaignButton';

export default async function LandingPage() {
  const campaigns = await db.campaign.findMany({ orderBy: { createdAt: 'asc' } });
  const cards = await Promise.all(campaigns.map(async (c) => ({ campaign: c, stats: await getCampaignCardStats(c) })));

  return (
    <main style={{ flex: 1, overflowY: 'auto', padding: '32px 40px 48px 40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--n90)', letterSpacing: '-0.01em' }}>Webinars</div>
          <div style={{ fontSize: 13, color: 'var(--n60)', marginTop: 3 }}>Every campaign the agent is running, drafting, or has already closed out</div>
        </div>
        <NewCampaignButton />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(268px, 1fr))', gap: 16 }}>
        {cards.map(({ campaign: c, stats }) => {
          const meta = statusMeta[c.status as keyof typeof statusMeta] ?? statusMeta.draft;
          return (
            <Link key={c.id} href={`/campaigns/${c.id}/${c.status === 'completed' ? 'dashboard' : 'setup'}`} style={{ textDecoration: 'none' }}>
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
        <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--n90)', marginBottom: 4 }}>Campaign-over-campaign learning</div>
        <div style={{ fontSize: 12, color: 'var(--n60)', marginBottom: 14 }}>
          Registration rate by persona, across all webinars to date — weighting feeds forward into the next scoring run
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {personaLearning.map((row) => (
            <div key={row.label} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 170, fontSize: 12.5, color: 'var(--n70)', flexShrink: 0 }}>{row.label}</div>
              <div style={{ flex: 1, background: 'var(--n20)', borderRadius: 'var(--radius-full)', height: 8, overflow: 'hidden' }}>
                <div style={{ width: `${row.pct}%`, height: '100%', background: 'var(--accent-500)', borderRadius: 'var(--radius-full)' }} />
              </div>
              <div style={{ width: 40, textAlign: 'right', fontSize: 12.5, fontWeight: 700, color: 'var(--n90)' }}>{row.pct}%</div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
