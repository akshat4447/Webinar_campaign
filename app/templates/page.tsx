import { db } from '@/lib/db';
import { PageHeader } from '@/components/ui/PageHeader';
import { TemplatesLibrary } from './TemplatesLibrary';

export const dynamic = 'force-dynamic';

const CHANNELS = ['email', 'whatsapp', 'sms', 'linkedin'] as const;

export default async function TemplatesPage(props: PageProps<'/templates'>) {
  const sp = await props.searchParams;
  const raw = typeof sp.channel === 'string' ? sp.channel : 'email';
  const channel = (CHANNELS as readonly string[]).includes(raw) ? raw : 'email';
  const selectedId = typeof sp.id === 'string' ? sp.id : undefined;

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

  const usage = await db.cadenceStep.groupBy({
    by: ['templateId'],
    where: { templateId: { in: templates.map((t) => t.id) } },
    _count: true,
  });
  const usageById = Object.fromEntries(usage.map((u) => [u.templateId ?? '', u._count]));

  return (
    <main style={{ flex: 1, overflowY: 'auto', padding: '32px 40px 48px 40px' }}>
      <div style={{ maxWidth: 1080, margin: '0 auto' }}>
        <PageHeader
          title="Message templates"
          subtitle="Reusable messages per channel. Cadence steps send these as written; AI mode uses them as the brief it personalizes from."
        />
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
          }))}
          selectedId={selectedId}
          campaigns={campaigns}
          sampleContact={sampleContact ?? { name: 'Priya Nair', account: 'Acme Financial' }}
        />
      </div>
    </main>
  );
}
