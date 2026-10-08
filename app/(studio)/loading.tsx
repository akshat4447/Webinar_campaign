import { SkeletonCard } from '@/components/ui/Skeleton';

// Fallback while any top-level page that has no loading.tsx of its own (dashboard,
// integrations, templates, linkedin, the wizard) fetches its data. Campaign tabs keep their
// own, more specific, skeletons. aria-busy lets assistive tech know content is on its way.
export default function RootLoading() {
  return (
    <main aria-busy="true" aria-label="Loading" className="lsq-home-main">
      <div className="lsq-page lsq-home-page">
        <SkeletonCard lines={2} />
        <SkeletonCard lines={3} />
        <SkeletonCard lines={2} />
      </div>
    </main>
  );
}
