'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';
import {
  getEnrichmentPreflightAction,
  runEnrichmentSampleAction,
  runEnrichmentAction,
} from '@/lib/actions/enrichment';
import {
  saveIntegrationConfigAction,
  testIntegrationAction,
} from '@/lib/actions/integrations';
import type {
  EnrichmentFieldSelection,
  EnrichmentPreflightEstimate,
  SampleEnrichmentPreview,
  EnrichmentResult,
} from '@/lib/enrichment';

interface EnrichmentModerationModalProps {
  isOpen: boolean;
  onClose: () => void;
  campaignId: string;
  onComplete: (result: EnrichmentResult) => void;
}

const DEFAULT_FIELDS: EnrichmentFieldSelection = {
  apolloEmail: true,
  apolloPhone: true,
  apolloTitle: true,
  claudePersona: true,
};

export function EnrichmentModerationModal({
  isOpen,
  onClose,
  campaignId,
  onComplete,
}: EnrichmentModerationModalProps) {
  const [fields, setFields] = useState<EnrichmentFieldSelection>(DEFAULT_FIELDS);
  const [preflight, setPreflight] = useState<EnrichmentPreflightEstimate | null>(null);
  const [loadingPreflight, setLoadingPreflight] = useState(false);
  const [sampleLoading, setSampleLoading] = useState(false);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [samples, setSamples] = useState<SampleEnrichmentPreview[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [apolloKeyInput, setApolloKeyInput] = useState('');
  const [savingApolloKey, setSavingApolloKey] = useState(false);
  const [apolloKeyError, setApolloKeyError] = useState<string | null>(null);
  const [apolloSuccessMsg, setApolloSuccessMsg] = useState<string | null>(null);
  const [showApolloInput, setShowApolloInput] = useState(false);

  async function handleSaveApolloKey() {
    const key = apolloKeyInput.trim();
    if (!key) {
      setApolloKeyError('Paste an Apollo API key.');
      return;
    }
    setSavingApolloKey(true);
    setApolloKeyError(null);
    setApolloSuccessMsg(null);
    try {
      const testRes = await testIntegrationAction('apollo', { apiKey: key });
      if (!testRes.ok) {
        setApolloKeyError(testRes.detail || 'Apollo rejected this API key.');
        return;
      }
      await saveIntegrationConfigAction('apollo', { apiKey: key });
      setApolloSuccessMsg('Apollo API key verified and connected.');
      const refreshed = await getEnrichmentPreflightAction(campaignId, fields);
      setPreflight(refreshed);
      setShowApolloInput(false);
      setApolloKeyInput('');
    } catch (err) {
      setApolloKeyError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingApolloKey(false);
    }
  }

  useEffect(() => {
    let active = true;
    if (!isOpen) return;

    getEnrichmentPreflightAction(campaignId, fields)
      .then((data) => {
        if (active) {
          setPreflight(data);
          setLoadingPreflight(false);
        }
      })
      .catch((err) => {
        if (active) {
          setError(err instanceof Error ? err.message : String(err));
          setLoadingPreflight(false);
        }
      });

    return () => {
      active = false;
    };
  }, [isOpen, campaignId, fields]);

  function handleFieldToggle(key: keyof EnrichmentFieldSelection, val: boolean) {
    setLoadingPreflight(true);
    setFields((prev) => ({ ...prev, [key]: val }));
  }

  const handleClose = useCallback(() => {
    setSamples(null);
    setError(null);
    setApolloKeyError(null);
    setApolloSuccessMsg(null);
    setShowApolloInput(false);
    setApolloKeyInput('');
    onClose();
  }, [onClose]);

  async function handleRunSample() {
    setSampleLoading(true);
    setError(null);
    try {
      const res = await runEnrichmentSampleAction(campaignId, 3, fields);
      if (res.ok && res.samples) {
        setSamples(res.samples);
      } else {
        setError(res.error || 'Failed to run sample enrichment.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSampleLoading(false);
    }
  }

  async function handleRunBulk() {
    setBulkLoading(true);
    setError(null);
    try {
      const res = await runEnrichmentAction(campaignId, { fields });
      if (res.ok) {
        onComplete(res);
        handleClose();
      } else {
        setError(res.error || 'Enrichment failed.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBulkLoading(false);
    }
  }

  const busy = sampleLoading || bulkLoading;
  const apolloConfigured = !!preflight?.integrations.apollo.configured;

  const fieldRows: {
    key: keyof EnrichmentFieldSelection;
    title: string;
    badge: { color: string; text: string };
    description: string;
  }[] = [
    {
      key: 'apolloEmail',
      title: 'Work email address',
      badge: { color: apolloConfigured ? 'blue light' : 'gray', text: apolloConfigured ? 'Apollo' : 'Local fallback' },
      description: apolloConfigured
        ? 'Finds verified direct email for prospects missing an inbox address via Apollo.'
        : 'Apollo offline: infers email via local name and domain pattern (held back until verified).',
    },
    {
      key: 'apolloPhone',
      title: 'Direct mobile or phone number',
      badge: { color: apolloConfigured ? 'blue light' : 'gray', text: apolloConfigured ? 'Apollo' : 'Apollo offline' },
      description: apolloConfigured
        ? 'Extracts mobile numbers for SMS and WhatsApp countdown reminders.'
        : 'Requires a connected Apollo API to search phone numbers (skipped while offline).',
    },
    {
      key: 'apolloTitle',
      title: 'Current job title and role',
      badge: { color: apolloConfigured ? 'blue light' : 'gray', text: apolloConfigured ? 'Apollo' : 'Apollo offline' },
      description: apolloConfigured
        ? 'Fills missing job titles and updates outdated roles via Apollo.'
        : 'Requires a connected Apollo API to update job titles (skipped while offline).',
    },
    {
      key: 'claudePersona',
      title: 'Persona and seniority normalization',
      badge: { color: 'purple', text: 'Claude' },
      description: 'Infers function, seniority tier (C-Suite, VP, Director) and writes tailored persona notes.',
    },
  ];

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      busy={busy}
      size="lg"
      title="Moderate and Select Enrichment Fields"
      subtitle="Select which fields to enrich and verify quality on sample contacts before running in bulk."
      footer={
        <>
          <Button hierarchy="tertiary" onClick={handleClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            hierarchy="secondary"
            onClick={handleRunSample}
            loading={sampleLoading}
            disabled={bulkLoading || loadingPreflight}
            title="Runs the real Apollo/Claude calls on 3 contacts so the preview reflects real results, but nothing is saved to those contacts. Only Enrich All Contacts writes changes."
          >
            {sampleLoading ? 'Testing 3 Contacts' : 'Test on 3 Sample Contacts'}
          </Button>
          <Button hierarchy="primary" onClick={handleRunBulk} loading={bulkLoading} disabled={sampleLoading || loadingPreflight}>
            {bulkLoading ? 'Enriching Audience' : 'Enrich All Contacts'}
          </Button>
        </>
      }
    >
      <div className="lsq-stack lsq-stack--lg">
        {error && (
          <div className="lsq-banner lsq-banner--error" role="alert">
            <span className="lsq-banner__icon" aria-hidden="true"><Icon name="error" size={16} /></span>
            <p className="lsq-banner__body">{error}</p>
          </div>
        )}

        <fieldset className="lsq-wiz-fieldset">
          <legend className="lsq-label">Fields to enrich</legend>
          <ul className="lsq-wiz-fieldlist">
            {fieldRows.map((row) => (
              <li key={row.key}>
                <label className="lsq-wiz-fieldrow" data-checked={fields[row.key] ? 'true' : undefined}>
                  <input type="checkbox" checked={fields[row.key]} onChange={(e) => handleFieldToggle(row.key, e.target.checked)} />
                  <span className="lsq-grow">
                    <span className="lsq-cluster">
                      <span className="lsq-wiz-fieldrow__title">{row.title}</span>
                      <Badge color={row.badge.color} text={row.badge.text} />
                    </span>
                    <span className="lsq-hint lsq-wiz-block">{row.description}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>

        {/* Preflight usage and cost estimation */}
        {preflight && (
          <div className="lsq-wiz-panel lsq-stack">
            <h3 className="lsq-wiz-panel__title">Estimated usage and integrations</h3>
            <dl className="lsq-kv">
              <dt>Apollo credits</dt>
              <dd>
                {apolloConfigured
                  ? `About ${preflight.estimatedApolloCredits} match${preflight.estimatedApolloCredits === 1 ? '' : 'es'}`
                  : '0 (offline, pattern guess)'}
              </dd>
              <dt>Claude inferences</dt>
              <dd>{fields.claudePersona ? preflight.totalContacts : 0} contacts</dd>
            </dl>

            <div className="lsq-cluster">
              <span className="lsq-hint">Integrations</span>
              <Badge color={apolloConfigured ? 'success' : 'warning'} text={apolloConfigured ? 'Apollo connected' : 'Apollo not connected (local pattern fallback)'} />
              <Badge color={preflight.integrations.claude.configured ? 'success' : 'error'} text={preflight.integrations.claude.configured ? 'Claude connected' : 'Claude not connected'} />
            </div>

            {apolloSuccessMsg && (
              <div className="lsq-banner lsq-banner--success" role="status">
                <span className="lsq-banner__icon" aria-hidden="true"><Icon name="check-circle" size={16} /></span>
                <p className="lsq-banner__body">{apolloSuccessMsg}</p>
              </div>
            )}

            {!apolloConfigured && (fields.apolloEmail || fields.apolloPhone || fields.apolloTitle) && (
              <div className="lsq-banner lsq-banner--warning">
                <span className="lsq-banner__icon" aria-hidden="true"><Icon name="warning" size={16} /></span>
                <div className="lsq-grow lsq-stack lsq-stack--sm">
                  <p className="lsq-banner__title">Apollo not configured</p>
                  <p className="lsq-banner__body">
                    Without an Apollo API key, email search falls back to built-in <strong>local pattern guessing</strong> (flagged and held back from sending until manually approved on the Audience tab). Real-time phone and job title updates require an Apollo key.
                  </p>
                  <div className="lsq-cluster">
                    <Button hierarchy="secondary" size="sm" onClick={() => setShowApolloInput((v) => !v)}>
                      {showApolloInput ? 'Hide Key Input' : 'Connect Apollo Key'}
                    </Button>
                    <a className="lsq-linkbtn lsq-wiz-extlink" href="/integrations" target="_blank" rel="noopener noreferrer">
                      Integrations page
                      <Icon name="external" size={14} />
                    </a>
                  </div>

                  {showApolloInput && (
                    <div className="lsq-wiz-inputrow">
                      <div className="lsq-grow">
                        <Field label="Apollo API key" error={apolloKeyError}>
                          {(p) => (
                            <input
                              {...p}
                              type="password"
                              className="lsq-input"
                              placeholder="Paste the Apollo API key from apollo.io"
                              value={apolloKeyInput}
                              onChange={(e) => setApolloKeyInput(e.target.value)}
                              disabled={savingApolloKey}
                            />
                          )}
                        </Field>
                      </div>
                      <Button hierarchy="primary" onClick={handleSaveApolloKey} loading={savingApolloKey} disabled={!apolloKeyInput.trim()}>
                        {savingApolloKey ? 'Verifying' : 'Save and Connect'}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Sample preview results */}
        {samples && samples.length > 0 && (
          <section className="lsq-stack" aria-labelledby="enrichment-samples-title">
            <h3 className="lsq-wiz-panel__title" id="enrichment-samples-title">
              Sample results ({samples.length} contacts verified)
            </h3>
            <ul className="lsq-rows">
              {samples.map((s) => (
                <li key={s.id} className="lsq-wiz-panel lsq-stack lsq-stack--sm">
                  <div className="lsq-cluster lsq-cluster--between">
                    <strong className="lsq-wiz-wrap">
                      {s.name} ({s.account})
                    </strong>
                    <Badge color="blue light" text={String(s.after.enrichmentSource)} />
                  </div>
                  <dl className="lsq-kv">
                    <dt>Email</dt>
                    <dd>
                      {s.after.email || 'None'}
                      {s.after.emailVerified && <> <Badge color="success" text="Verified" /></>}
                      {s.after.emailSimulated && <> <Badge color="warning" text="Inferred" /></>}
                    </dd>
                    <dt>Phone</dt>
                    <dd>{s.after.phone || 'None'}</dd>
                    <dt>Role</dt>
                    <dd>{s.after.title}</dd>
                    <dt>Vertical</dt>
                    <dd>{s.after.vertical}</dd>
                  </dl>
                  {s.after.personaNote && <p className="lsq-msgbox">&ldquo;{s.after.personaNote}&rdquo;</p>}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </Modal>
  );
}
