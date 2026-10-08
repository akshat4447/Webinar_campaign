'use client';

// Root error boundary: catches failures in pages outside the Studio shell, mainly the public
// attendee pages (registration, confirmation). It renders inside the root layout, so it has no
// sidebar and deliberately links nowhere internal.
import { useEffect } from 'react';
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
  useEffect(() => {
    console.error('Page error:', error);
  }, [error]);

  const tryAgain = () => {
    if (retry) retry();
    else if (reset) reset();
    else window.location.reload();
  };

  return (
    <main className="lsq-home-center">
      <section className="lsq-card" role="alert" aria-labelledby="root-error-title">
        <div className="lsq-empty">
          <span className="lsq-empty__icon" aria-hidden="true">
            <Icon name="warning" size={32} />
          </span>
          <h1 className="lsq-empty__title" id="root-error-title">Something Went Wrong</h1>
          <p className="lsq-empty__body">This page could not load. Try again in a moment. If the problem continues, contact the organiser.</p>
          {error.digest ? <p className="lsq-home-ref">Reference: {error.digest}</p> : null}
          <Button onClick={tryAgain}>Try Again</Button>
        </div>
      </section>
    </main>
  );
}
