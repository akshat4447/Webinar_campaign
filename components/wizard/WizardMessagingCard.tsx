'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { Field } from '@/components/ui/Field';
import {
  TONE_OPTIONS,
  LENGTH_OPTIONS,
  PERSONALIZATION_FIELD_OPTIONS,
} from '@/lib/messagingOptions';
import { normalizeChannel, type Channel } from '@/lib/channels';
import { testGenerateAiDraftAction } from '@/lib/actions/personalize';
import { ExploreAnglesModal } from '@/components/messaging/ExploreAnglesModal';
import { formatSpeakersSummary, type SpeakerInput } from '@/lib/speakerUtils';
import { compareCadenceSteps } from '@/lib/stepSchedule';
import type { WizardCadenceStep } from './WizardCadenceSetupCard';
import type { WizardFieldMapping } from '@/lib/actions/wizard';
import type { MessageAngle } from '@/lib/claude';

export interface StepMessagingConfig {
  mode: 'ai' | 'template';
  templateId?: string | null;
  instruction?: string;
  customSubject?: string;
  customBody?: string;
}

interface WizardMessagingCardProps {
  campaignId: string;
  webinarTitle: string;
  webinarDate?: string;
  webinarTime?: string;
  speakerName?: string;
  speakerTitle?: string;
  speakers?: SpeakerInput[];
  registrationLink?: string;
  zoomLink?: string;
  activeSteps: WizardCadenceStep[];
  fieldMappings: WizardFieldMapping[];
  templateOptions: Record<string, { id: string; name: string; scope: string }[]>;
  initialMode?: 'ai' | 'templatized';
  initialTone?: string;
  initialLength?: string;
  initialInstructions?: string;
  initialBrief?: string;
  initialOneClickSignup?: boolean;
  initialEmailProvider?: 'leadsquared' | 'netcore';
  initialGroundingFields?: string[];
  netcoreConfigured?: boolean;
  sampleContact?: {
    name: string;
    title: string;
    account: string;
    score?: number | null;
  };
  onChange: (config: {
    msgMode: 'ai' | 'templatized';
    tone: string;
    msgLength: string;
    aiInstructions: string;
    brief: string;
    oneClickSignup: boolean;
    emailProvider: 'leadsquared' | 'netcore';
    personalizationFields: string[];
    stepConfigs: Record<string, StepMessagingConfig>;
  }) => void;
}

const CHANNEL_BADGES: Record<Channel, { label: string; color: 'blue' | 'warning' | 'gray' | 'success'; hint: string }> = {
  email: { label: 'Email', color: 'blue', hint: 'Subject line and body with dynamic merge tokens' },
  linkedin: { label: 'LinkedIn DM', color: 'blue', hint: 'Direct message under 60 words, conversational, no subject' },
  sms: { label: 'SMS Text', color: 'warning', hint: 'Concise SMS under 280 GSM characters, no subject' },
  whatsapp: { label: 'WhatsApp', color: 'success', hint: 'Friendly message under 120 words with join link, no subject' },
};

