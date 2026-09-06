'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { cancelLinkedInEventAction, publishToLinkedInAction } from '@/lib/actions/linkedinEvents';

const STATUS_BADGE: Record<string, { color: string; text: string }> = {
  form_pending_review: { color: 'warning', text: 'Waiting on form review' },
  creating: { color: 'blue', text: 'Publishing…' },
  created_unpublished: { color: 'blue', text: 'Created — post pending' },
  published: { color: 'success', text: 'Live on LinkedIn' },
  failed: { color: 'error', text: 'Failed' },
  canceled: { color: 'gray', text: 'Canceled' },
};

export function LinkedInPublishCard(props: {
  campaignId: string;
  name: string;
  description: string | null;
  dateDisplay: string;
  zoomLink: string | null;
  organizationLabel: string | null;
  mode: 'sandbox' | 'live';
  status: string | null;
  error: string | null;
  eventUrn: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<'publish' | 'cancel' | null>(null);
  const [result, setResult] = useState<{ ok: boolean; detail: string } | null>(null);

  const badge = props.status ? STATUS_BADGE[props.status] ?? { color: 'gray', text: props.status } : { color: 'gray', text: 'Not on LinkedIn yet' };
  const published = props.status === 'published' && !!props.eventUrn;

  async function publish() {
    setBusy('publish');
    setResult(null);
    try {
      const outcome = await publishToLinkedInAction(props.campaignId);
      setResult({ ok: outcome.ok, detail: outcome.detail });
      router.refresh();
    } catch (err) {
      setResult({ ok: false, detail: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  }

  async function cancel() {
    if (!confirm('Unlink this webinar\'s LinkedIn Event? The event is deleted remotely when possible.')) return;
    setBusy('cancel');
    try {
      await cancelLinkedInEventAction(props.campaignId);
      router.refresh();
    } catch (err) {
      console.error('Failed to cancel LinkedIn event:', err);
    } finally {
      setBusy(null);
    }
  }

  const rows: [string, string][] = [
    ['Name', props.name],
    ['Description', (props.description ?? '—').slice(0, 140) + ((props.description?.length ?? 0) > 140 ? '…' : '')],
    ['Schedule', props.dateDisplay],
    ['Zoom link', props.zoomLink ?? '— missing —'],
    ['Page', props.organizationLabel ?? (props.mode === 'live' ? '— connect integration —' : 'sandbox')],
  ];

  return (
    <div style={{ background: '#fff', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)', padding: '16px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <div style={{ fontSize: 'var(--fs-label-1)', fontWeight: 700, color: 'var(--n90)', flex: 1 }}>LinkedIn Event</div>
        <Badge color={badge.color} text={badge.text} dot />
        {props.mode === 'sandbox' && <Badge color="gray" text="sandbox" />}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
        {rows.map(([label, value]) => (
          <div key={label} style={{ display: 'flex', gap: 10, fontSize: 'var(--fs-label-1)', lineHeight: 1.5 }}>
            <div style={{ width: 86, color: 'var(--n50)', flexShrink: 0 }}>{label}</div>
            <div style={{ color: 'var(--n80)', overflowWrap: 'anywhere' }}>{value}</div>
          </div>
        ))}
      </div>

      {props.error && (
        <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--danger-500)', marginBottom: 10, lineHeight: 1.5, overflowWrap: 'anywhere' }}>
          Last error: {props.error}
        </div>
      )}
      {result && (
        <div style={{ fontSize: 'var(--fs-label-1)', color: result.ok ? 'var(--success-700)' : 'var(--danger-500)', marginBottom: 10, lineHeight: 1.5, overflowWrap: 'anywhere' }}>
          {result.detail}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {!published && (
          <Button size="sm" onClick={publish} disabled={busy !== null}>
            {busy === 'publish' ? 'Publishing…' : props.status === 'form_pending_review' || props.status === 'created_unpublished' ? 'Resume publish' : 'Create & publish event'}
          </Button>
        )}
        {published && (
          <>
            <Button size="sm" hierarchy="secondary" onClick={() => window.open(`https://www.linkedin.com/events/${props.eventUrn!.replace('urn:li:event:', '')}`, '_blank')}>
              Open event page
            </Button>
            <Button size="sm" hierarchy="destructive-outline" onClick={cancel} disabled={busy !== null}>
              Unlink event
            </Button>
          </>
        )}
      </div>

      <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n50)', marginTop: 10, lineHeight: 1.55 }}>
        Creates the event, attaches the registration form and posts the announcement. Inviting members has no API — click “Invite connections” on the
        event page once (Control Center tracks it). Every registration then flows into this campaign automatically: scored by Claude, synced to LeadSquared.
        {props.mode === 'sandbox' && ' Sandbox mode simulates all LinkedIn calls until LINKEDIN_MODE=live.'}
      </div>
    </div>
  );
}