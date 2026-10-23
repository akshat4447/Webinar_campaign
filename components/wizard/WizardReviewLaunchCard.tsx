'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/Toast';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { launchCadenceAction, getLaunchReadinessAction } from '@/lib/actions/schedule';
import { getRegistrationOverviewAction } from '@/lib/actions/registration';
import { ExternalRegistrationSetup, type SetupChannelLink } from '@/components/registration/ExternalRegistrationSetup';
import type { Readiness } from '@/lib/registrationReadiness';
import type { WizardCadenceStep } from './WizardCadenceSetupCard';
import {
  approveAllCleanContactsAction,
  updateWizardFunnelModeAction,
  type WizardFieldMapping,
  type AudiencePreflightValidation,
} from '@/lib/actions/wizard';
import type { SpeakerInput } from '@/lib/speakerUtils';
import {
  buildNormalChannelRegistrationLinks,
  generateFramerEmbedScript,
} from '@/lib/landingPage';
import { buildCalendarUrls, type CalendarUrls } from '@/lib/calendar';
import { DEFAULT_TIMEZONE, formatLsqDateTime, timeZoneLabel, wallClockToDate } from '@/lib/dateFormat';

interface WizardReviewLaunchCardProps {
  campaignId: string;
  webinarTitle: string;
  webinarDate?: string;
  webinarTime?: string;
  scheduledAt?: string;
  timezone?: string;
  durationMinutes?: number;
  initialOrigin?: string;
  description?: string;
  capacity?: string;
  registrationLink?: string;
  zoomLink?: string;
  zoomMeetingId?: string;
  speakers?: SpeakerInput[];
  validation: AudiencePreflightValidation;
  approvedCount: number;
  fieldMappings: WizardFieldMapping[];
  activeSteps: WizardCadenceStep[];
  msgMode: 'ai' | 'templatized';
  tone: string;
  msgLength: string;
  brief: string;
  onApprovedCountChange?: (count: number) => void;
  /** Goes back to Step 1, where the registration page is chosen. */
  onChangeRegistration?: () => void;
}