export function WizardMessagingCard({
  campaignId,
  webinarTitle,
  webinarDate,
  webinarTime,
  speakerName,
  speakerTitle,
  speakers = [],
  registrationLink,
  zoomLink,
  activeSteps,
  fieldMappings,
  templateOptions,
  initialMode = 'ai',
  initialTone = TONE_OPTIONS[0],
  initialLength = LENGTH_OPTIONS[0],
  initialInstructions = "Invite the reader to a live session on the webinar topic, tied to the operational problem their role owns. Lead with the problem, not a pitch. Vary the angle by seniority and function. Keep the offer and registration link exactly as given.",
  initialBrief = "Invite the reader to a live session on the webinar topic, tied to the operational problem their role owns. Lead with the problem, not a pitch. Vary the angle by seniority and function. Keep the offer and registration link exactly as given.",
  initialOneClickSignup = true,
  initialEmailProvider = 'leadsquared',
  initialGroundingFields,
  netcoreConfigured = false,
  sampleContact = {
    name: 'Alex Rivera',
    title: 'VP of Engineering',
    account: 'Horizon Labs',
    score: 92,
  },
  onChange,
}: WizardMessagingCardProps) {
  const [msgMode, setMsgMode] = useState<'ai' | 'templatized'>(initialMode);
  const [tone, setTone] = useState(initialTone);
  const [msgLength, setMsgLength] = useState(initialLength);
  const [aiInstructions, setAiInstructions] = useState(() => {
    const isLegacyDefaultAi = initialInstructions?.startsWith("Lead with the operational problem the reader's role owns");
    const isLegacyDefaultBrief = initialBrief?.startsWith("Invite the reader to a live session on the webinar topic, tied to the operational problem their role owns. Lead with the problem, not a pitch. Keep it short and specific.");
    if (initialInstructions && !isLegacyDefaultAi && initialInstructions.trim()) return initialInstructions;
    if (initialBrief && !isLegacyDefaultBrief && initialBrief.trim()) return initialBrief;
    return "Invite the reader to a live session on the webinar topic, tied to the operational problem their role owns. Lead with the problem, not a pitch. Vary the angle by seniority and function. Keep the offer and registration link exactly as given.";
  });
  const [brief, setBrief] = useState(aiInstructions);
  const oneClickSignup = initialOneClickSignup;
  const emailProvider = initialEmailProvider;

  // Active steps from Step 3 sorted by canonical lifecycle order
  const validSteps = activeSteps.filter((s) => s.enabled).sort(compareCadenceSteps);
  const [selectedStepKey, setSelectedStepKey] = useState(validSteps[0]?.key || 'invite');

  // AI draft live testing state
  const [testingAi, setTestingAi] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [testedAiResults, setTestedAiResults] = useState<
    Record<string, { subject: string | null; body: string; rationale: string; usedFallback: boolean }>
  >({});
  const [anglesModalOpen, setAnglesModalOpen] = useState(false);

  // Grounding fields (derived from Step 2's mapped fields)
  const availableGrounding = fieldMappings.filter((m) => m.enabled).map((m) => m.token.replace(/^\{\{|\}\}$/g, ''));
  const [groundingFields, setGroundingFields] = useState<string[]>(
    initialGroundingFields && initialGroundingFields.length > 0
      ? initialGroundingFields
      : availableGrounding.length > 0
        ? availableGrounding
        : ['firstName', 'title', 'account', 'score']
  );

  // Per-step override configs
  const [stepConfigs, setStepConfigs] = useState<Record<string, StepMessagingConfig>>(() => {
    const init: Record<string, StepMessagingConfig> = {};
    for (const s of activeSteps) {
      init[s.key] = {
        mode: (s.mode as 'ai' | 'template') || (initialMode === 'ai' ? 'ai' : 'template'),
        templateId: s.templateId || null,
        instruction: s.instruction || s.desc || '',
        customSubject: "You're invited: {{topic}}",
        customBody: brief,
      };
    }
    return init;
  });

  const currentStep = validSteps.find((s) => s.key === selectedStepKey) || validSteps[0] || activeSteps[0];
  const stepChannel = normalizeChannel(currentStep?.channel || 'Email');
  const channelMeta = CHANNEL_BADGES[stepChannel] || CHANNEL_BADGES.email;

  const currentStepConfig = stepConfigs[selectedStepKey] || {
    mode: msgMode === 'ai' ? 'ai' : 'template',
    customSubject: "You're invited: {{topic}}",
    customBody: brief,
  };

  function updateStepConfig(patch: Partial<StepMessagingConfig>) {
    const updated = {
      ...stepConfigs,
      [selectedStepKey]: { ...currentStepConfig, ...patch },
    };
    setStepConfigs(updated);
    emitChanges({ stepConfigs: updated });
  }

  function emitChanges(overrides: Partial<{
    msgMode: 'ai' | 'templatized';
    tone: string;
    msgLength: string;
    aiInstructions: string;
    brief: string;
    oneClickSignup: boolean;
    emailProvider: 'leadsquared' | 'netcore';
    personalizationFields: string[];
    stepConfigs: Record<string, StepMessagingConfig>;
  }> = {}) {
    onChange({
      msgMode: overrides.msgMode ?? msgMode,
      tone: overrides.tone ?? tone,
      msgLength: overrides.msgLength ?? msgLength,
      aiInstructions: overrides.aiInstructions ?? aiInstructions,
      brief: overrides.brief ?? brief,
      oneClickSignup: overrides.oneClickSignup ?? oneClickSignup,
      emailProvider: overrides.emailProvider ?? emailProvider,
      personalizationFields: overrides.personalizationFields ?? groundingFields,
      stepConfigs: overrides.stepConfigs ?? stepConfigs,
    });
  }

  function toggleGroundingField(fieldId: string) {
    const next = groundingFields.includes(fieldId)
      ? groundingFields.filter((id) => id !== fieldId)
      : [...groundingFields, fieldId];
    setGroundingFields(next);
    emitChanges({ personalizationFields: next });
  }

  // Live Inbox Preview Calculation
  const firstName = sampleContact.name.split(' ')[0] || 'there';
  const topic = webinarTitle || 'Live Strategic Briefing';
  const dateStr = webinarDate ? (webinarTime ? `${webinarDate} at ${webinarTime}` : webinarDate) : 'Upcoming Session';

  const speakersSummary = speakers && speakers.length > 0
    ? formatSpeakersSummary(speakers)
    : speakerName ? `${speakerName}${speakerTitle ? ` (${speakerTitle})` : ''}` : '';
  const speakerStr = speakersSummary ? `Featuring: ${speakersSummary}` : '';
  const linkStr = registrationLink || zoomLink || 'https://webinar.example.com/join';

  // Live AI Draft Test handler
  async function handleTestAiPersonalize() {
    setTestingAi(true);
    setTestError(null);
    try {
      const res = await testGenerateAiDraftAction({
        campaignId,
        topic,
        speakers,
        speakerName,
        speakerTitle,
        brief,
        tone,
        msgLength,
        aiInstructions,
        channel: stepChannel,
        stepLabel: currentStep?.title || 'Webinar Touchpoint',
        stepKey: selectedStepKey,
        customSubject: currentStepConfig.customSubject,
        customBody: currentStepConfig.customBody || brief,
        sampleContact: {
          name: sampleContact.name,
          title: sampleContact.title,
          account: sampleContact.account,
          score: sampleContact.score,
        },
        link: linkStr,
      });

      if (res.ok) {
        setTestedAiResults((prev) => ({
          ...prev,
          [selectedStepKey]: {
            subject: res.subject,
            body: res.body,
            rationale: res.rationale,
            usedFallback: res.usedFallback,
          },
        }));
      } else {
        setTestError(res.error || 'Failed to generate a test draft.');
      }
    } catch (err) {
      setTestError(err instanceof Error ? err.message : 'Could not test the AI draft.');
    } finally {
      setTestingAi(false);
    }
  }

  function handleApplyAngle(angle: MessageAngle) {
    updateStepConfig({
      customBody: angle.body,
      customSubject: angle.subject || currentStepConfig.customSubject,
    });
    setAiInstructions(angle.rationale);
    setBrief(angle.rationale);
    emitChanges({
      aiInstructions: angle.rationale,
      brief: angle.rationale,
      stepConfigs: {
        ...stepConfigs,
        [selectedStepKey]: {
          ...currentStepConfig,
          customBody: angle.body,
          customSubject: angle.subject || currentStepConfig.customSubject,
        },
      },
    });
  }

  const liveTestedResult = testedAiResults[selectedStepKey] || null;

  let previewSubject = currentStepConfig.customSubject || `You're invited: ${topic}`;
  if (liveTestedResult?.subject) {
    previewSubject = liveTestedResult.subject;
  } else {
    previewSubject = previewSubject
      .replace(/\{\{topic\}\}/gi, topic)
      .replace(/\{\{firstName\}\}/gi, firstName)
      .replace(/\{\{company\}\}/gi, sampleContact.account);
  }

  let previewBody = '';
  if (liveTestedResult) {
    previewBody = liveTestedResult.body;
  } else if (currentStepConfig.mode === 'ai') {
    const roleHook = groundingFields.includes('title') && groundingFields.includes('account')
      ? `Given your role as ${sampleContact.title} at ${sampleContact.account}, `
      : groundingFields.includes('title')
        ? `Given your focus on ${sampleContact.title}, `
        : `For teams at ${sampleContact.account}, `;

    if (stepChannel === 'sms') {
      previewBody = `Hi ${firstName}, saw your role as ${sampleContact.title} at ${sampleContact.account}. Joining "${topic}" live? Save your seat: ${linkStr}`;
    } else if (stepChannel === 'linkedin') {
      previewBody = `Hi ${firstName} - noticed your focus heading ${sampleContact.title} at ${sampleContact.account}. We're running a live session on "${topic}" ${speakerStr ? `${speakerStr} ` : ''}tailored for leadership teams. Would you like to attend? Here's direct access: ${linkStr}`;
    } else if (stepChannel === 'whatsapp') {
      previewBody = `Hi ${firstName}, given your work as ${sampleContact.title} at ${sampleContact.account}, thought you'd find our session "${topic}" directly relevant.\n\nWe'll cover tactical playbooks ${speakerStr ? `${speakerStr} ` : ''}to eliminate bottlenecks.\n\nSave your spot: ${linkStr}`;
    } else {
      previewBody = `Hi ${firstName},\n\n${roleHook}we wanted to personally invite you to "${topic}".\n\nWe will break down operational best practices and tactical frameworks.\n\nDate: ${dateStr}\n${speakerStr ? `${speakerStr}\n` : ''}\nOne-click registration: ${linkStr}`;
    }
  } else {
    previewBody = (currentStepConfig.customBody || `Hi {{firstName}},\n\nYou're invited to {{topic}} on {{date}}.\n\nSave your seat here: {{link}}`)
      .replace(/\{\{firstName\}\}/gi, firstName)
      .replace(/\{\{topic\}\}/gi, topic)
      .replace(/\{\{date\}\}/gi, dateStr)
      .replace(/\{\{link\}\}/gi, linkStr)
      .replace(/\{\{speaker\}\}/gi, speakersSummary || 'Our expert panel')
      .replace(/\{\{speakers\}\}/gi, speakersSummary || 'Our expert panel')
      .replace(/\{\{company\}\}/gi, sampleContact.account);
  }

  // Length calculation for SMS / LinkedIn
  const charCount = previewBody.length;
  const wordCount = previewBody.trim().split(/\s+/).filter(Boolean).length;

  const isAi = currentStepConfig.mode === 'ai';
  const overLimit =
    (stepChannel === 'sms' && charCount > 280) ||
    (stepChannel === 'linkedin' && wordCount > 60) ||
    (stepChannel === 'whatsapp' && wordCount > 120);
  const countText =
    stepChannel === 'sms'
      ? `${charCount} / 280 chars (${Math.ceil(charCount / 160)} SMS segment${charCount > 160 ? 's' : ''})`
      : stepChannel === 'linkedin'
        ? `${wordCount} words (recommended under 60)`
        : stepChannel === 'whatsapp'
          ? `${wordCount} words (recommended under 120)`
          : `${wordCount} words`;

  return (
    <div data-campaign-id={campaignId} className="lsq-stack lsq-stack--lg">
      <header className="lsq-page-header">
        <div className="lsq-page-header__text">
          <p className="lsq-page-header__eyebrow">Messaging</p>
          <h2 className="lsq-page-header__title">Copy And Personalization</h2>
          <p className="lsq-page-header__sub">Choose how each touchpoint is written. The preview uses a sample contact until a real draft is generated.</p>
        </div>
      </header>

      <section className="lsq-card" aria-labelledby="wiz-msg-steps">
        <div className="lsq-card__header">
          <div>
            <h3 className="lsq-card__title" id="wiz-msg-steps">Touchpoints</h3>
            <p className="lsq-card__sub">Select a step to configure its copy and AI personalization.</p>
          </div>
        </div>
        <div className="lsq-card__body">
          <div className="lsq-wiz-stepnav" role="group" aria-label="Cadence touchpoints">
            {validSteps.map((s, idx) => {
              const active = s.key === selectedStepKey;
              const stepMode = stepConfigs[s.key]?.mode || 'ai';
              const ch = normalizeChannel(s.channel);
              return (
                <button key={s.key} type="button" className="lsq-wiz-stepnav__item" aria-pressed={active} onClick={() => setSelectedStepKey(s.key)}>
                  <span className="lsq-wiz-stepnav__title">
                    <span className="lsq-wiz-stepnav__n">{idx + 1}</span>
                    {s.title}
                  </span>
                  <span className="lsq-cluster">
                    <Badge color="gray" text={s.timing} />
                    <Badge color="gray" text={CHANNEL_BADGES[ch]?.label ?? ch} />
                    <Badge color={stepMode === 'ai' ? 'blue' : 'gray'} text={stepMode === 'ai' ? 'AI' : 'Template'} />
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <div className="lsq-wiz-split">
        <div className="lsq-stack lsq-stack--lg">
          <section className="lsq-card" aria-labelledby="wiz-msg-config">
            <div className="lsq-card__header">
              <div>
                <h3 className="lsq-card__title" id="wiz-msg-config">Configure {currentStep?.title || 'Touchpoint'}</h3>
                <p className="lsq-card__sub">
                  Timing {currentStep?.timing}, stage {currentStep?.group}. {channelMeta.hint}.
                </p>
              </div>
              <Badge color={channelMeta.color} text={channelMeta.label} dot />
            </div>
            <div className="lsq-card__body lsq-stack">
              <div className="lsq-field">
                <span className="lsq-label" id="wiz-msg-mode-label">Message source</span>
                <div className="lsq-segmented" role="group" aria-labelledby="wiz-msg-mode-label">
                  <button
                    type="button"
                    aria-pressed={currentStepConfig.mode === 'ai'}
                    onClick={() => {
                      setMsgMode('ai');
                      updateStepConfig({ mode: 'ai' });
                      emitChanges({ msgMode: 'ai' });
                    }}
                  >
                    AI Personalized
                  </button>
                  <button
                    type="button"
                    aria-pressed={currentStepConfig.mode === 'template'}
                    onClick={() => {
                      setMsgMode('templatized');
                      updateStepConfig({ mode: 'template' });
                      emitChanges({ msgMode: 'templatized' });
                    }}
                  >
                    Fixed Template
                  </button>
                </div>
              </div>
              {stepChannel === 'email' && (
                <p className="lsq-hint">
                  Email gateway: <strong>{emailProvider === 'netcore' ? 'Netcore Cloud' : 'LeadSquared CRM'}</strong>
                  {emailProvider === 'netcore' && !netcoreConfigured && (
                    <>
                      {' '}
                      <Badge color="warning" text="API key required on Integrations" />
                    </>
                  )}
                </p>
              )}
            </div>
          </section>

          {!isAi ? (
            <section className="lsq-card" aria-labelledby="wiz-msg-template">
              <div className="lsq-card__header">
                <h3 className="lsq-card__title" id="wiz-msg-template">Template</h3>
              </div>
              <div className="lsq-card__body lsq-stack">
                <Field label={`Base template for ${channelMeta.label}`}>
                  {(p) => (
                    <select
                      {...p}
                      className="lsq-select"
                      value={currentStepConfig.templateId || ''}
                      onChange={(e) => updateStepConfig({ templateId: e.target.value || null })}
                    >
                      <option value="">Default built-in template</option>
                      {(templateOptions[stepChannel] || templateOptions.email || []).map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} ({t.scope})
                        </option>
                      ))}
                    </select>
                  )}
                </Field>

                {stepChannel === 'email' && (
                  <Field label="Template subject">
                    {(p) => (
                      <input
                        {...p}
                        className="lsq-input"
                        value={currentStepConfig.customSubject || ''}
                        onChange={(e) => updateStepConfig({ customSubject: e.target.value })}
                        placeholder="You're invited: {{topic}}"
                      />
                    )}
                  </Field>
                )}

                <Field label="Template body (fixed text with merge tokens)">
                  {(p) => (
                    <textarea
                      {...p}
                      className="lsq-input"
                      rows={stepChannel === 'sms' ? 3 : 5}
                      value={currentStepConfig.customBody || brief}
                      onChange={(e) => updateStepConfig({ customBody: e.target.value })}
                    />
                  )}
                </Field>
                <div className="lsq-cluster">
                  <span className="lsq-hint">Insert token</span>
                  {['{{firstName}}', '{{company}}', '{{link}}', '{{speaker}}'].map((tok) => (
                    <Button
                      key={tok}
                      size="sm"
                      hierarchy="secondary"
                      icon={<Icon name="plus" size={14} />}
                      onClick={() => updateStepConfig({ customBody: (currentStepConfig.customBody || '') + ` ${tok} ` })}
                    >
                      {tok}
                    </Button>
                  ))}
                </div>
              </div>
            </section>
          ) : (
            <>
              <section className="lsq-card" aria-labelledby="wiz-msg-ai">
                <div className="lsq-card__header">
                  <div>
                    <h3 className="lsq-card__title" id="wiz-msg-ai">AI Instructions</h3>
                    <p className="lsq-card__sub">Objective, angle and behavioral rules for the touchpoint.</p>
                  </div>
                </div>
                <div className="lsq-card__body">
                  <Field label="Instructions for Claude">
                    {(p) => (
                      <textarea
                        {...p}
                        className="lsq-input"
                        rows={4}
                        value={aiInstructions}
                        onChange={(e) => {
                          const val = e.target.value;
                          setAiInstructions(val);
                          setBrief(val);
                          emitChanges({ aiInstructions: val, brief: val });
                        }}
                        placeholder="What core problem, angle or rules should Claude follow? For example: lead with the operational problem the reader's role owns, not a pitch; vary the angle by seniority; keep the offer and links exact."
                      />
                    )}
                  </Field>
                </div>
              </section>

              <section className="lsq-card" aria-labelledby="wiz-msg-voice">
                <div className="lsq-card__header">
                  <h3 className="lsq-card__title" id="wiz-msg-voice">Voice And Length</h3>
                </div>
                <div className="lsq-card__body">
                  <div className="lsq-grid lsq-grid--narrow">
                    <Field label="Tone of voice">
                      {(p) => (
                        <select
                          {...p}
                          className="lsq-select"
                          value={tone}
                          onChange={(e) => {
                            setTone(e.target.value);
                            emitChanges({ tone: e.target.value });
                          }}
                        >
                          {TONE_OPTIONS.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                      )}
                    </Field>
                    <Field label="Target length">
                      {(p) => (
                        <select
                          {...p}
                          className="lsq-select"
                          value={msgLength}
                          onChange={(e) => {
                            setMsgLength(e.target.value);
                            emitChanges({ msgLength: e.target.value });
                          }}
                        >
                          {LENGTH_OPTIONS.map((l) => (
                            <option key={l} value={l}>
                              {l}
                            </option>
                          ))}
                        </select>
                      )}
                    </Field>
                  </div>
                </div>
              </section>

              <section className="lsq-card" aria-labelledby="wiz-msg-ground">
                <div className="lsq-card__header">
                  <div>
                    <h3 className="lsq-card__title" id="wiz-msg-ground">Personalization Fields</h3>
                    <p className="lsq-card__sub">Contact attributes Claude may use. {groundingFields.length} active.</p>
                  </div>
                </div>
                <div className="lsq-card__body">
                  <div className="lsq-chips" role="group" aria-label="Personalization fields">
                    {PERSONALIZATION_FIELD_OPTIONS.map((f) => {
                      const isChecked = groundingFields.includes(f.id);
                      return (
                        <button
                          key={f.id}
                          type="button"
                          className="lsq-wiz-chip"
                          aria-pressed={isChecked}
                          onClick={() => toggleGroundingField(f.id)}
                          title={f.blurb}
                        >
                          <Icon name={isChecked ? 'check' : 'plus'} size={14} />
                          {f.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </section>
            </>
          )}
        </div>

        <section className="lsq-card lsq-wiz-preview" aria-labelledby="wiz-msg-preview">
          <div className="lsq-card__header">
            <div>
              <h3 className="lsq-card__title" id="wiz-msg-preview">Preview: {channelMeta.label}</h3>
              <p className="lsq-card__sub">
                Recipient {sampleContact.name}, {sampleContact.title} at {sampleContact.account}, score {sampleContact.score ?? 90}.
              </p>
            </div>
            {liveTestedResult ? (
              <Badge color={liveTestedResult.usedFallback ? 'warning' : 'success'} text={liveTestedResult.usedFallback ? 'Heuristic test draft' : 'Real AI draft'} dot />
            ) : (
              <Badge color="gray" text="Sample, not a real draft" dot />
            )}
          </div>
          <div className="lsq-card__body lsq-stack">
            <div className="lsq-cluster">
              <Button
                size="sm"
                icon={<Icon name="sparkle" size={14} />}
                loading={testingAi}
                disabled={testingAi}
                onClick={handleTestAiPersonalize}
              >
                {testingAi ? 'Personalizing' : 'Test Personalize With AI'}
              </Button>
              <Button size="sm" hierarchy="secondary" icon={<Icon name="sparkle" size={14} />} onClick={() => setAnglesModalOpen(true)}>
                Explore 3 AI Angles
              </Button>
              {liveTestedResult && (
                <Button
                  size="sm"
                  hierarchy="tertiary"
                  onClick={() => {
                    setTestedAiResults((prev) => {
                      const next = { ...prev };
                      delete next[selectedStepKey];
                      return next;
                    });
                  }}
                >
                  Reset To Sample
                </Button>
              )}
            </div>

            {testError && (
              <div className="lsq-banner lsq-banner--error" role="alert">
                <Icon name="error" size={18} />
                <p className="lsq-banner__body">{testError}</p>
              </div>
            )}

            {liveTestedResult?.rationale && (
              <div className="lsq-banner">
                <Icon name="sparkle" size={18} />
                <div>
                  <p className="lsq-banner__title">Claude hook and angle</p>
                  <p className="lsq-banner__body">{liveTestedResult.rationale}</p>
                  <div className="lsq-banner__actions">
                    <Button
                      size="sm"
                      hierarchy="secondary"
                      onClick={() => {
                        updateStepConfig({
                          customBody: liveTestedResult.body,
                          ...(liveTestedResult.subject ? { customSubject: liveTestedResult.subject } : {}),
                        });
                      }}
                    >
                      Use Copy For Step
                    </Button>
                  </div>
                </div>
              </div>
            )}

            <div className="lsq-wiz-message">
              {stepChannel === 'email' && <p className="lsq-wiz-message__subject">Subject: {previewSubject}</p>}
              <div className="lsq-wiz-message__body">{previewBody}</div>
              {isAi && !liveTestedResult && (
                <p className="lsq-hint">Illustrative sample only. The final copy is written per contact when the step sends. Use Test Personalize With AI for a real draft.</p>
              )}
            </div>

            <div className="lsq-cluster lsq-cluster--between lsq-wiz-count" data-over={overLimit || undefined}>
              <span>{channelMeta.hint}</span>
              <strong>{countText}</strong>
            </div>
          </div>
        </section>
      </div>

      {/* Explore Psychological Copy Angles Modal */}
      {anglesModalOpen && (
        <ExploreAnglesModal
          open={anglesModalOpen}
          onClose={() => setAnglesModalOpen(false)}
          campaignId={campaignId}
          topic={topic}
          speakers={speakers}
          speakerName={speakerName}
          speakerTitle={speakerTitle}
          brief={brief}
          stepKey={selectedStepKey}
          stepLabel={currentStep?.title || 'Touchpoint'}
          channel={stepChannel}
          baseBody={currentStepConfig.customBody || brief}
          onApplyAngle={handleApplyAngle}
        />
      )}
    </div>
  );
}
