import { SkeletonLine, SkeletonCard } from '@/components/ui/Skeleton';

// The dashboard is the slowest tab — it recomputes the funnel, per-channel
// delivery and every breakdown from real rows. This mirrors its actual
// layout (KPI strip → funnel → two-column panels) so nothing jumps when the
// real numbers arrive.
export default function DashboardLoading() {
  return (
    <main style={{ flex: 1, overflowY: 'auto', padding: '28px 36px 48px 36px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="lsq-card" style={{ padding: '16px 18px' }}>
              <SkeletonLine width="60%" height={9} style={{ marginBottom: 12 }} />
              <SkeletonLine width={64} height={22} />
            </div>
          ))}
        </div>

        <div className="lsq-card" style={{ padding: '18px 20px' }}>
          <SkeletonLine width={150} height={13} style={{ marginBottom: 16 }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[92, 74, 58, 40, 26].map((w, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <SkeletonLine width={92} height={10} />
                <SkeletonLine width={`${w}%`} height={26} style={{ borderRadius: 'var(--radius-sm)' }} />
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.6fr) minmax(0, 1fr)', gap: 16 }}>
          <SkeletonCard lines={4} />
          <SkeletonCard lines={4} />
        </div>
      </div>
    </main>
  );
}
