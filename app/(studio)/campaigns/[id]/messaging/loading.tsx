import { SkeletonLine } from '@/components/ui/Skeleton';

// The messaging tab is a step picker above a recipient list beside an editor, so
// the skeleton mirrors that shape instead of a stack of generic cards.
export default function PersonalizeLoading() {
  return (
    <main className="lsq-msg-main" aria-busy="true">
      <div className="lsq-page">
        <div>
          <SkeletonLine width={90} height={11} />
          <SkeletonLine width={220} height={22} />
          <SkeletonLine width="48%" />
        </div>

        <div className="lsq-card lsq-card__body lsq-stack">
          <SkeletonLine width={160} height={13} />
          <SkeletonLine width="70%" />
        </div>

        <div className="lsq-msg-workspace">
          <div className="lsq-card">
            <ul className="lsq-msg-list">
              {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                <li key={i} className="lsq-msg-recipient">
                  <div className="lsq-msg-recipient__main">
                    <SkeletonLine width="70%" height={11} />
                    <SkeletonLine width="45%" height={9} />
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div className="lsq-card lsq-card__body lsq-stack">
            <SkeletonLine width={160} height={13} />
            {['92%', '86%', '95%', '78%', '90%', '61%'].map((w, i) => (
              <SkeletonLine key={i} width={w} />
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
