'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useToast } from '@/components/ui/Toast';
import { saveRegistrationSettingsAction, verifyLandingPageAction, type RegistrationOverview } from '@/lib/actions/registration';
import { enableZoomRegistrationAction } from '@/lib/actions/zoom';
import type { RegistrationMode } from '@/lib/inviteLink';
import type { ReadinessCheck, ReadinessStatus } from '@/lib/registrationReadiness';
import type { LandingReport } from '@/lib/landingVerify';
import { ExternalRegistrationSetup } from '@/components/registration/ExternalRegistrationSetup';

const STATUS_BADGE: Record<ReadinessStatus, { color: string; text: string }> = {
  pass: { color: 'success', text: 'Ready' },
  warn: { color: 'warning', text: 'Review' },
  fail: { color: 'error', text: 'Needs Fixing' },
};
const CHECK_STATE: Record<ReadinessStatus, string> = { pass: 'done', warn: 'warn', fail: 'blocked' };
const GROUP_LABEL: Record<ReadinessCheck['group'], string> = {
  event: 'Event',
  registration: 'Registration',
  zoom: 'Zoom',
  crm: 'LeadSquared',
};

async function copy(text: string, showToast: (m: string) => void, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(`${what} copied.`);
  } catch {
    showToast('Copy is blocked in this browser. Select the text and copy it manually.');
  }
}

