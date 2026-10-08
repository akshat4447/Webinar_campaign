'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { ResultBanner } from './ResultBanner';
import { INTEGRATION_FIELDS, REFERENCE_ONLY } from '@/lib/integrationFields';
import { getIntegrationConfigMaskedAction, saveIntegrationConfigAction, testIntegrationAction, discoverSenderAction } from '@/lib/actions/integrations';
import { discoverNetcoreSenderAction } from '@/lib/actions/netcore';
import { SuppressionListModal } from './SuppressionListModal';
import { useOrigin } from '@/lib/useOrigin';

const EXPLANATION: Record<string, string> = {
  linkedin:
    "Outreach is manual by design — scripted LinkedIn messaging breaches their terms and risks account restriction. What the app does instead: Apollo verifies every queued contact before you reach out, and LinkedIn Events run through the official API with Lead Sync streaming registrations back in.",
};

export function IntegrationPanel({
  id,
  name,
  panelId,
  onClose,
  onChanged,
}: {
  id: string;
  name: string;
  /** DOM id so the card's Configure button can point at this region with aria-controls. */
  panelId?: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const fields = INTEGRATION_FIELDS[id] ?? [];
  const explanatoryOnly = fields.length === 0;
  const referenceOnly = REFERENCE_ONLY.includes(id);

  const [masked, setMasked] = useState<Record<string, { hasValue: boolean }> | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; detail: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [finding, setFinding] = useState(false);
  const [senderNote, setSenderNote] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const [netcoreNote, setNetcoreNote] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [suppressionModalOpen, setSuppressionModalOpen] = useState(false);
  const [webhookCopied, setWebhookCopied] = useState(false);
  const origin = useOrigin();

  useEffect(() => {
    if (explanatoryOnly) return;
    getIntegrationConfigMaskedAction(id).then(setMasked);
  }, [id, explanatoryOnly]);

  // Escape collapses the panel from anywhere on the page, as the dialog it replaced did, unless the
  // suppression-list dialog is open on top (that one handles its own Escape).
  useEffect(() => {
    if (suppressionModalOpen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, suppressionModalOpen]);

  const dirty = Object.values(values).some((v) => v.trim() !== '');

  async function test() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await testIntegrationAction(id, values);
      setTestResult(res);
      if (res.autoDiscovered) {
        const ad = res.autoDiscovered;
        setValues((v) => ({
          ...v,
          domain: ad.domain,
          fromEmail: ad.fromEmail,
          fromName: ad.fromName,
        }));
        setMasked(await getIntegrationConfigMaskedAction(id));
      }
      onChanged();
    } catch (err) {
      setTestResult({ ok: false, detail: err instanceof Error ? err.message : 'Connection test failed' });
    } finally {
      setTesting(false);
    }
  }

  // Sends no email: each candidate is validated against an undeliverable
  // reserved-TLD recipient, so LeadSquared checks the identity and then finds
  // nobody to deliver to.
  async function findSender() {
    setFinding(true);
    setSenderNote(null);
    try {
      const res = await discoverSenderAction(true);
      if (!res.ok) {
        setSenderNote({ tone: 'bad', text: res.error });
        return;
      }
      if (res.sender) {
        setSenderNote({
          tone: 'good',
          text: `Saved "${res.sender}" as the sender — accepted by LeadSquared after ${res.attempts.length} check(s) of ${res.activeUsers} active users. No email was sent.`,
        });
        setMasked(await getIntegrationConfigMaskedAction(id));
        onChanged();
      } else {
        setSenderNote({ tone: 'bad', text: res.note });
      }
    } catch (err) {
      setSenderNote({ tone: 'bad', text: err instanceof Error ? err.message : 'Failed to discover sender' });
    } finally {
      setFinding(false);
    }
  }

  // Queries Netcore API to discover verified domains and auto-fills sender fields
  async function fetchNetcoreSender() {
    setFinding(true);
    setNetcoreNote(null);
    try {
      const apiKey = values['apiKey'];
      const res = await discoverNetcoreSenderAction(apiKey);
      if (!res.ok) {
        setNetcoreNote({ tone: 'bad', text: res.error || 'Failed to find verified domains' });
        return;
      }
      setValues((v) => ({
        ...v,
        domain: res.domain || '',
        fromEmail: res.fromEmail || '',
        fromName: res.fromName || 'Webinar Team',
      }));
      setNetcoreNote({
        tone: 'good',
        text: `Auto-detected verified domain "${res.domain}" and configured From address "${res.fromEmail}". Use Save or Test Connection to confirm.`,
      });
      setMasked(await getIntegrationConfigMaskedAction(id));
      onChanged();
    } catch (err) {
      setNetcoreNote({ tone: 'bad', text: err instanceof Error ? err.message : 'Failed to discover Netcore sender' });
    } finally {
      setFinding(false);
    }
  }

  async function save() {
    if (!dirty) return;
    setSaving(true);
    setSaveError(null);
    try {
      await saveIntegrationConfigAction(id, values);
      setSaved(true);
      setValues({});
      const next = await getIntegrationConfigMaskedAction(id);
      setMasked(next);
      onChanged();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div
        id={panelId}
        className="lsq-int-panel"
        role="group"
        aria-label={`${name} settings`}
      >
        <h4 className="lsq-int-panel__title">{explanatoryOnly ? 'No credentials needed' : 'Connection settings'}</h4>

        {explanatoryOnly ? (
          <div className="lsq-int-note">{EXPLANATION[id]}</div>
        ) : (
          fields
            .filter((f) => !f.internal)
            .map((f) => {
              const hasSaved = !!masked?.[f.key]?.hasValue;
              const clearing = values[f.key] === '__CLEAR__';
              return (
                <Field
                  key={f.key}
                  label={f.label}
                  optional={f.optional}
                  hint={f.secret && hasSaved && !clearing ? 'A value is saved and never shown. Leave blank to keep it.' : undefined}
                >
                  {(p) => (
                    <>
                      <input
                        {...p}
                        className="lsq-input"
                        type={f.secret ? 'password' : 'text'}
                        autoComplete={f.secret ? 'new-password' : 'off'}
                        value={clearing ? '' : (values[f.key] ?? '')}
                        onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                        placeholder={
                          clearing
                            ? 'Cleared. Save to remove.'
                            : hasSaved
                              ? 'Saved. Leave blank to keep.'
                              : f.placeholder
                        }
                      />
                      {hasSaved && (
                        <div>
                          <button
                            type="button"
                            className="lsq-linkbtn"
                            data-danger={clearing ? 'true' : undefined}
                            onClick={() => setValues((v) => ({ ...v, [f.key]: v[f.key] === '__CLEAR__' ? '' : '__CLEAR__' }))}
                          >
                            {clearing ? 'Will clear on save. Undo' : 'Clear saved value'}
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </Field>
              );
            })
        )}

        {!explanatoryOnly && (
          <>
            {id === 'lsq' && (
              <div className="lsq-stack lsq-stack--sm">
                <div>
                  <Button hierarchy="secondary" size="sm" icon={<Icon name="search" size={16} />} onClick={findSender} loading={finding}>
                    {finding ? 'Checking Senders…' : 'Find a Working Sender'}
                  </Button>
                </div>
                <p className="lsq-hint">
                  The sender must be an active user in this tenant. This checks the tenant&apos;s users and saves the first one
                  LeadSquared accepts, without sending any email.
                </p>
                {senderNote && (
                  <ResultBanner tone={senderNote.tone === 'good' ? 'success' : 'error'}>{senderNote.text}</ResultBanner>
                )}
                <div className="lsq-int-note">
                  <p className="lsq-int-note__title">Outbound Messaging Note</p>
                  <p>
                    SMS and WhatsApp delivery modes (LeadSquared Automation or Direct Gateway REST API) and their testing are configured on the dedicated <strong>SMS &amp; WhatsApp Business</strong> card.
                  </p>
                </div>
              </div>
            )}

            {id === 'zoom' && (
              <div className="lsq-stack">
                <div className="lsq-int-note">
                  <p className="lsq-int-note__title">Two Ways to Connect Zoom</p>
                  <p>
                    <strong>Option 1: Server-to-Server OAuth (recommended, permanent).</strong> In Zoom Marketplace go to <strong>Develop, Build App, Server-to-Server OAuth</strong>. Copy the <strong>Account ID</strong>, <strong>Client ID</strong> and <strong>Client Secret</strong> into the fields above, then use <strong>Save</strong> and <strong>Test Connection</strong>. No redirect URLs, browser logins or tunnels are needed, and it never expires.
                  </p>
                  <p>
                    <strong>Option 2: User-managed OAuth app.</strong> In Zoom Marketplace open the app, then <strong>App Credentials, Development</strong>. Paste this exact URL into both <strong>OAuth Redirect URL</strong> and <strong>OAuth allow list</strong>, and choose <strong>Continue</strong> to save. Then use <strong>Connect With Zoom</strong>.
                  </p>
                  <div className="lsq-code lsq-code--wrap lsq-int-select-all">
                    https://lsq-webinar-campaign.loca.lt/api/auth/zoom/callback
                  </div>
                </div>
                <div>
                  <a
                    href="/api/auth/zoom/connect"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="lsq-btn lsq-btn--sm lsq-btn--secondary-color lsq-int-link"
                  >
                    <Icon name="external" size={16} />
                    Connect With Zoom (User OAuth)
                  </a>
                </div>
                <p className="lsq-hint">
                  For Server-to-Server OAuth (Option 1), choose Test Connection after saving the Account ID, Client ID and Client Secret.
                </p>
              </div>
            )}

            {id === 'linkedin' && (
              <div className="lsq-stack">
                <div className="lsq-int-note">
                  <p className="lsq-int-note__title">OAuth Redirect URL</p>
                  <div suppressHydrationWarning className="lsq-code lsq-code--wrap lsq-int-select-all">
                    {origin ? `${origin}/api/auth/linkedin/callback` : 'Loading…'}
                  </div>
                  <p>
                    Derived from the address this page is open on. Add this exact value to the LinkedIn app&apos;s Authorized redirect URLs before connecting.
                  </p>
                </div>
                <div>
                  <a
                    href="/api/auth/linkedin/connect"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="lsq-btn lsq-btn--sm lsq-btn--secondary-color lsq-int-link"
                  >
                    <Icon name="linkedin" size={16} />
                    Connect With LinkedIn
                  </a>
                </div>
                <p className="lsq-hint">
                  Authorizes the Page for Events, registration forms and Lead Sync (r_events, rw_events, leadgen automation). Tokens are stored server-side only. Opens in a new tab.
                </p>
              </div>
            )}

            {id === 'netcore' && (
              <div className="lsq-stack">
                <div className="lsq-int-note">
                  <div>
                    <Button hierarchy="secondary" size="sm" icon={<Icon name="search" size={16} />} onClick={fetchNetcoreSender} loading={finding}>
                      {finding ? 'Fetching Verified Domains…' : 'Auto-Fetch Verified Domain and From Email'}
                    </Button>
                  </div>
                  <p>Connects to the Netcore API to discover verified sending domains and fills in the From email and domain.</p>
                  {netcoreNote && (
                    <ResultBanner tone={netcoreNote.tone === 'good' ? 'success' : 'error'}>{netcoreNote.text}</ResultBanner>
                  )}
                </div>
                <div className="lsq-int-note">
                  <p className="lsq-int-note__title">Netcore Cloud Delivery and Webhook</p>
                  <p>
                    Sends transactional and promotional email directly through the Netcore CPaaS v5 API. Delivery reports, bounces and click events stream back to this webhook endpoint in real time.
                  </p>
                  <div className="lsq-int-url">
                    <strong>Inbound webhook URL</strong>
                    <button
                      type="button"
                      className="lsq-linkbtn"
                      onClick={() => {
                        if (origin) {
                          navigator.clipboard.writeText(`${origin}/api/webhooks/netcore`);
                          setWebhookCopied(true);
                          setTimeout(() => setWebhookCopied(false), 2000);
                        }
                      }}
                    >
                      {webhookCopied ? 'Copied' : 'Copy URL'}
                    </button>
                  </div>
                  <div suppressHydrationWarning className="lsq-code lsq-code--wrap lsq-int-select-all">
                    {origin ? `${origin}/api/webhooks/netcore` : 'Loading…'}
                  </div>
                  <p>
                    Paste this URL into Netcore Cloud under <em>Settings, Webhooks, Add Webhook</em> for Delivery, Bounce, Unsubscribe and Click events.
                  </p>
                </div>
                <div>
                  <Button hierarchy="secondary" size="sm" icon={<Icon name="shield" size={16} />} onClick={() => setSuppressionModalOpen(true)}>
                    View Suppression List
                  </Button>
                </div>
              </div>
            )}

            {referenceOnly ? (
              <p className="lsq-hint">
                No live API to test here, these are reference values only. SMS and WhatsApp still send through LeadSquared,
                configured on the LeadSquared card.
              </p>
            ) : (
              testResult && (
                <ResultBanner tone={testResult.ok ? 'success' : 'error'} title={testResult.ok ? 'Connection Works' : 'Connection Failed'}>
                  {testResult.detail}
                </ResultBanner>
              )
            )}
          </>
        )}

        {saveError && <ResultBanner tone="error" title="Save Failed">{saveError}</ResultBanner>}

        <div className="lsq-int-panel__footer">
          <Button hierarchy="tertiary" size="sm" onClick={onClose}>
            {explanatoryOnly ? 'Close' : 'Cancel'}
          </Button>
          {!explanatoryOnly && !referenceOnly && (
            <Button hierarchy="secondary" size="sm" icon={<Icon name="plug" size={16} />} onClick={test} loading={testing}>
              {testing ? 'Testing…' : 'Test Connection'}
            </Button>
          )}
          {!explanatoryOnly && (
            <Button hierarchy={dirty ? 'primary' : 'secondary'} size="sm" onClick={save} disabled={!dirty} loading={saving}>
              {saving ? 'Saving…' : !dirty && saved ? 'Saved' : 'Save'}
            </Button>
          )}
        </div>
      </div>

      {suppressionModalOpen && (
        <SuppressionListModal
          onClose={() => setSuppressionModalOpen(false)}
          onChanged={() => onChanged()}
        />
      )}
    </>
  );
}
