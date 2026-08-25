import { db } from '@/lib/db';
import { TemplatesEditor } from './TemplatesEditor';
import { templatesData } from '@/lib/demo-data';
import { computeTemplatesReadiness } from '@/lib/cadenceReadiness';
import { Badge } from '@/components/ui/Badge';

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
  const readiness = await computeTemplatesReadiness(id);
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <Badge color={readiness.ok ? 'success' : 'warning'} text={readiness.ok ? 'All enabled steps are send-ready' : `${readiness.problems.length} step(s) need attention`} dot />
        {!readiness.ok && (
          <span style={{ fontSize: 12, color: 'var(--warning-700)', overflowWrap: 'anywhere' }}>{readiness.problems.join(' · ')}</span>
        )}
      </div>
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