export function RegistrationClient({
  campaignId,
  overview,
  zoomLinked,
  locked,
  completed = false,
}: {
  campaignId: string;
  overview: RegistrationOverview;
  zoomLinked: boolean;
  locked: boolean;
  completed?: boolean;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();

  const [mode, setMode] = useState<RegistrationMode>(overview.mode);
  const [landingUrl, setLandingUrl] = useState(overview.landingUrl ?? '');
  const [prefill, setPrefill] = useState(overview.prefill);
  const [oneClick, setOneClick] = useState(overview.oneClickSignup);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [report, setReport] = useState<(LandingReport & { checkedAt: string }) | null>(overview.landingReport);
  const [checking, setChecking] = useState(false);
  const [enabling, setEnabling] = useState(false);

  const dirty =
    mode !== overview.mode ||
    (mode === 'external' && (landingUrl.trim() !== (overview.landingUrl ?? '') || prefill !== overview.prefill)) ||
    (mode === 'zoom' && oneClick !== overview.oneClickSignup);

  const { readiness } = overview;
  const headline = readiness.ready
    ? readiness.counts.warn > 0
      ? { color: 'warning', text: 'Ready With Notes' }
      : { color: 'success', text: locked ? 'All Clear' : 'Ready To Launch' }
    : { color: 'error', text: locked ? 'Needs Attention' : 'Not Ready' };

  function save() {
    setError(null);
    setWarnings([]);
    startTransition(async () => {
      const res = await saveRegistrationSettingsAction(campaignId, {
        mode,
        landingUrl: mode === 'external' ? landingUrl : undefined,
        prefill: mode === 'external' ? prefill : undefined,
        oneClickSignup: mode === 'zoom' ? oneClick : undefined,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setWarnings(res.warnings);
      showToast('Registration settings saved.');
      router.refresh();
    });
  }

  async function checkPage() {
    setChecking(true);
    setError(null);
    try {
      setReport(await verifyLandingPageAction(campaignId, landingUrl));
      router.refresh();
    } catch {
      setError('The page check could not run. Try again in a moment.');
    } finally {
      setChecking(false);
    }
  }

  async function enableRegistration() {
    setEnabling(true);
    try {
      const res = await enableZoomRegistrationAction(campaignId);
      showToast(res.ok ? 'Registration turned on in Zoom.' : res.error);
      if (res.ok) router.refresh();
    } finally {
      setEnabling(false);
    }
  }

  const zoomCheck = readiness.checks.find((c) => c.group === 'zoom' && /registration/i.test(c.label));
  const zoomNeedsEnable = zoomLinked && zoomCheck?.status === 'fail' && !readiness.takenPlace;

  return (
    <div className="lsq-page lsq-page--form">
      <header className="lsq-page-header">
        <div className="lsq-page-header__text">
          <p className="lsq-page-header__eyebrow">Registration</p>
          <h1 className="lsq-page-header__title">How People Register</h1>
          <p className="lsq-page-header__sub">
            Choose where attendees sign up. Every registration is synced to Zoom and LeadSquared whichever option is used.
          </p>
        </div>
        <div className="lsq-page-header__actions">
          <Badge color={headline.color} text={headline.text} dot />
        </div>
      </header>

      {locked && (
        <div className="lsq-banner lsq-banner--neutral" role="status">
          <div>
            <p className="lsq-banner__body">{completed ? 'This webinar is completed, so registration settings are read-only.' : 'This webinar has launched, so registration settings are locked. Links already sent keep working.'}</p>
          </div>
        </div>
      )}

      {/* Mode */}
      <section className="lsq-card" aria-labelledby="reg-mode-title">
        <div className="lsq-card__header">
          <div>
            <h2 className="lsq-card__title" id="reg-mode-title">Registration Option</h2>
            <p className="lsq-card__sub">One front door per webinar. Switching later does not affect people who already registered.</p>
          </div>
        </div>
        <div className="lsq-card__body lsq-stack">
          <div className="lsq-grid lsq-grid--wide" role="radiogroup" aria-label="Registration option">
            {(
              [
                { id: 'zoom', title: 'Webinar Studio Page', body: 'Hosted registration form or one-click links from invites. Registrants are added to Zoom automatically.' },
                { id: 'external', title: 'External Landing Page', body: 'Send people to a page built in LeadSquared, Framer or any site. A small script connects its form to this webinar.' },
              ] as const
            ).map((opt) => (
              <label key={opt.id} className="lsq-card" style={{ padding: 'var(--space-16)', cursor: locked ? 'not-allowed' : 'pointer', boxShadow: mode === opt.id ? 'inset 0 0 0 2px var(--accent-500)' : 'inset 0 0 0 1px var(--border-subtle)' }}>
                <span className="lsq-cluster">
                  <input
                    type="radio"
                    name="registration-mode"
                    value={opt.id}
                    checked={mode === opt.id}
                    disabled={locked}
                    onChange={() => setMode(opt.id)}
                  />
                  <strong>{opt.title}</strong>
                </span>
                <p className="lsq-hint" style={{ marginTop: 'var(--space-4)' }}>{opt.body}</p>
              </label>
            ))}
          </div>

          {mode === 'zoom' ? (
            <div className="lsq-stack">
              <label className="lsq-check">
                <input type="checkbox" checked={oneClick} disabled={locked} onChange={(e) => setOneClick(e.target.checked)} />
                <span>
                  One-click registration from invites
                  <span className="lsq-hint" style={{ display: 'block' }}>
                    The link in each invite registers that person immediately. Turn off to show the form first.
                  </span>
                </span>
              </label>
              <div className="lsq-field">
                <span className="lsq-label">Public Registration Page</span>
                <code className="lsq-code lsq-code--wrap">{`${overview.appOrigin}/register/${campaignId}`}</code>
              </div>
            </div>
          ) : (
            <div className="lsq-stack">
              <div className="lsq-field">
                <label className="lsq-label" htmlFor="landing-url">Landing page address</label>
                <input
                  id="landing-url"
                  className="lsq-input"
                  type="url"
                  inputMode="url"
                  placeholder="https://example.com/webinar"
                  value={landingUrl}
                  disabled={locked}
                  onChange={(e) => setLandingUrl(e.target.value)}
                  aria-invalid={error ? true : undefined}
                  aria-describedby="landing-url-hint"
                />
                <p className="lsq-hint" id="landing-url-hint">Must be a public https address. Visitors arrive here from every channel link below.</p>
              </div>
              <label className="lsq-check">
                <input type="checkbox" checked={prefill} disabled={locked} onChange={(e) => setPrefill(e.target.checked)} />
                <span>
                  Pre-fill the form for invited contacts
                  <span className="lsq-hint" style={{ display: 'block' }}>
                    Adds the contact&apos;s name and email to the link so the form is filled in. These appear in browser history and server logs, so leave this off unless the page needs them.
                  </span>
                </span>
              </label>
              <div className="lsq-cluster">
                <Button hierarchy="secondary" size="sm" onClick={checkPage} loading={checking} disabled={!landingUrl.trim()}>
                  Check Page
                </Button>
                {report && (
                  <Badge
                    color={report.overall === 'pass' ? 'success' : report.overall === 'warn' ? 'warning' : 'error'}
                    text={report.overall === 'pass' ? 'Page Looks Good' : report.overall === 'warn' ? 'Page Has Notes' : 'Page Has Problems'}
                    dot
                  />
                )}
              </div>
              {report && (
                <ul className="lsq-checklist" aria-label="Landing page checks">
                  {report.checks.map((c) => (
                    <li key={c.id} className="lsq-checklist__item" data-state={CHECK_STATE[c.status]}>
                      <span className="lsq-checklist__state" aria-hidden="true" />
                      <div className="lsq-checklist__main">
                        <p className="lsq-checklist__title">{c.label}</p>
                        <p className="lsq-checklist__desc">
                          {c.detail}
                          {c.fix ? ` ${c.fix}` : ''}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {warnings.length > 0 && (
            <div className="lsq-banner lsq-banner--warning" role="status">
              <div>
                {warnings.map((w) => (
                  <p key={w} className="lsq-banner__body">{w}</p>
                ))}
              </div>
            </div>
          )}
          {error && <p className="lsq-error" role="alert">{error}</p>}
        </div>
        <div className="lsq-card__footer">
          <Button hierarchy="primary" onClick={save} loading={pending} disabled={!dirty || locked}>
            Save Registration Settings
          </Button>
        </div>
      </section>

      {/* External page: script, attribution field, what people see */}
      {overview.mode === 'external' && overview.snippet && (
        <section className="lsq-card" aria-labelledby="reg-snippet-title">
          <div className="lsq-card__header">
            <div>
              <h2 className="lsq-card__title" id="reg-snippet-title">Connect Your Page</h2>
              <p className="lsq-card__sub">The script registers each person, records their channel and shows the calendar pop-up on your thank-you page.</p>
            </div>
          </div>
          <div className="lsq-card__body">
            <ExternalRegistrationSetup script={overview.snippet} apiOrigin={overview.appOrigin} />
          </div>
        </section>
      )}

      {/* Zoom */}
      <section className="lsq-card" aria-labelledby="reg-zoom-title">
        <div className="lsq-card__header">
          <div>
            <h2 className="lsq-card__title" id="reg-zoom-title">Zoom</h2>
            <p className="lsq-card__sub">Registrants are added to the linked Zoom event so each person gets a personal join link.</p>
          </div>
        </div>
        <div className="lsq-card__body lsq-stack">
          {!zoomLinked ? (
            <div className="lsq-banner lsq-banner--warning" role="status">
              <div>
                <p className="lsq-banner__title">No Zoom Event Linked</p>
                <p className="lsq-banner__body">Link or create a Zoom meeting or webinar so registrations can receive join links.</p>
                {locked ? (
                  <p className="lsq-banner__body">Setup is locked once a webinar has launched, so a Zoom event can no longer be linked to this one.</p>
                ) : (
                  <div className="lsq-banner__actions">
                    <Link href={`/campaigns/new?id=${campaignId}&step=0`} className="lsq-btn lsq-btn--sm lsq-btn--secondary">Open Webinar Setup</Link>
                  </div>
                )}
              </div>
            </div>
          ) : zoomNeedsEnable ? (
            <div className="lsq-banner lsq-banner--error" role="alert">
              <div>
                <p className="lsq-banner__title">Registration Is Off In Zoom</p>
                <p className="lsq-banner__body">{zoomCheck?.detail}</p>
                <div className="lsq-banner__actions">
                  <Button hierarchy="primary" size="sm" onClick={enableRegistration} loading={enabling}>Turn On Registration</Button>
                </div>
              </div>
            </div>
          ) : (
            <p className="lsq-hint">
              {readiness.takenPlace ? 'The webinar has taken place, so the Zoom event is no longer taking registrations.' : 'The linked Zoom event accepts registrations.'}
            </p>
          )}
        </div>
      </section>

      {/* Channel links */}
      <section className="lsq-card" aria-labelledby="reg-links-title">
        <div className="lsq-card__header">
          <div>
            <h2 className="lsq-card__title" id="reg-links-title">Links To Share</h2>
            <p className="lsq-card__sub">
              Studio adds the right link to every email, SMS, WhatsApp and LinkedIn message it sends or drafts. For anywhere else you share
              this webinar, use the link for that place so its registrations are credited to it. These links contain no personal data.
            </p>
          </div>
        </div>
        <div className="lsq-card__body">
          {overview.channelLinks.length === 0 ? (
            <p className="lsq-hint">No shared channels are turned on. Turn them on in Step 1 of the webinar setup to get a link for each.</p>
          ) : (
            <div className="lsq-table-wrap" tabIndex={0} role="region" aria-label="Scrollable table">
              <table className="lsq-table">
                <thead>
                  <tr><th scope="col">Channel</th><th scope="col">Link</th><th scope="col"><span className="lsq-sr-only">Actions</span></th></tr>
                </thead>
                <tbody>
                  {overview.channelLinks.map((l) => (
                    <tr key={l.channel}>
                      <td>{l.label}</td>
                      <td><code className="lsq-code lsq-code--wrap">{l.url}</code></td>
                      <td><Button hierarchy="tertiary" size="sm" onClick={() => copy(l.url, showToast, `${l.label} link`)}>Copy</Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* Readiness */}
      <section className="lsq-card" aria-labelledby="reg-ready-title">
        <div className="lsq-card__header">
          <div>
            <h2 className="lsq-card__title" id="reg-ready-title">{locked ? 'Registration Health' : 'Launch Readiness'}</h2>
            <p className="lsq-card__sub">
              {readiness.counts.fail} to fix, {readiness.counts.warn} to review, {readiness.counts.pass} ready.
            </p>
          </div>
        </div>
        <div className="lsq-card__body">
          <ul className="lsq-checklist">
            {readiness.checks.map((c) => (
              <li key={c.id} className="lsq-checklist__item" data-state={CHECK_STATE[c.status]}>
                <span className="lsq-checklist__state" aria-hidden="true" />
                <div className="lsq-checklist__main">
                  <p className="lsq-checklist__title">
                    {c.label} <span className="lsq-hint">· {GROUP_LABEL[c.group]}</span>
                  </p>
                  <p className="lsq-checklist__desc">
                    {c.detail}
                    {c.fix ? ` ${c.fix}` : ''}
                  </p>
                </div>
                <Badge color={STATUS_BADGE[c.status].color} text={STATUS_BADGE[c.status].text} />
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
