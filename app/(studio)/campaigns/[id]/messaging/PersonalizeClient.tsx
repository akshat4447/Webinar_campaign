'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Avatar } from '@/components/ui/Avatar';
import { Field } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { NavButton } from '@/components/ui/NavButton';
import { useToast } from '@/components/ui/Toast';
import {
  generatePersonalizedAction,
  generateAllStepsAction,
  regeneratePersonalizedAction,
  savePersonalizedAction,
  markReviewedAction,
  markAllReviewedAction,
  repairLinksAction,
  switchStepToFixedTemplateAction,
  switchStepModeAction,
  saveAiInstructionsAndRegeneratePendingAction,
  regenerateOutdatedDraftsAction,
  testGenerateAiDraftAction,
} from '@/lib/actions/personalize';
import { updateStepBaseTemplateAction } from '@/lib/actions/messageTemplates';
import { ExploreAnglesModal } from '@/components/messaging/ExploreAnglesModal';
import type { GenerateResult } from '@/lib/personalization';
import { validateRenderedMessageForChannel, type ValidationResult } from '@/lib/messageValidation';
import type { Channel } from '@/lib/channels';
import { renderMergeFields } from '@/lib/mergeFields';
import { PromptModal } from './PromptModal';
import { SendTestModal } from './SendTestModal';
import { GenerateConfigModal, type GenerateConfig } from './GenerateConfigModal';
import { EditContactModal, type EditableContactFields } from './EditContactModal';
import {
  PERSONALIZATION_FIELD_OPTIONS,
  DEFAULT_PERSONALIZATION_FIELDS,
} from '@/lib/messagingOptions';

interface MessageState {
  id: string;
  subject: string | null;
  body: string;
  rationale: string | null;
  status: string;
  linkStale: boolean;
  isOutdated?: boolean;
}

interface Row {
  contactId: string;
  name: string;
  title: string;
  account: string;
  seniority: string;
  function: string;
  vertical: string;
  score: number | null;
  personaNote: string | null;
  message: MessageState | null;
}

interface StepOption {
  key: string;
  label: string;
  channel: string;
  count: number;
  isSent?: boolean;
  sentCount?: number;
  queuedCount?: number;
}

export interface SelectableTemplate {
  id: string;
  name: string;
  subject: string | null;
  body: string;
  isDefault: boolean;
}

const CHANNEL_LABEL: Record<Channel, string> = { email: 'Email', linkedin: 'LinkedIn', sms: 'SMS', whatsapp: 'WhatsApp' };
const BODY_LABEL: Record<Channel, string> = { email: 'Email body', linkedin: 'LinkedIn message', sms: 'SMS text', whatsapp: 'WhatsApp message' };

const statusMeta: Record<string, { color: string; label: string }> = {
  draft: { color: 'blue', label: 'Draft' },
  edited: { color: 'warning', label: 'Edited' },
  reviewed: { color: 'success', label: 'Reviewed' },
};

function baselineFromRows(rows: Row[]): Record<string, { subject: string | null; body: string }> {
  return Object.fromEntries(rows.filter((r) => r.message).map((r) => [r.message!.id, { subject: r.message!.subject, body: r.message!.body }]));
}

function renderLocalMerge(text: string, contact: Row, topic: string, link: string, date?: string, speaker?: string) {
  return renderMergeFields(text, {
    firstName: contact.name.split(' ')[0] || contact.name,
    lastName: contact.name.split(' ').slice(1).join(' '),
    company: contact.account,
    topic,
    link,
    date,
    speaker,
  });
}

