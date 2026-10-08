import { SkeletonLine, SkeletonCard } from '@/components/ui/Skeleton';

// The dashboard is the slowest tab: it recomputes the funnel, per-channel
// delivery and every breakdown from real rows. This mirrors its actual
// layout (header, KPI strip, funnel, two-column panels) so nothing jumps when
// the real numbers arrive.
export default function DashboardLoading() {
  return (
    <main className="lsq-ov-main" aria-busy="true">
      <div className="lsq-page">
        <div className="lsq-page-header">
          <div className="lsq-page-header__text">
            <SkeletonLine width={72} height={10} />
            <SkeletonLine width={260} height={24} />
          </div>
        </div>

        <div className="lsq-grid lsq-grid--narrow">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="lsq-card lsq-stat lsq-stack">
              <SkeletonLine width="60%" height={10} />
              <SkeletonLine width={64} height={24} />
            </div>
          ))}
        </div>

        <div className="lsq-card lsq-stat lsq-stack">
          <SkeletonLine width={150} height={14} />
          {[92, 74, 58, 40, 26].map((w, i) => (
            <SkeletonLine key={i} width={`${w}%`} height={16} />
          ))}
        </div>

        <div className="lsq-ov-split lsq-ov-split--wide">
          <SkeletonCard lines={4} />
          <SkeletonCard lines={4} />
        </div>
      </div>
    </main>
  );
}
