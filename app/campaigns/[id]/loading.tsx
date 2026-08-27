import { SkeletonCard } from '@/components/ui/Skeleton';

// Fallback boundary for stage pages that don't ship their own skeleton
// (setup/templates/schedule/control). The three slow tabs — scoring,
// personalize, dashboard — each have a shape-matched loading.tsx instead,
// because they do real API work and a generic three-card block would just
// reflow into something completely different when the data lands.
export default function CampaignLoading() {
  return (
    <main style={{ flex: 1, overflowY: 'auto', padding: '28px 36px 48px 36px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <SkeletonCard lines={3} />
        <SkeletonCard lines={2} />
        <SkeletonCard lines={2} />
      </div>
    </main>
  );
}
