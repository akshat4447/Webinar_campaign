import { db } from '@/lib/db';
import { ControlPanel } from './ControlPanel';
import { SimulateClockCard } from './SimulateClockCard';
import { LinkedInInviteCard } from './LinkedInInviteCard';
import { ActivityLog } from './ActivityLog';
import { eventPublicUrl } from '@/lib/linkedin/events';

const LOG_LIMIT = 30;

export default async function AgentRunPage(props: PageProps<'/campaigns/[id]/agent'>) {
  const { id } = await props.params;
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
    registeredCount,
  ] = await Promise.all([
    db.campaign.findUniqueOrThrow({ where: { id } }),
    db.attentionItem.findMany({ where: { campaignId: id, resolvedAt: null }, orderBy: { createdAt: 'desc' } }),
    db.cadenceSend.findFirst({ where: { campaignId: id, status: 'queued' }, orderBy: { dueAt: 'asc' }, include: { contact: false } }),
    db.linkedinRegistration.count({ where: { campaignId: id, leadAction: 'CREATED' } }),
    db.linkedinRegistration.count({ where: { campaignId: id, processedAt: null } }),
    db.activityLogEntry.findMany({ where: { campaignId: id }, orderBy: { createdAt: 'desc' }, take: LOG_LIMIT }),
    db.cadenceSend.count({ where: { campaignId: id, status: 'sent' } }),
    db.cadenceSend.count({ where: { campaignId: id, status: 'failed' } }),
    db.cadenceSend.count({ where: { campaignId: id, status: 'queued' } }),
    db.contact.count({ where: { campaignId: id, registeredAt: { not: null } } }),
  ]);

  // Fetched newest-first (cheap with the index on createdAt) then reversed so
  // the log reads top-to-bottom as the order things actually happened — the
  // same convention the prototype's numbered fixture uses.
  const recentLog = [...recentLogDesc].reverse();

  const stats = [
    { label: 'Messages sent', value: sentCount },
    { label: 'Failed', value: failedCount, tone: failedCount > 0 ? ('warn' as const) : undefined },
    { label: 'Queued', value: queuedCount },
    { label: 'Registered', value: registeredCount },
  ];

  return (
    <main style={{ flex: 1, overflowY: 'auto', padding: '28px 36px 48px 36px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14, marginBottom: 18 }}>
        {stats.map((s) => (
          <div key={s.label} className="lsq-card" style={{ padding: '14px 16px' }}>
            <div style={{ fontSize: 'var(--fs-label-2)', fontWeight: 700, color: 'var(--n50)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              {s.label}
            </div>
            <div
              className="lsq-num"
              style={{
                fontSize: 'var(--fs-heading-2)',
                fontWeight: 700,
                marginTop: 5,
                color: s.tone === 'warn' ? 'var(--danger-500)' : 'var(--n90)',
              }}
            >
              {s.value.toLocaleString()}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 300px)', gap: 20, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <ControlPanel campaign={campaign} attentionItems={attentionItems} nextSendDueAt={nextSend?.dueAt.toISOString() ?? null} />
          <ActivityLog entries={recentLog} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {campaign.linkedinEventStatus === 'published' && campaign.linkedinEventUrn && (
            <LinkedInInviteCard
              campaignId={id}
              eventUrl={eventPublicUrl(campaign.linkedinEventUrn)}
              invited={!!campaign.linkedinInvitedAt}
              registrations={linkedinRegs}
              pendingRegistrations={pendingLinkedinRegs}
            />
          )}
          <SimulateClockCard campaignId={id} simulatedNow={campaign.simulatedNow?.toISOString() ?? null} />
        </div>
      </div>
    </main>
  );
}
