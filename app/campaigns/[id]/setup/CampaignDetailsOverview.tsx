'use client';

import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import type { Campaign } from '@/lib/generated/prisma/client';

/**
 * Read-only summary of the webinar's core details, shown once real audience
 * work exists (contacts imported) — editing these details after the fact
 * invalidates scoring, personalization and cadence timing built against the
 * old ones, so it's a deliberate action (see WebinarDetailsCard) rather than
 * something a stray keystroke on this tab can do by accident.
 */
export function CampaignDetailsOverview({ campaign, onEdit }: { campaign: Campaign; onEdit: () => void }) {
  const row = (label: string, value: React.ReactNode) => (
    <div>
      <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n50)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--n90)', lineHeight: 1.5, overflowWrap: 'anywhere' }}>{value}</div>
    </div>
  );

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 14 }}>
        <div style={{ fontSize: 'var(--fs-body)', fontWeight: 700, color: 'var(--n90)' }}>Webinar details</div>
        <Button hierarchy="secondary" size="sm" onClick={onEdit}>
          Edit details
        </Button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {row('Webinar topic', campaign.name)}

        {row(
          'Zoom event',
          campaign.zoomMeetingId ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Badge color="success" text={campaign.zoomMode === 'new' ? 'Created on Zoom' : 'Linked to Zoom'} />
              <span style={{ color: 'var(--n60)' }}>{campaign.zoomLink}</span>
            </div>
          ) : campaign.zoomLink ? (
            campaign.zoomLink
          ) : (
            <span style={{ color: 'var(--n50)' }}>Not set</span>
          )
        )}

        {row('Date & time', campaign.date)}

        {row('Description', campaign.description || <span style={{ color: 'var(--n50)' }}>No description set yet.</span>)}

        {row(
          'Registration link',
          campaign.registrationLink || <span style={{ color: 'var(--n50)' }}>Not set</span>
        )}

        {(campaign.speakerName || campaign.capacity) && (
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            {campaign.speakerName && row('Speaker', `${campaign.speakerName}${campaign.speakerTitle ? `, ${campaign.speakerTitle}` : ''}`)}
            {campaign.capacity && row('Capacity', `${campaign.capacity.toLocaleString()} seats`)}
          </div>
        )}
      </div>
    </Card>
  );
}
