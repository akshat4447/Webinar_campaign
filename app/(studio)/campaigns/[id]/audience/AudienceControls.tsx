'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import { approveAboveThresholdAction } from '@/lib/actions/scoring';
import { EnrichmentModerationModal } from '@/components/enrichment/EnrichmentModerationModal';
import { LeadImportCard } from '../setup/LeadImportCard';
import { CampaignSuppressionModal } from '../cadence/CampaignSuppressionModal';

// Search, band filter and paging all live in the URL and are executed by the
// database, not by filtering an array in the browser. At the scale this is
// built for — thousands of contacts — shipping every row to the client and
// filtering there is what makes a page feel broken.

export interface Band {
  id: string;
  label: string;
  count: number;
  color: string;
}

export function AudienceControls({
  campaignId,
  q,
  band,
  bands,
  total,
  threshold,
  page,
  pageSize,
  shown,
  completed = false,
}: {
  campaignId: string;
  q: string;
  band: string;
  bands: Band[];
  total: number;
  threshold: number;
  page: number;
  pageSize: number;
  shown: number;
  completed?: boolean;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [draft, setDraft] = useState(q);
  const [busy, setBusy] = useState(false);
  const [enrichModalOpen, setEnrichModalOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [confirmingApprove, setConfirmingApprove] = useState(false);
  const [suppressionModalOpen, setSuppressionModalOpen] = useState(false);

  const scoredTotal = bands.reduce((a, b) => a + b.count, 0);

  async function approveAboveThreshold() {
    setBusy(true);
    try {
      const r = await approveAboveThresholdAction(campaignId);
      showToast(`${r.approved.toLocaleString()} contact${r.approved === 1 ? '' : 's'} approved at ${threshold} and above.`);
      router.refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to approve contacts');
    } finally {
      setBusy(false);
    }
  }

  function navigate(next: Record<string, string>) {
    const params = new URLSearchParams({ ...(q ? { q } : {}), ...(band !== 'all' ? { band } : {}), ...next });
    if (params.get('page') === '0') params.delete('page');
    router.push(`/campaigns/${campaignId}/audience${params.toString() ? `?${params}` : ''}`);
  }

  const from = total === 0 ? 0 : page * pageSize + 1;
  const to = page * pageSize + shown;

  const filters = [{ id: 'all', label: `All ${total.toLocaleString()}` }, ...bands.map((b) => ({ id: b.id, label: `${b.label} (${b.count.toLocaleString()})` }))];

  return (
    <>
      {!completed && importOpen && <LeadImportCard campaignId={campaignId} existingContactCount={total} existingScoredCount={scoredTotal} />}

      {scoredTotal > 0 && (
        <section className="lsq-card" aria-labelledby="aud-distribution">
          <div className="lsq-card__header">
            <h2 className="lsq-card__title" id="aud-distribution">Score Distribution</h2>
            {!completed && (
              <Button size="sm" disabled={busy} onClick={() => setConfirmingApprove(true)}>
                Approve All ({threshold}+)
              </Button>
            )}
          </div>
          <div className="lsq-card__body lsq-stack">
            <div className="lsq-ov-dist" role="img" aria-label={`Score distribution: ${bands.map((b) => `${b.label} ${b.count.toLocaleString()}`).join(', ')}`}>
              {bands.map((b) => (
                <span key={b.id} title={`${b.label}: ${b.count}`} style={{ width: `${scoredTotal ? (b.count / scoredTotal) * 100 : 0}%`, background: b.color }} />
              ))}
            </div>
            <ul className="lsq-ov-legend">
              {bands.map((b) => (
                <li key={b.id}>
                  <span className="lsq-ov-legend__dot" style={{ background: b.color }} aria-hidden="true" />
                  <strong>{b.count.toLocaleString()}</strong>
                  <span className="lsq-ov-subtle">{b.label}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <div className="lsq-toolbar">
        <div className="lsq-toolbar__group lsq-grow">
          <form
            className="lsq-ov-filter-form"
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              navigate({ q: draft, page: '0' });
            }}
          >
            <div className="lsq-search">
              <Icon name="search" size={16} />
              <input
                className="lsq-input"
                type="search"
                aria-label="Search contacts"
                placeholder="Search name, title or account"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
            </div>
            <Button type="submit" hierarchy="secondary">
              Search
            </Button>
          </form>
          <div className="lsq-segmented lsq-ov-bands" role="group" aria-label="Filter by score band">
            {filters.map((f) => (
              <button key={f.id} type="button" aria-pressed={f.id === band} onClick={() => navigate({ band: f.id, page: '0' })}>
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {!completed && (
          <div className="lsq-toolbar__group">
            <Button hierarchy="secondary" icon={<Icon name={importOpen ? 'close' : 'plus'} size={16} />} onClick={() => setImportOpen((prev) => !prev)}>
              {importOpen ? 'Close Import' : 'Import Contacts'}
            </Button>
            {total > 0 && (
              <Button hierarchy="secondary" icon={<Icon name="sparkle" size={16} />} onClick={() => setEnrichModalOpen(true)}>
                Select Fields &amp; Enrich Leads
              </Button>
            )}
            <Button
              hierarchy="secondary"
              icon={<Icon name="shield" size={16} />}
              onClick={() => setSuppressionModalOpen(true)}
              title="Manage competitor domains and excluded leads for this webinar"
            >
              Exclusions
            </Button>
          </div>
        )}
      </div>

      {total > pageSize && (
        <div className="lsq-ov-pager">
          <span className="lsq-ov-muted lsq-num">
            Showing {from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()}
          </span>
          <div className="lsq-cluster">
            <Button hierarchy="secondary" size="sm" icon={<Icon name="chevron-left" size={14} />} disabled={page === 0} onClick={() => navigate({ page: String(page - 1) })}>
              Previous
            </Button>
            <Button hierarchy="secondary" size="sm" icon={<Icon name="chevron-right" size={14} />} iconPosition="trailing" disabled={to >= total} onClick={() => navigate({ page: String(page + 1) })}>
              Next
            </Button>
          </div>
        </div>
      )}

      {!completed && confirmingApprove && (
        <ConfirmDialog
          title="Approve All Contacts Above Threshold?"
          message={`This approves every scored contact at or above ${threshold} that isn't already approved or manually rejected. Approvals a human already set by hand are left as-is.`}
          confirmLabel="Approve All"
          busy={busy}
          onConfirm={() => {
            setConfirmingApprove(false);
            void approveAboveThreshold();
          }}
          onClose={() => setConfirmingApprove(false)}
        />
      )}

      {!completed && (
        <EnrichmentModerationModal
          isOpen={enrichModalOpen}
          onClose={() => setEnrichModalOpen(false)}
          campaignId={campaignId}
          onComplete={() => router.refresh()}
        />
      )}

      {suppressionModalOpen && (
        <CampaignSuppressionModal
          campaignId={campaignId}
          campaignName="This Webinar"
          onClose={() => setSuppressionModalOpen(false)}
          onChanged={() => router.refresh()}
        />
      )}
    </>
  );
}
