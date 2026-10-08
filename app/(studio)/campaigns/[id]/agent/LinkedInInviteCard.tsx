'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { markLinkedinInvitedAction, processLinkedInQueueAction } from '@/lib/actions/linkedinEvents';
// The human-in-the-loop step: LinkedIn has no invite API (inviting members to
// an Event is a UI-only action), so after publishing, a human clicks "Invite
// connections" exactly once. This card makes that impossible to forget and
// records that it happened.
export function LinkedInInviteCard(props: {
  campaignId: string;
  eventUrl: string;
  invited: boolean;
  registrations: number;
  pendingRegistrations: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<'invite' | 'process' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function invite() {
    setBusy('invite');
    setError(null);
    try {
      await markLinkedinInvitedAction(props.campaignId, true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save — try again.');
    } finally {
      setBusy(null);
    }
  }

  async function process() {
    setBusy('process');
    setError(null);
    try {
      await processLinkedInQueueAction(props.campaignId);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not process the queue — try again.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="lsq-card" aria-labelledby="res-li-event">
      <div className="lsq-card__header">
        <h2 className="lsq-card__title" id="res-li-event">LinkedIn Event</h2>
        <div className="lsq-cluster">
          <Badge color="success" text={`${props.registrations.toLocaleString()} registered`} dot />
          {props.invited && <Badge color="gray" text="Invites sent" />}
        </div>
      </div>

      <div className="lsq-card__body lsq-stack">
        {!props.invited ? (
          <>
            <p className="lsq-hint">
              One manual step remains: inviting members has no API. Open the event page and click{' '}
              <strong>&ldquo;Invite connections&rdquo;</strong>, then mark it done here.
            </p>
            <div className="lsq-cluster">
              <Button size="sm" icon={<Icon name="external" size={14} />} onClick={() => window.open(props.eventUrl, '_blank')}>
                Open Event Page
              </Button>
              <Button size="sm" hierarchy="secondary-color" onClick={invite} loading={busy === 'invite'} disabled={busy !== null}>
                {busy === 'invite' ? 'Saving' : 'Mark Invites Done'}
              </Button>
            </div>
          </>
        ) : (
          <p className="lsq-hint">
            Invites marked done{props.registrations > 0 ? `. ${props.registrations.toLocaleString()} registration(s) harvested into the funnel` : '. Registrations will stream in automatically'}.
          </p>
        )}

        {props.pendingRegistrations > 0 && (
          <div className="lsq-banner lsq-banner--warning">
            <span className="lsq-banner__icon"><Icon name="clock" size={16} /></span>
            <div>
              <p className="lsq-banner__body">{props.pendingRegistrations.toLocaleString()} registration(s) waiting to be processed.</p>
              <div className="lsq-banner__actions">
                <Button size="sm" hierarchy="secondary" onClick={process} loading={busy === 'process'} disabled={busy !== null}>
                  {busy === 'process' ? 'Processing' : 'Process Now'}
                </Button>
              </div>
            </div>
          </div>
        )}

        {error && <p className="lsq-error" role="alert">{error}</p>}
      </div>
    </section>
  );
}
