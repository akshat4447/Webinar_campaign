import { IntegrationCard } from './IntegrationCard';
import { integrationsData } from '@/lib/demo-data';
import { getTestResult, resolveIntegrationField } from '@/lib/integrationConfig';

export default async function IntegrationsPage() {
  const cards = await Promise.all(integrationsData.map(async (ig) => ({ ig, testResult: await getTestResult(ig.id) })));

  // One glanceable answer to "where do messages actually go right now?" — the
  // delivery-affecting switches live in three places, so they're surfaced here.
  const [smsStrategy, waStrategy] = await Promise.all([
    resolveIntegrationField('lsq', 'smsStrategy'),
    resolveIntegrationField('lsq', 'whatsappStrategy'),
  ]);
  const sendMode = process.env.SEND_MODE === 'live' ? 'live' : 'sandbox';
  const liMode = process.env.LINKEDIN_MODE === 'live' ? 'live' : 'sandbox';
  const delivery = [
    { label: 'Email', value: `${sendMode}${sendMode === 'sandbox' ? ' → allowlisted lead' : ''}` },
    { label: 'SMS', value: `LSQ ${(smsStrategy || 'trigger').toLowerCase()} strategy` },
    { label: 'WhatsApp', value: `LSQ ${(waStrategy || 'trigger').toLowerCase()} strategy` },
    { label: 'LinkedIn', value: liMode === 'live' ? 'Events API live' : 'Events API sandbox · touches manual' },
  ];

  return (
    <main style={{ flex: 1, overflowY: 'auto', padding: '32px 40px 48px 40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--n90)', letterSpacing: '-0.01em' }}>Integrations</div>
          <div style={{ fontSize: 13, color: 'var(--n60)', marginTop: 3 }}>Manage the connections the agent uses to run campaigns end to end</div>
        </div>
      </div>

      <div style={{ background: '#fff', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)', padding: '14px 20px', marginBottom: 20 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--n90)', marginBottom: 8 }}>Delivery settings</div>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          {delivery.map((d) => (
            <div key={d.label}>
              <div style={{ fontSize: 11, color: 'var(--n50)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{d.label}</div>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--n80)', marginTop: 2 }}>{d.value}</div>
            </div>
          ))}
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
