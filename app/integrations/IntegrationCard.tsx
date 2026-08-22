'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Drawer, type DrawerContent } from '@/components/ui/Drawer';
import { integrationsData } from '@/lib/demo-data';
import { testIntegrationAction, getIntegrationLogAction } from '@/lib/actions/integrations';

type Integration = (typeof integrationsData)[number];

export function IntegrationCard({ ig }: { ig: Integration }) {
  const [state, setState] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');
  const [detail, setDetail] = useState('');
  const [drawer, setDrawer] = useState<DrawerContent | null>(null);

  async function test() {
    setState('testing');
    const res = await testIntegrationAction(ig.id);
    setDetail(res.detail);
    setState(res.ok ? 'ok' : 'fail');
  }

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

  const testable = ig.id === 'lsq' || ig.id === 'claude' || ig.id === 'apollo';

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
        <Badge color={ig.statusColor} text={ig.statusLabel} dot />
      </div>
      <div style={{ fontSize: 12, color: 'var(--n60)', marginBottom: 2, overflowWrap: 'anywhere' }}>Last operation: {ig.lastOp}</div>
      <div style={{ fontSize: 11, color: 'var(--n50)', fontFamily: 'monospace', marginBottom: 6, overflowWrap: 'anywhere' }}>{ig.endpoint}</div>
      {ig.hasError && <div style={{ fontSize: 12, color: 'var(--danger-500)', marginBottom: 8 }}>{ig.error}</div>}
      {state !== 'idle' && (
        <div style={{ fontSize: 12, fontWeight: 600, color: state === 'fail' ? 'var(--danger-500)' : 'var(--success-700)', marginBottom: 8, overflowWrap: 'anywhere' }}>
          {state === 'testing' ? 'Opening connection…' : detail}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Button hierarchy="secondary" size="sm" fullWidth disabled={!testable} onClick={test}>
            {!testable ? 'Demo mode' : state === 'testing' ? 'Testing…' : state === 'idle' ? 'Test connection' : 'Test again'}
          </Button>
        </div>
        <Button hierarchy="tertiary" size="sm" onClick={viewLog}>
          View log
        </Button>
      </div>

      <Drawer content={drawer} onClose={() => setDrawer(null)} />
    </div>
  );
}
