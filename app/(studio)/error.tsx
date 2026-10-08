'use client';

// Segment-level error boundary for every page that has no tab-level one of its own
// (dashboard, integrations, templates, linkedin, the creation wizard). Before this, an
// uncaught exception on those pages fell through to Next's bare default error screen.
// It renders INSIDE the root layout, so the sidebar stays usable and the user can leave.
//
// `retry` re-fetches and re-renders the segment (the current recommended recovery);
// `reset` only clears the error state. Both are accepted so it keeps working across
// Next versions — see node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md.
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';

export default function RootError({
  error,
  retry,
  reset,
}: {
  error: Error & { digest?: string };
  retry?: () => void;
  reset?: () => void;
}) {
  const router = useRouter();

  useEffect(() => {
    console.error('Page error:', error);
  }, [error]);

  const tryAgain = () => {
    if (retry) retry();
    else if (reset) reset();
    else router.refresh();
  };

  return (
    <main className="lsq-home-main">
      <div className="lsq-page lsq-page--narrow">
        <section className="lsq-card" role="alert" aria-labelledby="studio-error-title">
          <div className="lsq-empty">
            <span className="lsq-empty__icon" aria-hidden="true">
              <Icon name="warning" size={32} />
            </span>
            <h1 className="lsq-empty__title" id="studio-error-title">Something Went Wrong</h1>
            <p className="lsq-empty__body">
              This page could not load. Saved work is not affected. Try again, or return to the webinar list.
            </p>
            {error.digest ? <p className="lsq-home-ref">Reference: {error.digest}</p> : null}
            <div className="lsq-cluster">
              <Button hierarchy="secondary" size="sm" onClick={() => router.push('/')}>
                Back to All Webinars
              </Button>
              <Button hierarchy="primary" size="sm" onClick={tryAgain}>
                Try Again
              </Button>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
