import { Card } from '@/components/ui/Card';
import type { Campaign } from '@/lib/generated/prisma/client';

// Campaigns with no real imported contacts (the pre-loaded "completed" demo
// campaigns) have no live data to compute a real dashboard from — show their
// stored historical numbers instead of an all-zero funnel.
export function HistoricalSummary({ campaign }: { campaign: Campaign }) {
  const stats = [
    { label: 'Invites sent', value: campaign.invites ?? '—' },
    { label: 'Registrations', value: campaign.registrations ?? '—' },
    { label: 'Attendance rate', value: campaign.attendance ?? '—' },
    { label: 'Demo requests', value: campaign.demoRequests ?? '—' },
  ];

  return (
    <div>
      <Card style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--n70)', lineHeight: 1.6 }}>
          This campaign has no imported contacts in this build, so there&apos;s no live funnel to compute — these are its
          recorded historical results.
        </div>
      </Card>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 14 }}>
        {stats.map((s) => (
          <Card key={s.label}>
            <div style={{ fontSize: 'var(--fs-label-2)', fontWeight: 600, color: 'var(--n60)', letterSpacing: '0.03em', textTransform: 'uppercase' }}>{s.label}</div>
            <div className="lsq-num" style={{ fontSize: 'var(--fs-heading-2)', fontWeight: 700, color: 'var(--n90)', marginTop: 6, letterSpacing: '-0.01em' }}>{s.value}</div>
          </Card>
        ))}
      </div>
    </div>
  );
}
