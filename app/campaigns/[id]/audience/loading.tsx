import { SkeletonLine, SkeletonTable } from '@/components/ui/Skeleton';

// Scoring can block on a live Claude call over the whole audience, so this is
// the tab most likely to be seen mid-load. Header strip + table, matching
// ScoringHeader and ScoringTable.
export default function ScoringLoading() {
  return (
    <main style={{ flex: 1, overflowY: 'auto', padding: '28px 36px 48px 36px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="lsq-card" style={{ padding: '18px 20px' }}>
          <SkeletonLine width={210} height={13} style={{ marginBottom: 10 }} />
          <SkeletonLine width="65%" />
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <SkeletonLine width={132} height={32} style={{ borderRadius: 'var(--radius-sm)' }} />
            <SkeletonLine width={104} height={32} style={{ borderRadius: 'var(--radius-sm)' }} />
          </div>
        </div>
        <SkeletonTable rows={8} cols={5} />
      </div>
    </main>
  );
}
