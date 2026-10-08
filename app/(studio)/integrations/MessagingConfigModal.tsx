'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Field } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ResultBanner } from './ResultBanner';
import { formatLsqDateTime } from '@/lib/dateFormat';
import {
  getChannelDeliverySettingsAction,
  saveChannelDeliveryModeAction,
  saveDirectGatewayConfigAction,
  testDirectChannelAction,
  getIntegrationConfigMaskedAction,
  saveIntegrationConfigAction,
  type ChannelDeliverySettingsResult,
} from '@/lib/actions/integrations';

type Tab = 'sms' | 'whatsapp' | 'compliance';
type Channel = 'sms' | 'whatsapp';

interface MessagingConfigModalProps {
  onClose: () => void;
  onChanged: () => void;
}

export function MessagingConfigModal({ onClose, onChanged }: MessagingConfigModalProps) {
  const [activeTab, setActiveTab] = useState<Tab>('sms');
  const [data, setData] = useState<ChannelDeliverySettingsResult | null>(null);
  const [loading, setLoading] = useState(true);

  // Direct SMS form
  const [smsFields, setSmsFields] = useState({ endpoint: '', authToken: '', senderId: '', templateId: '' });
  const [savingSms, setSavingSms] = useState(false);
  const [smsSavedNote, setSmsSavedNote] = useState<{ ok: boolean; text: string } | null>(null);

  // Direct WhatsApp form
  const [waFields, setWaFields] = useState({ endpoint: '', authToken: '', senderId: '', templateId: '' });
  const [savingWa, setSavingWa] = useState(false);
  const [waSavedNote, setWaSavedNote] = useState<{ ok: boolean; text: string } | null>(null);

  // Compliance fields (TRAI DLT & Meta WABA)
  const [complianceMasked, setComplianceMasked] = useState<Record<string, { hasValue: boolean }> | null>(null);
  const [complianceValues, setComplianceValues] = useState<Record<string, string>>({});
  const [savingCompliance, setSavingCompliance] = useState(false);
  const [complianceSavedNote, setComplianceSavedNote] = useState<{ ok: boolean; text: string } | null>(null);

  // Live Test Console states
  const [testPhoneSms, setTestPhoneSms] = useState('');
  const [testPhoneWa, setTestPhoneWa] = useState('');
  const [testingSms, setTestingSms] = useState(false);
  const [testingWa, setTestingWa] = useState(false);
  const [testResultSms, setTestResultSms] = useState<{ ok: boolean; status: number; latencyMs: number; detail: string } | null>(null);
  const [testResultWa, setTestResultWa] = useState<{ ok: boolean; status: number; latencyMs: number; detail: string } | null>(null);

  // Mode switching state
  const [switchingChannel, setSwitchingChannel] = useState<Channel | null>(null);
  const [modeSwitchError, setModeSwitchError] = useState<string | null>(null);
  const [pendingDirectSwitch, setPendingDirectSwitch] = useState<Channel | null>(null);

  function requestDirectSwitch(channel: Channel) {
    setPendingDirectSwitch(channel);
  }

  useEffect(() => {
    let canceled = false;
    Promise.all([
      getChannelDeliverySettingsAction(),
      getIntegrationConfigMaskedAction('messaging'),
    ])
      .then(([res, masked]) => {
        if (canceled) return;
        setData(res);
        setComplianceMasked(masked);
        setSmsFields({
          endpoint: res.sms.endpoint,
          authToken: '',
          senderId: res.sms.senderId,
          templateId: res.sms.templateId,
        });
        setWaFields({
          endpoint: res.whatsapp.endpoint,
          authToken: '',
          senderId: res.whatsapp.senderId,
          templateId: res.whatsapp.templateId,
        });
        setTestPhoneSms(res.defaultPhone);
        setTestPhoneWa(res.defaultPhone);
        setLoading(false);
      })
      .catch((err) => {
        if (canceled) return;
        console.error('Failed to load messaging settings:', err);
        setLoading(false);
      });

    return () => {
      canceled = true;
    };
  }, []);

  async function refreshSettings() {
    try {
      const [res, masked] = await Promise.all([
        getChannelDeliverySettingsAction(),
        getIntegrationConfigMaskedAction('messaging'),
      ]);
      setData(res);
      setComplianceMasked(masked);
    } catch (err) {
      console.error('Failed to refresh messaging settings:', err);
    }
  }



  async function handleModeChange(channel: Channel, mode: 'trigger' | 'direct') {
    setSwitchingChannel(channel);
    setModeSwitchError(null);
    try {
      await saveChannelDeliveryModeAction(channel, mode);
      await refreshSettings();
      onChanged();
    } catch (err) {
      setModeSwitchError(err instanceof Error ? err.message : `Could not switch ${channel} to ${mode} mode — try again.`);
    } finally {
      setSwitchingChannel(null);
    }
  }

  async function handleSaveDirectSms() {
    setSavingSms(true);
    setSmsSavedNote(null);
    try {
      await saveDirectGatewayConfigAction('sms', smsFields);
      setSmsSavedNote({ ok: true, text: 'Direct SMS gateway settings saved.' });
      setSmsFields((f) => ({ ...f, authToken: '' }));
      setTimeout(() => setSmsSavedNote(null), 3500);
      await refreshSettings();
      onChanged();
    } catch (err) {
      setSmsSavedNote({ ok: false, text: 'Failed to save settings: ' + (err instanceof Error ? err.message : String(err)) });
    } finally {
      setSavingSms(false);
    }
  }

  async function handleSaveDirectWa() {
    setSavingWa(true);
    setWaSavedNote(null);
    try {
      await saveDirectGatewayConfigAction('whatsapp', waFields);
      setWaSavedNote({ ok: true, text: 'Direct WhatsApp gateway settings saved.' });
      setWaFields((f) => ({ ...f, authToken: '' }));
      setTimeout(() => setWaSavedNote(null), 3500);
      await refreshSettings();
      onChanged();
    } catch (err) {
      setWaSavedNote({ ok: false, text: 'Failed to save settings: ' + (err instanceof Error ? err.message : String(err)) });
    } finally {
      setSavingWa(false);
    }
  }


  async function handleSaveCompliance() {
    setSavingCompliance(true);
    setComplianceSavedNote(null);
    try {
      await saveIntegrationConfigAction('messaging', complianceValues);
      setComplianceSavedNote({ ok: true, text: 'Compliance identifiers saved.' });
      setTimeout(() => setComplianceSavedNote(null), 3500);
      setComplianceValues({});
      const masked = await getIntegrationConfigMaskedAction('messaging');
      setComplianceMasked(masked);
      onChanged();
    } catch (err) {
      setComplianceSavedNote({ ok: false, text: 'Failed to save compliance: ' + (err instanceof Error ? err.message : String(err)) });
    } finally {
      setSavingCompliance(false);
    }
  }

  async function handleTestDirect(channel: Channel) {
    if (channel === 'sms') {
      setTestingSms(true);
      setTestResultSms(null);
      try {
        const res = await testDirectChannelAction({
          channel: 'sms',
          targetPhone: testPhoneSms,
          endpoint: smsFields.endpoint,
          authToken: smsFields.authToken,
          senderId: smsFields.senderId,
          templateId: smsFields.templateId,
        });
        setTestResultSms(res);
      } catch (err) {
        setTestResultSms({ ok: false, status: 0, latencyMs: 0, detail: String(err) });
      } finally {
        setTestingSms(false);
      }
    } else {
      setTestingWa(true);
      setTestResultWa(null);
      try {
        const res = await testDirectChannelAction({
          channel: 'whatsapp',
          targetPhone: testPhoneWa,
          endpoint: waFields.endpoint,
          authToken: waFields.authToken,
          senderId: waFields.senderId,
          templateId: waFields.templateId,
        });
        setTestResultWa(res);
      } catch (err) {
        setTestResultWa({ ok: false, status: 0, latencyMs: 0, detail: String(err) });
      } finally {
        setTestingWa(false);
      }
    }
  }

  const smsMode = data?.sms.mode ?? 'trigger';
  const waMode = data?.whatsapp.mode ?? 'trigger';

  const tabs: Array<{ id: Tab; label: string; icon: string; mode?: 'trigger' | 'direct' }> = [
    { id: 'sms', label: 'SMS Delivery', icon: 'sms', mode: smsMode },
    { id: 'whatsapp', label: 'WhatsApp Delivery', icon: 'whatsapp', mode: waMode },
    { id: 'compliance', label: 'Compliance and IDs', icon: 'file-text' },
  ];

  const complianceFields: Array<{ key: string; label: string; placeholder: string }> = [
    { key: 'dltEntityId', label: 'TRAI DLT entity ID', placeholder: 'e.g. 1701159123456789' },
    { key: 'dltSenderIds', label: 'DLT sender IDs (headers)', placeholder: 'e.g. EVHLTH, WEBINR' },
    { key: 'dltRoute', label: 'SMS route or DLT content template ID', placeholder: 'Registered DLT template ID' },
    { key: 'wabaId', label: 'Meta WABA account ID', placeholder: 'Meta WhatsApp Business account ID' },
    { key: 'wabaPhoneNumberId', label: 'WhatsApp business phone number ID', placeholder: 'Meta phone number ID' },
    { key: 'wabaTemplateNamespace', label: 'Message template namespace', placeholder: 'WABA template namespace' },
  ];

  return (
    <>
      <Modal
        isOpen
        onClose={onClose}
        size="lg"
        title="SMS & WhatsApp Business"
        subtitle="Two-mode dispatch configuration and compliance identifiers."
        footer={
          <div className="lsq-int-pager">
            <span className="lsq-hint">
              Selected: <strong>SMS</strong> via {smsMode === 'trigger' ? 'LSQ Automation' : 'Direct Gateway'}. <strong>WhatsApp</strong> via{' '}
              {waMode === 'trigger' ? 'LSQ Automation' : 'Direct Gateway'}.
            </span>
            <Button hierarchy="primary" size="md" onClick={onClose}>
              Done
            </Button>
          </div>
        }
      >
        <div className="lsq-stack lsq-stack--lg">
          <div className="lsq-tabs" role="tablist" aria-label="Messaging settings">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`msg-tab-${t.id}`}
                aria-selected={activeTab === t.id}
                aria-controls="msg-tabpanel"
                className="lsq-tab"
                onClick={() => setActiveTab(t.id)}
              >
                <Icon name={t.icon} size={16} />
                {t.label}
                {t.mode && <Badge color={t.mode === 'trigger' ? 'success' : 'blue'} text={t.mode === 'trigger' ? 'LSQ Automation' : 'Direct API'} />}
              </button>
            ))}
          </div>

          <div id="msg-tabpanel" role="tabpanel" aria-labelledby={`msg-tab-${activeTab}`} className="lsq-stack lsq-stack--lg">
            {loading ? (
              <div className="lsq-empty" role="status">
                <span className="lsq-spinner" aria-hidden="true" />
                <p className="lsq-empty__body">Loading delivery settings…</p>
              </div>
            ) : activeTab === 'sms' ? (
              <ChannelPane
                channel="sms"
                copy={SMS_COPY}
                mode={smsMode}
                switching={switchingChannel === 'sms'}
                modeSwitchError={modeSwitchError}
                onTrigger={() => handleModeChange('sms', 'trigger')}
                onDirect={() => requestDirectSwitch('sms')}
                fields={smsFields}
                setFields={setSmsFields}
                hasAuthToken={!!data?.sms.hasAuthToken}
                saving={savingSms}
                onSave={handleSaveDirectSms}
                savedNote={smsSavedNote}
                testPhone={testPhoneSms}
                setTestPhone={setTestPhoneSms}
                testing={testingSms}
                onTest={() => handleTestDirect('sms')}
                testResult={testResultSms}
                lastTestedAt={data?.sms.lastTestedAt ?? null}
              />
            ) : activeTab === 'whatsapp' ? (
              <ChannelPane
                channel="whatsapp"
                copy={WA_COPY}
                mode={waMode}
                switching={switchingChannel === 'whatsapp'}
                modeSwitchError={modeSwitchError}
                onTrigger={() => handleModeChange('whatsapp', 'trigger')}
                onDirect={() => requestDirectSwitch('whatsapp')}
                fields={waFields}
                setFields={setWaFields}
                hasAuthToken={!!data?.whatsapp.hasAuthToken}
                saving={savingWa}
                onSave={handleSaveDirectWa}
                savedNote={waSavedNote}
                testPhone={testPhoneWa}
                setTestPhone={setTestPhoneWa}
                testing={testingWa}
                onTest={() => handleTestDirect('whatsapp')}
                testResult={testResultWa}
                lastTestedAt={data?.whatsapp.lastTestedAt ?? null}
              />
            ) : (
              <>
                <div>
                  <h3 className="lsq-int-block__title">DLT and WABA Compliance Identifiers</h3>
                  <p className="lsq-int-block__sub">
                    Mandatory telecom registration identifiers for Indian TRAI DLT compliance and Meta WhatsApp Business Account records.
                  </p>
                </div>

                <div className="lsq-int-fields">
                  {complianceFields.map((f) => {
                    const hasSaved = !!complianceMasked?.[f.key]?.hasValue;
                    return (
                      <Field key={f.key} label={f.label} hint={hasSaved ? 'A value is saved. Leave blank to keep it.' : undefined}>
                        {(p) => (
                          <input
                            {...p}
                            className="lsq-input"
                            type="text"
                            placeholder={hasSaved ? 'Saved. Leave blank to keep.' : f.placeholder}
                            value={complianceValues[f.key] ?? ''}
                            onChange={(e) => setComplianceValues((v) => ({ ...v, [f.key]: e.target.value }))}
                          />
                        )}
                      </Field>
                    );
                  })}
                </div>

                <div className="lsq-cluster">
                  <Button
                    hierarchy="secondary"
                    size="sm"
                    onClick={handleSaveCompliance}
                    disabled={Object.values(complianceValues).every((v) => !v.trim())}
                    loading={savingCompliance}
                  >
                    {savingCompliance ? 'Saving…' : 'Save Compliance Identifiers'}
                  </Button>
                </div>
                {complianceSavedNote && (
                  <ResultBanner tone={complianceSavedNote.ok ? 'success' : 'error'}>{complianceSavedNote.text}</ResultBanner>
                )}
              </>
            )}
          </div>
        </div>
      </Modal>

      {pendingDirectSwitch && (
        <ConfirmDialog
          title={`Switch ${pendingDirectSwitch === 'sms' ? 'SMS' : 'WhatsApp'} to Direct Gateway?`}
          message="Direct Gateway dispatches messages straight to the external HTTP endpoint you've configured, bypassing LeadSquared Automation entirely. Make sure the endpoint, auth token, and template ID are correct and tested before switching — a misconfigured gateway will silently fail every send on this channel."
          confirmLabel={switchingChannel === pendingDirectSwitch ? 'Switching…' : 'Switch to Direct Gateway'}
          destructive={false}
          busy={switchingChannel === pendingDirectSwitch}
          onConfirm={async () => {
            await handleModeChange(pendingDirectSwitch, 'direct');
            setPendingDirectSwitch(null);
          }}
          onClose={() => setPendingDirectSwitch(null)}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// One channel's pane: mode choice, direct-gateway form, and the pre-flight test console. SMS and WhatsApp differ only in
// copy and field labels, so both render through this and keep identical behaviour.

interface GatewayFields {
  endpoint: string;
  authToken: string;
  senderId: string;
  templateId: string;
}

interface TestOutcome {
  ok: boolean;
  status: number;
  latencyMs: number;
  detail: string;
}

interface ChannelCopy {
  modeTitle: string;
  modeSub: string;
  triggerBadge: string;
  triggerDesc: React.ReactNode;
  directDesc: string;
  activeTitle: string;
  activeBody: React.ReactNode;
  formTitle: string;
  formActive: string;
  formSecondary: string;
  endpointPlaceholder: string;
  tokenLabel: string;
  tokenPlaceholder: string;
  senderLabel: string;
  senderPlaceholder: string;
  templateLabel: string;
  templatePlaceholder: string;
  saveLabel: string;
  testTitle: string;
  testSub: string;
  testButton: string;
}

const SMS_COPY: ChannelCopy = {
  modeTitle: 'Select Outbound SMS Delivery Mode',
  modeSub: 'Choose whether webinar reminders and invites trigger via LeadSquared Automation or dispatch directly to an external telecom gateway.',
  triggerBadge: 'Primary',
  triggerDesc: (
    <>
      Posts the configured custom activity in CRM. Configure a LeadSquared Automation rule to send through your SMS gateway.
    </>
  ),
  directDesc: 'Direct HTTP POST to an external telecom gateway (Route Mobile, Twilio, Kaleyra and others).',
  activeTitle: 'LeadSquared Automation Selected',
  activeBody: (
    <>
      Cadence sends create the configured custom activity with Channel, Cadence Step and Message fields. Match those fields in your LeadSquared Automation rule. Activity creation confirms the CRM handoff; check automation and gateway logs for delivery.
    </>
  ),
  formTitle: 'Direct SMS Gateway Configuration',
  formActive: 'Active: cadence dispatches call this HTTP endpoint directly.',
  formSecondary: 'Secondary mode: configure and test the direct telecom API at any time.',
  endpointPlaceholder: 'https://api.routemobile.com/... or custom gateway webhook',
  tokenLabel: 'Auth token or API key',
  tokenPlaceholder: 'Secret bearer token or API key',
  senderLabel: 'Sender ID or header',
  senderPlaceholder: 'e.g. EVHLTH',
  templateLabel: 'DLT content template ID',
  templatePlaceholder: 'e.g. 1707161829392819283',
  saveLabel: 'Save SMS Gateway Settings',
  testTitle: 'Direct SMS Pre-Flight Testing',
  testSub: 'Sends a real test SMS directly to verify HTTP routing, authentication and gateway status.',
  testButton: 'Send Test SMS',
};

const WA_COPY: ChannelCopy = {
  modeTitle: 'Select Outbound WhatsApp Delivery Mode',
  modeSub: 'Choose whether WhatsApp messages trigger via LeadSquared Automation (Route Mobile) or dispatch directly via an external API.',
  triggerBadge: 'Primary',
  triggerDesc: (
    <>
      Posts the configured custom activity in CRM. Configure a LeadSquared Automation rule to send through your WhatsApp provider.
    </>
  ),
  directDesc: 'Direct HTTP POST to an external WhatsApp API (Meta Cloud API, Route Mobile HTTP API and others).',
  activeTitle: 'LeadSquared Automation Selected',
  activeBody: (
    <>
      Cadence sends create the configured custom activity with Channel, Cadence Step and Message fields. Configure the corresponding LeadSquared Automation and approved WhatsApp template. Recipients need recorded WhatsApp opt-in. Check automation and gateway logs for delivery.
    </>
  ),
  formTitle: 'Direct WhatsApp Gateway Configuration',
  formActive: 'Active: outbound WhatsApp messages call this HTTP endpoint directly.',
  formSecondary: 'Secondary mode: configure and test the direct WhatsApp gateway API.',
  endpointPlaceholder: 'https://graph.facebook.com/v18.0/... or Route Mobile HTTP URL',
  tokenLabel: 'Bearer token or API key',
  tokenPlaceholder: 'Meta system user token or API key',
  senderLabel: 'WhatsApp phone number ID',
  senderPlaceholder: 'e.g. 109283746501928',
  templateLabel: 'Approved template name',
  templatePlaceholder: 'e.g. webinar_reminder_invite',
  saveLabel: 'Save WhatsApp Gateway Settings',
  testTitle: 'Direct WhatsApp Pre-Flight Testing',
  testSub: 'Sends a real WhatsApp message to verify direct Meta or Route Mobile API dispatch before launching cadences.',
  testButton: 'Send Test WhatsApp',
};

function ChannelPane({
  channel,
  copy,
  mode,
  switching,
  modeSwitchError,
  onTrigger,
  onDirect,
  fields,
  setFields,
  hasAuthToken,
  saving,
  onSave,
  savedNote,
  testPhone,
  setTestPhone,
  testing,
  onTest,
  testResult,
  lastTestedAt,
}: {
  channel: Channel;
  copy: ChannelCopy;
  mode: 'trigger' | 'direct';
  switching: boolean;
  modeSwitchError: string | null;
  onTrigger: () => void;
  onDirect: () => void;
  fields: GatewayFields;
  setFields: React.Dispatch<React.SetStateAction<GatewayFields>>;
  hasAuthToken: boolean;
  saving: boolean;
  onSave: () => void;
  savedNote: { ok: boolean; text: string } | null;
  testPhone: string;
  setTestPhone: (v: string) => void;
  testing: boolean;
  onTest: () => void;
  testResult: TestOutcome | null;
  lastTestedAt: string | Date | null;
}) {
  const set = (k: keyof GatewayFields) => (e: React.ChangeEvent<HTMLInputElement>) => setFields((s) => ({ ...s, [k]: e.target.value }));
  return (
    <>
      <div>
        <h3 className="lsq-int-block__title">{copy.modeTitle}</h3>
        <p className="lsq-int-block__sub">{copy.modeSub}</p>
      </div>

      {modeSwitchError && <ResultBanner tone="error">{modeSwitchError}</ResultBanner>}

      <div className="lsq-int-modes" role="radiogroup" aria-label={`${channel === 'sms' ? 'SMS' : 'WhatsApp'} delivery mode`}>
        <label className="lsq-int-mode" data-active={mode === 'trigger' ? 'true' : 'false'}>
          <span className="lsq-int-mode__head">
            <span className="lsq-int-mode__name">
              <input type="radio" name={`${channel}-mode`} checked={mode === 'trigger'} onChange={onTrigger} disabled={switching} />
              LSQ Automation
            </span>
            <Badge color="success" text={copy.triggerBadge} />
          </span>
          <span className="lsq-int-mode__desc">{copy.triggerDesc}</span>
        </label>

        <label className="lsq-int-mode" data-active={mode === 'direct' ? 'true' : 'false'}>
          <span className="lsq-int-mode__head">
            <span className="lsq-int-mode__name">
              <input type="radio" name={`${channel}-mode`} checked={mode === 'direct'} onChange={onDirect} disabled={switching} />
              Direct Gateway API
            </span>
            <Badge color="blue" text="Secondary" />
          </span>
          <span className="lsq-int-mode__desc">{copy.directDesc}</span>
        </label>
      </div>

      {mode === 'trigger' && (
        <ResultBanner tone="success" title={copy.activeTitle}>
          {copy.activeBody}
        </ResultBanner>
      )}

      <div className="lsq-int-block">
        <div>
          <h3 className="lsq-int-block__title">{copy.formTitle}</h3>
          <p className="lsq-int-block__sub">{mode === 'direct' ? copy.formActive : copy.formSecondary}</p>
        </div>

        <div className="lsq-int-fields">
          <div className="lsq-int-fields--span">
            <Field label="Gateway endpoint URL">
              {(p) => (
                <input
                  {...p}
                  className="lsq-input lsq-int-mono"
                  type="text"
                  placeholder={copy.endpointPlaceholder}
                  value={fields.endpoint}
                  onChange={set('endpoint')}
                />
              )}
            </Field>
          </div>
          <Field label={copy.tokenLabel} hint={hasAuthToken ? 'A token is saved and never shown. Leave blank to keep it.' : undefined}>
            {(p) => (
              <input
                {...p}
                className="lsq-input"
                type="password"
                autoComplete="new-password"
                placeholder={hasAuthToken ? 'Saved. Leave blank to keep.' : copy.tokenPlaceholder}
                value={fields.authToken}
                onChange={set('authToken')}
              />
            )}
          </Field>
          <Field label={copy.senderLabel}>
            {(p) => <input {...p} className="lsq-input" type="text" placeholder={copy.senderPlaceholder} value={fields.senderId} onChange={set('senderId')} />}
          </Field>
          <div className="lsq-int-fields--span">
            <Field label={copy.templateLabel}>
              {(p) => <input {...p} className="lsq-input" type="text" placeholder={copy.templatePlaceholder} value={fields.templateId} onChange={set('templateId')} />}
            </Field>
          </div>
        </div>

        <div className="lsq-cluster">
          <Button hierarchy="secondary" size="sm" onClick={onSave} loading={saving}>
            {saving ? 'Saving…' : copy.saveLabel}
          </Button>
        </div>
        {savedNote && <ResultBanner tone={savedNote.ok ? 'success' : 'error'}>{savedNote.text}</ResultBanner>}
      </div>

      <div className="lsq-int-block lsq-int-block--plain">
        <div className="lsq-int-block__head">
          <h3 className="lsq-int-block__title">
            <Icon name="zap" size={16} />
            {copy.testTitle}
          </h3>
          {lastTestedAt && <span className="lsq-hint">Last test: {formatLsqDateTime(new Date(lastTestedAt))}</span>}
        </div>
        <p className="lsq-int-block__sub">{copy.testSub}</p>
        <div className="lsq-int-inline">
          <Field label="Test phone number">
            {(p) => <input {...p} className="lsq-input" type="text" placeholder="+911234567890" value={testPhone} onChange={(e) => setTestPhone(e.target.value)} />}
          </Field>
          <Button hierarchy="secondary" size="md" icon={<Icon name="send" size={16} />} onClick={onTest} disabled={!testPhone} loading={testing}>
            {testing ? 'Sending Test…' : copy.testButton}
          </Button>
        </div>

        {testResult && (
          <ResultBanner tone={testResult.ok ? 'success' : 'error'} title={testResult.ok ? 'Test Dispatch Succeeded' : 'Test Dispatch Failed'}>
            <div className="lsq-int-result">
              <span className="lsq-int-mono">{testResult.detail}</span>
              <span>
                Status {testResult.status}, latency {testResult.latencyMs.toLocaleString()} ms
              </span>
            </div>
          </ResultBanner>
        )}
      </div>
    </>
  );
}
