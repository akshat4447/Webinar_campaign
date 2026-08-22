import { db } from '@/lib/db';
import { ControlPanel } from './ControlPanel';
import { ZoomPanel } from './ZoomPanel';
import { SimulateClockCard } from './SimulateClockCard';

export default async function ControlPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [campaign, attentionItems, nextSend] = await Promise.all([
    db.campaign.findUniqueOrThrow({ where: { id } }),
    db.attentionItem.findMany({ where: { campaignId: id, resolvedAt: null }, orderBy: { createdAt: 'desc' } }),
    db.cadenceSend.findFirst({ where: { campaignId: id, status: 'queued' }, orderBy: { dueAt: 'asc' }, include: { contact: false } }),
  ]);

  return (
    <main style={{ flex: 1, overflowY: 'auto', padding: '28px 36px 48px 36px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 300px)', gap: 20, alignItems: 'start' }}>
        <ControlPanel campaign={campaign} attentionItems={attentionItems} nextSendDueAt={nextSend?.dueAt.toISOString() ?? null} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <ZoomPanel campaignId={id} />
          <SimulateClockCard campaignId={id} simulatedNow={campaign.simulatedNow?.toISOString() ?? null} />
        </div>
      </div>
    </main>
  );
}
