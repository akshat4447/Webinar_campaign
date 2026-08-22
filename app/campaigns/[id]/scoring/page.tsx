import { db } from '@/lib/db';
import { ScoringHeader } from './ScoringHeader';
import { ScoringTable } from './ScoringTable';
import { RunScoringPrompt } from './RunScoringPrompt';

export default async function ScoringPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [campaign, contacts] = await Promise.all([
    db.campaign.findUniqueOrThrow({ where: { id } }),
    db.contact.findMany({ where: { campaignId: id } }),
  ]);

  if (contacts.length === 0) {
    return (
      <main style={{ flex: 1, overflowY: 'auto', padding: '28px 36px 48px 36px' }}>
        <div style={{ textAlign: 'center', color: 'var(--n60)', fontSize: 13, marginTop: 48 }}>No contacts imported yet — go to Setup first.</div>
      </main>
    );
  }

  const scored = contacts.filter((c) => c.score !== null);
  if (scored.length === 0) {
    return (
      <main style={{ flex: 1, overflowY: 'auto', padding: '28px 36px 48px 36px' }}>
        <RunScoringPrompt campaignId={id} contactCount={contacts.length} />
      </main>
    );
  }

  const accounts = new Set(contacts.map((c) => c.account)).size;
  const verifiedEmails = contacts.filter((c) => !c.missingInfo).length;
  const flagged = contacts.filter((c) => c.missingInfo).length;

  const discoveryStats = [
    { label: 'Accounts processed', value: String(accounts), sub: `${contacts.length} contacts` },
    { label: 'Contacts identified', value: String(contacts.length), sub: 'persona-matched' },
    { label: 'Verified emails', value: String(verifiedEmails), sub: `${Math.round((verifiedEmails / contacts.length) * 100)}% coverage` },
    { label: 'Flagged for review', value: String(flagged), sub: 'manual check needed' },
  ];

  return (
    <main style={{ flex: 1, overflowY: 'auto', padding: '28px 36px 48px 36px' }}>
      <ScoringHeader campaign={campaign} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(196px, 1fr))', gap: 14, marginBottom: 18 }}>
        {discoveryStats.map((stat) => (
          <div key={stat.label} style={{ background: '#fff', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)', padding: '16px 18px' }}>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--n60)', letterSpacing: '0.03em', textTransform: 'uppercase' }}>{stat.label}</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--n90)', marginTop: 6, letterSpacing: '-0.01em' }}>{stat.value}</div>
            <div style={{ fontSize: 12, color: 'var(--n60)', marginTop: 2 }}>{stat.sub}</div>
          </div>
        ))}
      </div>

      <ScoringTable campaignId={id} contacts={contacts} threshold={campaign.scoringThreshold} />
    </main>
  );
}
