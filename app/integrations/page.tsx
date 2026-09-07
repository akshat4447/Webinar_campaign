import { IntegrationCard } from './IntegrationCard';
import { LsqActivityMappingCard } from './LsqActivityMappingCard';
import { ConnectResultBanner } from './ConnectResultBanner';
import { DeliverySettingsBar } from './DeliverySettingsBar';
import { integrationsData } from '@/lib/demo-data';
import { getTestResult } from '@/lib/integrationConfig';
import { getChannelDeliverySettingsAction } from '@/lib/actions/integrations';
import { getSendMode } from '@/lib/sendGuard';
import { zoomIsConfigured, getZoomMode } from '@/lib/zoom/client';
import { linkedinIsConfigured, getLinkedinMode } from '@/lib/linkedin/client';

// Reads live DB credentials/test-results on every request — this page must
// NEVER be statically prerendered with build-time values frozen into HTML.
export const dynamic = 'force-dynamic';

export default async function IntegrationsPage(props: PageProps<'/integrations'>) {
  const sp = await props.searchParams;
  const connected = typeof sp.connected === 'string' ? sp.connected : undefined;
  const detail = typeof sp.detail === 'string' ? sp.detail : undefined;

  // One glanceable answer to "where do messages actually go right now?" — the
  // delivery-affecting switches live in three places, so they're surfaced here.
  const [channelSettings, sendMode] = await Promise.all([
    getChannelDeliverySettingsAction(),
    getSendMode(),
  ]);
  const smsMode = channelSettings.sms.mode;
  const waMode = channelSettings.whatsapp.mode;

  // Trigger mode rides on the already-verified LSQ integration, so it needs no
  // test of its own; a channel switched to Direct Gateway does, and its badge
  // must reflect that channel's own last real test result — not a blanket
  // "Active" regardless of whether direct delivery has ever been proven to work.
  const directChannels = [channelSettings.sms, channelSettings.whatsapp].filter((c) => c.mode === 'direct');
  const messagingBadge = directChannels.some((c) => c.lastTestOk === false)
    ? { color: 'error', text: 'Error' }
    : directChannels.some((c) => c.lastTestOk === null)
      ? { color: 'gray', text: 'Not tested yet' }
      : { color: 'success', text: 'Active (2 modes)' };

  const cards = await Promise.all(
    integrationsData.map(async (ig) => {
      const testResult = await getTestResult(ig.id);
      if (ig.id === 'messaging') {
        return {
          ig: {
            ...ig,
            lastOp: `SMS: ${smsMode === 'trigger' ? 'LSQ Automation' : 'Direct API'} · WA: ${waMode === 'trigger' ? 'LSQ Automation (Route Mobile)' : 'Direct API'}`,
            endpoint: 'Activity #302 / Direct Gateway REST API',
          },
          testResult,
          messagingBadge,
        };
      }
      return { ig, testResult, messagingBadge: null };
    })
  );
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
    { label: 'Email', value: `${sendMode}${sendMode === 'sandbox' ? ' → allowlisted lead' : ' (Direct to Leads)'}` },
    { label: 'SMS', value: smsMode === 'trigger' ? 'LSQ Automation (Trigger #302)' : 'Direct Gateway REST API' },
    { label: 'WhatsApp', value: waMode === 'trigger' ? 'LSQ Automation (Route Mobile #61182)' : 'Direct Gateway REST API' },
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

      <DeliverySettingsBar initialSendMode={sendMode} deliveryItems={delivery} />

      <LsqActivityMappingCard />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(288px, 1fr))', gap: 16 }}>

        {cards.map(({ ig, testResult, messagingBadge }) => (
          <IntegrationCard key={ig.id} ig={ig} testResult={testResult} messagingBadge={messagingBadge} />
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
