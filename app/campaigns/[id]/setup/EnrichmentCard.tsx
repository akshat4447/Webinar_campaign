'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { runEnrichmentAction, type EnrichmentStats } from '@/lib/actions/enrichment';
import type { EnrichmentResult } from '@/lib/enrichment';

export function EnrichmentCard({ campaignId, stats }: { campaignId: string; stats: EnrichmentStats }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<EnrichmentResult | null>(null);
  const router = useRouter();

  async function run() {
    setBusy(true);
    setResult(null);
    try {
      const res = await runEnrichmentAction(campaignId);
      setResult(res);
      if (res.ok) router.refresh();
    } catch (err) {
      setResult({ ok: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  const gaps = stats.missingEmail + stats.missingTitle;
  const alreadyEnriched = stats.enriched > 0;

  return (
    <div style={{ background: '#fff', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)', padding: '18px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12 }}>
        <div style={{ fontSize: 'var(--fs-body)', fontWeight: 700, color: 'var(--n90)' }}>Enrichment</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <Badge color="blue light" text="Apollo" />
          <Badge color="blue light" text="Claude" />
        </div>
      </div>

      {stats.total === 0 ? (
        <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--n60)' }}>Import contacts first — enrichment fills the gaps in whatever the source data is missing.</div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 20, marginBottom: 14, flexWrap: 'wrap' }}>
            <Stat label="Contacts" value={stats.total} />
            <Stat label="Missing email" value={stats.missingEmail} warn={stats.missingEmail > 0} />
            <Stat label="Missing title" value={stats.missingTitle} warn={stats.missingTitle > 0} />
            <Stat label="Enriched" value={stats.enriched} />
          </div>

          <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--n60)', lineHeight: 1.55, marginBottom: 14 }}>
            Claude normalizes messy titles into function + seniority, infers each account&apos;s vertical, and writes a persona
            note. Apollo fills in missing contact details.
          </div>

          {result?.ok && (
            <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--success-700)', lineHeight: 1.6, marginBottom: 12 }}>
              ✓ Claude enriched {result.personasEnriched} personas · Apollo inferred {result.emailsInferred} email
              {result.emailsInferred === 1 ? '' : 's'}
              {result.couldNotEnrich ? ` · ${result.couldNotEnrich} too sparse to enrich` : ''}
            </div>
          )}
          {result && !result.ok && <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--danger-500)', marginBottom: 12 }}>{result.error}</div>}

          {stats.inferredUnverified > 0 && (
            <div style={{ display: 'flex', gap: 10, background: 'var(--warning-100)', borderRadius: 'var(--radius-md)', padding: '12px 14px', marginBottom: 14 }}>
              <Icon name="InformationProperty1Outline" size={16} style={{ color: 'var(--warning-700)', flexShrink: 0, marginTop: 1 }} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 'var(--fs-label-1)', fontWeight: 700, color: 'var(--warning-700)', marginBottom: 2 }}>
                  {stats.inferredUnverified} inferred email{stats.inferredUnverified === 1 ? '' : 's'} held back from sending
                </div>
                <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--n70)', lineHeight: 1.5 }}>
                  These were pattern-guessed from a name and company, not supplied by the source. A guessed address can belong to
                  someone who never opted in — verify them on the Scoring tab before they can be sent to.
                </div>
              </div>
            </div>
          )}

          <Button hierarchy={alreadyEnriched ? 'secondary' : 'primary'} size="md" fullWidth onClick={run} disabled={busy}>
            {busy ? 'Enriching…' : alreadyEnriched ? 'Re-run enrichment' : `Run enrichment${gaps ? ` on ${gaps} gap${gaps === 1 ? '' : 's'}` : ''}`}
          </Button>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 'var(--fs-label-2)', fontWeight: 600, color: 'var(--n60)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>{label}</div>
      <div style={{ fontSize: 'var(--fs-heading-4)', fontWeight: 700, color: warn ? 'var(--warning-700)' : 'var(--n90)', marginTop: 2 }}>{value}</div>
    </div>
  );
}
