'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { INTEGRATION_FIELDS, REFERENCE_ONLY } from '@/lib/integrationFields';
import { getIntegrationConfigMaskedAction, saveIntegrationConfigAction, testIntegrationAction, discoverSenderAction } from '@/lib/actions/integrations';

const EXPLANATION: Record<string, string> = {
  linkedin:
    "Outreach is manual by design — scripted LinkedIn messaging breaches their terms and risks account restriction. What the app does instead: Apollo verifies every queued contact before you reach out, and LinkedIn Events run through the official API with Lead Sync streaming registrations back in.",
};

export function IntegrationPanel({ id, name, onClose, onChanged }: { id: string; name: string; onClose: () => void; onChanged: () => void }) {
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
  const [saveError, setSaveError] = useState<string | null>(null);
  // Whatever host the browser is actually on right now — localhost, a tunnel
  // (Cloudflare/ngrok), or a real deployment. Never hardcode a specific one:
  // a quick-tunnel hostname is random per session and dead the moment that
  // tunnel process ends, so baking one in goes stale immediately. Lazy init
  // rather than an effect: `window` isn't there during SSR, but by the time
  // this client component actually mounts in the browser it always is, so
  // there's no real "external system" to synchronize after the fact.
  const [origin] = useState(() => (typeof window !== 'undefined' ? window.location.origin : ''));

  useEffect(() => {
    if (explanatoryOnly) return;
    getIntegrationConfigMaskedAction(id).then(setMasked);
  }, [id, explanatoryOnly]);

  const dirty = Object.values(values).some((v) => v.trim() !== '');

  async function test() {
    setTesting(true);
    setTestResult(null);
    const res = await testIntegrationAction(id, values);
    setTestResult(res);
    setTesting(false);
    onChanged();
  }

  // Sends no email: each candidate is validated against an undeliverable
  // reserved-TLD recipient, so LeadSquared checks the identity and then finds
  // nobody to deliver to.
  async function findSender() {
    setFinding(true);
    setSenderNote(null);
    const res = await discoverSenderAction(true);
    setFinding(false);
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
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(16,20,25,0.45)', zIndex: 1200 }} />
      <div
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 480,
          maxHeight: 'calc(100vh - 48px)',
          background: '#fff',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-panel)',
          zIndex: 1201,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div style={{ flexShrink: 0, padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'start', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 'var(--fs-body)', fontWeight: 700, color: 'var(--n90)' }}>{name}</div>
            <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--n60)', marginTop: 3 }}>{explanatoryOnly ? 'No credentials needed' : 'Connection settings'}</div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{ cursor: 'pointer', width: 28, height: 28, borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, border: 'none', background: 'transparent', padding: 0 }}
          >
            <Icon name="close" size={16} style={{ color: 'var(--n60)' }} />
          </button>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: '18px 20px 20px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {explanatoryOnly ? (
            <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--n70)', lineHeight: 1.6 }}>{EXPLANATION[id]}</div>
          ) : (
            fields.map((f) => (
              <div key={f.key}>
                <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--n60)', marginBottom: 6 }}>
                  {f.label}
                  {f.optional && <span style={{ color: 'var(--n50)' }}> (optional)</span>}
                </div>
                <input
                  className="lsq-input"
                  type={f.secret ? 'password' : 'text'}
                  aria-label={f.label}
                  value={values[f.key] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  placeholder={masked?.[f.key]?.hasValue ? '•••• saved — leave blank to keep' : f.placeholder}
                  style={{ width: '100%' }}
                />
              </div>
            ))
          )}

          {!explanatoryOnly && (
            <div>
              {id === 'lsq' && (
                <div style={{ marginBottom: 12 }}>
                  <Button hierarchy="secondary" size="sm" onClick={findSender} disabled={finding}>
                    {finding ? 'Checking senders…' : 'Find a working sender'}
                  </Button>
                  <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n50)', marginTop: 6, lineHeight: 1.5 }}>
                    The sender must be an active user in <em>this</em> tenant. This checks your users and saves the first one
                    LeadSquared accepts — without sending any email.
                  </div>
                  {senderNote && (
                    <div style={{ fontSize: 'var(--fs-label-2)', fontWeight: 600, marginTop: 6, color: senderNote.tone === 'good' ? 'var(--success-700)' : 'var(--danger-500)', overflowWrap: 'anywhere' }}>
                      {senderNote.text}
                    </div>
                  )}
                </div>
              )}
              {id === 'lsq' && (
                <div style={{ marginBottom: 12, padding: 10, background: 'var(--n10)', borderRadius: 'var(--radius-md)', fontSize: 'var(--fs-label-2)', color: 'var(--n70)', lineHeight: 1.6 }}>
                  <strong style={{ display: 'block', marginBottom: 4 }}>Outbound Messaging Note</strong>
                  SMS &amp; WhatsApp delivery dispatch modes (LeadSquared Automation vs. Direct Gateway REST API) and testing are configured under the dedicated <strong>SMS &amp; WhatsApp Business</strong> integration card.
                </div>
              )}
              {id === 'zoom' && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ marginBottom: 10, padding: 10, background: 'var(--n10)', borderRadius: 'var(--radius-md)', fontSize: 'var(--fs-label-2)', color: 'var(--n70)', lineHeight: 1.6 }}>
                    A User-managed OAuth app&apos;s Client ID and Client Secret (Zoom Marketplace → Build App → OAuth), the same
                    app type a real Zoom Marketplace integration uses. Its Scopes tab needs these added:{' '}
                    <code>meeting:read:list_meetings</code>, <code>meeting:read:meeting</code>,{' '}
                    <code>meeting:write:meeting</code>, <code>meeting:read:list_past_participants</code>,{' '}
                    <code>user:read:user</code>.
                    <div style={{ marginTop: 8, padding: 8, background: '#f1f5f9', borderRadius: 'var(--radius-sm)', border: '1px solid #cbd5e1' }}>
                      <strong style={{ color: 'var(--n90)' }}>OAuth Redirect URL:</strong>
                      <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#1d4ed8', wordBreak: 'break-all', marginTop: 2, userSelect: 'all' }}>
                        {origin ? `${origin}/api/auth/zoom/callback` : 'Loading…'}
                      </div>
                      <span style={{ color: 'var(--n60)', fontSize: 11, display: 'block', marginTop: 2 }}>
                        This is derived from the URL you&apos;re viewing this page on right now — if you connect through a
                        different host later (a new tunnel session gets a new random address), this value changes too. Paste
                        the current value into Zoom Marketplace under <strong>OAuth Redirect URL</strong> and{' '}
                        <strong>OAuth allow list</strong> before connecting.
                      </span>
                    </div>
                  </div>
                  <a
                    href="/api/auth/zoom/connect"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'inline-flex', alignItems: 'center', height: 32, padding: '0 12px', fontSize: 'var(--fs-label-1)', fontWeight: 600,
                      background: '#2563EB', color: '#fff', borderRadius: 'var(--radius-md)', textDecoration: 'none',
                    }}
                  >
                    Connect with Zoom
                  </a>
                  <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n50)', marginTop: 6, lineHeight: 1.5 }}>
                    Authorizes reading and creating meetings, and reading past-meeting participants for attendance. Once
                    connected, meeting sync and attendance both run automatically in the background — see Delivery settings
                    above for the current sync state. Tokens are stored server-side only. Opens in a new tab.
                  </div>
                </div>
              )}
              {id === 'linkedin' && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ marginBottom: 10, padding: 8, background: '#f1f5f9', borderRadius: 'var(--radius-sm)', border: '1px solid #cbd5e1' }}>
                    <strong style={{ color: 'var(--n90)', fontSize: 'var(--fs-label-2)' }}>OAuth Redirect URL:</strong>
                    <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#1d4ed8', wordBreak: 'break-all', marginTop: 2, userSelect: 'all' }}>
                      {origin ? `${origin}/api/auth/linkedin/callback` : 'Loading…'}
                    </div>
                    <span style={{ color: 'var(--n60)', fontSize: 11, display: 'block', marginTop: 2 }}>
                      Derived from the URL you&apos;re viewing this page on right now. Add this exact value to your LinkedIn
                      app&apos;s Authorized redirect URLs before connecting.
                    </span>
                  </div>
                  <a
                    href="/api/auth/linkedin/connect"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'inline-flex', alignItems: 'center', height: 32, padding: '0 12px', fontSize: 'var(--fs-label-1)', fontWeight: 600,
                      background: 'var(--brand-linkedin)', color: '#fff', borderRadius: 'var(--radius-md)', textDecoration: 'none',
                    }}
                  >
                    Connect with LinkedIn
                  </a>
                  <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n50)', marginTop: 6, lineHeight: 1.5 }}>
                    Authorizes your Page for Events, registration forms and Lead Sync (r_events · rw_events · leadgen automation). Tokens are stored server-side only. Opens in a new tab.
                  </div>
                </div>
              )}
              {referenceOnly ? (
                <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n50)', lineHeight: 1.5 }}>
                  No live API to test here — these are reference values only. SMS/WhatsApp still send through LeadSquared,
                  configured on the LeadSquared card.
                </div>
              ) : (
                <>
                  <Button hierarchy="secondary" size="sm" onClick={test} disabled={testing}>
                    {testing ? 'Testing…' : 'Test connection'}
                  </Button>
                  {testResult && (
                    <div style={{ marginTop: 10, fontSize: 'var(--fs-label-1)', fontWeight: 600, color: testResult.ok ? 'var(--success-700)' : 'var(--danger-500)', overflowWrap: 'anywhere' }}>
                      {testResult.detail}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        <div style={{ flexShrink: 0, padding: '14px 20px', borderTop: '1px solid var(--border-subtle)' }}>
          {saveError && (
            <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--danger-500)', marginBottom: 8, overflowWrap: 'anywhere' }}>{saveError}</div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button hierarchy="secondary" size="sm" onClick={onClose}>
              {explanatoryOnly ? 'Close' : 'Cancel'}
            </Button>
            {!explanatoryOnly && (
              <Button hierarchy={dirty ? 'primary' : 'secondary'} size="sm" onClick={save} disabled={!dirty || saving}>
                {saving ? 'Saving…' : dirty ? 'Save' : saved ? 'Saved' : 'Save'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
