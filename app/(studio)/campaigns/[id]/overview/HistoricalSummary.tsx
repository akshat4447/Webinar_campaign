'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { Drawer, type DrawerContent } from '@/components/ui/Drawer';
import { ChannelRegistrationOverviewCard } from '@/components/overview/ChannelRegistrationOverviewCard';
import type { CampaignRegistrationOverview } from '@/lib/registrationChannels';
import { EditSetupModal } from './EditSetupModal';
import { isCampaignCompleted, isSetupLocked } from '@/lib/campaignLifecycle';
import { formatLsqDateTime, timeZoneLabel } from '@/lib/dateFormat';
import type { Campaign, Speaker } from '@/lib/generated/prisma/client';

export function HistoricalSummary({
  campaign,
  serverNow,
  initialEditOpen = false,
  registrationChannels,
  drawers = {},
}: {
  campaign: Campaign & { speakers?: Speaker[] };
  serverNow: number;
  initialEditOpen?: boolean;
  registrationChannels?: CampaignRegistrationOverview;
  drawers?: Record<string, DrawerContent>;
}) {
  const [editOpen, setEditOpen] = useState(initialEditOpen);
  const [drawer, setDrawer] = useState<DrawerContent | null>(null);
  const completed = isCampaignCompleted(campaign.status);
  const setupLocked = isSetupLocked(campaign);

  const stats = [
    { label: 'Invites sent', value: campaign.invites ?? '—' },
    { label: 'Registrations', value: campaign.registrations ?? '—' },
    { label: 'Attendance rate', value: campaign.attendance ?? '—' },
    { label: 'Demo requests', value: campaign.demoRequests ?? '—' },
  ];

  // != null (not truthy) so a real recorded 0 still counts as historical data —
  // the stats grid below already distinguishes "0" from "never recorded" via
  // `??`, but this gate used `||` and dropped demoRequests entirely, so a
  // campaign with only demo requests on record fell into the empty state.
  const hasHistorical =
    campaign.invites != null || campaign.registrations != null || campaign.attendance != null || campaign.demoRequests != null;

  const when = campaign.scheduledAt
    ? `${formatLsqDateTime(campaign.scheduledAt, campaign.timezone)} ${timeZoneLabel(campaign.scheduledAt, campaign.timezone)}`
    : campaign.date;

  return (
    <div className="lsq-page">
      <header className="lsq-page-header">
        <div className="lsq-page-header__text">
          <p className="lsq-page-header__eyebrow">Overview</p>
          <div className="lsq-ov-titlerow">
            <h1 className="lsq-page-header__title">{campaign.name}</h1>
            {completed ? (
              <Badge color="success" text="Completed" dot />
            ) : setupLocked ? (
              <Badge color="blue" text="Launched, setup locked" dot />
            ) : (
              <Badge color="gray" text="Draft" dot />
            )}
          </div>
          <p className="lsq-page-header__sub">{when}</p>
        </div>
        <div className="lsq-page-header__actions">
          {!completed && !setupLocked && (
            <Button hierarchy="secondary" icon={<Icon name="edit" size={16} />} onClick={() => setEditOpen(true)}>
              Edit Setup
            </Button>
          )}
          {completed || setupLocked ? (
            <Link href={`/campaigns/${campaign.id}/results`} className="lsq-btn lsq-btn--md lsq-btn--primary lsq-ov-linkbtn">
              View Results
              <Icon name="arrow-right" size={16} />
            </Link>
          ) : (
            <Link href={`/campaigns/${campaign.id}/audience`} className="lsq-btn lsq-btn--md lsq-btn--primary lsq-ov-linkbtn">
              Go To Audience
              <Icon name="arrow-right" size={16} />
            </Link>
          )}
        </div>
      </header>

      {setupLocked && (
        <div className="lsq-banner lsq-banner--neutral" role="status">
          <Icon name="lock" size={16} />
          <div>
            <p className="lsq-banner__title">{completed ? 'Webinar Completed' : 'Launched, Setup Locked'}</p>
            <p className="lsq-banner__body">
              {completed
                ? 'This webinar is complete, so its setup is a read-only record.'
                : 'Webinar details, audience and registration channels are now a read-only record.'}
            </p>
          </div>
        </div>
      )}

      {registrationChannels && (
        <ChannelRegistrationOverviewCard
          overview={registrationChannels}
          drawers={drawers}
          onOpenDrawer={(content) => setDrawer(content)}
        />
      )}

      <Drawer content={drawer} onClose={() => setDrawer(null)} />

      <div className="lsq-banner lsq-banner--neutral">
        <Icon name="info" size={16} />
        <p className="lsq-banner__body">
          {hasHistorical
            ? "This campaign has no imported contacts in this build, so there's no live funnel to compute. These are its recorded historical results."
            : 'No contacts have been imported for this webinar yet. Import a contact list in the Audience tab to begin scoring and outreach.'}
        </p>
      </div>

      {hasHistorical ? (
        <div className="lsq-grid lsq-grid--narrow">
          {stats.map((s) => (
            <div key={s.label} className="lsq-card lsq-stat">
              <p className="lsq-stat__label">{s.label}</p>
              <p className="lsq-stat__value">{typeof s.value === 'number' ? s.value.toLocaleString() : s.value}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="lsq-card">
          <div className="lsq-empty">
            <span className="lsq-empty__icon" aria-hidden="true">
              <Icon name="user" size={24} />
            </span>
            <h2 className="lsq-empty__title">{completed ? 'No Audience Data Recorded' : 'Ready For An Audience'}</h2>
            <p className="lsq-empty__body">
              {completed
                ? 'This webinar was completed without contacts or historical totals.'
                : 'Upload a CSV or sync a LeadSquared list to score personas, draft personalized messaging, and launch the multi-channel cadence.'}
            </p>
            {!completed && (
              <Link href={`/campaigns/${campaign.id}/audience`} className="lsq-btn lsq-btn--md lsq-btn--primary lsq-ov-linkbtn">
                Import Contacts In Audience
                <Icon name="arrow-right" size={16} />
              </Link>
            )}
          </div>
        </div>
      )}

      {!setupLocked && (
        <EditSetupModal campaign={campaign} serverNow={serverNow} isOpen={editOpen} onClose={() => setEditOpen(false)} />
      )}
    </div>
  );
}
