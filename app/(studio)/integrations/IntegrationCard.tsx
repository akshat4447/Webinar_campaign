'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Drawer, type DrawerContent } from '@/components/ui/Drawer';
import { Icon } from '@/components/ui/Icon';
import { IntegrationPanel } from './IntegrationPanel';
import { MessagingConfigModal } from './MessagingConfigModal';
import { SuppressionListModal } from './SuppressionListModal';
import { ResultBanner } from './ResultBanner';
import { integrationStatus, STATUS_BADGE, type IntegrationStatus } from './integrationStatus';
import { integrationsData } from '@/lib/demo-data';
import { getIntegrationLogAction } from '@/lib/actions/integrations';
import { formatLsqDateTime } from '@/lib/dateFormat';
import type { TestResult } from '@/lib/integrationConfig';

type Integration = (typeof integrationsData)[number];

// One sentence on what each service is for, so the card answers "why connect this" before any setting.
const USED_FOR: Record<string, string> = {
  lsq: 'Creates and updates leads, sends email and receives registration webhooks.',
  zoom: 'Creates webinar meetings and imports attendance once a session ends.',
  claude: 'Scores propensity, rewrites messages and infers attendee personas.',
  apollo: 'Fills missing contact emails and verifies LinkedIn profiles before outreach.',
  linkedin: 'Creates LinkedIn Events and streams registrations back with Lead Sync.',
  messaging: 'Delivers SMS and WhatsApp through LSQ Automation or a direct gateway.',
  netcore: 'Sends high-throughput email and returns delivery, bounce and click events.',
};

const ICON: Record<string, string> = {
  lsq: 'database',
  zoom: 'video',
  claude: 'sparkle',
  apollo: 'users',
  linkedin: 'linkedin',
  messaging: 'chat',
  netcore: 'mail',
};

export function IntegrationCard({
  ig,
  testResult,
  messagingBadge,
  status,
}: {
  ig: Integration;
  testResult: TestResult | null;
  messagingBadge?: { color: string; text: string } | null;
  /** Computed once on the page so the summary tiles and this badge agree. */
  status?: IntegrationStatus;
}) {
  const [drawer, setDrawer] = useState<DrawerContent | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [suppressionOpen, setSuppressionOpen] = useState(false);
  const router = useRouter();
  const panelId = useId();

  async function viewLog() {
    const entries = await getIntegrationLogAction(ig.id);
    setDrawer({
      title: `${ig.name} activity`,
      subtitle: `${entries.length} recent log entr${entries.length === 1 ? 'y' : 'ies'} mentioning ${ig.name}, across all campaigns`,
      columns: ['Campaign', 'Event', 'Time'],
      rows: entries.map((e) => [e.campaign, e.text, formatLsqDateTime(new Date(e.time))]),
      notes: entries.length === 0 ? [`No activity logged for ${ig.name} yet.`] : undefined,
    });
  }

  const resolved = status ?? integrationStatus({ id: ig.id, testResult, messagingBadge });
  const badge = STATUS_BADGE[resolved];
  const isMessaging = ig.id === 'messaging';
  // The inline panel is for connectors with plain credentials; SMS & WhatsApp has its own dialog.
  const inlinePanelOpen = panelOpen && !isMessaging;

  return (
    <article className="lsq-card lsq-int-card" aria-label={ig.name}>
      <div className="lsq-int-card__head">
        <span className="lsq-int-card__icon" aria-hidden="true">
          <Icon name={ICON[ig.id] ?? 'plug'} size={20} />
        </span>
        <div className="lsq-int-card__id">
          <h3 className="lsq-int-card__name">{ig.name}</h3>
          <p className="lsq-int-card__role">{ig.role}</p>
        </div>
        <Badge color={badge.color} text={badge.text} dot />
      </div>

      <div className="lsq-int-card__body">
        <p className="lsq-int-card__use">{USED_FOR[ig.id] ?? ig.role}</p>
        <p className="lsq-int-card__meta">Last operation: {ig.lastOp}</p>
        <div className="lsq-code lsq-code--wrap">{ig.endpoint}</div>
        {testResult && !testResult.ok && <ResultBanner tone="error" title="Last test failed">{testResult.detail}</ResultBanner>}
        {!testResult && ig.hasError && <ResultBanner tone="error">{ig.error}</ResultBanner>}
        <div className="lsq-int-card__actions">
          <button
            type="button"
            className={`lsq-btn lsq-btn--sm ${inlinePanelOpen ? 'lsq-btn--secondary-color' : 'lsq-btn--secondary'}`}
            aria-expanded={isMessaging ? undefined : inlinePanelOpen}
            aria-controls={inlinePanelOpen ? panelId : undefined}
            aria-haspopup={isMessaging ? 'dialog' : undefined}
            onClick={() => setPanelOpen((o) => (isMessaging ? true : !o))}
          >
            <Icon name={inlinePanelOpen ? 'chevron-up' : 'settings'} size={16} />
            Configure
          </button>
          {ig.id === 'netcore' && (
            <Button hierarchy="secondary" size="sm" icon={<Icon name="shield" size={16} />} onClick={() => setSuppressionOpen(true)}>
              Suppression List
            </Button>
          )}
          <Button hierarchy="tertiary" size="sm" icon={<Icon name="list" size={16} />} onClick={viewLog}>
            View Log
          </Button>
        </div>
      </div>

      {inlinePanelOpen && (
        <IntegrationPanel
          id={ig.id}
          name={ig.name}
          panelId={panelId}
          onClose={() => setPanelOpen(false)}
          onChanged={() => router.refresh()}
        />
      )}

      <Drawer content={drawer} onClose={() => setDrawer(null)} />
      {panelOpen && isMessaging && (
        <MessagingConfigModal onClose={() => setPanelOpen(false)} onChanged={() => router.refresh()} />
      )}
      {suppressionOpen && (
        <SuppressionListModal onClose={() => setSuppressionOpen(false)} onChanged={() => router.refresh()} />
      )}
    </article>
  );
}
