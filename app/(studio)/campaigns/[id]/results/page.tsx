import { DeliveryHistory } from '@/components/jobs/DeliveryHistory';
import { db } from '@/lib/db';
import { getCachedCampaign } from '@/lib/campaignCache';
import { ControlPanel } from '../agent/ControlPanel';
import { LinkedInInviteCard } from '../agent/LinkedInInviteCard';
import { ActivityLog } from '../agent/ActivityLog';
import { ResultsClient } from './ResultsClient';
import { eventPublicUrl } from '@/lib/linkedin/events';
import { getAccountEngagement, getPostEventStats } from '@/lib/postEvent';
import { isCampaignCompleted } from '@/lib/campaignLifecycle';
import { formatLsqDateTime } from '@/lib/dateFormat';
import { Badge } from '@/components/ui/Badge';

const LOG_LIMIT = 30;

function cadenceBadge(status: string, cadenceStatus: string): { color: string; text: string } {
  if (status === 'completed') return { color: 'success', text: 'Webinar completed' };
  if (cadenceStatus === 'running') return { color: 'success', text: 'Cadence live' };
  if (cadenceStatus === 'paused') return { color: 'warning', text: 'Cadence paused' };
  if (cadenceStatus === 'stopped') return { color: 'error', text: 'Cadence stopped' };
  return { color: 'gray', text: 'Not yet launched' };
}

function ZoomSyncCard({ campaign, completed }: { campaign: { attendanceImportedAt: Date | null; zoomMeetingId: string | null }; completed: boolean }) {
  return (
    <section className="lsq-card" aria-labelledby="res-zoom">
      <div className="lsq-card__header">
        <h2 className="lsq-card__title" id="res-zoom">Zoom Attendance Auto-Sync</h2>
        {campaign.attendanceImportedAt ? (
          <Badge color="success" text="Imported" dot />
        ) : campaign.zoomMeetingId ? (
          <Badge color="blue" text="Linked" dot />
        ) : (
          <Badge color="gray" text="Not linked" />
        )}
      </div>
      <div className="lsq-card__body">
        {campaign.attendanceImportedAt ? (
          <p className="lsq-hint">
            Imported automatically {formatLsqDateTime(campaign.attendanceImportedAt)}. Attendee and no-show follow-ups are active below.
          </p>
        ) : campaign.zoomMeetingId ? (
          <p className="lsq-hint">
            Linked to Zoom ({campaign.zoomMeetingId}). Attendance pulls in automatically once the webinar concludes.
          </p>
        ) : completed ? (
          <p className="lsq-hint">
            No Zoom meeting was linked before this webinar was marked completed, so attendance was never imported.
          </p>
        ) : (
          <p className="lsq-hint">
            No Zoom meeting linked. Use <strong>Edit setup</strong> on the Overview tab to link Zoom for automated attendance sync.
          </p>
        )}
      </div>
    </section>
  );
}