export function WizardReviewLaunchCard({
  campaignId,
  webinarTitle,
  webinarDate,
  webinarTime,
  scheduledAt,
  timezone = DEFAULT_TIMEZONE,
  durationMinutes = 60,
  initialOrigin,
  description,
  capacity,
  registrationLink,
  zoomLink,
  zoomMeetingId,
  speakers = [],
  validation,
  approvedCount,
  fieldMappings,
  activeSteps,
  msgMode,
  tone,
  msgLength,
  brief,
  onApprovedCountChange,
  onChangeRegistration,
}: WizardReviewLaunchCardProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const [launching, setLaunching] = useState(false);
  const [approving, setApproving] = useState(false);
  const [currentApprovedCount, setCurrentApprovedCount] = useState(approvedCount);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  // Funnel & Calendar Integration State
  // How people register is chosen once, in Step 1; this step only reflects it.
  const currentLandingLink = (registrationLink ?? '').trim();
  const funnelMode: 'normal' | 'framer' = currentLandingLink ? 'framer' : 'normal';
  const [sharedLinks, setSharedLinks] = useState<SetupChannelLink[] | undefined>(undefined);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Registration readiness comes from the same rules the workspace uses, evaluated
  // against what is actually saved, so this card cannot claim "armed" for a setup that is broken.
  const [registrationReadiness, setRegistrationReadiness] = useState<Readiness | null>(null);
  const readinessKey = JSON.stringify({ campaignId, currentApprovedCount, registrationLink, activeSteps });
  const [readinessResult, setReadinessResult] = useState<{ key: string; ok: boolean; problems: string[] } | null>(null);
  const launchReadiness = readinessResult?.key === readinessKey ? readinessResult : null;
  useEffect(() => {
    let active = true;
    getLaunchReadinessAction(campaignId)
      .then(res => { if (active) setReadinessResult({ ...res, key: readinessKey }); })
      .catch(() => { if (active) setReadinessResult({ key: readinessKey, ok: false, problems: ['Could not verify launch readiness. Reload to retry.'] }); });
    return () => { active = false; };
  }, [campaignId, readinessKey]);

  useEffect(() => {
    let cancelled = false;
    getRegistrationOverviewAction(campaignId)
      .then((res) => {
        if (cancelled || 'error' in res) return;
        setRegistrationReadiness(res.readiness);
        setSharedLinks(res.channelLinks);
      })
      .catch(() => {
        /* checklist falls back to "not verified" */
      });
    return () => {
      cancelled = true;
    };
  }, [campaignId, registrationLink]);

  // Hydration-safe origin:
  // Derived from initialOrigin passed from the server page (via appOrigin()), or defaults to http://localhost:3000.
  // This guarantees identical HTML between SSR and client initial hydration without React hydration mismatch.
  const origin = (initialOrigin || 'http://localhost:3000').replace(/\/$/, '');

  const start = webinarDate ? wallClockToDate(`${webinarDate}T${webinarTime||'09:00'}`,timezone) : scheduledAt ? new Date(scheduledAt) : null;
  const validStart = start && !Number.isNaN(start.getTime()) ? start : null;
  const whenLabel = validStart ? `${formatLsqDateTime(validStart,timezone)} ${timeZoneLabel(validStart,timezone)}` : 'Date to be set';
  const scheduledIso = validStart?.toISOString();

  const normalLinks = buildNormalChannelRegistrationLinks(
    { id: campaignId },
    'sample-contact-id',
    origin
  );

  // The calendar details are fetched when the pop-up opens, so the script only needs the webinar, Zoom event and origin.
  const embedScript = generateFramerEmbedScript({
    campaignId,
    zoomId: zoomMeetingId || undefined,
    apiOrigin: origin,
    landingUrl: currentLandingLink || undefined,
  });

  const calUrls = scheduledIso
    ? buildCalendarUrls(
        {
          title: webinarTitle,
          description,
          location: zoomLink || 'Online Webinar',
          startTime: scheduledIso,
          durationMinutes,
          campaignId,
        },
        origin
      )
    : null;

  function copyText(text: string, key: string) {
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(text);
      setCopiedKey(key);
      showToast('Copied to clipboard.');
      setTimeout(() => setCopiedKey(null), 2500);
    }
  }

  const safeValidation = validation || {
    total: 0,
    verifiedWorkEmailCount: 0,
    emailHealthPercent: 0,
    linkedinProfileCount: 0,
    linkedinHealthPercent: 0,
    titleAndSeniorityCount: 0,
    titleHealthPercent: 0,
    duplicateCount: 0,
    suppressedCount: 0,
    cleanReadyCount: 0,
  };

  const safeSteps = activeSteps || [];
  const safeMappings = fieldMappings || [];

  const enabledSteps = safeSteps.filter((s) => s && s.enabled);
  const enabledMappings = safeMappings.filter((m) => m && m.enabled);

  async function handleApproveAllClean() {
    setApproving(true);
    try {
      const res = await approveAllCleanContactsAction(campaignId);
      setCurrentApprovedCount(res.approvedCount);
      onApprovedCountChange?.(res.approvedCount);
      showToast(`Approved ${res.approvedCount} clean contacts for live launch.`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to approve clean contacts');
    } finally {
      setApproving(false);
    }
  }

  async function handleLaunch() {
    setConfirming(false);
    setLaunching(true);
    setLaunchError(null);
    try {
      // Ensure the selected funnel mode and registration link are committed to DB
      const desiredLink = funnelMode === 'framer' ? currentLandingLink.trim() : '';
      await updateWizardFunnelModeAction(campaignId, funnelMode, desiredLink);

      let finalCount = currentApprovedCount;
      if (finalCount === 0 && safeValidation.cleanReadyCount > 0) {
        showToast('Approving clean contacts…');
        const res = await approveAllCleanContactsAction(campaignId);
        finalCount = res.approvedCount;
        setCurrentApprovedCount(res.approvedCount);
        onApprovedCountChange?.(res.approvedCount);
      }

      showToast('Deploying campaign and queueing cadence sends…');
      const res = await launchCadenceAction(campaignId);
      if (!res.ok) {
        const reason = [res.error, ...(res.problems ?? [])].join(' ');
        setLaunchError(reason);
        showToast(res.error);
        return;
      }
      showToast(`Webinar launched. ${res.queued} sends queued (${res.sent} sent immediately).`);
      setTimeout(() => {
        router.push(`/campaigns/${campaignId}/overview`);
      }, 800);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to launch webinar campaign';
      setLaunchError(errorMsg);
      showToast(errorMsg);
    } finally {
      setLaunching(false);
    }
  }

  const hasDate = Boolean(webinarDate) || Boolean(scheduledAt);
  const detailsDone = Boolean(webinarTitle) && hasDate;
  const channelsInPlan = Array.from(new Set(enabledSteps.map((s) => channelOf(s.channel))));
  const filteredOut = safeValidation.duplicateCount + safeValidation.suppressedCount;
  const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

  const regState: ChecklistState = !registrationReadiness
    ? 'warn'
    : registrationReadiness.counts.fail > 0
      ? 'blocked'
      : registrationReadiness.ready
        ? 'done'
        : 'warn';
  const regIssues = registrationReadiness ? registrationReadiness.checks.filter((c) => c.status !== 'pass') : [];

  const checklist: Array<{ id: string; state: ChecklistState; title: string; desc: string }> = [
    {
      id: 'details',
      state: detailsDone ? 'done' : 'warn',
      title: 'Webinar details',
      desc: detailsDone ? 'Title, date and time are set.' : 'A title and a date are needed before attendees can be invited.',
    },
    {
      id: 'audience',
      state: safeValidation.total > 0 ? 'done' : 'warn',
      title: 'Audience imported',
      desc: safeValidation.total > 0 ? `${safeValidation.total.toLocaleString()} contacts are in this webinar.` : 'No contacts have been imported yet.',
    },
    {
      id: 'quality',
      state: safeValidation.cleanReadyCount > 0 ? 'done' : 'warn',
      title: 'Input quality check',
      desc:
        safeValidation.cleanReadyCount > 0
          ? `${safeValidation.cleanReadyCount.toLocaleString()} verified clean ${plural(safeValidation.cleanReadyCount, 'contact is', 'contacts are')} ready for outreach.`
          : 'No contact has passed the quality check yet.',
    },
    {
      id: 'approved',
      state: currentApprovedCount > 0 ? 'done' : 'warn',
      title: 'Contacts approved',
      desc:
        currentApprovedCount > 0
          ? `${currentApprovedCount.toLocaleString()} approved for outreach.`
          : safeValidation.cleanReadyCount > 0
            ? `Approve the ${safeValidation.cleanReadyCount.toLocaleString()} clean contacts before launching.`
            : 'None approved yet.',
    },
    {
      id: 'cadence',
      state: enabledSteps.length > 0 ? 'done' : 'warn',
      title: 'Cadence scheduled',
      desc: enabledSteps.length > 0 ? `${enabledSteps.length} active ${plural(enabledSteps.length, 'step', 'steps')} across ${channelsInPlan.join(', ')}.` : 'No cadence step is active.',
    },
    {
      id: 'registration',
      state: regState,
      title: 'Registration setup',
      desc: registrationReadiness
        ? registrationReadiness.ready
          ? 'Registration is set up and verified.'
          : `Needs attention: ${registrationReadiness.counts.fail} to fix, ${registrationReadiness.counts.warn} to review.`
        : 'Not verified yet.',
    },
  ];
  const attention = checklist.filter((c) => c.state !== 'done').length;

  return (
    <div className="lsq-stack lsq-stack--lg">
      <header className="lsq-page-header">
        <div className="lsq-page-header__text">
          <p className="lsq-page-header__eyebrow">Webinar</p>
          <h2 className="lsq-page-header__title">{webinarTitle || 'Untitled Webinar'}</h2>
          <p className="lsq-page-header__sub" suppressHydrationWarning>
            {whenLabel}
            {capacity ? ` | Capacity ${capacity}` : ''}
          </p>
        </div>
        <div className="lsq-page-header__actions">
          <Badge color="blue" text="Configured providers" />
        </div>
      </header>

      {launchError && (
        <div className="lsq-banner lsq-banner--error" role="alert">
          <Icon name="error" size={18} />
          <div>
            <p className="lsq-banner__title">Launch halted</p>
            <p className="lsq-banner__body">{launchError}</p>
          </div>
        </div>
      )}

      {currentApprovedCount === 0 && safeValidation.total > 0 && (
        <div className="lsq-banner lsq-banner--warning" role="status">
          <Icon name="warning" size={18} />
          <div>
            <p className="lsq-banner__title">Contacts imported but none approved yet</p>
            <p className="lsq-banner__body">
              {safeValidation.cleanReadyCount.toLocaleString()} verified clean {plural(safeValidation.cleanReadyCount, 'contact is', 'contacts are')} ready for outreach. Approve them to queue their cadence invites.
            </p>
            <div className="lsq-banner__actions">
              <Button
                size="sm"
                hierarchy="secondary"
                icon={<Icon name="check" size={14} />}
                disabled={approving || launching || safeValidation.cleanReadyCount === 0}
                loading={approving}
                onClick={handleApproveAllClean}
              >
                {approving ? 'Approving' : `Approve All Clean Contacts (${safeValidation.cleanReadyCount.toLocaleString()})`}
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="lsq-grid lsq-grid--wide">
        <section className="lsq-card" aria-labelledby="wiz-readiness">
          <div className="lsq-card__header">
            <div>
              <h3 className="lsq-card__title" id="wiz-readiness">Launch Readiness</h3>
              <p className="lsq-card__sub">Checked against what is saved for this webinar.</p>
            </div>
            <Badge color={attention === 0 ? 'success' : 'warning'} text={attention === 0 ? 'All clear' : `${attention} to review`} />
          </div>
          <div className="lsq-card__body">
            {!launchReadiness && <p role="status">Verifying backend launch checks…</p>}
            {launchReadiness && !launchReadiness.ok && <ul className="lsq-wiz-issues" aria-label="Launch blockers">{launchReadiness.problems.map(problem=><li key={problem}>{problem}</li>)}</ul>}
            <ul className="lsq-checklist">
              {checklist.map((c) => (
                <li key={c.id} className="lsq-checklist__item" data-state={c.state}>
                  <span className="lsq-checklist__state" aria-hidden="true">
                    {c.state === 'done' ? <Icon name="check" size={12} /> : c.state === 'blocked' ? <Icon name="close" size={12} /> : <Icon name="minus" size={12} />}
                  </span>
                  <div className="lsq-checklist__main">
                    <p className="lsq-checklist__title">
                      {c.title}
                      <span className="lsq-sr-only">{c.state === 'done' ? ' (complete)' : c.state === 'blocked' ? ' (needs a fix)' : ' (needs review)'}</span>
                    </p>
                    <p className="lsq-checklist__desc">{c.desc}</p>
                    {c.id === 'registration' && regIssues.length > 0 && (
                      <ul className="lsq-wiz-issues">
                        {regIssues.map((issue) => (
                          <li key={issue.id}>
                            <Badge color={issue.status === 'fail' ? 'error' : 'warning'} text={issue.status === 'fail' ? 'Fix' : 'Review'} />
                            <span>
                              <strong>{issue.label}.</strong> {issue.detail}
                              {issue.fix ? ` ${issue.fix}` : ''}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="lsq-card" aria-labelledby="wiz-summary">
          <div className="lsq-card__header">
            <div>
              <h3 className="lsq-card__title" id="wiz-summary">What Happens At Launch</h3>
              <p className="lsq-card__sub">The cadence engine starts and the campaign goes live.</p>
            </div>
          </div>
          <div className="lsq-card__body">
            <dl className="lsq-kv">
              <dt>Approved contacts</dt>
              <dd>{currentApprovedCount.toLocaleString()}</dd>
              <dt>Active steps</dt>
              <dd>{enabledSteps.length}</dd>
              <dt>Channels</dt>
              <dd>
                {channelsInPlan.length > 0 ? (
                  <span className="lsq-cluster">
                    {channelsInPlan.map((ch) => (
                      <Badge key={ch} color="gray" text={ch} />
                    ))}
                  </span>
                ) : (
                  'None'
                )}
              </dd>
              <dt>Delivery</dt><dd>Selected recipients</dd>
              <dt>Messages</dt>
              <dd>{msgMode === 'ai' ? 'AI personalized' : 'Fixed template'}</dd>
              <dt>Tone and length</dt>
              <dd>
                {tone}, {msgLength}
              </dd>
              <dt>Dispatch</dt>
              <dd>Netcore Cloud</dd>
              <dt>Registration</dt>
              <dd>{funnelMode === 'normal' ? 'One-click links and calendar' : 'Custom landing page'}</dd>
              {speakers.length > 0 && (
                <>
                  <dt>Speakers</dt>
                  <dd>{speakers.map((s) => s.name + (s.title ? ` (${s.title})` : '')).join(', ')}</dd>
                </>
              )}
              {zoomLink && (
                <>
                  <dt>Zoom</dt>
                  <dd>{zoomLink}</dd>
                </>
              )}
            </dl>
            {brief && <p className="lsq-hint lsq-wiz-brief">Brief: {brief.length > 120 ? `${brief.slice(0, 120)}…` : brief}</p>}
          </div>
          <div className="lsq-card__footer">
            <p className="lsq-hint lsq-grow">
              {attention > 0 ? `${attention} ${plural(attention, 'item needs', 'items need')} review. Fix blocking checks before launch.` : 'Every check passed.'}
            </p>
            <Button size="lg" icon={<Icon name="send" size={16} />} disabled={launching || approving || !registrationReadiness?.ready || !launchReadiness?.ok || enabledSteps.length === 0} loading={launching} onClick={() => setConfirming(true)}>
              {launching ? 'Launching' : 'Launch Webinar'}
            </Button>
          </div>
        </section>
      </div>

      <div className="lsq-grid lsq-grid--wide">
        <section className="lsq-card" aria-labelledby="wiz-audience">
          <div className="lsq-card__header">
            <div>
              <h3 className="lsq-card__title" id="wiz-audience">Audience Quality</h3>
              <p className="lsq-card__sub">Results of the input validation on imported contacts.</p>
            </div>
            <div className="lsq-cluster">
              {currentApprovedCount === 0 && safeValidation.cleanReadyCount > 0 && (
                <Button size="sm" hierarchy="secondary" disabled={approving || launching} onClick={handleApproveAllClean}>
                  {approving ? 'Approving' : `Approve ${safeValidation.cleanReadyCount.toLocaleString()} Clean`}
                </Button>
              )}
              <Badge color={currentApprovedCount > 0 ? 'success' : 'warning'} text={`${currentApprovedCount.toLocaleString()} approved`} />
            </div>
          </div>
          <div className="lsq-card__body">
            <dl className="lsq-kv">
              <dt>Total imported</dt>
              <dd>{safeValidation.total.toLocaleString()} contacts</dd>
              <dt>Verified work emails</dt>
              <dd>
                {safeValidation.verifiedWorkEmailCount.toLocaleString()} ({safeValidation.emailHealthPercent}%)
              </dd>
              <dt>LinkedIn profiles</dt>
              <dd>
                {safeValidation.linkedinProfileCount.toLocaleString()} ({safeValidation.linkedinHealthPercent}%)
              </dd>
              <dt>Title and seniority match</dt>
              <dd>
                {safeValidation.titleAndSeniorityCount.toLocaleString()} ({safeValidation.titleHealthPercent}%)
              </dd>
              <dt>Suppressed or duplicate</dt>
              <dd>{filteredOut.toLocaleString()} filtered out</dd>
              <dt>Approved for launch</dt>
              <dd>{currentApprovedCount.toLocaleString()} contacts</dd>
            </dl>
          </div>
        </section>

        <section className="lsq-card" aria-labelledby="wiz-cadence">
          <div className="lsq-card__header">
            <div>
              <h3 className="lsq-card__title" id="wiz-cadence">Cadence Blueprint</h3>
              <p className="lsq-card__sub">Active steps in send order.</p>
            </div>
            <Badge color="blue" text={`${enabledSteps.length} ${plural(enabledSteps.length, 'step', 'steps')}`} />
          </div>
          <div className="lsq-card__body">
            {enabledSteps.length > 0 ? (
              <ul className="lsq-wiz-steplist">
                {enabledSteps.map((step) => {
                  const ch = channelOf(step.channel);
                  return (
                    <li key={step.id} className="lsq-wiz-steplist__item">
                      <span className="lsq-chan" data-ch={ch} aria-hidden="true">
                        <Icon name={CH_ICON[ch] ?? 'mail'} size={18} />
                      </span>
                      <span className="lsq-wiz-steplist__title">
                        {step.title}
                        <span className="lsq-sr-only"> ({ch})</span>
                      </span>
                      <Badge color="gray" text={step.timing} />
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="lsq-stage__empty">No active cadence step. Go back to the Cadence step to enable one.</p>
            )}
          </div>
        </section>
      </div>

      <section className="lsq-card" aria-labelledby="wiz-grounding">
        <div className="lsq-card__header">
          <div>
            <h3 className="lsq-card__title" id="wiz-grounding">LeadSquared Fields For Personalization</h3>
            <p className="lsq-card__sub">
              {enabledMappings.length} active {plural(enabledMappings.length, 'token', 'tokens')} synced with LeadSquared and available in messages.
            </p>
          </div>
        </div>
        <div className="lsq-card__body">
          {enabledMappings.length > 0 ? (
            <ul className="lsq-chips lsq-wiz-tokens">
              {enabledMappings.map((m) => (
                <li key={m.id} className="lsq-tag">
                  <code className="lsq-wiz-token">{m.token}</code>
                  <Icon name="arrow-right" size={12} />
                  <span>{m.lsqField}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="lsq-hint">No field mapping is active.</p>
          )}
        </div>
      </section>

      <section className="lsq-card" aria-labelledby="wiz-funnel">
        <div className="lsq-card__header">
          <div>
            <h3 className="lsq-card__title" id="wiz-funnel">Registration And Calendar</h3>
            <p className="lsq-card__sub">How people register after they follow a message link, and how they add the webinar to their calendar.</p>
          </div>
        </div>
        <div className="lsq-card__body lsq-stack lsq-stack--lg">
          <div className="lsq-banner lsq-banner--neutral" role="status">
            <Icon name={funnelMode === 'framer' ? 'globe' : 'bolt'} size={18} />
            <div className="lsq-grow">
              <p className="lsq-banner__title">
                {funnelMode === 'framer' ? 'Custom landing page' : 'One-click registration'}
              </p>
              <p className="lsq-banner__body lsq-wiz-wrap">
                {funnelMode === 'framer'
                  ? currentLandingLink
                  : 'Signed links for Email, WhatsApp, SMS and LinkedIn register a contact in one click, then open the attendee hub with calendar options.'}
              </p>
            </div>
            {onChangeRegistration && (
              <Button size="sm" hierarchy="secondary" onClick={onChangeRegistration} disabled={launching}>
                Change In Step 1
              </Button>
            )}
          </div>

          {funnelMode === 'normal' && (
            <>
              <div className="lsq-stack lsq-stack--sm">
                <div className="lsq-cluster">
                  <h4 className="lsq-wiz-subtitle">One-Click Registration Links</h4>
                  <Badge color="success" text="Channel attribution on" />
                </div>
                <p className="lsq-hint">
                  Each invitee receives a personalized signed link for the delivery channel. A click registers the contact, records the channel and opens the attendee hub. The links below use a sample contact.
                </p>
                <div className="lsq-table-wrap" tabIndex={0} role="region" aria-label="Scrollable table">
                  <table className="lsq-table">
                    <thead>
                      <tr>
                        <th scope="col">Channel</th>
                        <th scope="col">Link</th>
                        <th scope="col">
                          <span className="lsq-sr-only">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {(
                        [
                          { key: 'email', label: 'Email', icon: 'mail', url: normalLinks.email, tag: 'source=email' },
                          { key: 'whatsapp', label: 'WhatsApp', icon: 'whatsapp', url: normalLinks.whatsapp, tag: 'source=whatsapp' },
                          { key: 'sms', label: 'SMS', icon: 'sms', url: normalLinks.sms, tag: 'source=sms' },
                          { key: 'linkedin', label: 'LinkedIn', icon: 'linkedin', url: normalLinks.linkedin, tag: 'source=linkedin' },
                        ] as const
                      ).map((item) => (
                        <tr key={item.key}>
                          <th scope="row" className="lsq-cell-primary lsq-wiz-rowhead">
                            <span className="lsq-cluster">
                              <Icon name={item.icon} size={16} />
                              {item.label}
                            </span>
                            <span className="lsq-cell-secondary">{item.tag}</span>
                          </th>
                          <td>
                            <span className="lsq-wiz-url" suppressHydrationWarning>
                              {item.url}
                            </span>
                          </td>
                          <td>
                            <span className="lsq-wiz-actions">
                              <a
                                className="lsq-btn lsq-btn--sm lsq-btn--secondary"
                                href={item.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label={`Test open ${item.label} link`}
                                suppressHydrationWarning
                              >
                                <Icon name="external" size={14} />
                                Test Open
                              </a>
                              <CopyButton
                                copied={copiedKey === `norm_${item.key}`}
                                label={`Copy ${item.label} link`}
                                onCopy={() => copyText(item.url, `norm_${item.key}`)}
                              />
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="lsq-stack lsq-stack--sm">
                <div className="lsq-cluster">
                  <h4 className="lsq-wiz-subtitle">Calendar Links</h4>
                  <Badge color="success" text="Google, Outlook and Apple" />
                </div>
                <p className="lsq-hint">
                  Attendees who land on the result page get one-click calendar scheduling. These are the generated links for testing.
                </p>
                {calUrls && <CalendarLinks calUrls={calUrls} campaignId={campaignId} />}
              </div>

              <div className="lsq-banner lsq-banner--neutral">
                <Icon name="info" size={18} />
                <div>
                  <p className="lsq-banner__title">How the one-click journey works</p>
                  <ol className="lsq-wiz-steps">
                    <li>
                      <strong>Channel send.</strong> Outreach messages replace <code>{'{{link}}'}</code> with the contact&apos;s signed link tagged with the channel source.
                    </li>
                    <li>
                      <strong>One click.</strong> The backend validates the token, marks the contact registered, registers them on Zoom, cancels future invites and adds them to the LeadSquared suppression list.
                    </li>
                    <li>
                      <strong>Attendee hub.</strong> The browser opens the result page with the webinar countdown, Zoom join details and calendar scheduling.
                    </li>
                  </ol>
                </div>
              </div>
            </>
          )}

          {funnelMode === 'framer' && (
            <>
              <ExternalRegistrationSetup script={embedScript} channelLinks={sharedLinks} apiOrigin={origin} />
            </>
          )}
        </div>
      </section>

      {confirming && (
        <ConfirmDialog
          title="Launch webinar?"
          message={`This queues messages for ${currentApprovedCount} approved contacts using your configured providers.`}
          confirmLabel={launching ? 'Launching…' : 'Launch Webinar'}
          destructive
          busy={launching}
          onConfirm={handleLaunch}
          onClose={() => setConfirming(false)}
        />
      )}
    </div>
  );
}

type ChecklistState = 'done' | 'warn' | 'blocked';

const CH_ICON: Record<string, 'mail' | 'linkedin' | 'whatsapp' | 'sms'> = { Email: 'mail', LinkedIn: 'linkedin', WhatsApp: 'whatsapp', SMS: 'sms' };

function channelOf(channel: string): string {
  if (channel.includes('LinkedIn')) return 'LinkedIn';
  if (channel.includes('SMS')) return 'SMS';
  if (channel.includes('WhatsApp')) return 'WhatsApp';
  return 'Email';
}

function CopyButton({ copied, label, onCopy }: { copied: boolean; label: string; onCopy: () => void }) {
  return (
    <Button size="sm" hierarchy="secondary" icon={<Icon name={copied ? 'check' : 'copy'} size={14} />} ariaLabel={label} onClick={onCopy}>
      {copied ? 'Copied' : 'Copy'}
    </Button>
  );
}

function CalendarLinks({
  calUrls,
  campaignId,
  icsAsLink = true,
}: {
  calUrls: CalendarUrls;
  campaignId: string;
  icsAsLink?: boolean;
}) {
  const linkClass = 'lsq-btn lsq-btn--sm lsq-btn--secondary';
  return (
    <div className="lsq-cluster">
      <a className={linkClass} href={calUrls.google} target="_blank" rel="noopener noreferrer">
        <Icon name="calendar" size={14} />
        Google Calendar
      </a>
      <a className={linkClass} href={calUrls.outlookLive} target="_blank" rel="noopener noreferrer">
        <Icon name="calendar" size={14} />
        Outlook Live
      </a>
      <a className={linkClass} href={calUrls.outlookOffice} target="_blank" rel="noopener noreferrer">
        <Icon name="calendar" size={14} />
        Office 365
      </a>
      {calUrls.ics &&
        (icsAsLink ? (
          <a className={linkClass} href={calUrls.ics} download={`${campaignId}.ics`} suppressHydrationWarning>
            <Icon name="download" size={14} />
            Apple Calendar (.ics)
          </a>
        ) : (
          <span className="lsq-hint" suppressHydrationWarning>
            .ics endpoint: <code className="lsq-wiz-url">{calUrls.ics}</code>
          </span>
        ))}
    </div>
  );
}
