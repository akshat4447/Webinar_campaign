import { SkeletonLine } from '@/components/ui/Skeleton';

// Personalize loads every drafted message for the campaign; its layout is a
// recipient list beside an editor pane, so a stack of generic cards would
// reflow badly here.
export default function PersonalizeLoading() {
  return (
    <main style={{ flex: 1, overflowY: 'auto', padding: '28px 36px 48px 36px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="lsq-card" style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <div style={{ flex: 1 }}>
            <SkeletonLine width={190} height={13} style={{ marginBottom: 9 }} />
            <SkeletonLine width="48%" />
          </div>
          <SkeletonLine width={124} height={32} style={{ borderRadius: 'var(--radius-sm)' }} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 300px) minmax(0, 1fr)', gap: 16 }}>
          <div className="lsq-card" style={{ padding: 0, overflow: 'hidden' }}>
            {[0, 1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} style={{ padding: '13px 16px', borderBottom: '1px solid var(--border-subtle)' }}>
                <SkeletonLine width="70%" height={11} style={{ marginBottom: 7 }} />
                <SkeletonLine width="45%" height={9} />
              </div>
            ))}
          </div>
          <div className="lsq-card" style={{ padding: '18px 20px' }}>
            <SkeletonLine width={160} height={13} style={{ marginBottom: 16 }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {['92%', '86%', '95%', '78%', '90%', '61%'].map((w, i) => (
                <SkeletonLine key={i} width={w} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
