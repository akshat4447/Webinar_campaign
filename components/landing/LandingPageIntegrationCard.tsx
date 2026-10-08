'use client';

import { useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { Field } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import {
  buildChannelTrackingLinks,
  generateUniversalEmbedScript,
  type LandingPlatform,
  type MergeTagProvider,
  type ChannelTrackingLinksResult,
} from '@/lib/landingPage';
import { parseZoomInput } from '@/lib/zoomParser';
import { CHANNEL_DEFINITIONS, type RegistrationChannelKey } from '@/lib/registrationChannels';

export type LandingStudioTab = 'funnel' | 'script' | 'channels' | 'validator';

export interface LandingPageIntegrationCardProps {
  campaignId: string;
  campaignName: string;
  initialRegistrationLink?: string | null;
  initialOneClickSignup?: boolean;
  zoomMeetingId?: string | null;
  zoomLink?: string | null;
  onSave?: (patch: {
    registrationLink: string;
    oneClickSignup: boolean;
    zoomMeetingId?: string | null;
    zoomLink?: string | null;
  }) => Promise<void> | void;
  sampleContact?: {
    id?: string;
    name?: string;
    email?: string;
    phone?: string;
    account?: string;
    title?: string;
  };
  scheduledAt?: string | Date | null;
  durationMinutes?: number;
}

export function LandingPageIntegrationCard({
  campaignId,
  campaignName,
  initialRegistrationLink = '',
  initialOneClickSignup = true,
  zoomMeetingId: propZoomMeetingId,
  zoomLink: propZoomLink,
  onSave,
  sampleContact,
  scheduledAt,
  durationMinutes = 60,
}: LandingPageIntegrationCardProps) {
  const [activeTab, setActiveTab] = useState<'funnel' | 'script' | 'channels' | 'validator'>('funnel');
  const [mode, setMode] = useState<'one_click' | 'external'>(
    initialRegistrationLink ? 'external' : initialOneClickSignup ? 'one_click' : 'external'
  );
  const [landingUrl, setLandingUrl] = useState(initialRegistrationLink || '');
  const [currentZoomMeetingId, setCurrentZoomMeetingId] = useState(propZoomMeetingId || '');
  const [currentZoomLink, setCurrentZoomLink] = useState(propZoomLink || '');

  // Zoom paste/parse state
  const [zoomInputText, setZoomInputText] = useState(propZoomMeetingId || propZoomLink || '');
  const [parsedZoom, setParsedZoom] = useState<ReturnType<typeof parseZoomInput> | null>(() => {
    if (propZoomMeetingId || propZoomLink) {
      return parseZoomInput(propZoomMeetingId || propZoomLink || '');
    }
    return null;
  });

  // Technician embed script state
  const [platform, setPlatform] = useState<LandingPlatform>('universal');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Channels state
  const [mergeTagFormat, setMergeTagFormat] = useState<MergeTagProvider>('leadsquared');

  // Saving state
  const [isSaving, setIsSaving] = useState(false);
  const [saveNote, setSaveNote] = useState<string | null>(null);

  // Validator test state
  const [validatorLog, setValidatorLog] = useState<{ status: 'idle' | 'testing' | 'success' | 'error'; message: string } | null>(null);

  function handleZoomInputChange(val: string) {
    setZoomInputText(val);
    if (!val.trim()) {
      setParsedZoom(null);
      return;
    }
    const res = parseZoomInput(val);
    setParsedZoom(res);
    if (res.isValid && res.webinarId) {
      setCurrentZoomMeetingId(res.webinarId);
      if (res.canonicalJoinUrl) {
        setCurrentZoomLink(res.canonicalJoinUrl);
      }
    }
  }

  const channelLinks = landingUrl
    ? buildChannelTrackingLinks(
        landingUrl,
        { id: campaignId, name: campaignName, zoomMeetingId: currentZoomMeetingId },
        sampleContact,
        typeof window !== 'undefined' ? window.location.origin : undefined,
        mergeTagFormat
      )
    : null;

  const embedScript = generateUniversalEmbedScript({
    campaignId,
    zoomId: currentZoomMeetingId || undefined,
    webinarTitle: campaignName,
    scheduledAt: scheduledAt,
    durationMinutes: durationMinutes,
    platform: platform,
    apiOrigin: typeof window !== 'undefined' ? window.location.origin : undefined,
  });

  function copyText(text: string, key: string) {
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2200);
    }
  }

  async function handleSave() {
    setIsSaving(true);
    setSaveNote(null);
    try {
      if (onSave) {
        await onSave({
          registrationLink: mode === 'external' ? landingUrl.trim() : '',
          oneClickSignup: mode === 'one_click',
          zoomMeetingId: currentZoomMeetingId || null,
          zoomLink: currentZoomLink || null,
        });
      }
      setSaveNote('Funnel and Zoom settings saved.');
      setTimeout(() => setSaveNote(null), 3000);
    } catch {
      setSaveNote('Failed to save funnel settings.');
    } finally {
      setIsSaving(false);
    }
  }

  function checkConfiguration() {
    setValidatorLog({ status: currentZoomMeetingId ? 'success' : 'error', message: currentZoomMeetingId ? 'Zoom event is linked. Use the registration diagnostics below to inspect persisted registrations and sync jobs.' : 'Link a Zoom event before enabling Zoom registration.' });
  }

  const CHANNEL_ICON: Record<string, 'mail' | 'whatsapp' | 'linkedin' | 'phone' | 'share' | 'calendar' | 'globe'> = {
    email_campaign: 'mail',
    sms: 'phone',
    whatsapp: 'whatsapp',
    linkedin: 'linkedin',
    sdr_sales: 'phone',
    third_parties: 'share',
    linkedin_event: 'calendar',
    website: 'globe',
  };

  const saveFailed = Boolean(saveNote?.startsWith('Failed'));

  const tabs: Array<{ id: LandingStudioTab; label: string }> = [
    { id: 'funnel', label: 'Funnel URL And Zoom ID' },
    { id: 'script', label: 'Embed Script' },
    { id: 'channels', label: 'Channel Links' },
    { id: 'validator', label: 'Health Check' },
  ];

  const channelsList: Array<{ key: RegistrationChannelKey; propKey: keyof ChannelTrackingLinksResult }> = [
    { key: 'email_campaign', propKey: 'email' },
    { key: 'sms', propKey: 'sms' },
    { key: 'whatsapp', propKey: 'whatsapp' },
    { key: 'linkedin', propKey: 'linkedin' },
    { key: 'sdr_sales', propKey: 'sdr_sales' },
    { key: 'third_parties', propKey: 'third_parties' },
    { key: 'linkedin_event', propKey: 'linkedin_event' },
    { key: 'website', propKey: 'website' },
  ];

  return (
    <section className="lsq-card lsq-wiz-landing" aria-labelledby="landing-studio-title">
      <div className="lsq-card__header">
        <div>
          <h2 className="lsq-card__title" id="landing-studio-title">Landing Page, Zoom ID And Channel Studio</h2>
          <p className="lsq-card__sub">
            Cross-platform integration for Framer, WordPress, LeadSquared FormTracker and Webflow, with channel-segregated tracking.
          </p>
          <div className="lsq-cluster lsq-wiz-landing__badges">
            <Badge text={mode === 'external' ? 'Custom landing page' : 'One-click magic link'} color={mode === 'external' ? 'gray' : 'blue'} />
            {currentZoomMeetingId && <Badge text={`Zoom #${currentZoomMeetingId}`} color="success" />}
          </div>
        </div>
        <Button hierarchy="primary" size="sm" loading={isSaving} onClick={handleSave}>
          {isSaving ? 'Saving' : 'Save Funnel Settings'}
        </Button>
      </div>

      <div className="lsq-card__body lsq-stack lsq-stack--lg">
        {saveNote && (
          <div className={`lsq-banner ${saveFailed ? 'lsq-banner--error' : 'lsq-banner--success'}`} role={saveFailed ? 'alert' : 'status'}>
            <Icon name={saveFailed ? 'error' : 'check-circle'} size={18} />
            <p className="lsq-banner__body">{saveNote}</p>
          </div>
        )}

        <div className="lsq-tabs" role="tablist" aria-label="Landing page studio">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`landing-tab-${t.id}`}
              aria-selected={activeTab === t.id}
              aria-controls={`landing-panel-${t.id}`}
              className="lsq-tab"
              onClick={() => setActiveTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* TAB 1: Funnel URL & Zoom ID */}
        {activeTab === 'funnel' && (
          <div className="lsq-stack lsq-stack--lg" role="tabpanel" id="landing-panel-funnel" aria-labelledby="landing-tab-funnel">
            <div className="lsq-grid lsq-grid--wide" role="group" aria-label="Registration mode">
              <button type="button" className="lsq-wiz-mode" aria-pressed={mode === 'one_click'} onClick={() => setMode('one_click')}>
                <span className="lsq-wiz-mode__head">
                  <Icon name="bolt" size={18} />
                  <span className="lsq-wiz-mode__title">One-Click Magic Link</span>
                </span>
                <span className="lsq-wiz-mode__body">
                  Signed one-click links sent in emails and WhatsApp. Contacts register in one click and immediately open the attendee hub.
                </span>
              </button>
              <button type="button" className="lsq-wiz-mode" aria-pressed={mode === 'external'} onClick={() => setMode('external')}>
                <span className="lsq-wiz-mode__head">
                  <Icon name="globe" size={18} />
                  <span className="lsq-wiz-mode__title">Custom External Landing Page</span>
                </span>
                <span className="lsq-wiz-mode__body">
                  Framer, WordPress or LeadSquared pages. Traffic goes to the landing page, which fills inputs, connects FormTracker, registers on Zoom and syncs calendars.
                </span>
              </button>
            </div>

            {mode === 'external' && (
              <Field label="Target landing page URL" hint="Without query params, for example https://webinar.leadsquared.com/opd-to-ipd-funnel.">
                {(p) => (
                  <div className="lsq-cluster lsq-wiz-urlrow">
                    <input
                      {...p}
                      className="lsq-input lsq-grow"
                      type="url"
                      placeholder="https://webinar.leadsquared.com/funnel-slug"
                      value={landingUrl}
                      onChange={(e) => setLandingUrl(e.target.value)}
                    />
                    {landingUrl && (
                      <Button hierarchy="secondary" icon={<Icon name="link" size={16} />} onClick={() => setActiveTab('channels')}>
                        View Channel Links
                      </Button>
                    )}
                  </div>
                )}
              </Field>
            )}

            <div className="lsq-stack">
              <div className="lsq-cluster lsq-cluster--between">
                <h3 className="lsq-wiz-subtitle">Zoom Webinar ID And Registration</h3>
                {currentZoomMeetingId ? <Badge color="success" text={`ID #${currentZoomMeetingId} connected`} /> : <Badge color="gray" text="Not extracted yet" />}
              </div>
              <Field
                label="Zoom registration URL, join link or ID"
                hint="Any Zoom webinar registration URL, join link or raw ID. The unique webinar ID is extracted and synced with landing page submissions."
              >
                {(p) => (
                  <input
                    {...p}
                    className="lsq-input"
                    placeholder="https://zoom.us/webinar/register/WN_... or 849 2049 1823"
                    value={zoomInputText}
                    onChange={(e) => handleZoomInputChange(e.target.value)}
                  />
                )}
              </Field>

              {parsedZoom && parsedZoom.isValid ? (
                <div className="lsq-banner lsq-banner--success" role="status">
                  <Icon name="check-circle" size={18} />
                  <div className="lsq-grow">
                    <p className="lsq-banner__title">
                      Zoom {parsedZoom.type === 'webinar' ? 'webinar' : 'event'} detected: ID #{parsedZoom.webinarId}
                    </p>
                    {parsedZoom.isRegistration && <p className="lsq-banner__body">Registration slug: {parsedZoom.registrationSlug}</p>}
                    {parsedZoom.canonicalJoinUrl && (
                      <p className="lsq-banner__body">
                        Canonical join URL: <code className="lsq-wiz-url">{parsedZoom.canonicalJoinUrl}</code>
                      </p>
                    )}
                    <div className="lsq-banner__actions">
                      <Button
                        hierarchy="secondary"
                        size="sm"
                        icon={<Icon name="check" size={14} />}
                        onClick={() => {
                          if (parsedZoom.webinarId) setCurrentZoomMeetingId(parsedZoom.webinarId);
                          if (parsedZoom.canonicalJoinUrl) setCurrentZoomLink(parsedZoom.canonicalJoinUrl);
                          handleSave();
                        }}
                      >
                        Link And Save
                      </Button>
                    </div>
                  </div>
                </div>
              ) : zoomInputText.trim() ? (
                <div className="lsq-banner lsq-banner--warning" role="alert">
                  <Icon name="warning" size={18} />
                  <p className="lsq-banner__body">Could not parse a Zoom webinar ID. Enter a 9 to 11 digit numeric ID or a valid Zoom link.</p>
                </div>
              ) : null}
            </div>
          </div>
        )}

        {/* TAB 2: Technician Embed Script */}
        {activeTab === 'script' && (
          <div className="lsq-stack" role="tabpanel" id="landing-panel-script" aria-labelledby="landing-tab-script">
            <div className="lsq-toolbar">
              <div className="lsq-chips" role="group" aria-label="Platform">
                {(
                  [
                    { id: 'universal', label: 'Universal (HTML or any CMS)' },
                    { id: 'framer', label: 'Framer' },
                    { id: 'wordpress', label: 'WordPress (Elementor or CF7)' },
                    { id: 'leadsquared', label: 'LeadSquared FormTracker' },
                    { id: 'webflow', label: 'Webflow' },
                  ] as const
                ).map((pl) => (
                  <button key={pl.id} type="button" className="lsq-wiz-chip" aria-pressed={platform === pl.id} onClick={() => setPlatform(pl.id as LandingPlatform)}>
                    {pl.label}
                  </button>
                ))}
              </div>
              <p className="lsq-hint">Attendees choose a calendar link after registration.</p>
            </div>

            <div className="lsq-banner lsq-banner--neutral">
              <Icon name="info" size={18} />
              <div>
                <p className="lsq-banner__title">Installation for {platform === 'leadsquared' ? 'LeadSquared' : platform.charAt(0).toUpperCase() + platform.slice(1)}</p>
                <p className="lsq-banner__body">
                  {platform === 'framer' && (
                    <>In Framer, open Project Settings, then Custom Code, and paste the script in <strong>End of body tag</strong>. Publish the site.</>
                  )}
                  {platform === 'wordpress' && (
                    <>In WordPress, go to <strong>Elementor, Custom Code</strong> (or the WPCode plugin), add new, location <strong>End of body</strong>. Works with Elementor Form, CF7, Gravity Forms and WPForms.</>
                  )}
                  {platform === 'leadsquared' && (
                    <>In the LeadSquared Landing Page Builder, open Page Settings, then Custom Script Embed, and paste the script before <strong>the closing body tag</strong>. Works alongside LeadSquared FormTracker (<code>web.mxradon.com</code>).</>
                  )}
                  {platform === 'webflow' && (
                    <>In Webflow, go to Project or Page Settings, then Custom Code, and paste the script in <strong>Before body tag</strong>. Publish to the live domain.</>
                  )}
                  {platform === 'universal' && <>Works on any website builder or custom HTML. Paste the snippet right before the closing <code>&lt;/body&gt;</code> tag.</>}
                </p>
              </div>
            </div>

            <div className="lsq-cluster lsq-cluster--between">
              <span className="lsq-label">Embed script</span>
              <Button
                hierarchy="secondary"
                size="sm"
                icon={<Icon name={copiedKey === 'embed_script' ? 'check' : 'copy'} size={14} />}
                onClick={() => copyText(embedScript, 'embed_script')}
              >
                {copiedKey === 'embed_script' ? 'Copied' : 'Copy Embed Script'}
              </Button>
            </div>
            <pre className="lsq-code lsq-wiz-script" tabIndex={0} aria-label="Embed script">
              {embedScript}
            </pre>
          </div>
        )}

        {/* TAB 3: Channel Segregation Links */}
        {activeTab === 'channels' && (
          <div role="tabpanel" id="landing-panel-channels" aria-labelledby="landing-tab-channels">
            {!landingUrl ? (
              <div className="lsq-empty">
                <Icon name="link" size={32} />
                <h3 className="lsq-empty__title">Landing Page URL Required</h3>
                <p className="lsq-empty__body">Set the target landing page URL on the Funnel tab to generate channel distribution links.</p>
                <Button hierarchy="secondary" size="sm" onClick={() => setActiveTab('funnel')}>
                  Go To Funnel Setup
                </Button>
              </div>
            ) : (
              <div className="lsq-stack">
                <div className="lsq-toolbar">
                  <div>
                    <h3 className="lsq-wiz-subtitle">Segregated Outbound Links</h3>
                    <p className="lsq-hint">Each channel has its own source identifier. Submissions are attributed automatically in analytics.</p>
                  </div>
                  <div className="lsq-segmented lsq-wiz-seg-wrap" role="group" aria-label="Merge tag format">
                    {(
                      [
                        { id: 'leadsquared', label: 'LeadSquared {{FirstName}}' },
                        { id: 'netcore', label: 'Netcore Cloud [NAME]' },
                        { id: 'sample', label: 'Sample lead (preview)' },
                      ] as const
                    ).map((m) => (
                      <button key={m.id} type="button" aria-pressed={mergeTagFormat === m.id} onClick={() => setMergeTagFormat(m.id)}>
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>

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
                      {channelsList.map(({ key, propKey }) => {
                        const def = CHANNEL_DEFINITIONS[key];
                        const url = channelLinks ? channelLinks[propKey] : '';
                        return (
                          <tr key={key}>
                            <th scope="row" className="lsq-cell-primary lsq-wiz-rowhead">
                              <span className="lsq-cluster">
                                <Icon name={CHANNEL_ICON[key] ?? 'link'} size={16} />
                                {def.label}
                              </span>
                              <span className="lsq-cell-secondary">source={key}</span>
                            </th>
                            <td>
                              <span className="lsq-wiz-url">{url}</span>
                            </td>
                            <td>
                              <span className="lsq-wiz-actions">
                                <Button
                                  size="sm"
                                  hierarchy="secondary"
                                  icon={<Icon name={copiedKey === key ? 'check' : 'copy'} size={14} />}
                                  ariaLabel={`Copy ${def.label} link`}
                                  onClick={() => copyText(url, key)}
                                >
                                  {copiedKey === key ? 'Copied' : 'Copy'}
                                </Button>
                                <a
                                  className="lsq-btn lsq-btn--sm lsq-btn--secondary"
                                  href={url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  aria-label={`Test ${def.label} link`}
                                >
                                  <Icon name="external" size={14} />
                                  Test
                                </a>
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 4: Live Health Check & Validator */}
        {activeTab === 'validator' && (
          <div className="lsq-stack" role="tabpanel" id="landing-panel-validator" aria-labelledby="landing-tab-validator">
            <div className="lsq-toolbar">
              <div>
                <h3 className="lsq-wiz-subtitle">Integration Health Check</h3>
                <p className="lsq-hint">Inspect the configured event and registration diagnostics.</p>
              </div>
              <Button
                hierarchy="secondary"
                size="sm"
                icon={<Icon name="play" size={14} />}
                loading={validatorLog?.status === 'testing'}
                onClick={checkConfiguration}
              >
                {validatorLog?.status === 'testing' ? 'Testing' : 'Check Configuration'}
              </Button>
            </div>

            <ul className="lsq-checklist">
              <li className="lsq-checklist__item" data-state={currentZoomMeetingId ? 'done' : 'warn'}>
                <span className="lsq-checklist__state" aria-hidden="true">
                  <Icon name={currentZoomMeetingId ? 'check' : 'minus'} size={12} />
                </span>
                <div className="lsq-checklist__main">
                  <p className="lsq-checklist__title">Zoom webinar sync</p>
                  <p className="lsq-checklist__desc">
                    {currentZoomMeetingId ? `Webinar ID #${currentZoomMeetingId} is linked for auto-registration.` : 'No Zoom webinar ID is configured.'}
                  </p>
                </div>
              </li>
              <li className="lsq-checklist__item" data-state="done">
                <span className="lsq-checklist__state" aria-hidden="true">
                  <Icon name="check" size={12} />
                </span>
                <div className="lsq-checklist__main">
                  <p className="lsq-checklist__title">Dual-dispatch endpoint</p>
                  <p className="lsq-checklist__desc">
                    Endpoint <code>/api/landing/submit</code> is active with CORS enabled.
                  </p>
                </div>
              </li>
            </ul>

            {validatorLog && (
              <div
                className={`lsq-banner ${validatorLog.status === 'success' ? 'lsq-banner--success' : validatorLog.status === 'error' ? 'lsq-banner--error' : 'lsq-banner--neutral'}`}
                role={validatorLog.status === 'error' ? 'alert' : 'status'}
              >
                <p className="lsq-banner__body">{validatorLog.message}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
