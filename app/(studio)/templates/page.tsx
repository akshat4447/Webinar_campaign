import { db } from '@/lib/db';
import { getTemplateUsageCounts } from '@/lib/messageTemplates';
import { TemplatesLibrary } from './TemplatesLibrary';

export const dynamic = 'force-dynamic';

const CHANNELS = ['email', 'whatsapp', 'sms', 'linkedin'] as const;

export default async function TemplatesPage(props: PageProps<'/templates'>) {
  const sp = await props.searchParams;
  const raw = typeof sp.channel === 'string' ? sp.channel : 'email';
  const channel = (CHANNELS as readonly string[]).includes(raw) ? raw : 'email';
  const selectedId = typeof sp.id === 'string' ? sp.id : undefined;
  const campaignId = typeof sp.campaignId === 'string' ? sp.campaignId : undefined;

  const [templates, campaigns, sampleContact] = await Promise.all([
    db.messageTemplate.findMany({
      where: { channel },
      orderBy: [{ campaignId: 'asc' }, { createdAt: 'asc' }],
      include: { campaign: { select: { name: true } } },
    }),
    db.campaign.findMany({ where: { archived: false }, orderBy: { createdAt: 'desc' }, select: { id: true, name: true } }),
    db.contact.findFirst({ where: { approved: true }, select: { name: true, account: true } }),
  ]);

  // Counts per channel so the tabs say how much is in each.
  const counts = Object.fromEntries(
    await Promise.all(
      CHANNELS.map(async (c) => [c, await db.messageTemplate.count({ where: { channel: c } })] as const)
    )
  ) as Record<string, number>;

  // Counts steps that explicitly point at each template AND ones that would
  // resolve to it through the key-fallback chain (resolveStepTemplate) — a
  // plain `templateId` count misses most real usage, since a step's
  // templateId is usually left null and resolved by key instead.
  const usageById = await getTemplateUsageCounts(templates.map((t) => ({ id: t.id, key: t.key, campaignId: t.campaignId })));

  return (
    <main style={{ flex: 1, overflowY: 'auto' }}>
      <div className="lsq-page">
        <header className="lsq-page-header">
          <div className="lsq-page-header__text">
            <p className="lsq-page-header__eyebrow">Library</p>
            <h1 className="lsq-page-header__title">Message Templates</h1>
            <p className="lsq-page-header__sub">
              Reusable messages per channel. Cadence steps send these as written; AI mode uses them as the brief to personalize from.
            </p>
          </div>
        </header>
        <TemplatesLibrary
          channel={channel}
          counts={counts}
          templates={templates.map((t) => ({
            id: t.id,
            campaignId: t.campaignId,
            campaignName: t.campaign?.name ?? null,
            channel: t.channel,
            key: t.key,
            name: t.name,
            hasSubject: t.hasSubject,
            subject: t.subject,
            body: t.body,
            category: t.category,
            language: t.language,
            footer: t.footer,
            buttons: t.buttons,
            dltTemplateId: t.dltTemplateId,
            senderId: t.senderId,
            status: t.status,
            hidden: t.hidden,
            hasSaved: !!t.savedAt,
            usedBySteps: usageById[t.id] ?? 0,
            updatedAt: t.updatedAt.toISOString(),
          }))}
          selectedId={selectedId}
          campaignId={campaignId}
          campaigns={campaigns}
          sampleContact={sampleContact ?? { name: 'Priya Nair', account: 'Acme Financial' }}
        />
      </div>
    </main>
  );
}
