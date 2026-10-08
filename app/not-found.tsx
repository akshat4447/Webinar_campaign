import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';

export default function NotFound() {
  return (
    <main className="lsq-home-center">
      <section className="lsq-card" aria-labelledby="not-found-title">
        <div className="lsq-empty">
          <span className="lsq-empty__icon" aria-hidden="true">
            <Icon name="search" size={32} />
          </span>
          <h1 className="lsq-empty__title" id="not-found-title">Page Not Found</h1>
          <p className="lsq-empty__body">
            The page or webinar may have been moved, archived or removed, or the link may be incomplete.
          </p>
          <Link href="/" className="lsq-btn lsq-btn--md lsq-btn--primary lsq-home-linkbtn">
            Back to Webinars
          </Link>
        </div>
      </section>
    </main>
  );
}
