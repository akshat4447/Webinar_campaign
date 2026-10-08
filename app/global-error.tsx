'use client';

// Last-resort boundary for failures in the ROOT layout itself (e.g. a provider that throws),
// which error.tsx cannot catch because it renders inside that layout. It replaces the whole
// document, so it must bring its own <html>/<body> and import the stylesheet itself.
import './globals.css';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';

export default function GlobalError({
  error,
  retry,
  reset,
}: {
  error: Error & { digest?: string };
  retry?: () => void;
  reset?: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <main className="lsq-home-center">
          <section className="lsq-card" role="alert" aria-labelledby="global-error-title">
            <div className="lsq-empty">
              <span className="lsq-empty__icon" aria-hidden="true">
                <Icon name="warning" size={32} />
              </span>
              <h1 className="lsq-empty__title" id="global-error-title">Webinar Studio Hit a Problem</h1>
              <p className="lsq-empty__body">The app failed to start. Saved data is not affected. Try again, and if it keeps happening, share the reference below with support.</p>
              {error.digest ? <p className="lsq-home-ref"><code>{error.digest}</code></p> : null}
              <Button onClick={() => (retry ?? reset ?? (() => window.location.reload()))()}>Try Again</Button>
            </div>
          </section>
        </main>
      </body>
    </html>
  );
}
