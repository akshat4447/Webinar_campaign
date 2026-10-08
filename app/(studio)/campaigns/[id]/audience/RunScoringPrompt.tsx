'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { runScoringAction } from '@/lib/actions/scoring';
import { EnrichmentModerationModal } from '@/components/enrichment/EnrichmentModerationModal';
import { LeadImportCard } from '../setup/LeadImportCard';

export function RunScoringPrompt({ campaignId, contactCount }: { campaignId: string; contactCount: number }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enrichModalOpen, setEnrichModalOpen] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const router = useRouter();

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await runScoringAction(campaignId);
      if (!res.ok) setError(res.error ?? 'Scoring failed.');
      else router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scoring failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="lsq-page lsq-page--narrow">
      <header className="lsq-page-header">
        <div className="lsq-page-header__text">
          <p className="lsq-page-header__eyebrow">Audience</p>
          <h1 className="lsq-page-header__title">Score Audience</h1>
        </div>
      </header>

      {showImport && <LeadImportCard campaignId={campaignId} existingContactCount={contactCount} existingScoredCount={0} />}

      <div className="lsq-card">
        <div className="lsq-empty">
          <span className="lsq-empty__icon" aria-hidden="true">
            <Icon name="sparkle" size={24} />
          </span>
          <h2 className="lsq-empty__title">Ready To Score {contactCount.toLocaleString()} Contacts</h2>
          <p className="lsq-empty__body">
            Claude scores every imported contact against this webinar&apos;s topic and persona criteria. Missing fields (work email, job title, company grounding) can be enriched selectively before scoring.
          </p>
          {error && <p className="lsq-error" role="alert">{error}</p>}
          <div className="lsq-ov-empty-actions">
            <Button onClick={run} loading={busy} icon={<Icon name="sparkle" size={16} />}>
              {busy ? 'Scoring…' : 'Run Audience Scoring'}
            </Button>
            <Button hierarchy="secondary" onClick={() => setEnrichModalOpen(true)} disabled={busy}>
              Select Fields &amp; Enrich
            </Button>
            <Button hierarchy="tertiary" onClick={() => setShowImport((s) => !s)} disabled={busy} icon={<Icon name={showImport ? 'close' : 'plus'} size={16} />}>
              {showImport ? 'Hide Import' : 'Add Contacts'}
            </Button>
          </div>
        </div>
      </div>

      <EnrichmentModerationModal
        isOpen={enrichModalOpen}
        onClose={() => setEnrichModalOpen(false)}
        campaignId={campaignId}
        onComplete={() => router.refresh()}
      />
    </div>
  );
}
