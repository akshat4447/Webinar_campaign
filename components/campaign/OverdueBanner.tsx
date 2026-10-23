'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from '@/components/ui/Icon';

/**
 * The webinar's date has passed and it is still open. One compact row on every tab; the shortcut to Results is left out
 * on Results itself, where it would only point at the page you are on.
 */
export function OverdueBanner({ campaignId, scheduledLabel }: { campaignId: string; scheduledLabel: string }) {
  const onResults = (usePathname() ?? '').startsWith(`/campaigns/${campaignId}/results`);
  return (
    <div className="lsq-banner lsq-banner--warning lsq-res-overdue" role="status">
      <span className="lsq-banner__icon"><Icon name="warning" size={16} /></span>
      <div className="lsq-res-overdue__text">
        <p className="lsq-banner__title">Webinar Date Has Passed</p>
        <p className="lsq-banner__body">
          This webinar was scheduled for {scheduledLabel} but is still open. Import attendance and mark it completed to stop reminders and lock the workspace, or reschedule it from Results if the date has changed.
        </p>
      </div>
      {!onResults && (
        <div className="lsq-banner__actions">
          <Link href={`/campaigns/${campaignId}/results`} className="lsq-btn lsq-btn--sm lsq-btn--secondary">Go to Results</Link>
        </div>
      )}
    </div>
  );
}
