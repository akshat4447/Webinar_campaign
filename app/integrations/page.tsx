import { IntegrationCard } from './IntegrationCard';
import { integrationsData } from '@/lib/demo-data';
import { getTestResult } from '@/lib/integrationConfig';

export default async function IntegrationsPage() {
  const cards = await Promise.all(integrationsData.map(async (ig) => ({ ig, testResult: await getTestResult(ig.id) })));

  return (
    <main style={{ flex: 1, overflowY: 'auto', padding: '32px 40px 48px 40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--n90)', letterSpacing: '-0.01em' }}>Integrations</div>
          <div style={{ fontSize: 13, color: 'var(--n60)', marginTop: 3 }}>Manage the connections the agent uses to run campaigns end to end</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(288px, 1fr))', gap: 16 }}>
        {cards.map(({ ig, testResult }) => (
          <IntegrationCard key={ig.id} ig={ig} testResult={testResult} />
        ))}
      </div>

      <div style={{ marginTop: 24, fontSize: 11.5, color: 'var(--n50)', lineHeight: 1.6, maxWidth: 760 }}>
        Build note — LeadSquared and Claude make live API calls. Zoom attendance comes from a real exported participants report
        rather than the Zoom API. Apollo&apos;s contact lookup and LinkedIn&apos;s automated mode run on simulated responses in this
        build; the persona enrichment layered on top of them is real Claude output, and inferred contact details are held back
        from sending until a human verifies them.
      </div>
    </main>
  );
}
