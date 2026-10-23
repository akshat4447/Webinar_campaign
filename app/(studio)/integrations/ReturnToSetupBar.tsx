import Link from 'next/link';
import { db } from '@/lib/db';
import { Icon } from '@/components/ui/Icon';
import { returnTarget, wizardStepLabel } from '@/lib/wizardDraft';

/**
 * Shown whenever Integrations was opened from a webinar's setup. Connecting, saving a key or just looking
 * around all end with the same way back, so the person is never stranded on a settings page.
 */
export async function ReturnToSetupBar({ returnTo }: { returnTo: string | null }) {
  const target = returnTarget(returnTo);
  if (!returnTo || !target) return null;
  let name: string | null = null;
  try {
    name = (await db.campaign.findUnique({ where: { id: target.id }, select: { name: true } }))?.name ?? null;
  } catch {
    name = null;
  }
  // A webinar that no longer exists has nothing to go back to.
  if (!name) return null;

  return (
    <div className="lsq-banner lsq-banner--neutral" role="region" aria-label="Return to webinar setup">
      <span className="lsq-banner__icon" aria-hidden="true"><Icon name="arrow-left" size={16} /></span>
      <div>
        <p className="lsq-banner__title">Setting Up {name}</p>
        <p className="lsq-banner__body">
          Changes made here are kept. Return to {target.step !== null ? wizardStepLabel(target.step).toLowerCase() : 'the webinar'} when done.
        </p>
      </div>
      <Link href={returnTo} className="lsq-btn lsq-btn--sm lsq-btn--secondary">
        Back To Webinar
      </Link>
    </div>
  );
}