export function PersonalizeClient({
  campaignId,
  campaignName,
  campaignDate,
  speakerName,
  hasDescription,
  steps,
  activeStepKey,
  activeStepLabel,
  activeChannel,
  isSent = false,
  sentCount = 0,
  stepMode = 'ai',
  stepTemplateId = null,
  selectableTemplates = [],
  personalizationFields = [],
  templateSubject,
  templateBody,
  rows: initialRows,
  totalApproved,
  totalDrafted,
  currentLink,
  personalizationPrompt,
  brief = '',
  aiInstructions = '',
  tone,
  msgLength,
  confirmThreshold,
  statusNotice,
  msgMode,
  speakers = [],
}: {
  campaignId: string;
  campaignName: string;
  campaignDate?: string;
  speakerName?: string | null;
  speakers?: Array<{ name: string; title?: string | null; company?: string | null }>;
  hasDescription: boolean;
  steps: StepOption[];
  activeStepKey: string;
  activeStepLabel: string;
  activeChannel: Channel;
  isSent?: boolean;
  sentCount?: number;
  queuedCount?: number;
  stepMode?: 'ai' | 'template';
  stepTemplateId?: string | null;
  selectableTemplates?: SelectableTemplate[];
  personalizationFields?: string[];
  templateSubject: string | null;
  templateBody: string;
  rows: Row[];
  totalApproved?: number;
  totalDrafted?: number;
  currentLink: string;
  personalizationPrompt: string;
  brief?: string;
  aiInstructions?: string;
  tone?: string | null;
  msgLength?: string | null;
  confirmThreshold: number;
  /** Page-level status shown directly under the header (readiness summary). */
  statusNotice?: React.ReactNode;
  /** Campaign-level messaging mode set in the wizard — governs the run
   *  summary's copy only; generation itself is unconditional (AI mode uses
   *  the brief, templatized mode still runs a merge-field pass per contact). */
  msgMode: 'ai' | 'templatized';
}) {
  const audienceTotal = totalApproved ?? initialRows.length;
  const [rows, setRows] = useState(initialRows);
  const [selectedId, setSelectedId] = useState<string | null>(initialRows.find((r) => r.message)?.contactId ?? initialRows[0]?.contactId ?? null);
  const [generating, setGenerating] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const [generateConfigOpen, setGenerateConfigOpen] = useState(false);
  const [showTemplate, setShowTemplate] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const [testModalOpen, setTestModalOpen] = useState(false);
  const [savedPrompt, setSavedPrompt] = useState(personalizationPrompt);
  const [savedBrief, setSavedBrief] = useState(brief);
  const [savedAiInstructions, setSavedAiInstructions] = useState(aiInstructions);
  const [savedTone, setSavedTone] = useState(tone ?? undefined);
  const [savedMsgLength, setSavedMsgLength] = useState(msgLength ?? undefined);
  const [editingBaseTemplate, setEditingBaseTemplate] = useState(false);
  const [baseSubjectDraft, setBaseSubjectDraft] = useState(templateSubject ?? '');
  const [baseBodyDraft, setBaseBodyDraft] = useState(templateBody);
  const [savingBase, setSavingBase] = useState(false);

  // Mode and Template state for pending steps
  const [currentStepMode, setCurrentStepMode] = useState<'ai' | 'template'>(stepMode === 'template' ? 'template' : 'ai');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(stepTemplateId || selectableTemplates[0]?.id || '');
  const [anglesModalOpen, setAnglesModalOpen] = useState(false);
  const [testingSampleAi, setTestingSampleAi] = useState(false);
  const [sampleAiResult, setSampleAiResult] = useState<{
    subject: string | null;
    body: string;
    rationale: string;
    usedFallback: boolean;
  } | null>(null);
  const [activePersonalizationFields, setActivePersonalizationFields] = useState<string[]>(
    personalizationFields && personalizationFields.length > 0 ? personalizationFields : [...DEFAULT_PERSONALIZATION_FIELDS]
  );
  const [fieldEditContact, setFieldEditContact] = useState<EditableContactFields | null>(null);
  const [switchingTemplate, setSwitchingTemplate] = useState(false);
  // Text as it stands in the DB, keyed by message id — lets the editor tell a
  // real edit from an untouched message, so saving can't demote a reviewed
  // message back to "edited" for nothing.
  const [baseline, setBaseline] = useState<Record<string, { subject: string | null; body: string }>>(() => baselineFromRows(initialRows));
  const [seenRows, setSeenRows] = useState(initialRows);
  const router = useRouter();
  const { showToast } = useToast();

  // `rows` is seeded from the `initialRows` prop but several actions below
  // (handleRegenerateOutdated, and the stepScope:'all' branch of runGenerate)
  // only call router.refresh() instead of patching `rows` locally — the
  // server component re-renders with fresh data, but a plain useState(prop)
  // never re-reads a changed prop on its own, so the editor kept showing
  // stale/outdated drafts until something else happened to touch `rows`.
  // Adjusting state during render (rather than in an effect) picks up the
  // new prop the moment it arrives, matching CadenceGroups' `seenSteps` /
  // ScoringTable's `seen`. `baseline` is keyed off the same rows, so it has
  // to be rebuilt in lockstep or a freshly-refreshed message would look
  // permanently "dirty" against a baseline entry that no longer exists.
  if (seenRows !== initialRows) {
    setSeenRows(initialRows);
    setRows(initialRows);
    setBaseline(baselineFromRows(initialRows));
  }

  const selected = rows.find((r) => r.contactId === selectedId) ?? null;
  const generatedCount = rows.filter((r) => r.message).length;

  // Personalize previously had zero content validation at all — a message
  // missing the link or with a leftover {{token}} looked exactly as ready as a
  // correct one. This computes a real pass/fail per recipient for this step,
  // reusing the same check the actual send path in lib/cadence.ts applies —
  // see validateRenderedMessage's docstring for why a leftover token there
  // isn't just cosmetic.
  const validationByContact = useMemo(() => {
    const map = new Map<string, ValidationResult>();
    for (const r of rows) {
      if (r.message) map.set(r.contactId, validateRenderedMessageForChannel(r.message.subject, r.message.body, activeChannel === 'email', currentLink, activeChannel));
    }
    return map;
  }, [rows, activeChannel, currentLink]);
  const selectedValidation = selected?.message ? validationByContact.get(selected.contactId) ?? null : null;
  const invalidCount = Array.from(validationByContact.values()).filter((v) => !v.valid).length;
  const unreviewed = rows.filter((r) => r.message && r.message.status !== 'reviewed').length;
  const staleLinkCount = rows.filter((r) => r.message?.linkStale).length;
  const outdatedDraftsCount = rows.filter((r) => r.message?.isOutdated).length;
  const [regeneratingOutdated, setRegeneratingOutdated] = useState(false);

  async function handleRegenerateOutdated() {
    setRegeneratingOutdated(true);
    setNotice(null);
    try {
      const res = await regenerateOutdatedDraftsAction(campaignId, activeStepKey);
      if (res.ok) {
        setNotice({ text: `Refreshed ${res.generated} draft(s) with updated webinar information (custom edits preserved).`, tone: 'good' });
        router.refresh();
      } else {
        setNotice({ text: res.error || 'Failed to refresh drafts.', tone: 'bad' });
      }
    } catch {
      setNotice({ text: 'Error refreshing drafts.', tone: 'bad' });
    } finally {
      setRegeneratingOutdated(false);
    }
  }

  const base = selected?.message ? baseline[selected.message.id] : undefined;
  const dirty = !!selected?.message && (!base || base.subject !== selected.message.subject || base.body !== selected.message.body);

  async function repairStaleLinks() {
    setRepairing(true);
    try {
      const { count, bodies } = await repairLinksAction(campaignId, activeStepKey);
      // Apply the new bodies locally: router.refresh() re-runs the server component
      // but won't reseed this component's state, so the open preview would keep
      // showing the superseded link.
      setRows((rs) =>
        rs.map((r) =>
          r.message && bodies[r.contactId] !== undefined
            ? { ...r, message: { ...r.message, body: bodies[r.contactId], linkStale: false } }
            : r
        )
      );
      setBaseline((bl) => {
        const next = { ...bl };
        for (const r of rows) {
          const body = r.message ? bodies[r.contactId] : undefined;
          if (r.message && body !== undefined) next[r.message.id] = { subject: r.message.subject, body };
        }
        return next;
      });
      setNotice({ tone: 'good', text: `Registration link updated in ${count} message${count === 1 ? '' : 's'}.` });
      router.refresh();
    } catch (err) {
      setNotice({ tone: 'bad', text: err instanceof Error ? err.message : 'Repair failed.' });
    } finally {
      setRepairing(false);
    }
  }

  /** Folds freshly written copy into the editor and marks it as the saved baseline. */
  function applyWritten(messages: NonNullable<GenerateResult['messages']>) {
    const byContact = new Map(messages.map((m) => [m.contactId, m]));
    setRows((rs) =>
      rs.map((r) => {
        const m = byContact.get(r.contactId);
        return m ? { ...r, message: { id: m.id, subject: m.subject, body: m.body, rationale: m.rationale, status: m.status, linkStale: m.linkStale } } : r;
      })
    );
    setBaseline((bl) => {
      const next = { ...bl };
      for (const m of messages) next[m.id] = { subject: m.subject, body: m.body };
      return next;
    });
  }

  async function runGenerate(config?: GenerateConfig) {
    setConfirming(false);
    setGenerating(true);
    setNotice(null);
    try {
      if (config?.stepScope === 'all') {
        const allRes = await generateAllStepsAction(campaignId, { onlyMissing: config.onlyMissing });
        if (!allRes.ok) {
          setNotice({ tone: 'bad', text: allRes.errors.join('; ') || 'Generation failed across steps.' });
          return;
        }
        setNotice({
          tone: 'good',
          text: `Wrote ${allRes.totalGenerated} personalized draft(s) across all active steps.`,
        });
        router.refresh();
        return;
      }

      const res = await generatePersonalizedAction(campaignId, activeStepKey, { onlyMissing: config?.onlyMissing });
      if (!res.ok) {
        setNotice({ tone: 'bad', text: res.error ?? 'Generation failed.' });
        return;
      }
      if (res.messages) applyWritten(res.messages);
      setNotice({
        tone: 'good',
        text: `Wrote ${res.generated} message${res.generated === 1 ? '' : 's'}${res.linkRepaired ? ` · re-inserted the registration link into ${res.linkRepaired}` : ''}`,
      });
      router.refresh();
    } catch (err) {
      setNotice({ tone: 'bad', text: err instanceof Error ? err.message : 'Generation failed.' });
    } finally {
      setGenerating(false);
    }
  }

  function onGenerateClick() {
    setGenerateConfigOpen(true);
  }

  async function regenerate(contactId: string) {
    setBusyRow(contactId);
    try {
      const res = await regeneratePersonalizedAction(campaignId, contactId, activeStepKey);
      if (!res.ok) {
        const text = res.error ?? 'Could not regenerate.';
        setNotice({ tone: 'bad', text });
        // Per-row Regenerate sits far down a long, scrollable page — the local
        // `notice` banner lives up near the step picker, easy to miss. A toast
        // surfaces failures wherever the user's eyes actually are.
        showToast(text);
        return;
      }
      if (res.messages) applyWritten(res.messages);
      setNotice({ tone: 'good', text: 'Rewritten.' });
      router.refresh();
    } catch (err) {
      const text = err instanceof Error ? err.message : 'Could not regenerate.';
      setNotice({ tone: 'bad', text });
      showToast(text);
    } finally {
      setBusyRow(null);
    }
  }

  function patchSelected(patch: Partial<MessageState>) {
    setRows((rs) => rs.map((r) => (r.contactId === selectedId && r.message ? { ...r, message: { ...r.message, ...patch } } : r)));
  }

  async function save() {
    if (!selected?.message || !dirty) return;
    const { id, subject, body } = selected.message;
    setSaving(true);
    try {
      const res = await savePersonalizedAction(campaignId, id, subject, body, {
        contactId: selected.contactId,
        stepKey: activeStepKey,
      });
      const finalId = res.id || id;
      setBaseline((bl) => ({ ...bl, [finalId]: { subject, body } }));
      patchSelected({ id: finalId, status: 'edited' });
      router.refresh();
    } catch (err) {
      const text = err instanceof Error ? err.message : 'Save failed.';
      setNotice({ tone: 'bad', text });
      // Row Save sits far down a long, scrollable page — the local `notice`
      // banner lives up near the step picker, easy to miss. A toast surfaces
      // failures wherever the user's eyes actually are.
      showToast(text);
    } finally {
      setSaving(false);
    }
  }

  async function saveBaseTemplate() {
    setSavingBase(true);
    setNotice(null);
    try {
      const res = await updateStepBaseTemplateAction(campaignId, activeStepKey, {
        subject: activeChannel === 'email' ? baseSubjectDraft : null,
        body: baseBodyDraft,
      });
      if (res.ok) {
        setNotice({ tone: 'good', text: 'Base template updated and linked to campaign.' });
        setEditingBaseTemplate(false);
        router.refresh();
      } else {
        setNotice({ tone: 'bad', text: res.error || 'Failed to update base template.' });
      }
    } catch (err) {
      setNotice({ tone: 'bad', text: err instanceof Error ? err.message : 'Failed to update base template.' });
    } finally {
      setSavingBase(false);
    }
  }

  async function review() {
    if (!selected?.message) return;
    try {
      await markReviewedAction(campaignId, selected.message.id);
      patchSelected({ status: 'reviewed' });
      router.refresh();
    } catch (err) {
      setNotice({ tone: 'bad', text: err instanceof Error ? err.message : 'Could not mark reviewed.' });
    }
  }

  async function reviewAll() {
    try {
      const n = await markAllReviewedAction(campaignId, activeStepKey);
      setRows((rs) => rs.map((r) => (r.message ? { ...r, message: { ...r.message, status: 'reviewed' } } : r)));
      setNotice({ tone: 'good', text: `${n} message${n === 1 ? '' : 's'} marked reviewed.` });
      router.refresh();
    } catch (err) {
      setNotice({ tone: 'bad', text: err instanceof Error ? err.message : 'Could not mark all reviewed.' });
    }
  }

  async function handleSwitchMode(newMode: 'ai' | 'template') {
    if (isSent) return;
    setCurrentStepMode(newMode);
    setSwitchingTemplate(true);
    setNotice(null);
    try {
      if (newMode === 'template') {
        const targetTplId = selectedTemplateId || selectableTemplates[0]?.id || null;
        await switchStepModeAction(campaignId, activeStepKey, 'template', targetTplId);
        setNotice({ tone: 'good', text: `Switched "${activeStepLabel}" to fixed template mode.` });
      } else {
        const res = await switchStepModeAction(campaignId, activeStepKey, 'ai', null, { autoDraft: true });
        if (res.messages && res.messages.length > 0) {
          applyWritten(res.messages);
        }
        setNotice({
          tone: 'good',
          text: `Switched "${activeStepLabel}" to AI personalized mode${res.generated ? ` · wrote ${res.generated} drafts` : ''}.`,
        });
      }
      router.refresh();
    } catch (err) {
      setNotice({ tone: 'bad', text: err instanceof Error ? err.message : 'Failed to switch mode.' });
    } finally {
      setSwitchingTemplate(false);
    }
  }

  function handleApplyAngle(angle: import('@/lib/claude').MessageAngle) {
    if (currentStepMode === 'template') {
      setBaseBodyDraft(angle.body);
      if (angle.subject) setBaseSubjectDraft(angle.subject);
      setNotice({ tone: 'good', text: `Applied "${angle.name}" to the template copy. Open the base template and use Save Template Changes to commit.` });
    } else {
      setSavedBrief(angle.rationale);
      setNotice({ tone: 'good', text: `Applied "${angle.name}" as the touchpoint brief.` });
    }
    // Update sample preview if visible
    setSampleAiResult({
      subject: angle.subject || null,
      body: angle.body,
      rationale: `Angle: ${angle.name} · ${angle.rationale}`,
      usedFallback: false,
    });
    setAnglesModalOpen(false);
    showToast(`Applied "${angle.name}" angle to copy.`);
  }

  async function handleTestSampleAi() {
    setTestingSampleAi(true);
    setNotice(null);
    try {
      const res = await testGenerateAiDraftAction({
        campaignId,
        topic: campaignName,
        speakers,
        speakerName,
        brief: savedBrief || brief,
        tone: savedTone || tone,
        msgLength: savedMsgLength || msgLength,
        aiInstructions: savedAiInstructions || aiInstructions,
        channel: activeChannel,
        stepLabel: activeStepLabel,
        stepKey: activeStepKey,
        customSubject: templateSubject,
        customBody: templateBody,
        sampleContact: {
          name: 'Alex Rivera',
          title: 'VP of Engineering',
          account: 'Horizon Labs',
          function: 'Engineering',
          seniority: 'VP',
          score: 92,
        },
        link: currentLink,
      });

      if (res.ok) {
        setSampleAiResult({
          subject: res.subject,
          body: res.body,
          rationale: res.rationale,
          usedFallback: res.usedFallback,
        });
        setNotice({
          tone: 'good',
          text: res.usedFallback
            ? 'Heuristic test draft generated (Claude key not configured or offline).'
            : 'Test draft generated below.',
        });
      } else {
        setNotice({ tone: 'bad', text: res.error || 'Failed to generate test AI draft.' });
      }
    } catch (err) {
      setNotice({ tone: 'bad', text: err instanceof Error ? err.message : 'Error generating test AI draft.' });
    } finally {
      setTestingSampleAi(false);
    }
  }

  async function handleSelectFixedTemplate(tplId: string) {
    if (isSent) return;
    setSelectedTemplateId(tplId);
    setSwitchingTemplate(true);
    try {
      await switchStepToFixedTemplateAction(campaignId, activeStepKey, tplId);
      const chosen = selectableTemplates.find((t) => t.id === tplId);
      if (chosen) {
        setBaseSubjectDraft(chosen.subject || '');
        setBaseBodyDraft(chosen.body);
      }
      setNotice({ tone: 'good', text: `Assigned template "${chosen?.name || tplId}" to this step.` });
      router.refresh();
    } catch (err) {
      setNotice({ tone: 'bad', text: err instanceof Error ? err.message : 'Failed to select template.' });
    } finally {
      setSwitchingTemplate(false);
    }
  }

  const isTemplateMode = currentStepMode === 'template';
  const channelLabel = CHANNEL_LABEL[activeChannel];
  const fieldsChanged = JSON.stringify(activePersonalizationFields) !== JSON.stringify(personalizationFields || DEFAULT_PERSONALIZATION_FIELDS);
  const draftedPct = rows.length > 0 ? Math.round((generatedCount / rows.length) * 100) : 0;
  const chosenTemplate = selectableTemplates.find((t) => t.id === selectedTemplateId) || selectableTemplates[0];
  const templateOptions =
    selectableTemplates.length === 0 ? (
      <option value="">Default campaign template</option>
    ) : (
      selectableTemplates.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name} {t.isDefault ? '(Default)' : ''}
        </option>
      ))
    );

  function openEditContact(r: Row) {
    setFieldEditContact({
      id: r.contactId,
      name: r.name,
      title: r.title,
      seniority: r.seniority,
      function: r.function,
      account: r.account,
      vertical: r.vertical,
      personaNote: r.personaNote,
    });
  }

  // Everything the editor and the live preview need for the selected recipient.
  let view: {
    resolvedSubject: string;
    resolvedBody: string;
    charCount: number;
    wordCount: number;
    readTimeMinutes: number;
    firstName: string;
  } | null = null;
  if (selected) {
    const rawSubject = isTemplateMode ? chosenTemplate?.subject ?? templateSubject ?? '' : selected.message?.subject ?? templateSubject ?? '';
    const rawBody = isTemplateMode ? chosenTemplate?.body ?? templateBody : selected.message?.body ?? templateBody;
    const resolvedSubject =
      activeChannel === 'email' && rawSubject
        ? renderLocalMerge(rawSubject, selected, campaignName, currentLink, campaignDate, speakerName ?? undefined)
        : rawSubject;
    const resolvedBody = renderLocalMerge(rawBody, selected, campaignName, currentLink, campaignDate, speakerName ?? undefined);
    const measured = isTemplateMode ? resolvedBody : selected.message?.body || resolvedBody;
    const words = measured.trim().split(/\s+/).filter(Boolean).length;
    view = {
      resolvedSubject,
      resolvedBody,
      charCount: measured.length,
      wordCount: words,
      readTimeMinutes: Math.max(1, Math.ceil(words / 200)),
      firstName: selected.name.split(' ')[0] || selected.name,
    };
  }

  async function approveScored() {
    setNotice(null);
    try {
      const { approveAboveThresholdAction } = await import('@/lib/actions/scoring');
      const r = await approveAboveThresholdAction(campaignId);
      setNotice({ tone: 'good', text: `Approved ${r.approved} contacts.` });
      router.refresh();
    } catch {
      setNotice({ tone: 'bad', text: 'Failed to approve contacts.' });
    }
  }

  async function applyFieldsToPending() {
    setNotice(null);
    try {
      await saveAiInstructionsAndRegeneratePendingAction(campaignId, {
        personalizationFields: activePersonalizationFields,
        activeStepKey,
      });
      setNotice({ tone: 'good', text: 'Fields updated and pending messages regenerated.' });
      router.refresh();
    } catch (err) {
      setNotice({ tone: 'bad', text: err instanceof Error ? err.message : 'Failed to update fields.' });
    }
  }

  return (
    <div className="lsq-stack lsq-stack--lg">
      <header className="lsq-page-header">
        <div className="lsq-page-header__text">
          <p className="lsq-page-header__eyebrow">Messaging</p>
          <h1 className="lsq-page-header__title">Message Copy</h1>
          <p className="lsq-page-header__sub">Review and edit what each recipient gets, one cadence step at a time.</p>
        </div>
        <div className="lsq-page-header__actions">
          <NavButton href={`/campaigns/${campaignId}/cadence`}>Continue to Cadence</NavButton>
        </div>
      </header>

      {statusNotice}

      {/* Step picker */}
      <section className="lsq-card" aria-label="Cadence steps">
        <div className="lsq-msg-steps">
          <nav className="lsq-tabs" aria-label="Cadence steps">
            {steps.map((s) => {
              const active = s.key === activeStepKey;
              return (
                <button
                  key={s.key}
                  type="button"
                  className="lsq-tab"
                  data-active={active}
                  aria-current={active ? 'step' : undefined}
                  onClick={() => router.push(`/campaigns/${campaignId}/messaging?step=${s.key}`)}
                >
                  {s.isSent && <Icon name="lock" size={14} />}
                  {s.label}
                  {s.isSent ? <Badge color="success" text={`Sent · ${(s.sentCount ?? 0).toLocaleString()}`} /> : <Badge color="blue" text="Pending" />}
                </button>
              );
            })}
          </nav>
        </div>
      </section>

      {isSent && (
        <div className="lsq-banner lsq-banner--neutral" role="status">
          <span className="lsq-banner__icon" aria-hidden="true">
            <Icon name="lock" size={16} />
          </span>
          <div>
            <p className="lsq-banner__title">Read-Only Step</p>
            <p className="lsq-banner__body">
              {sentCount.toLocaleString()} message{sentCount === 1 ? '' : 's'} from this step already sent. Copy cannot be edited or regenerated.
            </p>
          </div>
        </div>
      )}

      {!hasDescription && (
        <div className="lsq-banner lsq-banner--warning">
          <span className="lsq-banner__icon" aria-hidden="true">
            <Icon name="warning" size={16} />
          </span>
          <p className="lsq-banner__body">This campaign has no description. Adding one in webinar setup gives drafts more context than the topic alone.</p>
        </div>
      )}

      {staleLinkCount > 0 && !isSent && (
        <div className="lsq-banner lsq-banner--warning">
          <span className="lsq-banner__icon" aria-hidden="true">
            <Icon name="warning" size={16} />
          </span>
          <div>
            <p className="lsq-banner__title">Registration Link Changed</p>
            <p className="lsq-banner__body">
              {staleLinkCount} message{staleLinkCount === 1 ? ' still points' : 's still point'} at the old link. Current link: <strong>{currentLink}</strong>
            </p>
            <div className="lsq-banner__actions">
              <Button hierarchy="secondary" size="sm" onClick={repairStaleLinks} loading={repairing}>
                {repairing ? 'Updating…' : 'Update Links'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {outdatedDraftsCount > 0 && !isSent && stepMode === 'ai' && (
        <div className="lsq-banner">
          <span className="lsq-banner__icon" aria-hidden="true">
            <Icon name="info" size={16} />
          </span>
          <div>
            <p className="lsq-banner__title">Webinar Details Updated</p>
            <p className="lsq-banner__body">
              {outdatedDraftsCount} draft{outdatedDraftsCount === 1 ? '' : 's'} can be refreshed with the current topic and speaker info. Custom edits are preserved.
            </p>
            <div className="lsq-banner__actions">
              <Button hierarchy="primary" size="sm" icon={<Icon name="refresh" size={14} />} onClick={handleRegenerateOutdated} loading={regeneratingOutdated}>
                {regeneratingOutdated ? 'Refreshing…' : 'Refresh Outdated Drafts'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {notice && (
        <div className={`lsq-banner lsq-banner--${notice.tone === 'good' ? 'success' : 'error'}`} role={notice.tone === 'good' ? 'status' : 'alert'}>
          <span className="lsq-banner__icon" aria-hidden="true">
            <Icon name={notice.tone === 'good' ? 'check-circle' : 'error'} size={16} />
          </span>
          <p className="lsq-banner__body">{notice.text}</p>
        </div>
      )}

      {/* Copy for this step */}
      <section className="lsq-card" aria-labelledby="msg-copy-title">
        <div className="lsq-card__header">
          <div>
            <h2 className="lsq-card__title" id="msg-copy-title">
              Copy for This Step
            </h2>
            <p className="lsq-card__sub">
              {activeStepLabel} · {channelLabel}
            </p>
          </div>
          {isSent && <Badge color="gray" text={isTemplateMode ? 'Fixed Template' : 'AI Personalized'} />}
        </div>
        <div className="lsq-card__body lsq-stack">
          {!isSent && (
            <div className="lsq-msg-mode">
              <div className="lsq-field">
                <span className="lsq-label" id="msg-mode-label">
                  Mode
                </span>
                <div className="lsq-segmented" role="group" aria-labelledby="msg-mode-label">
                  <button type="button" aria-pressed={!isTemplateMode} disabled={switchingTemplate} onClick={() => handleSwitchMode('ai')}>
                    AI Personalized
                  </button>
                  <button type="button" aria-pressed={isTemplateMode} disabled={switchingTemplate} onClick={() => handleSwitchMode('template')}>
                    Fixed Template
                  </button>
                </div>
              </div>
              {isTemplateMode && (
                <div className="lsq-msg-mode__select">
                  <Field label="Template">
                    {(p) => (
                      <select
                        {...p}
                        className="lsq-select"
                        value={selectedTemplateId}
                        onChange={(e) => handleSelectFixedTemplate(e.target.value)}
                        disabled={switchingTemplate || selectableTemplates.length === 0}
                      >
                        {templateOptions}
                      </select>
                    )}
                  </Field>
                </div>
              )}
            </div>
          )}

          {!isSent && (
            <p className="lsq-hint">
              {isTemplateMode
                ? 'Every recipient gets the selected template, with merge fields resolved on send.'
                : 'Each message is rewritten from the approved template for one person, using title, seniority, function, industry and score. The offer and registration link stay as the template has them.'}
            </p>
          )}

          {confirming && !isSent && (
            <div className="lsq-banner lsq-banner--warning" role="alert">
              <div>
                <p className="lsq-banner__body">
                  {audienceTotal} recipients will make about {Math.ceil(audienceTotal / 5)} Claude calls. Continue?
                </p>
                <div className="lsq-banner__actions">
                  <Button hierarchy="secondary" size="sm" onClick={() => setConfirming(false)}>
                    Cancel
                  </Button>
                  <Button hierarchy="primary" size="sm" onClick={() => runGenerate()}>
                    Generate Anyway
                  </Button>
                </div>
              </div>
            </div>
          )}

          <div className="lsq-msg-actions">
            {!isSent && !isTemplateMode && (
              <>
                <Button
                  hierarchy="primary"
                  icon={<Icon name="sparkle" size={16} />}
                  onClick={onGenerateClick}
                  loading={generating}
                  disabled={rows.length === 0}
                >
                  {generating ? 'Writing…' : generatedCount > 0 ? `Regenerate All (${audienceTotal})` : `Generate Drafts (${audienceTotal})`}
                </Button>
                {unreviewed > 0 && (
                  <Button hierarchy="secondary" icon={<Icon name="check" size={16} />} onClick={reviewAll}>
                    Mark {unreviewed} Reviewed
                  </Button>
                )}
              </>
            )}
            {!isSent && (
              <>
                <Button hierarchy="secondary-color" icon={<Icon name="sparkle" size={16} />} onClick={() => setAnglesModalOpen(true)}>
                  Explore Angles
                </Button>
                <Button hierarchy="secondary" icon={<Icon name="settings" size={16} />} onClick={() => setPromptOpen(true)}>
                  Instructions and Settings
                </Button>
              </>
            )}
            <Button hierarchy="secondary" icon={<Icon name="send" size={16} />} onClick={() => setTestModalOpen(true)}>
              Send Test
            </Button>
            <Button hierarchy="tertiary" icon={<Icon name="eye" size={16} />} onClick={() => setShowTemplate((v) => !v)}>
              {showTemplate ? 'Hide Base Template' : 'View Base Template'}
            </Button>
          </div>

          {showTemplate && (
            <div className="lsq-stack lsq-stack--sm">
              <hr className="lsq-divider" />
              <div className="lsq-cluster lsq-cluster--between">
                <h3 className="lsq-msg-section-title">
                  Base Template · {activeStepLabel} ({channelLabel})
                </h3>
                {!isSent && (
                  <Button hierarchy="secondary" size="sm" icon={<Icon name="edit" size={14} />} onClick={() => setEditingBaseTemplate((e) => !e)}>
                    {editingBaseTemplate ? 'Cancel Editing' : 'Edit Base Template'}
                  </Button>
                )}
              </div>

              {editingBaseTemplate ? (
                <div className="lsq-stack">
                  {activeChannel === 'email' && (
                    <Field label="Subject">
                      {(p) => <input {...p} className="lsq-input" value={baseSubjectDraft} onChange={(e) => setBaseSubjectDraft(e.target.value)} />}
                    </Field>
                  )}
                  <Field label="Message body">
                    {(p) => <textarea {...p} className="lsq-input" rows={6} value={baseBodyDraft} onChange={(e) => setBaseBodyDraft(e.target.value)} />}
                  </Field>
                  <div className="lsq-cluster">
                    <Button hierarchy="primary" size="sm" loading={savingBase} onClick={saveBaseTemplate}>
                      {savingBase ? 'Saving…' : 'Save Template Changes'}
                    </Button>
                    <Button
                      hierarchy="tertiary"
                      size="sm"
                      onClick={() => {
                        setBaseSubjectDraft(templateSubject ?? '');
                        setBaseBodyDraft(templateBody);
                        setEditingBaseTemplate(false);
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="lsq-msgbox">
                  {templateSubject && <p className="lsq-msg-section-title">{templateSubject}</p>}
                  {templateBody}
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Personalization settings */}
      {rows.length > 0 && (
        <section className="lsq-card" aria-labelledby="msg-settings-title">
          <div className="lsq-card__header">
            <div>
              <h2 className="lsq-card__title" id="msg-settings-title">
                Personalization Settings
              </h2>
              <p className="lsq-card__sub">
                {msgMode === 'ai'
                  ? 'Each contact gets a unique message built from the campaign brief and enriched fields.'
                  : 'One template per step is merged for every contact. Only merge fields change per recipient.'}
              </p>
            </div>
            <Badge color={msgMode === 'ai' ? 'blue' : 'gray'} text={msgMode === 'ai' ? 'AI Personalized' : 'Templatized'} />
          </div>
          <div className="lsq-card__body lsq-stack">
            <div className="lsq-msg-meter">
              <div className="lsq-msg-meter__row">
                <span>
                  {msgMode === 'ai' ? 'Drafted' : 'Merged'} {generatedCount.toLocaleString()} of {rows.length.toLocaleString()} {msgMode === 'ai' ? 'messages' : 'recipients'} on this page
                </span>
                <strong>{draftedPct}%</strong>
              </div>
              <div className="lsq-progress" role="progressbar" aria-label="Drafting progress" aria-valuenow={draftedPct} aria-valuemin={0} aria-valuemax={100}>
                <div className="lsq-progress__bar" style={{ width: `${draftedPct}%` }} />
              </div>
            </div>

            {!isTemplateMode && (
              <>
                <div className="lsq-chips">
                  <span className="lsq-tag">Tone: {savedTone || 'Default'}</span>
                  <span className="lsq-tag">Length: {savedMsgLength || 'Default'}</span>
                </div>

                <div className="lsq-stack lsq-stack--sm" role="group" aria-labelledby="msg-fields-label">
                  <div className="lsq-cluster lsq-cluster--between">
                    <span className="lsq-label" id="msg-fields-label">
                      Fields used per contact ({activePersonalizationFields.length} active)
                    </span>
                    {!isSent && fieldsChanged && (
                      <Button hierarchy="primary" size="sm" onClick={applyFieldsToPending}>
                        Apply to Pending and Regenerate
                      </Button>
                    )}
                  </div>
                  <div className="lsq-chips">
                    {PERSONALIZATION_FIELD_OPTIONS.map((f) => {
                      const isChecked = activePersonalizationFields.includes(f.id);
                      return (
                        <button
                          key={f.id}
                          type="button"
                          className="lsq-msg-chip"
                          aria-pressed={isChecked}
                          disabled={isSent}
                          title={f.blurb}
                          onClick={() => setActivePersonalizationFields((prev) => (isChecked ? prev.filter((id) => id !== f.id) : [...prev, f.id]))}
                        >
                          <Icon name={isChecked ? 'check' : 'plus'} size={12} />
                          {f.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
        </section>
      )}

      {rows.length === 0 ? (
        <section className="lsq-card" aria-labelledby="msg-empty-title">
          <div className="lsq-empty">
            <h2 className="lsq-empty__title" id="msg-empty-title">
              No Matching Contacts Yet
            </h2>
            <p className="lsq-empty__body">{audienceTotal > 0 ? 'No approved contacts match this search. Clear the search to view all message recipients.' : `Approve scored contacts on the Audience tab (threshold: ${confirmThreshold}) before drafts can be generated.`}</p>
            <div className="lsq-cluster">
              {audienceTotal === 0 && <Button hierarchy="primary" onClick={approveScored}>
                Approve Scored Contacts
              </Button>}
              <Button hierarchy="secondary" onClick={() => router.push(`/campaigns/${campaignId}/audience`)}>
                Go to Audience
              </Button>
              <Button hierarchy="secondary-color" icon={<Icon name="sparkle" size={16} />} loading={testingSampleAi} onClick={handleTestSampleAi}>
                {testingSampleAi ? 'Testing…' : 'Test With Sample Contact'}
              </Button>
              <Button hierarchy="secondary" icon={<Icon name="sparkle" size={16} />} onClick={() => setAnglesModalOpen(true)}>
                Explore Angles
              </Button>
            </div>
          </div>

          {sampleAiResult && (
            <div className="lsq-card__body lsq-stack lsq-msg-sample">
              <div className="lsq-cluster lsq-cluster--between">
                <h3 className="lsq-msg-section-title">Sample Draft · {channelLabel}</h3>
                <Badge color={sampleAiResult.usedFallback ? 'warning' : 'success'} text={sampleAiResult.usedFallback ? 'Fallback Draft' : 'Claude'} dot />
              </div>
              <p className="lsq-hint">Recipient: Alex Rivera, VP of Engineering at Horizon Labs</p>
              {sampleAiResult.rationale && (
                <div className="lsq-banner">
                  <div>
                    <p className="lsq-banner__title">Angle</p>
                    <p className="lsq-banner__body">{sampleAiResult.rationale}</p>
                  </div>
                </div>
              )}
              <div className="lsq-msgbox">
                {sampleAiResult.subject && activeChannel === 'email' && <p className="lsq-msg-section-title">Subject: {sampleAiResult.subject}</p>}
                {sampleAiResult.body}
              </div>
            </div>
          )}
        </section>
      ) : (
        <div className="lsq-msg-workspace">
          {/* Recipient list */}
          <section className="lsq-card" aria-labelledby="msg-recipients-title">
            <div className="lsq-card__header">
              <div>
                <h2 className="lsq-card__title" id="msg-recipients-title">
                  Recipients
                </h2>
                <p className="lsq-card__sub">
                  {generatedCount.toLocaleString()} of {rows.length.toLocaleString()} written on this page
                </p>
              </div>
              {invalidCount > 0 && <Badge color="error" text={`${invalidCount.toLocaleString()} invalid`} />}
            </div>
            <ul className="lsq-msg-list">
              {rows.map((r) => {
                const active = r.contactId === selectedId;
                const meta = r.message ? statusMeta[r.message.status] ?? statusMeta.draft : null;
                const rowValidation = r.message ? validationByContact.get(r.contactId) : null;
                return (
                  <li key={r.contactId}>
                    <button type="button" className="lsq-msg-recipient" aria-current={active ? 'true' : undefined} onClick={() => setSelectedId(r.contactId)}>
                      <Avatar name={r.name} size={32} />
                      <span className="lsq-msg-recipient__main">
                        <span className="lsq-msg-recipient__name">{r.name}</span>
                        <span className="lsq-msg-recipient__meta">
                          {r.seniority} · {r.account}
                        </span>
                      </span>
                      {rowValidation && !rowValidation.valid ? (
                        <Badge color="error" text="Invalid" />
                      ) : r.message?.linkStale ? (
                        <Badge color="warning" text="Old Link" />
                      ) : meta ? (
                        <Badge color={meta.color} text={meta.label} />
                      ) : msgMode === 'templatized' ? (
                        <Badge color="gray" text="Auto-Merged" />
                      ) : (
                        <Badge color="gray" text="No Draft" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          {/* Editor, live preview and contact signals */}
          <div className="lsq-stack lsq-stack--lg">
            {!selected || !view ? (
              <section className="lsq-card">
                <div className="lsq-empty">
                  <p className="lsq-empty__body">Select a recipient to edit or preview the message.</p>
                </div>
              </section>
            ) : (
              <>
                <section className="lsq-card" aria-labelledby="msg-editor-title">
                  <div className="lsq-card__header">
                    <div>
                      <h2 className="lsq-card__title" id="msg-editor-title">
                        {selected.name}
                      </h2>
                      <p className="lsq-card__sub">
                        {selected.title || 'No title'} · {selected.account} · {selected.vertical}
                        {selected.score !== null ? ` · Score ${selected.score}` : ''}
                      </p>
                    </div>
                    {isSent ? (
                      <Badge color="gray" text="Read Only" />
                    ) : isTemplateMode ? (
                      <Badge color="success" text="Fixed Template" dot />
                    ) : selectedValidation ? (
                      <Badge color={selectedValidation.valid ? 'success' : 'error'} text={selectedValidation.valid ? 'Valid' : 'Invalid'} dot />
                    ) : selected.message ? (
                      <Badge color="blue" text="AI Personalized" dot />
                    ) : (
                      <Badge color="gray" text="No Draft" dot />
                    )}
                  </div>

                  <div className="lsq-card__body lsq-stack">
                    {!isSent && !isTemplateMode && selectedValidation && !selectedValidation.valid && (
                      <div className="lsq-banner lsq-banner--error" role="alert">
                        <span className="lsq-banner__icon" aria-hidden="true">
                          <Icon name="error" size={16} />
                        </span>
                        <div>
                          <p className="lsq-banner__title">Fix Before Sending</p>
                          <p className="lsq-banner__body">{view.firstName}&apos;s message has unresolved issues.</p>
                          <ul className="lsq-msg-issues">
                            {selectedValidation.issues
                              .filter((i) => i.severity === 'error')
                              .map((issue, i) => (
                                <li key={i}>{issue.message}</li>
                              ))}
                          </ul>
                        </div>
                      </div>
                    )}

                    {!isTemplateMode && selected.message?.rationale && (
                      <div className="lsq-banner">
                        <div>
                          <p className="lsq-banner__title">Angle</p>
                          <p className="lsq-banner__body">{selected.message.rationale}</p>
                        </div>
                      </div>
                    )}

                    {isTemplateMode ? (
                      <div className="lsq-stack lsq-stack--sm">
                        <p className="lsq-hint">
                          Sends {chosenTemplate?.name || 'the default template'}. Merge fields such as <code>{'{{firstName}}'}</code> and <code>{'{{company}}'}</code> resolve per recipient.
                        </p>
                        {templateSubject && (
                          <div className="lsq-field">
                            <span className="lsq-label">Subject template</span>
                            <div className="lsq-msgbox">{chosenTemplate?.subject ?? templateSubject}</div>
                          </div>
                        )}
                        <div className="lsq-field">
                          <span className="lsq-label">Body template</span>
                          <div className="lsq-msgbox">{chosenTemplate?.body ?? templateBody}</div>
                        </div>
                      </div>
                    ) : !selected.message ? (
                      <div className="lsq-stack lsq-stack--sm">
                        <p className="lsq-hint">No draft yet. The preview below shows the shared template for this recipient.</p>
                        <div className="lsq-msgbox">
                          {activeChannel === 'email' && view.resolvedSubject && <p className="lsq-msg-section-title">Subject: {view.resolvedSubject}</p>}
                          {view.resolvedBody}
                        </div>
                      </div>
                    ) : (
                      <>
                        {activeChannel === 'email' && (
                          <Field label="Subject">
                            {(p) => (
                              <input
                                {...p}
                                className="lsq-input"
                                type="text"
                                disabled={isSent}
                                value={selected.message?.subject ?? ''}
                                onChange={(e) => patchSelected({ subject: e.target.value })}
                              />
                            )}
                          </Field>
                        )}
                        <Field label={BODY_LABEL[activeChannel]} hint={`${view.charCount.toLocaleString()} chars · ${view.wordCount.toLocaleString()} words`}>
                          {(p) => (
                            <textarea
                              {...p}
                              className="lsq-input"
                              disabled={isSent}
                              rows={activeChannel === 'linkedin' ? 5 : activeChannel === 'sms' ? 3 : activeChannel === 'whatsapp' ? 6 : 9}
                              value={selected.message?.body ?? ''}
                              onChange={(e) => patchSelected({ body: e.target.value })}
                            />
                          )}
                        </Field>
                      </>
                    )}
                  </div>

                  {!isSent && !isTemplateMode && (
                    <div className="lsq-card__footer">
                      <Button
                        hierarchy={selected.message ? 'secondary' : 'primary'}
                        icon={<Icon name="refresh" size={16} />}
                        onClick={() => regenerate(selected.contactId)}
                        loading={busyRow === selected.contactId}
                      >
                        {busyRow === selected.contactId ? 'Writing…' : selected.message ? 'Regenerate' : 'Generate Draft'}
                      </Button>
                      {selected.message && (
                        <>
                          <Button hierarchy={dirty ? 'primary' : 'secondary'} onClick={save} loading={saving} disabled={!dirty}>
                            {saving ? 'Saving…' : dirty ? 'Save Edit' : 'Saved'}
                          </Button>
                          {selected.message.status !== 'reviewed' && (
                            <Button
                              hierarchy={dirty ? 'secondary' : 'primary'}
                              icon={<Icon name="check" size={16} />}
                              onClick={review}
                              disabled={!!selectedValidation && !selectedValidation.valid}
                            >
                              Mark Reviewed
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </section>

                <section className="lsq-card" aria-labelledby="msg-preview-title">
                  <div className="lsq-card__header">
                    <div>
                      <h2 className="lsq-card__title" id="msg-preview-title">
                        Live Preview
                      </h2>
                      <p className="lsq-card__sub">As {view.firstName} receives it on {channelLabel}.</p>
                    </div>
                  </div>
                  <div className="lsq-card__body lsq-stack">
                    <div className="lsq-msg-preview" data-channel={activeChannel}>
                      {activeChannel === 'email' ? (
                        <>
                          <div className="lsq-msg-preview__head">
                            <span>
                              <strong>To:</strong> {selected.name}
                              {selected.account ? `, ${selected.account}` : ''}
                            </span>
                            {view.resolvedSubject && <span className="lsq-msg-preview__subject">{view.resolvedSubject}</span>}
                          </div>
                          <div className="lsq-msg-preview__body">{view.resolvedBody}</div>
                        </>
                      ) : (
                        <div className="lsq-msg-bubble">{view.resolvedBody}</div>
                      )}
                    </div>
                    <div className="lsq-msg-preview__foot">
                      <div className="lsq-chips">
                        <span className="lsq-chip">
                          <strong>{view.charCount.toLocaleString()}</strong> chars
                        </span>
                        <span className="lsq-chip">
                          <strong>{view.wordCount.toLocaleString()}</strong> words
                        </span>
                        <span className="lsq-chip">
                          About <strong>{view.readTimeMinutes}</strong> min read
                        </span>
                      </div>
                      <span className="lsq-msg-ok">
                        <Icon name="check-circle" size={14} />
                        Tokens resolved for {view.firstName}
                      </span>
                    </div>
                  </div>
                </section>

                <section className="lsq-card" aria-labelledby="msg-signals-title">
                  <div className="lsq-card__header">
                    <div>
                      <h2 className="lsq-card__title" id="msg-signals-title">
                        Contact Signals
                      </h2>
                      <p className="lsq-card__sub">Fields the draft for {view.firstName} is grounded in.</p>
                    </div>
                    <Button hierarchy="secondary" size="sm" icon={<Icon name="edit" size={14} />} disabled={isSent} onClick={() => openEditContact(selected)}>
                      Edit Contact Fields
                    </Button>
                  </div>
                  <div className="lsq-card__body">
                    <dl className="lsq-kv">
                      <dt>Seniority</dt>
                      <dd>{selected.seniority || 'N/A'}</dd>
                      <dt>Function</dt>
                      <dd>{selected.function || 'N/A'}</dd>
                      <dt>Industry</dt>
                      <dd>{selected.vertical || 'N/A'}</dd>
                      <dt>Company</dt>
                      <dd>{selected.account || 'N/A'}</dd>
                      <dt>Channel</dt>
                      <dd>{channelLabel}</dd>
                      {selected.personaNote && (
                        <>
                          <dt>Persona note</dt>
                          <dd>{selected.personaNote}</dd>
                        </>
                      )}
                    </dl>
                  </div>
                </section>
              </>
            )}
          </div>
        </div>
      )}

      {fieldEditContact && (
        <EditContactModal
          isOpen={true}
          campaignId={campaignId}
          activeStepKey={activeStepKey}
          contact={fieldEditContact}
          onClose={() => setFieldEditContact(null)}
          onSavedAndRegenerated={(updated, newDraft) => {
            setRows((rs) =>
              rs.map((r) =>
                r.contactId === updated.id
                  ? {
                      ...r,
                      name: updated.name,
                      title: updated.title || '',
                      seniority: updated.seniority || '',
                      function: updated.function || '',
                      account: updated.account || '',
                      vertical: updated.vertical || '',
                      personaNote: updated.personaNote || null,
                      message: newDraft
                        ? {
                            id: newDraft.id,
                            subject: newDraft.subject,
                            body: newDraft.body,
                            rationale: newDraft.rationale,
                            status: newDraft.status,
                            linkStale: newDraft.linkStale,
                          }
                        : r.message,
                    }
                  : r
              )
            );
            if (newDraft) {
              setBaseline((bl) => ({ ...bl, [newDraft.id]: { subject: newDraft.subject, body: newDraft.body } }));
            }
            setFieldEditContact(null);
            setNotice({ tone: 'good', text: `Updated contact fields and regenerated message for ${updated.name}.` });
            router.refresh();
          }}
        />
      )}

      {promptOpen && (
        <PromptModal
          campaignId={campaignId}
          campaignName={campaignName}
          prompt={savedPrompt}
          brief={savedBrief}
          aiInstructions={savedAiInstructions}
          tone={savedTone}
          msgLength={savedMsgLength}
          personalizationFields={activePersonalizationFields}
          activeStepKey={activeStepKey}
          onClose={() => setPromptOpen(false)}
          onSaved={(nextPrompt, nextBrief, nextAi, nextTone, nextLen, nextFields) => {
            setSavedPrompt(nextPrompt);
            if (nextBrief !== undefined) setSavedBrief(nextBrief);
            if (nextAi !== undefined) setSavedAiInstructions(nextAi);
            if (nextTone !== undefined) setSavedTone(nextTone);
            if (nextLen !== undefined) setSavedMsgLength(nextLen);
            if (nextFields !== undefined) setActivePersonalizationFields(nextFields);
            setPromptOpen(false);
            setNotice({ tone: 'good', text: 'AI settings saved.' });
          }}
          onRegeneratedPending={(result) => {
            setPromptOpen(false);
            setNotice({
              tone: 'good',
              text: `Applied new AI instructions and regenerated ${result.totalRegenerated} message(s) across pending steps.`,
            });
            router.refresh();
          }}
        />
      )}

      {testModalOpen && (
        <SendTestModal
          campaignId={campaignId}
          channel={activeChannel}
          stepLabel={activeStepLabel}
          subject={
            selected?.message
              ? selected.message.subject
              : templateSubject && selected
                ? renderLocalMerge(templateSubject, selected, campaignName, currentLink, campaignDate, speakerName ?? undefined)
                : templateSubject
          }
          body={
            selected?.message
              ? selected.message.body
              : selected
                ? renderLocalMerge(templateBody, selected, campaignName, currentLink, campaignDate, speakerName ?? undefined)
                : templateBody
          }
          onClose={() => setTestModalOpen(false)}
        />
      )}

      <GenerateConfigModal
        isOpen={generateConfigOpen}
        onClose={() => setGenerateConfigOpen(false)}
        campaignId={campaignId}
        campaignName={campaignName}
        activeStepKey={activeStepKey}
        activeStepLabel={activeStepLabel}
        activeChannel={activeChannel}
        totalApproved={audienceTotal}
        missingCount={Math.max(0, audienceTotal - (totalDrafted ?? generatedCount))}
        initialTone={savedTone}
        initialLength={savedMsgLength}
        initialBrief={savedBrief}
        initialAiInstructions={savedAiInstructions}
        onConfirm={async (config) => {
          setSavedBrief(config.brief);
          setSavedAiInstructions(config.aiInstructions);
          setSavedTone(config.tone);
          setSavedMsgLength(config.msgLength);
          await runGenerate(config);
        }}
      />

      <ExploreAnglesModal
        open={anglesModalOpen}
        onClose={() => setAnglesModalOpen(false)}
        campaignId={campaignId}
        topic={campaignName}
        speakers={speakers}
        speakerName={speakerName}
        brief={savedBrief || brief}
        stepKey={activeStepKey}
        stepLabel={activeStepLabel}
        channel={activeChannel}
        baseBody={templateBody}
        onApplyAngle={handleApplyAngle}
      />
    </div>
  );
}
