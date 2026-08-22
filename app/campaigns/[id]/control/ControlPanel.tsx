'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { togglePauseResumeAction, stopCadenceAction, retryFailedSendsAction, resolveAttentionAction } from '@/lib/actions/control';
import type { Campaign, AttentionItem } from '@/lib/generated/prisma/client';

const actionLabel: Record<string, string> = { retry: 'Retry', skip: 'Skip', fix: 'Fix configuration', view: 'View details' };

export function ControlPanel({ campaign, attentionItems: initialItems, nextSendDueAt }: { campaign: Campaign; attentionItems: AttentionItem[]; nextSendDueAt: string | null }) {
  const [status, setStatus] = useState(campaign.cadenceStatus);
  const [items, setItems] = useState(initialItems);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  const badge =
    status === 'paused'
      ? { color: 'warning', text: 'Cadence paused' }
      : status === 'stopped'
      ? { color: 'error', text: 'Cadence stopped' }
      : status === 'running'
      ? { color: 'success', text: 'Cadence live' }
      : { color: 'gray', text: 'Not yet launched' };

  async function pauseResume() {
    setBusy(true);
    await togglePauseResumeAction(campaign.id);
    setStatus((s) => (s === 'running' ? 'paused' : 'running'));
    setBusy(false);
  }

  async function stop() {
    setBusy(true);
    await stopCadenceAction(campaign.id);
    setStatus('stopped');
    setBusy(false);
  }

  async function retry() {
    setBusy(true);
    await retryFailedSendsAction(campaign.id);
    setBusy(false);
    router.refresh();
  }

  async function resolve(id: string, action: string) {
    // "Fix configuration" takes you to the thing that needs fixing rather than
    // dismissing the card — the underlying config issue isn't resolved by looking away.
    if (action === 'fix') {
      router.push(`/campaigns/${campaign.id}/scoring`);
      return;
    }
    setItems((its) => its.filter((it) => it.id !== id));
    if (action === 'retry') await retryFailedSendsAction(campaign.id);
    await resolveAttentionAction(id, campaign.id);
    router.refresh();
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ background: '#fff', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)', padding: '18px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--n90)' }}>Campaign control</div>
          <Badge color={badge.color} text={badge.text} dot />
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Button hierarchy="secondary" size="sm" onClick={pauseResume} disabled={busy || status === 'not_started' || status === 'stopped'}>
            {status === 'running' ? 'Pause' : 'Resume'}
          </Button>
          <Button hierarchy="destructive-outline" size="sm" onClick={stop} disabled={busy || status === 'stopped'}>
            Stop
          </Button>
          <Button hierarchy="tertiary" size="sm" onClick={retry} disabled={busy}>
            Retry failed sends
          </Button>
          <Button hierarchy="tertiary" size="sm" onClick={() => router.push(`/campaigns/${campaign.id}/schedule`)}>
            Reschedule
          </Button>
        </div>
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border-subtle)' }}>
          <div style={{ fontSize: 12, color: 'var(--n60)', marginBottom: 4 }}>Next automated action</div>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--n90)' }}>
            {nextSendDueAt ? `Send due ${new Date(nextSendDueAt).toLocaleString('en-GB', { hour12: false })}` : 'Nothing queued'}
          </div>
        </div>
      </div>

      <div style={{ background: '#fff', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)', padding: '18px 20px' }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--n90)', marginBottom: 4 }}>Needs attention</div>
        <div style={{ fontSize: 12, color: 'var(--n60)', marginBottom: 14 }}>{items.length} item(s) need review</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {items.map((na) => (
            <div key={na.id} style={{ display: 'flex', gap: 12, alignItems: 'start', padding: '12px 14px', borderRadius: 'var(--radius-md)', background: 'var(--n10)' }}>
              <Icon name={na.icon} size={16} style={{ color: na.color === 'error' ? 'var(--danger-500)' : 'var(--warning-700)', flexShrink: 0, marginTop: 1 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--n90)', marginBottom: 2 }}>{na.title}</div>
                <div style={{ fontSize: 12, color: 'var(--n60)', lineHeight: 1.5, marginBottom: 8, overflowWrap: 'anywhere' }}>{na.detail}</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {na.actionsCsv.split(',').map((a) => (
                    <Button key={a} hierarchy="tertiary" size="sm" onClick={() => resolve(na.id, a)}>
                      {actionLabel[a] ?? a}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          ))}
          {items.length === 0 && <div style={{ fontSize: 12.5, color: 'var(--n60)', padding: '8px 0' }}>Nothing needs attention right now.</div>}
        </div>
      </div>
    </div>
  );
}
