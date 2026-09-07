'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
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
  // Switching TO direct-gateway dispatch has the same real-world consequence
  // as the SEND_MODE sandbox->live toggle (messages start going out through a
  // different, unproven path) — confirm it the same way. Switching back to
  // trigger (LSQ Automation, the already-verified default) needs no confirm.
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

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      canceled = true;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

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

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(16,20,25,0.45)', zIndex: 1200 }} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="messaging-modal-title"
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 740,
          maxWidth: '94vw',
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
        {/* Modal Header */}
        <div style={{ flexShrink: 0, padding: '18px 24px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 'var(--radius-md)',
                background: '#0D9488',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 'var(--fs-body)',
                fontWeight: 700,
              }}
            >
              M
            </div>
            <div>
              <div style={{ fontSize: 'var(--fs-body)', fontWeight: 700, color: 'var(--n90)' }}>SMS & WhatsApp Business</div>
              <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n60)', marginTop: 2 }}>
                Two-mode dispatch configuration & compliance identifiers
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              cursor: 'pointer',
              width: 30,
              height: 30,
              borderRadius: 'var(--radius-sm)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: 'none',
              background: 'transparent',
              padding: 0,
            }}
          >
            <Icon name="close" size={18} style={{ color: 'var(--n60)' }} />
          </button>
        </div>

        {/* Tab Navigation */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border-subtle)', background: 'var(--n10)', padding: '6px 20px', gap: 8 }}>
          <button
            onClick={() => setActiveTab('sms')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 16px',
              borderRadius: 'var(--radius-md)',
              border: 'none',
              cursor: 'pointer',
              background: activeTab === 'sms' ? '#fff' : 'transparent',
              color: activeTab === 'sms' ? 'var(--n90)' : 'var(--n60)',
              fontWeight: 600,
              fontSize: 'var(--fs-label-1)',
              boxShadow: activeTab === 'sms' ? 'var(--shadow-xs)' : 'none',
            }}
          >
            💬 SMS Delivery
            <Badge
              color={smsMode === 'trigger' ? 'success' : 'blue'}
              text={smsMode === 'trigger' ? 'LSQ Automation' : 'Direct API'}
            />
          </button>

          <button
            onClick={() => setActiveTab('whatsapp')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 16px',
              borderRadius: 'var(--radius-md)',
              border: 'none',
              cursor: 'pointer',
              background: activeTab === 'whatsapp' ? '#fff' : 'transparent',
              color: activeTab === 'whatsapp' ? 'var(--n90)' : 'var(--n60)',
              fontWeight: 600,
              fontSize: 'var(--fs-label-1)',
              boxShadow: activeTab === 'whatsapp' ? 'var(--shadow-xs)' : 'none',
            }}
          >
            🟢 WhatsApp Delivery
            <Badge
              color={waMode === 'trigger' ? 'success' : 'blue'}
              text={waMode === 'trigger' ? 'LSQ Automation' : 'Direct API'}
            />
          </button>

          <button
            onClick={() => setActiveTab('compliance')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 16px',
              borderRadius: 'var(--radius-md)',
              border: 'none',
              cursor: 'pointer',
              background: activeTab === 'compliance' ? '#fff' : 'transparent',
              color: activeTab === 'compliance' ? 'var(--n90)' : 'var(--n60)',
              fontWeight: 600,
              fontSize: 'var(--fs-label-1)',
              boxShadow: activeTab === 'compliance' ? 'var(--shadow-xs)' : 'none',
            }}
          >
            📋 Compliance & IDs
          </button>
        </div>

        {/* Modal Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--n60)', fontSize: 'var(--fs-label-1)' }}>
              Loading delivery settings…
            </div>
          ) : activeTab === 'sms' ? (
            <div>
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 'var(--fs-label-1)', fontWeight: 700, color: 'var(--n90)', marginBottom: 4 }}>
                  Select Outbound SMS Delivery Mode
                </div>
                <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n60)' }}>
                  Choose whether webinar reminders and invites trigger via LeadSquared Automation or dispatch directly to an external telecom gateway.
                </div>
              </div>

              {modeSwitchError && (
                <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--danger-500)', marginBottom: 12 }}>{modeSwitchError}</div>
              )}

              {/* Mode Selection Cards */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
                {/* LSQ Automation Card */}
                <div
                  onClick={() => handleModeChange('sms', 'trigger')}
                  style={{
                    border: `2px solid ${smsMode === 'trigger' ? 'var(--accent-500)' : 'var(--border-subtle)'}`,
                    borderRadius: 'var(--radius-md)',
                    padding: 16,
                    cursor: 'pointer',
                    background: smsMode === 'trigger' ? 'rgba(37, 99, 235, 0.03)' : '#fff',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input
                        type="radio"
                        checked={smsMode === 'trigger'}
                        onChange={() => handleModeChange('sms', 'trigger')}
                        disabled={switchingChannel === 'sms'}
                      />
                      <span style={{ fontWeight: 700, fontSize: 'var(--fs-label-1)', color: 'var(--n90)' }}>
                        LSQ Automation
                      </span>
                    </div>
                    <Badge color="success" text="Primary" />
                  </div>
                  <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n60)', lineHeight: 1.5 }}>
                    Posts Custom Activity <strong>#302</strong> in CRM. LeadSquared Automation triggers your connected SMS gateway.
                  </div>
                </div>

                {/* Direct API Card */}
                <div
                  onClick={() => requestDirectSwitch('sms')}
                  style={{
                    border: `2px solid ${smsMode === 'direct' ? 'var(--accent-500)' : 'var(--border-subtle)'}`,
                    borderRadius: 'var(--radius-md)',
                    padding: 16,
                    cursor: 'pointer',
                    background: smsMode === 'direct' ? 'rgba(37, 99, 235, 0.03)' : '#fff',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input
                        type="radio"
                        checked={smsMode === 'direct'}
                        onChange={() => requestDirectSwitch('sms')}
                        disabled={switchingChannel === 'sms'}
                      />
                      <span style={{ fontWeight: 700, fontSize: 'var(--fs-label-1)', color: 'var(--n90)' }}>
                        Direct Gateway API
                      </span>
                    </div>
                    <Badge color="blue" text="Secondary" />
                  </div>
                  <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n60)', lineHeight: 1.5 }}>
                    Direct HTTP POST to external telecom gateway (Route Mobile, Twilio, Kaleyra, etc.).
                  </div>
                </div>
              </div>

              {/* Status Banner when LSQ Automation is selected */}
              {smsMode === 'trigger' && (
                <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 'var(--radius-md)', padding: 14, marginBottom: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#166534', fontWeight: 600, fontSize: 'var(--fs-label-1)' }}>
                    <span>✓</span> LeadSquared Automation Trigger Active
                  </div>
                  <div style={{ fontSize: 'var(--fs-label-2)', color: '#15803d', marginTop: 4, lineHeight: 1.5 }}>
                    Cadence sends create Custom Activity <strong>#302 (WebinarAgent Channel Trigger 2)</strong> on the lead profile.
                    Your LeadSquared Automation rule dispatches SMS via your connected provider with registered DLT sender header.
                  </div>
                </div>
              )}

              {/* Direct Gateway Form */}
              <div style={{ background: 'var(--n10)', borderRadius: 'var(--radius-md)', padding: 18, marginBottom: 20 }}>
                <div style={{ fontSize: 'var(--fs-label-1)', fontWeight: 700, color: 'var(--n90)', marginBottom: 2 }}>
                  Direct SMS Gateway Configuration
                </div>
                <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n60)', marginBottom: 14 }}>
                  {smsMode === 'direct'
                    ? 'Active: Cadence dispatches will call this HTTP endpoint directly.'
                    : 'Secondary mode: Configure and test your direct telecom API anytime.'}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div style={{ gridColumn: 'span 2' }}>
                    <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n70)', marginBottom: 4 }}>Gateway Endpoint URL</div>
                    <input
                      className="lsq-input"
                      type="text"
                      placeholder="https://api.routemobile.com/... or custom gateway webhook"
                      value={smsFields.endpoint}
                      onChange={(e) => setSmsFields((s) => ({ ...s, endpoint: e.target.value }))}
                      style={{ width: '100%', fontFamily: 'monospace', fontSize: 'var(--fs-label-2)' }}
                    />
                  </div>
                  <div>
                    <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n70)', marginBottom: 4 }}>Auth Token / API Key</div>
                    <input
                      className="lsq-input"
                      type="password"
                      placeholder={data?.sms.hasAuthToken ? '•••• saved — leave blank to keep' : 'Secret Bearer token or API key'}
                      value={smsFields.authToken}
                      onChange={(e) => setSmsFields((s) => ({ ...s, authToken: e.target.value }))}
                      style={{ width: '100%', fontSize: 'var(--fs-label-2)' }}
                    />
                  </div>
                  <div>
                    <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n70)', marginBottom: 4 }}>Sender ID / Header</div>
                    <input
                      className="lsq-input"
                      type="text"
                      placeholder="e.g. EVHLTH"
                      value={smsFields.senderId}
                      onChange={(e) => setSmsFields((s) => ({ ...s, senderId: e.target.value }))}
                      style={{ width: '100%', fontSize: 'var(--fs-label-2)' }}
                    />
                  </div>
                  <div style={{ gridColumn: 'span 2' }}>
                    <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n70)', marginBottom: 4 }}>DLT Content Template ID</div>
                    <input
                      className="lsq-input"
                      type="text"
                      placeholder="e.g. 1707161829392819283"
                      value={smsFields.templateId}
                      onChange={(e) => setSmsFields((s) => ({ ...s, templateId: e.target.value }))}
                      style={{ width: '100%', fontSize: 'var(--fs-label-2)' }}
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 }}>
                  <Button hierarchy="secondary" size="sm" onClick={handleSaveDirectSms} disabled={savingSms}>
                    {savingSms ? 'Saving…' : 'Save SMS Gateway Settings'}
                  </Button>
                  {smsSavedNote && (
                    <span style={{ fontSize: 'var(--fs-label-2)', color: smsSavedNote.ok ? 'var(--success-700)' : 'var(--danger-500)', fontWeight: 600 }}>
                      {smsSavedNote.ok ? '✓' : '✗'} {smsSavedNote.text}
                    </span>
                  )}
                </div>
              </div>

              {/* Pre-flight Live Testing Console */}
              <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: 18 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <div style={{ fontSize: 'var(--fs-label-1)', fontWeight: 700, color: 'var(--n90)' }}>
                    ⚡ Direct SMS Pre-Flight Testing
                  </div>
                  {data?.sms.lastTestedAt && (
                    <span style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n50)' }}>
                      Last test: {new Date(data.sms.lastTestedAt).toLocaleTimeString()}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n60)', marginBottom: 12 }}>
                  Sends a real test SMS message directly to verify HTTP routing, authentication, and gateway status.
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <input
                    className="lsq-input"
                    type="text"
                    placeholder="+919123443870"
                    value={testPhoneSms}
                    onChange={(e) => setTestPhoneSms(e.target.value)}
                    style={{ flex: 1, fontSize: 'var(--fs-label-2)' }}
                  />
                  <Button
                    hierarchy="secondary"
                    size="sm"
                    onClick={() => handleTestDirect('sms')}
                    disabled={testingSms || !testPhoneSms}
                  >
                    {testingSms ? 'Sending test…' : 'Send Test SMS'}
                  </Button>
                </div>

                {testResultSms && (
                  <div
                    style={{
                      marginTop: 12,
                      padding: 12,
                      borderRadius: 'var(--radius-sm)',
                      background: testResultSms.ok ? '#f0fdf4' : '#fef2f2',
                      border: `1px solid ${testResultSms.ok ? '#bbf7d0' : '#fecaca'}`,
                      fontSize: 'var(--fs-label-2)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontWeight: 700, color: testResultSms.ok ? '#166534' : '#991b1b' }}>
                        {testResultSms.ok ? '✓ Test Dispatch Succeeded' : '✗ Test Dispatch Failed'}
                      </span>
                      <span style={{ color: 'var(--n60)' }}>
                        Status: {testResultSms.status} · Latency: {testResultSms.latencyMs}ms
                      </span>
                    </div>
                    <div style={{ color: testResultSms.ok ? '#15803d' : '#b91c1c', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                      {testResultSms.detail}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : activeTab === 'whatsapp' ? (
            <div>
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 'var(--fs-label-1)', fontWeight: 700, color: 'var(--n90)', marginBottom: 4 }}>
                  Select Outbound WhatsApp Delivery Mode
                </div>
                <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n60)' }}>
                  Choose whether WhatsApp messages trigger via LeadSquared Automation (Route Mobile) or dispatch directly via external API.
                </div>
              </div>

              {modeSwitchError && (
                <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--danger-500)', marginBottom: 12 }}>{modeSwitchError}</div>
              )}

              {/* Mode Selection Cards */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
                {/* LSQ Automation Card */}
                <div
                  onClick={() => handleModeChange('whatsapp', 'trigger')}
                  style={{
                    border: `2px solid ${waMode === 'trigger' ? 'var(--accent-500)' : 'var(--border-subtle)'}`,
                    borderRadius: 'var(--radius-md)',
                    padding: 16,
                    cursor: 'pointer',
                    background: waMode === 'trigger' ? 'rgba(37, 99, 235, 0.03)' : '#fff',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input
                        type="radio"
                        checked={waMode === 'trigger'}
                        onChange={() => handleModeChange('whatsapp', 'trigger')}
                        disabled={switchingChannel === 'whatsapp'}
                      />
                      <span style={{ fontWeight: 700, fontSize: 'var(--fs-label-1)', color: 'var(--n90)' }}>
                        LSQ Automation
                      </span>
                    </div>
                    <Badge color="success" text="Primary · Route Mobile" />
                  </div>
                  <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n60)', lineHeight: 1.5 }}>
                    Posts Custom Activity <strong>#302</strong> in CRM. Dispatched via connected Route Mobile connector (Tenant #61182).
                  </div>
                </div>

                {/* Direct API Card */}
                <div
                  onClick={() => requestDirectSwitch('whatsapp')}
                  style={{
                    border: `2px solid ${waMode === 'direct' ? 'var(--accent-500)' : 'var(--border-subtle)'}`,
                    borderRadius: 'var(--radius-md)',
                    padding: 16,
                    cursor: 'pointer',
                    background: waMode === 'direct' ? 'rgba(37, 99, 235, 0.03)' : '#fff',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input
                        type="radio"
                        checked={waMode === 'direct'}
                        onChange={() => requestDirectSwitch('whatsapp')}
                        disabled={switchingChannel === 'whatsapp'}
                      />
                      <span style={{ fontWeight: 700, fontSize: 'var(--fs-label-1)', color: 'var(--n90)' }}>
                        Direct Gateway API
                      </span>
                    </div>
                    <Badge color="blue" text="Secondary" />
                  </div>
                  <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n60)', lineHeight: 1.5 }}>
                    Direct HTTP POST to external WhatsApp API (Meta Cloud API, Route Mobile HTTP API, etc.).
                  </div>
                </div>
              </div>

              {/* Status Banner when LSQ Automation is selected */}
              {waMode === 'trigger' && (
                <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 'var(--radius-md)', padding: 14, marginBottom: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#166534', fontWeight: 600, fontSize: 'var(--fs-label-1)' }}>
                    <span>✓</span> Connected with Route Mobile (Tenant #61182)
                  </div>
                  <div style={{ fontSize: 'var(--fs-label-2)', color: '#15803d', marginTop: 4, lineHeight: 1.5 }}>
                    Cadence sends trigger Custom Activity <strong>#302</strong>. LeadSquared Automation delivers via your installed
                    Route Mobile WhatsApp connector (1,000 conversations/day). No separate gateway tokens required.
                  </div>
                </div>
              )}

              {/* Direct Gateway Form */}
              <div style={{ background: 'var(--n10)', borderRadius: 'var(--radius-md)', padding: 18, marginBottom: 20 }}>
                <div style={{ fontSize: 'var(--fs-label-1)', fontWeight: 700, color: 'var(--n90)', marginBottom: 2 }}>
                  Direct WhatsApp Gateway Configuration
                </div>
                <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n60)', marginBottom: 14 }}>
                  {waMode === 'direct'
                    ? 'Active: Outbound WhatsApp messages will call this HTTP endpoint directly.'
                    : 'Secondary mode: Configure and test your direct WhatsApp gateway API.'}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div style={{ gridColumn: 'span 2' }}>
                    <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n70)', marginBottom: 4 }}>Gateway Endpoint URL</div>
                    <input
                      className="lsq-input"
                      type="text"
                      placeholder="https://graph.facebook.com/v18.0/... or Route Mobile HTTP URL"
                      value={waFields.endpoint}
                      onChange={(e) => setWaFields((s) => ({ ...s, endpoint: e.target.value }))}
                      style={{ width: '100%', fontFamily: 'monospace', fontSize: 'var(--fs-label-2)' }}
                    />
                  </div>
                  <div>
                    <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n70)', marginBottom: 4 }}>Bearer Token / API Key</div>
                    <input
                      className="lsq-input"
                      type="password"
                      placeholder={data?.whatsapp.hasAuthToken ? '•••• saved — leave blank to keep' : 'Meta System User token or API key'}
                      value={waFields.authToken}
                      onChange={(e) => setWaFields((s) => ({ ...s, authToken: e.target.value }))}
                      style={{ width: '100%', fontSize: 'var(--fs-label-2)' }}
                    />
                  </div>
                  <div>
                    <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n70)', marginBottom: 4 }}>WhatsApp Phone Number ID</div>
                    <input
                      className="lsq-input"
                      type="text"
                      placeholder="e.g. 109283746501928"
                      value={waFields.senderId}
                      onChange={(e) => setWaFields((s) => ({ ...s, senderId: e.target.value }))}
                      style={{ width: '100%', fontSize: 'var(--fs-label-2)' }}
                    />
                  </div>
                  <div style={{ gridColumn: 'span 2' }}>
                    <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n70)', marginBottom: 4 }}>Approved Template Name</div>
                    <input
                      className="lsq-input"
                      type="text"
                      placeholder="e.g. webinar_reminder_invite"
                      value={waFields.templateId}
                      onChange={(e) => setWaFields((s) => ({ ...s, templateId: e.target.value }))}
                      style={{ width: '100%', fontSize: 'var(--fs-label-2)' }}
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 }}>
                  <Button hierarchy="secondary" size="sm" onClick={handleSaveDirectWa} disabled={savingWa}>
                    {savingWa ? 'Saving…' : 'Save WhatsApp Gateway Settings'}
                  </Button>
                  {waSavedNote && (
                    <span style={{ fontSize: 'var(--fs-label-2)', color: waSavedNote.ok ? 'var(--success-700)' : 'var(--danger-500)', fontWeight: 600 }}>
                      {waSavedNote.ok ? '✓' : '✗'} {waSavedNote.text}
                    </span>
                  )}
                </div>
              </div>

              {/* Pre-flight Live Testing Console */}
              <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: 18 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <div style={{ fontSize: 'var(--fs-label-1)', fontWeight: 700, color: 'var(--n90)' }}>
                    ⚡ Direct WhatsApp Pre-Flight Testing
                  </div>
                  {data?.whatsapp.lastTestedAt && (
                    <span style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n50)' }}>
                      Last test: {new Date(data.whatsapp.lastTestedAt).toLocaleTimeString()}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n60)', marginBottom: 12 }}>
                  Sends a real WhatsApp message to verify direct Meta / Route Mobile API dispatch before launching cadences.
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <input
                    className="lsq-input"
                    type="text"
                    placeholder="+919123443870"
                    value={testPhoneWa}
                    onChange={(e) => setTestPhoneWa(e.target.value)}
                    style={{ flex: 1, fontSize: 'var(--fs-label-2)' }}
                  />
                  <Button
                    hierarchy="secondary"
                    size="sm"
                    onClick={() => handleTestDirect('whatsapp')}
                    disabled={testingWa || !testPhoneWa}
                  >
                    {testingWa ? 'Sending test…' : 'Send Test WhatsApp'}
                  </Button>
                </div>

                {testResultWa && (
                  <div
                    style={{
                      marginTop: 12,
                      padding: 12,
                      borderRadius: 'var(--radius-sm)',
                      background: testResultWa.ok ? '#f0fdf4' : '#fef2f2',
                      border: `1px solid ${testResultWa.ok ? '#bbf7d0' : '#fecaca'}`,
                      fontSize: 'var(--fs-label-2)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontWeight: 700, color: testResultWa.ok ? '#166534' : '#991b1b' }}>
                        {testResultWa.ok ? '✓ Test Dispatch Succeeded' : '✗ Test Dispatch Failed'}
                      </span>
                      <span style={{ color: 'var(--n60)' }}>
                        Status: {testResultWa.status} · Latency: {testResultWa.latencyMs}ms
                      </span>
                    </div>
                    <div style={{ color: testResultWa.ok ? '#15803d' : '#b91c1c', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                      {testResultWa.detail}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div>
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 'var(--fs-label-1)', fontWeight: 700, color: 'var(--n90)', marginBottom: 4 }}>
                  DLT & WABA Compliance Identifiers
                </div>
                <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n60)' }}>
                  Mandatory telecom registration identifiers for Indian TRAI DLT compliance and Meta WhatsApp Business Account records.
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div>
                  <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n70)', marginBottom: 4 }}>TRAI DLT Entity ID</div>
                  <input
                    className="lsq-input"
                    type="text"
                    placeholder={complianceMasked?.dltEntityId?.hasValue ? '•••• saved — leave blank to keep' : 'e.g. 1701159123456789'}
                    value={complianceValues.dltEntityId ?? ''}
                    onChange={(e) => setComplianceValues((v) => ({ ...v, dltEntityId: e.target.value }))}
                    style={{ width: '100%', fontSize: 'var(--fs-label-2)' }}
                  />
                </div>
                <div>
                  <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n70)', marginBottom: 4 }}>DLT Sender IDs (Headers)</div>
                  <input
                    className="lsq-input"
                    type="text"
                    placeholder={complianceMasked?.dltSenderIds?.hasValue ? '•••• saved — leave blank to keep' : 'e.g. EVHLTH, WEBINR'}
                    value={complianceValues.dltSenderIds ?? ''}
                    onChange={(e) => setComplianceValues((v) => ({ ...v, dltSenderIds: e.target.value }))}
                    style={{ width: '100%', fontSize: 'var(--fs-label-2)' }}
                  />
                </div>
                <div>
                  <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n70)', marginBottom: 4 }}>SMS Route / DLT Content Template ID</div>
                  <input
                    className="lsq-input"
                    type="text"
                    placeholder={complianceMasked?.dltRoute?.hasValue ? '•••• saved — leave blank to keep' : 'Registered DLT template ID'}
                    value={complianceValues.dltRoute ?? ''}
                    onChange={(e) => setComplianceValues((v) => ({ ...v, dltRoute: e.target.value }))}
                    style={{ width: '100%', fontSize: 'var(--fs-label-2)' }}
                  />
                </div>
                <div>
                  <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n70)', marginBottom: 4 }}>Meta WABA Account ID</div>
                  <input
                    className="lsq-input"
                    type="text"
                    placeholder={complianceMasked?.wabaId?.hasValue ? '•••• saved — leave blank to keep' : 'Meta WhatsApp Business Account ID'}
                    value={complianceValues.wabaId ?? ''}
                    onChange={(e) => setComplianceValues((v) => ({ ...v, wabaId: e.target.value }))}
                    style={{ width: '100%', fontSize: 'var(--fs-label-2)' }}
                  />
                </div>
                <div>
                  <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n70)', marginBottom: 4 }}>WhatsApp Business Phone Number ID</div>
                  <input
                    className="lsq-input"
                    type="text"
                    placeholder={complianceMasked?.wabaPhoneNumberId?.hasValue ? '•••• saved — leave blank to keep' : 'Meta phone number ID'}
                    value={complianceValues.wabaPhoneNumberId ?? ''}
                    onChange={(e) => setComplianceValues((v) => ({ ...v, wabaPhoneNumberId: e.target.value }))}
                    style={{ width: '100%', fontSize: 'var(--fs-label-2)' }}
                  />
                </div>
                <div>
                  <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n70)', marginBottom: 4 }}>Message Template Namespace</div>
                  <input
                    className="lsq-input"
                    type="text"
                    placeholder={complianceMasked?.wabaTemplateNamespace?.hasValue ? '•••• saved — leave blank to keep' : 'WABA template namespace'}
                    value={complianceValues.wabaTemplateNamespace ?? ''}
                    onChange={(e) => setComplianceValues((v) => ({ ...v, wabaTemplateNamespace: e.target.value }))}
                    style={{ width: '100%', fontSize: 'var(--fs-label-2)' }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 18 }}>
                <Button
                  hierarchy="secondary"
                  size="sm"
                  onClick={handleSaveCompliance}
                  disabled={savingCompliance || Object.values(complianceValues).every((v) => !v.trim())}
                >
                  {savingCompliance ? 'Saving…' : 'Save Compliance Identifiers'}
                </Button>
                {complianceSavedNote && (
                  <span style={{ fontSize: 'var(--fs-label-2)', color: complianceSavedNote.ok ? 'var(--success-700)' : 'var(--danger-500)', fontWeight: 600 }}>
                    {complianceSavedNote.ok ? '✓' : '✗'} {complianceSavedNote.text}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div style={{ flexShrink: 0, padding: '14px 24px', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--n10)' }}>
          <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n60)' }}>
            Active: <strong>SMS</strong> → {smsMode === 'trigger' ? 'LSQ Automation (#302)' : 'Direct Gateway'} &nbsp;·&nbsp;
            <strong>WhatsApp</strong> → {waMode === 'trigger' ? 'LSQ Automation (Route Mobile)' : 'Direct Gateway'}
          </div>
          <Button hierarchy="primary" size="sm" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>

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
