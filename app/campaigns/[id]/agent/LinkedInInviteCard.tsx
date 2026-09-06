'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
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
    <div style={{ background: '#fff', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)', padding: '16px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <div style={{ fontSize: 'var(--fs-label-1)', fontWeight: 700, color: 'var(--n90)', flex: 1 }}>LinkedIn Event</div>
        <Badge color="success" text={`${props.registrations} registered`} dot />
        {props.invited && <Badge color="gray" text="invites sent" />}
      </div>

      {!props.invited ? (
        <>
          <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--n70)', lineHeight: 1.55, marginBottom: 12 }}>
            One manual step remains — inviting members has no API. Open the event page and click{' '}
            <strong>“Invite connections”</strong>, then mark it done here.
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: props.pendingRegistrations > 0 ? 10 : 0 }}>
            <Button size="sm" onClick={() => window.open(props.eventUrl, '_blank')}>
              Open event page
            </Button>
            <Button size="sm" hierarchy="secondary-color" onClick={invite} disabled={busy !== null}>
              {busy === 'invite' ? 'Saving…' : "Mark invites done"}
            </Button>
          </div>
        </>
      ) : (
        <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--n60)', marginBottom: props.pendingRegistrations > 0 ? 10 : 0 }}>
          Invites marked done{props.registrations > 0 ? ` · ${props.registrations} registration(s) harvested into the funnel` : ' · registrations will stream in automatically'}.
        </div>
      )}

      {props.pendingRegistrations > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--warning-700)', flex: 1 }}>
            {props.pendingRegistrations} registration(s) waiting to be processed.
          </div>
          <Button size="sm" hierarchy="secondary" onClick={process} disabled={busy !== null}>
            {busy === 'process' ? 'Processing…' : 'Process now'}
          </Button>
        </div>
      )}

      {error && (
        <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--danger-500)', marginTop: 10, overflowWrap: 'anywhere' }}>{error}</div>
      )}
    </div>
  );
}