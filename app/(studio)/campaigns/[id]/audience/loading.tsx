import { SkeletonLine, SkeletonTable } from '@/components/ui/Skeleton';

// Scoring can block on a live Claude call over the whole audience, so this is
// the tab most likely to be seen mid-load. Header, stats strip and table,
// matching AudiencePage, ScoringHeader and ScoringTable.
export default function ScoringLoading() {
  return (
    <main className="lsq-ov-main" aria-busy="true">
      <div className="lsq-page">
        <div className="lsq-page-header">
          <div className="lsq-page-header__text">
            <SkeletonLine width={72} height={10} />
            <SkeletonLine width={180} height={24} />
          </div>
        </div>
        <div className="lsq-grid lsq-grid--narrow">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="lsq-card lsq-stat lsq-stack">
              <SkeletonLine width="60%" height={10} />
              <SkeletonLine width={64} height={24} />
            </div>
          ))}
        </div>
        <SkeletonTable rows={8} cols={5} />
      </div>
    </main>
  );
}
