'use client';

// Error boundaries must be Client Components (see node_modules/next/dist/docs/
// .../error.md). Previously there was no error.tsx anywhere in the app, so an
// uncaught exception in any stage page (a bad Claude/LeadSquared response, a
// thrown assertion, etc.) surfaced as Next's generic full-page crash screen
// with no way back into the campaign without a manual URL edit.
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';

export default function CampaignError({
  error,
  reset,
  retry,
}: {
  error: Error & { digest?: string };
  reset?: () => void;
  retry?: () => void;
}) {
  const router = useRouter();

  useEffect(() => {
    console.error('Campaign workspace error:', error);
  }, [error]);

  const handleReset = () => {
    if (reset) reset();
    else if (retry) retry();
    else router.refresh();
  };

  return (
    <main style={{ flex: 1, overflowY: 'auto' }}>
      <div className="lsq-page lsq-page--narrow">
        <section className="lsq-card" role="alert">
          <div className="lsq-empty">
            <span className="lsq-empty__icon"><Icon name="warning" size={32} /></span>
            <h1 className="lsq-empty__title">Something Went Wrong on This Tab</h1>
            <p className="lsq-empty__body lsq-res-errmsg">
              {error.message || 'An unexpected error interrupted this page.'}
            </p>
            <div className="lsq-cluster">
              <Button hierarchy="secondary" size="md" onClick={() => router.push('/')}>
                Back to All Webinars
              </Button>
              <Button hierarchy="primary" size="md" icon={<Icon name="refresh" size={16} />} onClick={handleReset}>
                Try Again
              </Button>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
