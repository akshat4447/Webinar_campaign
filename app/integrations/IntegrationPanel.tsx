'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { INTEGRATION_FIELDS } from '@/lib/integrationFields';
import { getIntegrationConfigMaskedAction, saveIntegrationConfigAction, testIntegrationAction } from '@/lib/actions/integrations';

const EXPLANATION: Record<string, string> = {
  zoom: 'Zoom attendance comes from a real exported "Participants Report" CSV, not the Zoom API — there\'s nothing to connect here. Import the CSV from a campaign\'s Setup tab.',
  linkedin:
    "Outreach is manual by design — scripted LinkedIn messaging breaches their terms and risks account restriction. What the app does instead: Apollo verifies every queued contact before you reach out, and LinkedIn Events run through the official API with Lead Sync streaming registrations back in.",
};

export function IntegrationPanel({ id, name, onClose, onChanged }: { id: string; name: string; onClose: () => void; onChanged: () => void }) {
  const fields = INTEGRATION_FIELDS[id] ?? [];
  const explanatoryOnly = fields.length === 0;

  const [masked, setMasked] = useState<Record<string, { hasValue: boolean }> | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; detail: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

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

  async function save() {
    if (!dirty) return;
    setSaving(true);
    await saveIntegrationConfigAction(id, values);
    setSaving(false);
    setSaved(true);
    setValues({});
    const next = await getIntegrationConfigMaskedAction(id);
    setMasked(next);
    onChanged();
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
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--n90)' }}>{name}</div>
            <div style={{ fontSize: 12, color: 'var(--n60)', marginTop: 3 }}>{explanatoryOnly ? 'No credentials needed' : 'Connection settings'}</div>
          </div>
          <div onClick={onClose} style={{ cursor: 'pointer', width: 28, height: 28, borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Icon name="close" size={16} style={{ color: 'var(--n60)' }} />
          </div>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: '18px 20px 20px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {explanatoryOnly ? (
            <div style={{ fontSize: 13, color: 'var(--n70)', lineHeight: 1.6 }}>{EXPLANATION[id]}</div>
          ) : (
            fields.map((f) => (
              <div key={f.key}>
                <div style={{ fontSize: 12, color: 'var(--n60)', marginBottom: 6 }}>
                  {f.label}
                  {f.optional && <span style={{ color: 'var(--n50)' }}> (optional)</span>}
                </div>
                <input
                  className="lsq-input"
                  type={f.secret ? 'password' : 'text'}
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
                <div style={{ marginBottom: 12, padding: 10, background: 'var(--n10)', borderRadius: 'var(--radius-md)', fontSize: 11.5, color: 'var(--n70)', lineHeight: 1.6 }}>
                  <strong style={{ display: 'block', marginBottom: 4 }}>SMS / WhatsApp delivery</strong>
                  <strong>Trigger (default):</strong> the app posts a <em>WebinarAgent Channel Trigger</em> activity per send. One-time in your
                  tenant: Settings → Automation → Add Program → trigger “On activity: WebinarAgent Channel Trigger” → action Send SMS /
                  Send WhatsApp using field <code>mxp_Message</code>, to the lead&apos;s phone.
                  <br />
                  <strong>Direct:</strong> paste your account&apos;s endpoint path from{' '}
                  <a href="https://apidocs.leadsquared.com/" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-500)' }}>
                    apidocs.leadsquared.com
                  </a>{' '}
                  into SMS/WhatsApp Endpoint. Guides &amp; add-ons (Kaleyra/Twilio SMS, Whatsapp Connector):{' '}
                  <a href="https://help.leadsquared.com/" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-500)' }}>
                    help.leadsquared.com
                  </a>
                </div>
              )}
              {id === 'linkedin' && (
                <div style={{ marginBottom: 12 }}>
                  <a
                    href="/api/auth/linkedin/connect"
                    style={{
                      display: 'inline-flex', alignItems: 'center', height: 32, padding: '0 12px', fontSize: 12.5, fontWeight: 600,
                      background: '#0A66C2', color: '#fff', borderRadius: 'var(--radius-md)', textDecoration: 'none',
                    }}
                  >
                    Connect with LinkedIn
                  </a>
                  <div style={{ fontSize: 11, color: 'var(--n50)', marginTop: 6, lineHeight: 1.5 }}>
                    Authorizes your Page for Events, registration forms and Lead Sync (r_events · rw_events · leadgen automation). Tokens are stored server-side only.
                  </div>
                </div>
              )}
              <Button hierarchy="secondary" size="sm" onClick={test} disabled={testing}>
                {testing ? 'Testing…' : 'Test connection'}
              </Button>
              {testResult && (
                <div style={{ marginTop: 10, fontSize: 12.5, fontWeight: 600, color: testResult.ok ? 'var(--success-700)' : 'var(--danger-500)', overflowWrap: 'anywhere' }}>
                  {testResult.detail}
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ flexShrink: 0, padding: '14px 20px', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
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
    </>
  );
}
