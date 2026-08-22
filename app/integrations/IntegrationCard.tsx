'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Drawer, type DrawerContent } from '@/components/ui/Drawer';
import { IntegrationPanel } from './IntegrationPanel';
import { integrationsData } from '@/lib/demo-data';
import { getIntegrationLogAction } from '@/lib/actions/integrations';
import type { TestResult } from '@/lib/integrationConfig';

type Integration = (typeof integrationsData)[number];

export function IntegrationCard({ ig, testResult }: { ig: Integration; testResult: TestResult | null }) {
  const [drawer, setDrawer] = useState<DrawerContent | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const router = useRouter();

  async function viewLog() {
    const entries = await getIntegrationLogAction(ig.id);
    setDrawer({
      title: `${ig.name} activity`,
      subtitle: `${entries.length} recent log entr${entries.length === 1 ? 'y' : 'ies'} mentioning ${ig.name}, across all campaigns`,
      columns: ['Campaign', 'Event', 'Time'],
      rows: entries.map((e) => [e.campaign, e.text, new Date(e.time).toLocaleString('en-GB', { hour12: false })]),
      notes: entries.length === 0 ? [`No activity logged for ${ig.name} yet.`] : undefined,
    });
  }

  // For connectors with real credential testing, the badge reflects the last
  // genuine test result rather than static demo data — "not tested yet" is
  // more honest than defaulting to a green badge nothing has actually proven.
  const badge = testResult
    ? testResult.ok
      ? { color: 'success', text: 'Connected' }
      : { color: 'error', text: 'Error' }
    : { color: 'gray', text: 'Not tested yet' };

  return (
    <div style={{ background: '#fff', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)', padding: '18px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: 'var(--radius-md)',
            background: ig.avatarBg,
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 14,
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          {ig.initial}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--n90)' }}>{ig.name}</div>
          <div style={{ fontSize: 11, color: 'var(--n60)' }}>{ig.role}</div>
        </div>
        <Badge color={testResult ? badge.color : ig.statusColor} text={testResult ? badge.text : ig.statusLabel} dot />
      </div>
      <div style={{ fontSize: 12, color: 'var(--n60)', marginBottom: 2, overflowWrap: 'anywhere' }}>Last operation: {ig.lastOp}</div>
      <div style={{ fontSize: 11, color: 'var(--n50)', fontFamily: 'monospace', marginBottom: 6, overflowWrap: 'anywhere' }}>{ig.endpoint}</div>
      {testResult && !testResult.ok && (
        <div style={{ fontSize: 12, color: 'var(--danger-500)', marginBottom: 8, overflowWrap: 'anywhere' }}>{testResult.detail}</div>
      )}
      {!testResult && ig.hasError && <div style={{ fontSize: 12, color: 'var(--danger-500)', marginBottom: 8 }}>{ig.error}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Button hierarchy="secondary" size="sm" fullWidth onClick={() => setPanelOpen(true)}>
            Configure
          </Button>
        </div>
        <Button hierarchy="tertiary" size="sm" onClick={viewLog}>
          View log
        </Button>
      </div>

      <Drawer content={drawer} onClose={() => setDrawer(null)} />
      {panelOpen && <IntegrationPanel id={ig.id} name={ig.name} onClose={() => setPanelOpen(false)} onChanged={() => router.refresh()} />}
    </div>
  );
}
