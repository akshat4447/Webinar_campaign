'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Drawer, type DrawerContent } from '@/components/ui/Drawer';
import { Icon } from '@/components/ui/Icon';
import { EditSetupModal } from './EditSetupModal';
import { BroadcastReminderModal } from '@/components/cadence/BroadcastReminderModal';
import { ChannelRegistrationOverviewCard } from '@/components/overview/ChannelRegistrationOverviewCard';
import type { CampaignRegistrationOverview } from '@/lib/registrationChannels';
import { isCampaignCompleted, isSetupLocked } from '@/lib/campaignLifecycle';
import { formatLsqDateTime, timeZoneLabel } from '@/lib/dateFormat';
import type { Campaign, Speaker } from '@/lib/generated/prisma/client';

type BreakdownMode = 'persona' | 'scoreband' | 'source' | 'vertical';

interface FunnelStage {
  label: string;
  value: number;
  pctOfTotal: number;
  stepConversion: number | null;
}

interface ScoreBand {
  label: string;
  contacts: number;
  approved: number;
  attended: number;
  approvalRate: number | null;
  attendanceRate: number | null;
}

interface Kpi {
  label: string;
  value: string;
  sub: string;
  tone: 'accent' | 'good' | 'warn' | 'neutral';
}

interface Row {
  label: string;
  count: number;
  pct: number;
  failed?: number;
}

interface AccountRow {
  account: string;
  contactCount: number;
  approved: number;
  attended: number;
  topScore: number;
  action: string;
  actionColor: string;
}

interface PipelineStage {
  label: string;
  value: number;
  pctOfTotal: number;
}

interface About {
  name: string;
  vertical: string;
  date: string;
  description: string | null;
  speakerName: string | null;
  speakerTitle: string | null;
  capacity: number | null;
  speakersSummary?: string | null;
}

interface AttendeeChannelStat {
  label: string;
  attended: number;
  pctOfAttendees: number;
}

const BREAKDOWN_MODES: BreakdownMode[] = ['persona', 'scoreband', 'source', 'vertical'];
const BREAKDOWN_LABEL: Record<BreakdownMode, string> = {
  persona: 'Persona',
  scoreband: 'Score band',
  source: 'Source',
  vertical: 'Vertical',
};

/** The one thing a draft webinar should do next, derived from how far the pipeline has got. */
function nextStepFor(pipeline: PipelineStage[], campaignId: string) {
  const count = (label: string) => pipeline.find((p) => p.label === label)?.value ?? 0;
  if (count('Imported') === 0) {
    return {
      title: 'Audience Not Imported Yet',
      body: 'Import a contact list to run scoring and cadence outreach, or share the channel tracking links to capture sign-ups directly.',
      cta: 'Import Contacts',
      href: `/campaigns/${campaignId}/audience`,
    };
  }
  if (count('Scored') === 0) {
    return {
      title: 'Audience Ready To Score',
      body: `${count('Imported').toLocaleString()} contacts are imported. Run scoring to rank them against this webinar.`,
      cta: 'Score Audience',
      href: `/campaigns/${campaignId}/audience`,
    };
  }
  if (count('Approved') === 0) {
    return {
      title: 'Review And Approve Contacts',
      body: `${count('Scored').toLocaleString()} contacts are scored. Approve the ones to invite before drafting messages.`,
      cta: 'Review Audience',
      href: `/campaigns/${campaignId}/audience`,
    };
  }
  return {
    title: 'Next, Prepare The Messaging',
    body: `${count('Approved').toLocaleString()} contacts are approved. Draft and approve the messages, then launch the cadence.`,
    cta: 'Continue To Messaging',
    href: `/campaigns/${campaignId}/messaging`,
  };
}

