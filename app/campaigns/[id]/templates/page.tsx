import { db } from '@/lib/db';
import { TemplatesEditor } from './TemplatesEditor';
import { templatesData } from '@/lib/demo-data';

// Cadence-order sequence (invite -> nudge -> final -> linkedin -> attend -> noshow),
// not updatedAt — otherwise the list re-shuffles every time a template gets edited.
const KEY_ORDER = templatesData.map((t) => t.id);

export default async function TemplatesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [campaign, templatesRaw, sampleContact] = await Promise.all([
    db.campaign.findUniqueOrThrow({ where: { id } }),
    db.template.findMany({ where: { campaignId: id } }),
    db.contact.findFirst({ where: { campaignId: id, approved: true } }).then((c) => c ?? db.contact.findFirst({ where: { campaignId: id } })),
  ]);
  const templates = [...templatesRaw].sort((a, b) => {
    const ai = KEY_ORDER.indexOf(a.key.split('-copy-')[0]);
    const bi = KEY_ORDER.indexOf(b.key.split('-copy-')[0]);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  if (templates.length === 0) {
    return (
      <main style={{ flex: 1, overflowY: 'auto', padding: '28px 36px 48px 36px' }}>
        <div style={{ textAlign: 'center', color: 'var(--n60)', fontSize: 13, marginTop: 48 }}>No templates yet for this campaign.</div>
      </main>
    );
  }

  return (
    <main style={{ flex: 1, overflowY: 'auto', padding: '28px 36px 48px 36px' }}>
      <TemplatesEditor
        campaignId={id}
        campaignName={campaign.name}
        initialTemplates={templates}
        registrationLink={campaign.registrationLink ?? ''}
        sampleContact={sampleContact ? { name: sampleContact.name, account: sampleContact.account } : { name: 'Priya Nair', account: 'Acme Financial' }}
      />
    </main>
  );
}
