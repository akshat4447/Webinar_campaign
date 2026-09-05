import { db } from '@/lib/db';
import { ControlPanel } from './ControlPanel';
import { SimulateClockCard } from './SimulateClockCard';
import { LinkedInInviteCard } from './LinkedInInviteCard';
import { eventPublicUrl } from '@/lib/linkedin/events';

export default async function ControlPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [campaign, attentionItems, nextSend, linkedinRegs, pendingLinkedinRegs] = await Promise.all([
    db.campaign.findUniqueOrThrow({ where: { id } }),
    db.attentionItem.findMany({ where: { campaignId: id, resolvedAt: null }, orderBy: { createdAt: 'desc' } }),
    db.cadenceSend.findFirst({ where: { campaignId: id, status: 'queued' }, orderBy: { dueAt: 'asc' }, include: { contact: false } }),
    db.linkedinRegistration.count({ where: { campaignId: id, leadAction: 'CREATED' } }),
    db.linkedinRegistration.count({ where: { campaignId: id, processedAt: null } }),
  ]);

  return (
    <main style={{ flex: 1, overflowY: 'auto', padding: '28px 36px 48px 36px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 300px)', gap: 20, alignItems: 'start' }}>
        <ControlPanel campaign={campaign} attentionItems={attentionItems} nextSendDueAt={nextSend?.dueAt.toISOString() ?? null} />

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