export function DashboardClient({
  pipeline,
  about,
  learnings,
  kpis,
  funnel,
  scoreBands,
  stepBreakdown,
  channelBreakdown,
  breakdownData,
  accountBreakdown,
  attended,
  approved,
  attendanceImported,
  zoomLinked,
  attendeeChannelBreakdown,
  drawers,
  campaign,
  serverNow,
  initialEditOpen,
  registrationChannels,
}: {
  pipeline: PipelineStage[];
  about: About;
  learnings: string[];
  kpis: Kpi[];
  funnel: FunnelStage[];
  scoreBands: ScoreBand[];
  stepBreakdown: Row[];
  channelBreakdown: Array<{ label: string; sent: number; queued: number; failed: number }>;
  breakdownData: Record<BreakdownMode, Row[]>;
  accountBreakdown: AccountRow[];
  attended: number;
  approved: number;
  attendanceImported: boolean;
  zoomLinked: boolean;
  attendeeChannelBreakdown: AttendeeChannelStat[];
  drawers: Record<string, DrawerContent>;
  campaign?: Campaign & { speakers?: Speaker[] };
  serverNow?: number;
  initialEditOpen?: boolean;
  registrationChannels?: CampaignRegistrationOverview;
}) {
  const [breakdownMode, setBreakdownMode] = useState<BreakdownMode>('persona');
  const [drawer, setDrawer] = useState<DrawerContent | null>(null);
  const [showTable, setShowTable] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(initialEditOpen ?? false);
  const [broadcastModalOpen, setBroadcastModalOpen] = useState(false);

  const completed = campaign ? isCampaignCompleted(campaign.status) : false;
  const setupLocked = campaign ? isSetupLocked(campaign) : false;
  const isDraft = !!campaign && !setupLocked;

  const noShow = Math.max(0, approved - attended);
  const attendPct = approved > 0 ? Math.round((attended / approved) * 100) : 0;
  const maxFunnel = Math.max(1, ...funnel.map((f) => f.value));
  const registeredCount = funnel.find((f) => f.label.toLowerCase() === 'registered')?.value ?? 0;

  const hasLinkedIn =
    channelBreakdown.some((c) => c.label.toLowerCase().includes('linkedin')) ||
    stepBreakdown.some((s) => s.label.toLowerCase().includes('linkedin')) ||
    registrationChannels?.channels.some((c) => c.key === 'linkedin' || c.key === 'linkedin_event');

  const when = campaign?.scheduledAt
    ? `${formatLsqDateTime(campaign.scheduledAt, campaign.timezone)} ${timeZoneLabel(campaign.scheduledAt, campaign.timezone)}`
    : about.date;
  const speakerLine = about.speakersSummary || `${about.speakerName || 'Speaker'}${about.speakerTitle ? `, ${about.speakerTitle}` : ''}`;
  const nextStep = isDraft && campaign ? nextStepFor(pipeline, campaign.id) : null;

  return (
    <div className="lsq-page">
      <header className="lsq-page-header">
        <div className="lsq-page-header__text">
          <p className="lsq-page-header__eyebrow">Overview</p>
          <div className="lsq-ov-titlerow">
            <h1 className="lsq-page-header__title">{about.name}</h1>
            {campaign && completed && <Badge color="success" text="Completed" dot />}
            {campaign && !completed && setupLocked && <Badge color="blue" text="Launched, setup locked" dot />}
            {isDraft && <Badge color="gray" text="Draft" dot />}
          </div>
          <p className="lsq-page-header__sub">
            {when} · {speakerLine} · {zoomLinked ? 'Zoom linked' : 'Direct join link'}
          </p>
        </div>
        {campaign && !completed && (
          <div className="lsq-page-header__actions">
            <Button hierarchy="secondary" icon={<Icon name="bell" size={16} />} onClick={() => setBroadcastModalOpen(true)}>
              Broadcast Reminder
            </Button>
            {hasLinkedIn && (
              <Link href={`/linkedin?event=${campaign.id}`} className="lsq-btn lsq-btn--md lsq-btn--secondary lsq-ov-linkbtn">
                <Icon name="linkedin" size={16} />
                LinkedIn Outreach
              </Link>
            )}
            {!setupLocked && (
              <Button hierarchy="secondary" icon={<Icon name="edit" size={16} />} onClick={() => setEditModalOpen(true)}>
                Edit Setup
              </Button>
            )}
          </div>
        )}
      </header>

      {campaign && !setupLocked && (
        <EditSetupModal campaign={campaign} serverNow={serverNow ?? 0} isOpen={editModalOpen} onClose={() => setEditModalOpen(false)} />
      )}

      {campaign && !completed && broadcastModalOpen && (
        <BroadcastReminderModal
          campaignId={campaign.id}
          campaignName={campaign.name}
          webinarDate={campaign.date}
          registeredCount={registeredCount}
          onClose={() => setBroadcastModalOpen(false)}
        />
      )}

      {/* Completed campaigns are locked here: Setup can't be edited and this tab reads as a
          historical summary, so point at Results for the full post-event detail. */}
      {campaign && completed && (
        <div className="lsq-banner lsq-banner--neutral" role="status">
          <Icon name="lock" size={16} />
          <div className="lsq-grow">
            <p className="lsq-banner__title">Webinar Completed</p>
            <p className="lsq-banner__body">This webinar is complete. Results has the full attendance and SDR hand-off detail.</p>
            <div className="lsq-banner__actions">
              <Link href={`/campaigns/${campaign.id}/results`} className="lsq-btn lsq-btn--sm lsq-btn--secondary lsq-ov-linkbtn">
                View Full Results
                <Icon name="arrow-right" size={14} />
              </Link>
            </div>
          </div>
        </div>
      )}

      {campaign && !completed && setupLocked && (
        <div className="lsq-banner lsq-banner--neutral" role="status">
          <Icon name="lock" size={16} />
          <div>
            <p className="lsq-banner__title">Launched, Setup Locked</p>
            <p className="lsq-banner__body">
              Webinar details, audience and registration channels are now a read-only record. Only cadence steps that have not sent yet can still change.
            </p>
          </div>
        </div>
      )}

      {/* Next step: drafts only, one primary action. */}
      {nextStep && (
        <div className="lsq-banner" role="status">
          <Icon name="info" size={16} />
          <div>
            <p className="lsq-banner__title">{nextStep.title}</p>
            <p className="lsq-banner__body">{nextStep.body}</p>
            <div className="lsq-banner__actions">
              <Link href={nextStep.href} className="lsq-btn lsq-btn--sm lsq-btn--primary lsq-ov-linkbtn">
                {nextStep.cta}
                <Icon name="arrow-right" size={14} />
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* KPI row: the headline numbers, read before any chart */}
      <section aria-label="Key metrics">
        <div className="lsq-grid lsq-grid--narrow">
          {kpis.map((k) => (
            <div key={k.label} className="lsq-card lsq-stat lsq-ov-stat" data-tone={k.tone}>
              <p className="lsq-stat__label">{k.label}</p>
              <p className="lsq-stat__value">{k.value}</p>
              <p className="lsq-stat__note">{k.sub}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Registrations by channel: multi-channel attribution with one-click links and registrant drawers */}
      {registrationChannels && (
        <ChannelRegistrationOverviewCard
          overview={registrationChannels}
          drawers={drawers}
          onOpenDrawer={(content) => setDrawer(content)}
          onEditChannels={setupLocked ? undefined : () => setEditModalOpen(true)}
        />
      )}

      {/* Funnel: horizontal so long stage names fit, with stage-to-stage conversion */}
      <section className="lsq-card" aria-labelledby="ov-funnel">
        <div className="lsq-card__header">
          <div>
            <h2 className="lsq-card__title" id="ov-funnel">Campaign Funnel</h2>
            <p className="lsq-card__sub">Percentages are conversion from the previous stage. Select a stage for the records behind it.</p>
          </div>
          <div className="lsq-segmented" role="group" aria-label="Funnel view">
            <button type="button" aria-pressed={!showTable} onClick={() => setShowTable(false)}>Chart</button>
            <button type="button" aria-pressed={showTable} onClick={() => setShowTable(true)}>Table</button>
          </div>
        </div>
        <div className="lsq-card__body">
          {showTable ? (
            <div className="lsq-table-wrap" tabIndex={0} role="region" aria-label="Scrollable table">
              <table className="lsq-table">
                <thead>
                  <tr>
                    <th scope="col">Stage</th>
                    <th scope="col" className="lsq-ov-num">Contacts</th>
                    <th scope="col" className="lsq-ov-num">Step conversion</th>
                    <th scope="col" className="lsq-ov-num">Of total</th>
                  </tr>
                </thead>
                <tbody>
                  {funnel.map((f) => (
                    <tr key={f.label}>
                      <th scope="row" className="lsq-cell-primary">{f.label}</th>
                      <td className="lsq-ov-num">{f.value.toLocaleString()}</td>
                      <td className="lsq-ov-num lsq-ov-subtle">{f.stepConversion === null ? '—' : `${f.stepConversion}%`}</td>
                      <td className="lsq-ov-num lsq-ov-subtle">{f.pctOfTotal}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <ul className="lsq-ov-bars">
              {funnel.map((f) => {
                const dropped = f.stepConversion !== null && f.stepConversion < 100;
                return (
                  <li key={f.label}>
                    <button type="button" className="lsq-ov-bar" onClick={() => setDrawer(drawers[f.label] ?? null)} aria-label={`${f.label}: ${f.value.toLocaleString()} contacts. Open records`}>
                      <span className="lsq-ov-bar__label">{f.label}</span>
                      <span className="lsq-progress" aria-hidden="true">
                        <span className="lsq-progress__bar" style={{ width: `${Math.max(1.5, (f.value / maxFunnel) * 100)}%` }} />
                      </span>
                      <span className="lsq-ov-bar__value">{f.value.toLocaleString()}</span>
                      <span className="lsq-ov-bar__aux" data-tone={f.stepConversion === null ? undefined : dropped ? 'warn' : 'good'}>
                        {f.stepConversion === null ? '—' : `${f.stepConversion}%`}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      {/* About + what the agent learned */}
      <div className="lsq-ov-split">
        <section className="lsq-card" aria-labelledby="ov-about">
          <div className="lsq-card__header">
            <h2 className="lsq-card__title" id="ov-about">About This Webinar</h2>
          </div>
          <div className="lsq-card__body">
            <p className="lsq-ov-desc">{about.description || 'No description set yet.'}</p>
            <dl className="lsq-kv">
              <dt>Vertical</dt>
              <dd>{about.vertical}</dd>
              <dt>Date</dt>
              <dd>{when}</dd>
              {(about.speakersSummary || about.speakerName) && (
                <>
                  <dt>{about.speakersSummary && about.speakersSummary.includes('&') ? 'Speakers' : 'Speaker'}</dt>
                  <dd>{about.speakersSummary || `${about.speakerName}${about.speakerTitle ? `, ${about.speakerTitle}` : ''}`}</dd>
                </>
              )}
              {about.capacity !== null && (
                <>
                  <dt>Capacity</dt>
                  <dd>{about.capacity.toLocaleString()} seats</dd>
                </>
              )}
            </dl>
          </div>
        </section>

        <section className="lsq-card" aria-labelledby="ov-insights">
          <div className="lsq-card__header">
            <h2 className="lsq-card__title" id="ov-insights">Insights</h2>
          </div>
          <div className="lsq-card__body">
            {learnings.length === 0 ? (
              <p className="lsq-ov-muted">Not enough data yet to draw a pattern for this campaign.</p>
            ) : (
              <ul className="lsq-ov-list">
                {learnings.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      {/* The advanced read: is the score predictive? */}
      <section className="lsq-card" aria-labelledby="ov-predictive">
        <div className="lsq-card__header">
          <div>
            <h2 className="lsq-card__title" id="ov-predictive">Is The Score Predictive</h2>
            <p className="lsq-card__sub">
              Outcomes grouped by the relevance score Claude assigned. If scoring is working, approval and attendance should fall as the band drops.
            </p>
          </div>
        </div>
        <div className="lsq-card__body lsq-stack">
          {scoreBands.length === 0 ? (
            <p className="lsq-ov-muted">No scored contacts yet. Run scoring in the Audience tab to see outcomes by band.</p>
          ) : (
          <div className="lsq-table-wrap" tabIndex={0} role="region" aria-label="Scrollable table">
            <table className="lsq-table">
              <thead>
                <tr>
                  <th scope="col">Score band</th>
                  <th scope="col" className="lsq-ov-num">Contacts</th>
                  <th scope="col" className="lsq-ov-num">Approved</th>
                  <th scope="col">Approval rate</th>
                  <th scope="col" className="lsq-ov-num">Attended</th>
                </tr>
              </thead>
              <tbody>
                {scoreBands.map((b) => (
                  <tr key={b.label}>
                    <th scope="row" className="lsq-cell-primary">{b.label}</th>
                    <td className="lsq-ov-num">{b.contacts.toLocaleString()}</td>
                    <td className="lsq-ov-num">{b.approved.toLocaleString()}</td>
                    <td>
                      {b.approvalRate === null ? (
                        <span className="lsq-ov-disabled">—</span>
                      ) : (
                        <div className="lsq-ov-rate">
                          <div className="lsq-progress" aria-hidden="true">
                            <div className="lsq-progress__bar" style={{ width: `${b.approvalRate}%` }} />
                          </div>
                          <span className="lsq-ov-rate__text">{b.approvalRate}%</span>
                        </div>
                      )}
                    </td>
                    <td className={`lsq-ov-num${attendanceImported ? '' : ' lsq-ov-disabled'}`}>{attendanceImported ? b.attended.toLocaleString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
          {scoreBands.length > 0 && !attendanceImported && (
            <p className="lsq-hint">
              {zoomLinked
                ? 'Attendance is blank until the webinar ends. It pulls in automatically from Zoom, no action needed.'
                : 'Attendance will pull in automatically once a Zoom meeting is linked in webinar setup and the webinar has ended.'}
            </p>
          )}
        </div>
      </section>

      {channelBreakdown.length > 0 && (
        <section className="lsq-card" aria-labelledby="ov-delivery">
          <div className="lsq-card__header">
            <div>
              <h2 className="lsq-card__title" id="ov-delivery">Delivery By Channel</h2>
              <p className="lsq-card__sub">
                Every step counted, not just the invite. The funnel above stays invite-only so its stage percentages remain meaningful.
              </p>
            </div>
          </div>
          <div className="lsq-card__body">
            <div className="lsq-ov-tiles">
              {channelBreakdown.map((c) => (
                <div key={c.label} className="lsq-ov-tile">
                  <p className="lsq-ov-tile__label">{c.label}</p>
                  <p className="lsq-ov-tile__value">{c.sent.toLocaleString()}</p>
                  <p className="lsq-ov-tile__note">
                    sent
                    {c.queued > 0 && <span> · {c.queued.toLocaleString()} queued</span>}
                    {c.failed > 0 && <span className="lsq-ov-danger"> · {c.failed.toLocaleString()} failed</span>}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {attendanceImported && attendeeChannelBreakdown.length > 0 && (
        <section className="lsq-card" aria-labelledby="ov-attendee-channels">
          <div className="lsq-card__header">
            <div>
              <h2 className="lsq-card__title" id="ov-attendee-channels">Attendees By Invite Channel</h2>
              <p className="lsq-card__sub">
                Which channel each attendee&apos;s invite went out on. A contact invited on more than one channel counts under each, so this can add up to more than the total attended.
              </p>
            </div>
          </div>
          <div className="lsq-card__body">
            <div className="lsq-ov-tiles">
              {attendeeChannelBreakdown.map((c) => (
                <div key={c.label} className="lsq-ov-tile">
                  <p className="lsq-ov-tile__label">{c.label}</p>
                  <p className="lsq-ov-tile__value">{c.attended.toLocaleString()}</p>
                  <p className="lsq-ov-tile__note">{c.pctOfAttendees}% of attendees</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      <div className="lsq-ov-split lsq-ov-split--wide">
        <section className="lsq-card" aria-labelledby="ov-steps">
          <div className="lsq-card__header">
            <h2 className="lsq-card__title" id="ov-steps">Real Sends By Cadence Step</h2>
          </div>
          <div className="lsq-card__body">
            {stepBreakdown.length === 0 ? (
              <p className="lsq-ov-muted">No sends have gone out yet. Launch the cadence from the Cadence tab.</p>
            ) : (
              <ul className="lsq-ov-bars">
                {stepBreakdown.map((row) => (
                  <li key={row.label} className="lsq-ov-bar">
                    <span className="lsq-ov-bar__label" title={row.label}>{row.label}</span>
                    <div className="lsq-progress" aria-hidden="true">
                      <div className="lsq-progress__bar" style={{ width: `${Math.max(1.5, row.pct)}%` }} />
                    </div>
                    <span className="lsq-ov-bar__value">{row.count.toLocaleString()}</span>
                    <span className="lsq-ov-bar__aux" data-tone={row.failed ? 'bad' : undefined}>
                      {row.failed ? `${row.failed.toLocaleString()} failed` : '—'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="lsq-card" aria-labelledby="ov-attendance">
          <div className="lsq-card__header">
            <h2 className="lsq-card__title" id="ov-attendance">Attended Vs. No-show</h2>
          </div>
          <div className="lsq-card__body">
            {!attendanceImported ? (
              <p className="lsq-ov-muted">
                {zoomLinked
                  ? 'Not imported yet. Attendance pulls in automatically from Zoom once the webinar has ended.'
                  : 'Link a Zoom meeting in webinar setup to get attendance pulled in automatically after the webinar.'}
              </p>
            ) : (
              <div className="lsq-stack">
                <div className="lsq-progress lsq-progress--lg" aria-hidden="true">
                  <div className="lsq-progress__bar" style={{ width: `${attendPct}%` }} />
                </div>
                <div className="lsq-ov-split-counts">
                  <span>
                    <strong data-tone="accent">{attended.toLocaleString()}</strong> attended
                  </span>
                  <span>
                    <strong>{noShow.toLocaleString()}</strong> no-show
                  </span>
                </div>
                <hr className="lsq-divider" />
                <p className="lsq-ov-muted">{attendPct}% of approved contacts attended.</p>
              </div>
            )}
          </div>
        </section>
      </div>

      <section className="lsq-card" aria-labelledby="ov-segments">
        <div className="lsq-card__header">
          <h2 className="lsq-card__title" id="ov-segments">Segment Breakdown</h2>
          <div className="lsq-segmented" role="group" aria-label="Break down by">
            {BREAKDOWN_MODES.map((m) => (
              <button key={m} type="button" aria-pressed={breakdownMode === m} onClick={() => setBreakdownMode(m)}>
                {BREAKDOWN_LABEL[m]}
              </button>
            ))}
          </div>
        </div>
        <div className="lsq-card__body">
          {breakdownData[breakdownMode].length === 0 && <p className="lsq-ov-muted">No contacts imported yet.</p>}
          <ul className="lsq-ov-bars">
            {breakdownData[breakdownMode].slice(0, 8).map((row) => (
              <li key={row.label} className="lsq-ov-bar lsq-ov-bar--3">
                <span className="lsq-ov-bar__label" title={row.label}>{row.label}</span>
                <div className="lsq-progress" aria-hidden="true">
                  <div className="lsq-progress__bar" style={{ width: `${Math.max(1.5, row.pct)}%` }} />
                </div>
                <span className="lsq-ov-bar__value">{row.count.toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="lsq-card" aria-labelledby="ov-accounts">
        <div className="lsq-card__header">
          <div>
            <h2 className="lsq-card__title" id="ov-accounts">Top Accounts By Best-scoring Contact</h2>
            <p className="lsq-card__sub">Where the SDR team should start.</p>
          </div>
        </div>
        <div className="lsq-card__body">
          {accountBreakdown.length === 0 ? (
            <p className="lsq-ov-muted">No accounts yet. Import contacts in the Audience tab.</p>
          ) : (
          <div className="lsq-table-wrap" tabIndex={0} role="region" aria-label="Scrollable table">
            <table className="lsq-table">
              <thead>
                <tr>
                  <th scope="col">Account</th>
                  <th scope="col" className="lsq-ov-num">Top score</th>
                  <th scope="col" className="lsq-ov-num">Contacts</th>
                  <th scope="col" className="lsq-ov-num">Approved</th>
                  <th scope="col" className="lsq-ov-num">Attended</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {accountBreakdown.map((row) => (
                  <tr key={row.account}>
                    <th scope="row" className="lsq-cell-primary">{row.account}</th>
                    <td className="lsq-ov-num">{row.topScore || '—'}</td>
                    <td className="lsq-ov-num">{row.contactCount.toLocaleString()}</td>
                    <td className="lsq-ov-num">{row.approved.toLocaleString()}</td>
                    <td className={`lsq-ov-num${attendanceImported ? '' : ' lsq-ov-disabled'}`}>{attendanceImported ? row.attended.toLocaleString() : '—'}</td>
                    <td>
                      <Badge color={row.actionColor} text={row.action} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
        </div>
      </section>

      <Drawer content={drawer} onClose={() => setDrawer(null)} />
    </div>
  );
}
