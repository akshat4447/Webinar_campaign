import { IntegrationCard } from './IntegrationCard';
import { LsqActivityMappingCard } from './LsqActivityMappingCard';
import { ConnectResultBanner } from './ConnectResultBanner';
import { integrationsData } from '@/lib/demo-data';
import { getTestResult, resolveIntegrationField } from '@/lib/integrationConfig';
import { zoomIsConfigured, getZoomMode } from '@/lib/zoom/client';
import { linkedinIsConfigured, getLinkedinMode } from '@/lib/linkedin/client';

// Reads live DB credentials/test-results on every request — this page must
// NEVER be statically prerendered with build-time values frozen into HTML.
export const dynamic = 'force-dynamic';

export default async function IntegrationsPage(props: PageProps<'/integrations'>) {
  const sp = await props.searchParams;
  const connected = typeof sp.connected === 'string' ? sp.connected : undefined;
  const detail = typeof sp.detail === 'string' ? sp.detail : undefined;

  const cards = await Promise.all(integrationsData.map(async (ig) => ({ ig, testResult: await getTestResult(ig.id) })));

  // One glanceable answer to "where do messages actually go right now?" — the
  // delivery-affecting switches live in three places, so they're surfaced here.
  const [smsStrategy, waStrategy] = await Promise.all([
    resolveIntegrationField('lsq', 'smsStrategy'),
    resolveIntegrationField('lsq', 'whatsappStrategy'),
  ]);
  const sendMode = process.env.SEND_MODE === 'live' ? 'live' : 'sandbox';
  const liMode = await getLinkedinMode();
  const liConnected = await linkedinIsConfigured();
  const zoomMode = await getZoomMode();
  const zoomConnected = await zoomIsConfigured();
  const zoomAutosyncOn = process.env.ZOOM_AUTOSYNC === '1' || process.env.ZOOM_AUTOSYNC === 'true';
  const zoomValue =
    zoomMode !== 'live'
      ? 'Sandbox — meeting sync and attendance simulated'
      : !zoomConnected
        ? 'Live mode, but not connected — click Connect with Zoom'
        : zoomAutosyncOn
          ? 'Live · auto-sync running'
          : 'Live · connected, auto-sync off (set ZOOM_AUTOSYNC=1)';
  const liValue =
    liMode !== 'live'
      ? 'Sandbox — Events API simulated · touches manual either way'
      : !liConnected
        ? 'Live mode, but not connected — click Connect with LinkedIn'
        : 'Live · Events API connected · touches manual';
  const delivery = [
    { label: 'Email', value: `${sendMode}${sendMode === 'sandbox' ? ' → allowlisted lead' : ''}` },
    { label: 'SMS', value: `LSQ ${(smsStrategy || 'trigger').toLowerCase()} strategy` },
    { label: 'WhatsApp', value: `LSQ ${(waStrategy || 'trigger').toLowerCase()} strategy` },
    { label: 'LinkedIn', value: liValue },
    { label: 'Zoom', value: zoomValue },
  ];

  return (
    <main style={{ flex: 1, overflowY: 'auto', padding: '32px 40px 48px 40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 'var(--fs-heading-2)', fontWeight: 700, color: 'var(--n90)', letterSpacing: '-0.01em' }}>Integrations</div>
          <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--n60)', marginTop: 3 }}>Manage the connections the agent uses to run campaigns end to end</div>
        </div>
      </div>

      <ConnectResultBanner connected={connected} detail={detail} />

      <div style={{ background: '#fff', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)', padding: '14px 20px', marginBottom: 20 }}>
        <div style={{ fontSize: 'var(--fs-label-1)', fontWeight: 700, color: 'var(--n90)', marginBottom: 8 }}>Delivery settings</div>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          {delivery.map((d) => (
            <div key={d.label}>
              <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n50)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{d.label}</div>
              <div style={{ fontSize: 'var(--fs-label-1)', fontWeight: 600, color: 'var(--n80)', marginTop: 2 }}>{d.value}</div>
            </div>
          ))}
        </div>
      </div>

      <LsqActivityMappingCard />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(288px, 1fr))', gap: 16 }}>
        {cards.map(({ ig, testResult }) => (
          <IntegrationCard key={ig.id} ig={ig} testResult={testResult} />
        ))}
      </div>

      <div style={{ marginTop: 24, fontSize: 'var(--fs-label-2)', color: 'var(--n50)', lineHeight: 1.6, maxWidth: 760 }}>
        Build note — LeadSquared, Claude, Apollo, Apify and Zoom (User-managed OAuth, connected per account via Connect with
        Zoom) all make live API calls, none of them simulated. Meeting creation/linking and attendance both run
        automatically once Zoom is connected and ZOOM_AUTOSYNC is on — there is no manual upload path. LinkedIn outreach is
        manual by design; its Events API is real. Apollo enrichment falls back to an unverified pattern-guess only when it
        has no real match (or isn&apos;t configured) — that guess, and any contact detail inferred rather than supplied, is
        held back from sending until a human verifies it.
      </div>
    </main>
  );
}
