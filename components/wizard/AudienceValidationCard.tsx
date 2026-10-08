'use client';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import type { AudiencePreflightValidation } from '@/lib/actions/wizard';

interface AudienceValidationCardProps {
  validation: AudiencePreflightValidation;
  onOpenExclusions?: () => void;
}

export function AudienceValidationCard({ validation, onOpenExclusions }: AudienceValidationCardProps) {
  const {
    total,
    verifiedWorkEmailCount,
    missingEmailCount,
    emailHealthPercent,
    linkedinProfileCount,
    linkedinHealthPercent,
    titleAndSeniorityCount,
    titleHealthPercent,
    duplicateCount,
    suppressedCount,
    cleanReadyCount,
  } = validation;
  const filtered = duplicateCount + suppressedCount;

  return (
    <section className="lsq-card" aria-labelledby="audience-validation-title">
      <div className="lsq-card__header">
        <div>
          <div className="lsq-cluster">
            <h2 className="lsq-card__title" id="audience-validation-title">Audience Quality and Validation</h2>
            <Badge color={cleanReadyCount > 0 ? 'green' : 'amber'} text={`${cleanReadyCount.toLocaleString()} send-ready`} />
          </div>
          <p className="lsq-card__sub">Preflight check across emails, professional profiles, job hierarchy and suppressions.</p>
        </div>
        <div className="lsq-cluster">
          <span className="lsq-hint">{total.toLocaleString()} total contacts</span>
          {onOpenExclusions && (
            <Button
              hierarchy="secondary"
              size="sm"
              icon={<Icon name="shield" size={14} />}
              onClick={onOpenExclusions}
              title="Add competitor domains or custom exclusions to this webinar"
            >
              Webinar Exclusions{suppressedCount > 0 ? ` (${suppressedCount})` : ''}
            </Button>
          )}
        </div>
      </div>

      <div className="lsq-card__body lsq-stack">
        <div className="lsq-grid lsq-grid--narrow" role="group" aria-label="Audience quality summary">
          <div className="lsq-wiz-stat">
            <p className="lsq-wiz-stat__label">
              Verified email
              <span className="lsq-wiz-stat__pct" data-tone={emailHealthPercent >= 80 ? 'success' : 'warn'}>{emailHealthPercent}%</span>
            </p>
            <p className="lsq-wiz-stat__value">{verifiedWorkEmailCount.toLocaleString()}</p>
            <p className="lsq-wiz-stat__note">
              {missingEmailCount > 0 ? `${missingEmailCount.toLocaleString()} missing or unverified` : 'All emails valid and corporate'}
            </p>
          </div>

          <div className="lsq-wiz-stat">
            <p className="lsq-wiz-stat__label">
              LinkedIn profile
              <span className="lsq-wiz-stat__pct" data-tone={linkedinHealthPercent >= 60 ? 'accent' : 'warn'}>{linkedinHealthPercent}%</span>
            </p>
            <p className="lsq-wiz-stat__value">{linkedinProfileCount.toLocaleString()}</p>
            <p className="lsq-wiz-stat__note">
              {linkedinProfileCount === total ? 'All profiles matched' : `${(total - linkedinProfileCount).toLocaleString()} missing URLs`}
            </p>
          </div>

          <div className="lsq-wiz-stat">
            <p className="lsq-wiz-stat__label">
              Title and seniority
              <span className="lsq-wiz-stat__pct" data-tone={titleHealthPercent >= 80 ? 'success' : 'warn'}>{titleHealthPercent}%</span>
            </p>
            <p className="lsq-wiz-stat__value">{titleAndSeniorityCount.toLocaleString()}</p>
            <p className="lsq-wiz-stat__note">Role and hierarchy resolved</p>
          </div>

          <div className="lsq-wiz-stat" data-tone={filtered > 0 ? 'warn' : undefined}>
            <p className="lsq-wiz-stat__label">
              Filtered out
              <span className="lsq-wiz-stat__pct" data-tone={filtered > 0 ? 'warn' : 'success'}>{filtered === 0 ? '0 issues' : 'Filtered'}</span>
            </p>
            <p className="lsq-wiz-stat__value">{filtered.toLocaleString()}</p>
            <p className="lsq-wiz-stat__note">
              {duplicateCount} duplicate{duplicateCount === 1 ? '' : 's'} | {suppressedCount} suppressed
            </p>
          </div>
        </div>

        <div className="lsq-banner lsq-banner--neutral">
          <span className="lsq-banner__icon" aria-hidden="true"><Icon name="info" size={16} /></span>
          <p className="lsq-banner__body">
            Suppressed and duplicate emails are automatically skipped from the outreach cadence to protect sender reputation.
          </p>
        </div>
      </div>
    </section>
  );
}
