'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { type EnrichmentStats } from '@/lib/actions/enrichment';
import type { EnrichmentResult } from '@/lib/enrichment';
import { EnrichmentModerationModal } from '@/components/enrichment/EnrichmentModerationModal';

export function EnrichmentCard({ campaignId, stats }: { campaignId: string; stats: EnrichmentStats }) {
  const [modalOpen, setModalOpen] = useState(false);
  const [result, setResult] = useState<EnrichmentResult | null>(null);
  const router = useRouter();

  const gaps = stats.missingEmail + stats.missingTitle;
  const alreadyEnriched = stats.enriched > 0;

  return (
    <section className="lsq-card" aria-labelledby="enrichment-card-title">
      <div className="lsq-card__header">
        <div>
          <h2 className="lsq-card__title" id="enrichment-card-title">Enrichment</h2>
          <p className="lsq-card__sub">Fills the gaps in whatever the source data is missing.</p>
        </div>
        <div className="lsq-cluster">
          <Badge color="blue light" text="Apollo" />
          <Badge color="purple" text="Claude" />
        </div>
      </div>

      {stats.total === 0 ? (
        <div className="lsq-card__body">
          <p className="lsq-hint">Import contacts first. Enrichment fills the gaps in whatever the source data is missing.</p>
        </div>
      ) : (
        <>
          <div className="lsq-card__body lsq-stack">
            <div className="lsq-grid lsq-grid--narrow" role="group" aria-label="Enrichment coverage">
              <Stat label="Contacts" value={stats.total} />
              <Stat label="Missing email" value={stats.missingEmail} warn={stats.missingEmail > 0} />
              <Stat label="Missing title" value={stats.missingTitle} warn={stats.missingTitle > 0} />
              <Stat label="Enriched" value={stats.enriched} />
            </div>

            <p className="lsq-hint">
              Apollo fills in missing work emails with real people-match verification, while Claude normalizes titles into seniority brackets, infers account verticals and generates targeted persona hooks.
            </p>

            {result?.ok && (
              <div className="lsq-banner lsq-banner--success" role="status">
                <span className="lsq-banner__icon" aria-hidden="true"><Icon name="check-circle" size={16} /></span>
                <p className="lsq-banner__body">
                  Claude enriched {result.personasEnriched} personas
                  {!!result.emailsFoundReal && `. Apollo found ${result.emailsFoundReal} real email${result.emailsFoundReal === 1 ? '' : 's'}`}
                  {!!result.emailsInferred && `. Guessed ${result.emailsInferred} more (unverified)`}
                  {result.couldNotEnrich ? `. ${result.couldNotEnrich} too sparse to enrich` : ''}
                </p>
              </div>
            )}
            {result && !result.ok && (
              <div className="lsq-banner lsq-banner--error" role="alert">
                <span className="lsq-banner__icon" aria-hidden="true"><Icon name="error" size={16} /></span>
                <p className="lsq-banner__body">{result.error}</p>
              </div>
            )}

            {stats.inferredUnverified > 0 && (
              <div className="lsq-banner lsq-banner--warning">
                <span className="lsq-banner__icon" aria-hidden="true"><Icon name="warning" size={16} /></span>
                <div>
                  <p className="lsq-banner__title">
                    {stats.inferredUnverified} inferred email{stats.inferredUnverified === 1 ? '' : 's'} held back from sending
                  </p>
                  <p className="lsq-banner__body">
                    These were pattern-guessed from a name and company, not supplied by the source. A guessed address can belong to someone who never opted in. Verify them on the Audience tab before they can be sent to.
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="lsq-card__footer">
            <Button hierarchy={alreadyEnriched ? 'secondary' : 'primary'} icon={<Icon name="sparkle" size={16} />} onClick={() => setModalOpen(true)}>
              {alreadyEnriched
                ? 'Select Fields and Re-Run Enrichment'
                : `Select Fields and Run Enrichment${gaps ? ` (${gaps} gap${gaps === 1 ? '' : 's'})` : ''}`}
            </Button>
          </div>

          <EnrichmentModerationModal
            isOpen={modalOpen}
            onClose={() => setModalOpen(false)}
            campaignId={campaignId}
            onComplete={(res) => {
              setResult(res);
              router.refresh();
            }}
          />
        </>
      )}
    </section>
  );
}

function Stat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="lsq-wiz-stat" data-tone={warn ? 'warn' : undefined}>
      <p className="lsq-wiz-stat__label">{label}</p>
      <p className="lsq-wiz-stat__value">{value.toLocaleString()}</p>
    </div>
  );
}
