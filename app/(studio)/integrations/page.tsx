import { IntegrationCard } from './IntegrationCard';
import { LsqActivityMappingCard } from './LsqActivityMappingCard';
import { ConnectResultBanner } from './ConnectResultBanner';
import { DeliverySettingsBar } from './DeliverySettingsBar';
import { integrationsData } from '@/lib/demo-data';
import { getTestResult } from '@/lib/integrationConfig';
import { getChannelDeliverySettingsAction } from '@/lib/actions/integrations';
import { zoomIsConfigured } from '@/lib/zoom/client';
import { linkedinIsConfigured } from '@/lib/linkedin/client';
import { getDefaultEmailProviderAction } from '@/lib/actions/netcore';
import { Badge } from '@/components/ui/Badge';
import { integrationStatus, type IntegrationStatus } from './integrationStatus';

// Reads live DB credentials/test-results on every request — this page must
// NEVER be statically prerendered with build-time values frozen into HTML.
export const dynamic = 'force-dynamic';

export default async function IntegrationsPage(props: PageProps<'/integrations'>) {
  const sp = await props.searchParams;
  const connected = typeof sp.connected === 'string' ? sp.connected : undefined;
  const detail = typeof sp.detail === 'string' ? sp.detail : undefined;

  // One glanceable answer to "where do messages actually go right now?" — the
  // delivery-affecting switches live in three places, so they're surfaced here.
  const [channelSettings, defaultEmailProvider] = await Promise.all([
    getChannelDeliverySettingsAction(),
    getDefaultEmailProviderAction(),
  ]);
  const smsMode = channelSettings.sms.mode;
  const waMode = channelSettings.whatsapp.mode;

  // Selecting automation proves routing intent, not gateway or handset delivery.
  const directChannels = [channelSettings.sms, channelSettings.whatsapp].filter((c) => c.mode === 'direct');
  const messagingBadge = directChannels.some((c) => c.lastTestOk === false)
    ? { color: 'error', text: 'Error' }
    : smsMode === 'trigger' || waMode === 'trigger'
      ? { color: 'gray', text: 'Automation selected' }
      : directChannels.some((c) => c.lastTestOk === null)
        ? { color: 'gray', text: 'Not tested yet' }
        : { color: 'success', text: 'Gateway tests passed' };

  const cards = await Promise.all(
    integrationsData.map(async (ig) => {
      const testResult = await getTestResult(ig.id);
      if (ig.id === 'messaging') {
        return {
          ig: {
            ...ig,
            lastOp: `SMS: ${smsMode === 'trigger' ? 'LSQ Automation' : 'Direct API'} · WA: ${waMode === 'trigger' ? 'LSQ Automation' : 'Direct API'}`,
            endpoint: 'Configured CRM activity / Direct Gateway REST API',
          },
          testResult,
          messagingBadge,
        };
      }
      return { ig, testResult, messagingBadge: null };
    })
  );
  const liConnected = await linkedinIsConfigured();
  const zoomConnected = await zoomIsConfigured();
  const zoomAutosyncOn = process.env.ZOOM_AUTOSYNC === '1' || process.env.ZOOM_AUTOSYNC === 'true';
  const zoomValue = !zoomConnected ? 'Not connected. Use Connect with Zoom.' : zoomAutosyncOn ? 'Connected. Automatic synchronization enabled.' : 'Connected. Use scheduled synchronization.';
  const liValue = !liConnected ? 'Not connected. Use Connect with LinkedIn.' : 'Events API connected; outreach is assisted.';
  const delivery = [
    {
      label: 'Email',
      value: `Sent to selected recipients. Gateway: ${defaultEmailProvider === 'netcore' ? 'Netcore Cloud' : 'LeadSquared CRM'}`,
    },
    { label: 'SMS', value: smsMode === 'trigger' ? 'LSQ Automation (configured activity)' : 'Direct Gateway REST API' },
    { label: 'WhatsApp', value: waMode === 'trigger' ? 'LSQ Automation (configured activity)' : 'Direct Gateway REST API' },
    { label: 'LinkedIn', value: liValue },
    { label: 'Zoom', value: zoomValue },
  ];

  const statuses = cards.map((c) =>
    integrationStatus({
      id: c.ig.id,
      testResult: c.testResult,
      messagingBadge: c.messagingBadge,
      oauthConnected: (c.ig.id === 'zoom' && zoomConnected) || (c.ig.id === 'linkedin' && liConnected),
    })
  );
  const statusById = Object.fromEntries(cards.map((c, i) => [c.ig.id, statuses[i]])) as Record<string, IntegrationStatus>;
  const connectedCount = statuses.filter((s) => s === 'connected').length;
  const setupCount = statuses.filter((s) => s === 'setup').length;
  const errorCount = statuses.filter((s) => s === 'error').length;

  const outreachCards = cards.filter((c) => ['lsq', 'netcore', 'messaging'].includes(c.ig.id));
  const aiCards = cards.filter((c) => ['claude', 'apollo'].includes(c.ig.id));
  const sessionCards = cards.filter((c) => ['zoom', 'linkedin'].includes(c.ig.id));

  const sections = [
    {
      id: 'int-outreach',
      title: 'Outreach and Email Gateways',
      sub: 'Transactional and bulk dispatch engines for email, SMS and WhatsApp.',
      items: outreachCards,
    },
    {
      id: 'int-ai',
      title: 'AI and Contact Enrichment',
      sub: 'Apollo email reveal, plus Claude propensity scoring, rewrites and attendee persona inference.',
      items: aiCards,
    },
    {
      id: 'int-sessions',
      title: 'Webinar Sessions and Social Events',
      sub: 'Live meeting room creation, attendee sync and official LinkedIn events.',
      items: sessionCards,
    },
  ];

  return (
    <main style={{ flex: 1, overflowY: 'auto' }}>
      <div className="lsq-page">
        <header className="lsq-page-header">
          <div className="lsq-page-header__text">
            <p className="lsq-page-header__eyebrow">Settings</p>
            <h1 className="lsq-page-header__title">Integrations</h1>
            <p className="lsq-page-header__sub">Manage the external services and delivery gateways connected to webinar campaigns.</p>
          </div>
          <div className="lsq-page-header__actions">
            <Badge color={connectedCount === cards.length ? 'success' : 'blue light'} text={`${connectedCount} of ${cards.length} services connected`} />
          </div>
        </header>

        <ConnectResultBanner connected={connected} detail={detail} />

        <DeliverySettingsBar deliveryItems={delivery} />

        <section className="lsq-int-summary" aria-label="Connection summary">
          <div className="lsq-card lsq-stat">
            <p className="lsq-stat__label">Connected</p>
            <p className="lsq-stat__value">{connectedCount.toLocaleString()}</p>
            <p className="lsq-stat__note">of {cards.length.toLocaleString()} services</p>
          </div>
          <div className="lsq-card lsq-stat">
            <p className="lsq-stat__label">Needs setup</p>
            <p className="lsq-stat__value">{setupCount.toLocaleString()}</p>
            <p className="lsq-stat__note">Credentials missing or untested</p>
          </div>
          <div className="lsq-card lsq-stat">
            <p className="lsq-stat__label">Errors</p>
            <p className={`lsq-stat__value${errorCount > 0 ? ' lsq-stat__note--down' : ''}`}>{errorCount.toLocaleString()}</p>
            <p className="lsq-stat__note">Last test failed</p>
          </div>
        </section>

        <LsqActivityMappingCard />

        {sections.map((sec) => (
          <section key={sec.id} className="lsq-int-section" aria-labelledby={sec.id}>
            <div>
              <h2 className="lsq-int-section__title" id={sec.id}>{sec.title}</h2>
              <p className="lsq-int-section__sub">{sec.sub}</p>
            </div>
            <div className="lsq-int-grid">
              {sec.items.map(({ ig, testResult, messagingBadge }) => (
                <IntegrationCard
                  key={ig.id}
                  ig={ig}
                  testResult={testResult}
                  messagingBadge={messagingBadge}
                  status={statusById[ig.id]}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