export default async function ResultsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const deliveryRows = await db.cadenceSend.findMany({ where: { campaignId: id, OR: [{ recipient: { not: null } }, { status: 'unknown' }] }, orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, stepKey: true, status: true, recipient: true, renderedSubject: true, renderedBody: true, providerMessageId: true, deliveryOutcome: true, error: true } });


  const [
    campaign,
    attentionItems,
    nextSend,
    linkedinRegs,
    pendingLinkedinRegs,
    recentLogDesc,
    sentCount,
    failedCount,
    queuedCount,
    skippedCount,
    registeredCount,
    postEventStats,
    accounts,
  ] = await Promise.all([
    getCachedCampaign(id),
    db.attentionItem.findMany({ where: { campaignId: id, resolvedAt: null }, orderBy: { createdAt: 'desc' } }),
    db.cadenceSend.findFirst({ where: { campaignId: id, status: 'queued' }, orderBy: { dueAt: 'asc' } }),
    db.linkedinRegistration.count({ where: { campaignId: id, leadAction: 'CREATED' } }),
    db.linkedinRegistration.count({ where: { campaignId: id, processedAt: null } }),
    db.activityLogEntry.findMany({ where: { campaignId: id }, orderBy: { createdAt: 'desc' }, take: LOG_LIMIT }),
    db.cadenceSend.count({ where: { campaignId: id, status: 'sent' } }),
    db.cadenceSend.count({ where: { campaignId: id, status: 'failed' } }),
    db.cadenceSend.count({ where: { campaignId: id, status: 'queued' } }),
    db.cadenceSend.count({ where: { campaignId: id, status: 'skipped' } }),
    db.contact.count({ where: { campaignId: id, registeredAt: { not: null } } }),
    getPostEventStats(id),
    getAccountEngagement(id),
  ]);

  const recentLog = [...recentLogDesc].reverse();
  const completed = isCampaignCompleted(campaign.status);

  const liveStats = [
    { label: 'Messages sent', value: sentCount },
    { label: 'Failed', value: failedCount, tone: failedCount > 0 ? ('warn' as const) : undefined },
    { label: 'Queued', value: queuedCount },
    // Suppressed, stopped-on-decline, disabled-step, etc. — these used to
    // have no tile at all, so a send that quietly dropped out of the cadence
    // for any of those reasons was invisible here even though it's a real,
    // inspectable outcome (Control Center shows why) distinct from "failed".
    { label: 'Skipped', value: skippedCount },
    { label: 'Registered', value: registeredCount },
  ];

  const badge = cadenceBadge(campaign.status, campaign.cadenceStatus);

  return (
    <main style={{ flex: 1, overflowY: 'auto' }}>
      <div className="lsq-page">
        <header className="lsq-page-header">
          <div className="lsq-page-header__text">
            <p className="lsq-page-header__eyebrow">Results</p>
            <h1 className="lsq-page-header__title">Campaign Results</h1>
            <p className="lsq-page-header__sub">
              Live send activity, items that need attention, and post-webinar outcomes.
            </p>
          </div>
          <div className="lsq-page-header__actions">
            <Badge color={badge.color} text={badge.text} dot />
          </div>
        </header>

        {/* Live agent operational KPIs */}
        <div className="lsq-grid lsq-grid--narrow">
          {liveStats.map((s) => (
            <div key={s.label} className="lsq-card lsq-stat">
              <p className="lsq-stat__label">{s.label}</p>
              <p className="lsq-stat__value" data-tone={s.tone === 'warn' ? 'warn' : undefined}>
                {s.value.toLocaleString()}
              </p>
            </div>
          ))}
        </div>

        {/* Live Agent Execution Command Center — cadence control, LinkedIn outreach
            both require an active campaign, so once the
            webinar is marked completed only the historical log and the Zoom
            status (read-only at that point) stay on the page. */}
        {completed ? (
          <div className="lsq-stack lsq-stack--lg">
            {/* Marking completed stops the cadence, so this should normally never
                show. If a cadence is somehow still running on a completed webinar,
                hiding Control Center would leave the operator with no way to stop
                it — so the control stays reachable precisely in that case. */}
            {campaign.cadenceStatus === 'running' && (
              <ControlPanel campaign={campaign} attentionItems={attentionItems} nextSendDueAt={nextSend?.dueAt.toISOString() ?? null} />
            )}
            <ActivityLog entries={recentLog} />
            <ZoomSyncCard campaign={campaign} completed />
          </div>
        ) : (
          <div className="lsq-with-aside">
            <div className="lsq-stack lsq-stack--lg">
              <ControlPanel campaign={campaign} attentionItems={attentionItems} nextSendDueAt={nextSend?.dueAt.toISOString() ?? null} />
              <ActivityLog entries={recentLog} />
            </div>

            <div className="lsq-stack lsq-stack--lg">
              {campaign.linkedinEventStatus === 'published' && campaign.linkedinEventUrn && (
                <LinkedInInviteCard
                  campaignId={id}
                  eventUrl={eventPublicUrl(campaign.linkedinEventUrn)}
                  invited={!!campaign.linkedinInvitedAt}
                  registrations={linkedinRegs}
                  pendingRegistrations={pendingLinkedinRegs}
                />
              )}
              <ZoomSyncCard campaign={campaign} completed={false} />
            </div>
          </div>
        )}

        {/* Post-event debrief and SDR lead handoff */}
        <ResultsClient
          campaignId={id}
          campaign={campaign}
          stats={postEventStats}
          accounts={accounts}
        />
      </div>
    <DeliveryHistory campaignId={id} rows={deliveryRows} />
</main>
  );
}
