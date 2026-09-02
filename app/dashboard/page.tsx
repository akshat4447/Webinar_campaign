import { PageHeader } from '@/components/ui/PageHeader';
import { Placeholder } from '@/components/ui/Placeholder';

export default function DashboardPage() {
  return (
    <main style={{ flex: 1, overflowY: 'auto', padding: '32px 40px 48px 40px' }}>
      <div style={{ maxWidth: 1080, margin: '0 auto' }}>
        <PageHeader title="Dashboard" subtitle="Everything across your webinars, in one place" />
        <Placeholder
          checkpoint="C11"
          summary="Cross-campaign reporting: selectable date ranges, headline KPIs with period-over-period deltas, a registrations trend, which personas convert, and the learnings the agent carries from one campaign to the next. Per-campaign reporting is unaffected."
          currentHome={{ href: '/', label: 'a campaign’s Overview tab' }}
        />
      </div>
    </main>
  );
}
