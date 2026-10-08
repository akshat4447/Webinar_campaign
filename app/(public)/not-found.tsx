import { Icon } from '@/components/ui/Icon';

// Shown when a public attendee link points at a webinar that does not exist. Unlike the app-level
// 404 it links nowhere internal: attendees have no Studio to go back to.
export default function PublicNotFound() {
  return (
    <section className="lsq-card" aria-labelledby="public-not-found-title">
      <div className="lsq-empty">
        <span className="lsq-empty__icon" aria-hidden="true">
          <Icon name="search" size={32} />
        </span>
        <h1 className="lsq-empty__title" id="public-not-found-title">Webinar Not Found</h1>
        <p className="lsq-empty__body">
          This link does not match an available webinar. It may be incomplete or the webinar may have been removed. Check the link with the sender.
        </p>
      </div>
    </section>
  );
}
