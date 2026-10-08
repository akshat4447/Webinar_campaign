'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import { checkSmsBody } from '@/lib/channels';
import { formatLsqDate } from '@/lib/dateFormat';
import { CopyTemplateModal } from './CopyTemplateModal';
import { Icon } from '@/components/ui/Icon';
import {
  copyIntoCampaignAction,
  createMessageTemplateAction,
  deleteMessageTemplateAction,
  duplicateMessageTemplateAction,
  revertMessageTemplateAction,
  rewriteMessageTemplateAction,
  saveMessageTemplateAction,
  submitForApprovalAction,
  toggleMessageTemplateHiddenAction,
} from '@/lib/actions/messageTemplates';

export interface LibraryTemplate {
  id: string;
  campaignId: string | null;
  campaignName: string | null;
  channel: string;
  key: string | null;
  name: string;
  hasSubject: boolean;
  subject: string | null;
  body: string;
  category: string | null;
  language: string | null;
  footer: string | null;
  buttons: string | null;
  dltTemplateId: string | null;
  senderId: string | null;
  status: string;
  hidden: boolean;
  hasSaved: boolean;
  usedBySteps: number;
  /** ISO timestamp of the last edit; shown as "Updated …" in the list. */
  updatedAt?: string;
}

const CHANNELS: { id: string; label: string; icon: string }[] = [
  { id: 'email', label: 'Email', icon: 'mail' },
  { id: 'whatsapp', label: 'WhatsApp', icon: 'whatsapp' },
  { id: 'sms', label: 'SMS', icon: 'sms' },
  { id: 'linkedin', label: 'LinkedIn', icon: 'linkedin' },
];

/** What a draft status means per channel, so a new template never looks finished when it is not. */
const DRAFT_NOTE: Record<string, string> = {
  email: 'New templates start as drafts. This one becomes Ready the first time it is saved with a subject and a message.',
  whatsapp: 'New templates start as drafts. Complete the fields, then submit to Meta. It can be used in a cadence once approved.',
  sms: 'New templates start as drafts. Add the DLT content-template ID and sender ID before a cadence can send it.',
};

const WHATSAPP_BODY_LIMIT = 1024;
const LINKEDIN_NOTE_LIMIT = 300;
const KNOWN_TOKENS = ['firstName', 'company', 'topic', 'date', 'speaker', 'link'];

function unknownTokens(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/\{\{\s*([^{}\s]+)\s*\}\}/g)) {
    if (!KNOWN_TOKENS.includes(m[1])) found.add(`{{${m[1]}}}`);
  }
  return [...found];
}

// Each channel has real, externally-imposed rules. Stating them here is the
// difference between an operator drafting something usable and drafting
// something Meta or the DLT registry will reject days later.
const CHANNEL_RULES: Record<string, string> = {
  email:
    'Free-form subject and body. Personalize with {{variables}}, or let a campaign in AI mode rewrite this per recipient. Sends from your verified LeadSquared sending domain.',
  whatsapp:
    'WhatsApp Business only sends pre-approved templates for marketing and utility messages. Draft here, submit to Meta, and use it once approved — the recipient must also have opted in. Uses the same {{merge}} tokens as every other channel; free text is allowed solely inside the 24-hour service window.',
  sms:
    'Every SMS template needs a DLT content-template ID and a registered sender ID before it can send. Promotional messages must carry an opt-out and respect DND windows.',
  linkedin:
    'LinkedIn has no send API, so these are assisted drafts: they are queued against the audience and you send each in one click from your own account. Automating them would breach LinkedIn’s terms.',
};

const STATUS_COLOR: Record<string, string> = {
  ready: 'success',
  approved: 'success',
  pending: 'warning',
  draft: 'gray',
  assisted: 'blue light',
};

const STATUS_LABEL: Record<string, string> = {
  ready: 'Ready',
  approved: 'Approved',
  pending: 'Pending review',
  draft: 'Draft',
  assisted: 'Assisted',
};

/** Variables every channel understands — the same {{merge}} tokens the send
 *  pipeline (lib/cadence.ts renderMergeFields) actually resolves. WhatsApp
 *  used to advertise Meta's numbered {{1}}..{{4}} scheme here, but nothing
 *  in this app ever resolved those: a template written that way failed
 *  validation, and would have gone out to a real recipient with the literal
 *  "{{1}}" text still in it. */
const TEMPLATE_VARIABLES = ['{{firstName}}', '{{company}}', '{{topic}}', '{{date}}', '{{speaker}}', '{{link}}'];

function renderPreview(text: string, sample: { name: string; account: string }): string {
  return text
    .replace(/\{\{\s*firstName\s*\}\}/g, sample.name.split(' ')[0] || sample.name)
    .replace(/\{\{\s*company\s*\}\}/g, sample.account)
    .replace(/\{\{\s*topic\s*\}\}/g, 'Patient Journeys at Scale')
    .replace(/\{\{\s*speaker\s*\}\}/g, 'Dr. Sarah Chen')
    .replace(/\{\{\s*link\s*\}\}/g, 'lsq.co/w/example')
    .replace(/\{\{\s*date\s*\}\}/g, 'Oct 15, 2026');
}

export function TemplatesLibrary({
  channel,
  counts,
  templates,
  selectedId,
  campaignId,
  campaigns,
  sampleContact,
}: {
  channel: string;
  counts: Record<string, number>;
  templates: LibraryTemplate[];
  selectedId?: string;
  campaignId?: string;
  campaigns: { id: string; name: string }[];
  sampleContact: { name: string; account: string };
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();

  const selected = templates.find((t) => t.id === selectedId) ?? templates[0] ?? null;
  const activeCampaign = campaignId ? campaigns.find((c) => c.id === campaignId) : null;

  // Draft state is keyed by template id so switching selection cannot carry
  // one template's unsaved edits onto another.
  const [draftId, setDraftId] = useState<string | null>(selected?.id ?? null);
  const [draft, setDraft] = useState<Partial<LibraryTemplate>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pendingNav, setPendingNav] = useState<Record<string, string | undefined> | null>(null);
  const [copyModalOpen, setCopyModalOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [search, setSearch] = useState('');

  // Client-side filter over the already-loaded per-channel list — same
  // pattern as WebinarViewControls' and AudienceControls' search boxes, no
  // server round-trip needed.
  const filteredTemplates = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter(
      (t) => t.name.toLowerCase().includes(q) || (t.key ?? '').toLowerCase().includes(q) || t.channel.toLowerCase().includes(q)
    );
  }, [templates, search]);

  if (selected && draftId !== selected.id) {
    setDraftId(selected.id);
    setDraft({});
    setShowPreview(false);
  }

  const value = <K extends keyof LibraryTemplate>(field: K): LibraryTemplate[K] | undefined =>
    (draft[field] !== undefined ? draft[field] : selected?.[field]) as LibraryTemplate[K] | undefined;

  const set = (field: keyof LibraryTemplate, v: unknown) => setDraft((d) => ({ ...d, [field]: v }));
  const dirty = Object.keys(draft).length > 0;

  const navigate = (params: Record<string, string | undefined>) => {
    const nextChannel = params.channel ?? channel;
    const nextId = 'id' in params ? params.id : selected?.id;
    const nextCampaign = 'campaignId' in params ? params.campaignId : campaignId;
    const qs = new URLSearchParams();
    if (nextChannel) qs.set('channel', nextChannel);
    if (nextId) qs.set('id', nextId);
    if (nextCampaign) qs.set('campaignId', nextCampaign);
    router.push(`/templates?${qs.toString()}`);
  };

  // Selecting another template resets `draft`, which silently threw away
  // unsaved body/subject edits. `dirty` was already tracked (it gates
  // Duplicate/Copy) — it just wasn't consulted before navigating away.
  const go = (params: Record<string, string | undefined>) => {
    const leavingThisTemplate = 'id' in params && params.id !== selected?.id;
    if (dirty && leavingThisTemplate) {
      setPendingNav(params);
      return;
    }
    navigate(params);
  };

  async function run<T>(fn: () => Promise<T>, after?: (r: T) => void) {
    setBusy(true);
    try {
      const r = await fn();
      after?.(r);
      startTransition(() => router.refresh());
    } catch (err) {
      // try/finally with no catch meant any server action that threw (delete,
      // duplicate, hide, submit-to-Meta) just un-stuck the spinner and left the
      // operator staring at an unchanged screen with no idea it had failed.
      showToast(err instanceof Error ? err.message : 'That action failed — nothing was changed.');
    } finally {
      setBusy(false);
    }
  }

  const body = (value('body') as string) ?? '';
  const smsCheck = channel === 'sms' ? checkSmsBody(body) : null;

  // Validation is guidance only (nothing here blocks Save, exactly as before). A brand-new draft that nobody has
  // touched yet shows the draft note instead of a wall of red.
  const nameVal = (value('name') as string) ?? '';
  const subjectVal = (value('subject') as string) ?? '';
  const dltVal = (value('dltTemplateId') as string) ?? '';
  const senderVal = (value('senderId') as string) ?? '';
  const showValidation = !!selected && (dirty || selected.status !== 'draft');
  const unknown = unknownTokens(`${subjectVal}\n${body}`);
  const nameError = !showValidation
    ? null
    : !nameVal.trim()
      ? 'Name the template.'
      : channel === 'whatsapp' && !/^[a-z0-9_]+$/.test(nameVal)
        ? 'Use lowercase letters, digits and underscores only. Meta rejects other names.'
        : null;
  const subjectError = showValidation && selected?.hasSubject && !subjectVal.trim() ? 'Add a subject line.' : null;
  const smsIssue = smsCheck?.issues.find((i) => i.severity === 'error')?.message ?? null;
  const bodyError = !showValidation
    ? null
    : channel === 'sms'
      ? smsIssue
      : !body.trim()
        ? 'Write the message.'
        : channel === 'whatsapp' && body.length > WHATSAPP_BODY_LIMIT
          ? `Meta allows up to ${WHATSAPP_BODY_LIMIT.toLocaleString()} characters in the body.`
          : unknown.length > 0
            ? `Unknown merge field ${unknown.join(', ')}. It would be sent as written. Use the fields listed under Merge Fields.`
            : null;
  const dltError = showValidation && channel === 'sms' && !dltVal.trim() ? 'Required before this template can send.' : null;
  const senderError = showValidation && channel === 'sms' && !senderVal.trim() ? 'Required before this template can send.' : null;
  const activeChannel = CHANNELS.find((c) => c.id === channel);
  const isDraft = selected?.status === 'draft';

  return (
    <>
      {activeCampaign && (
        <div className="lsq-banner" role="status">
          <span className="lsq-banner__icon" aria-hidden="true">
            <Icon name="info" size={16} />
          </span>
          <div className="lsq-grow">
            <p className="lsq-banner__title">Editing Template For {activeCampaign.name}</p>
            <p className="lsq-banner__body">
              {selected?.campaignId === activeCampaign.id
                ? 'Campaign-specific copy.'
                : 'Library default. Saving will create a campaign copy.'}
            </p>
          </div>
          <Link href={`/campaigns/${activeCampaign.id}/cadence`} className="lsq-btn lsq-btn--secondary lsq-btn--sm lsq-int-link">
            <Icon name="arrow-left" size={16} />
            Return to Cadence Planner
          </Link>
        </div>
      )}

      <div className="lsq-tabs" role="tablist" aria-label="Template channel">
        {CHANNELS.map((c) => {
          const active = c.id === channel;
          return (
            <button
              key={c.id}
              type="button"
              role="tab"
              id={`tpl-tab-${c.id}`}
              aria-selected={active}
              aria-controls="tpl-panel"
              className="lsq-tab"
              onClick={() => go({ channel: c.id, id: undefined })}
            >
              <Icon name={c.icon} size={16} />
              {c.label}
              <span className="lsq-hint">{(counts[c.id] ?? 0).toLocaleString()}</span>
            </button>
          );
        })}
      </div>

      <div id="tpl-panel" role="tabpanel" aria-labelledby={`tpl-tab-${channel}`} className="lsq-stack lsq-stack--lg">
        <div className="lsq-banner" role="note">
          <span className="lsq-banner__icon" aria-hidden="true">
            <Icon name="info" size={16} />
          </span>
          <div>
            <p className="lsq-banner__title">{activeChannel?.label} Rules</p>
            <p className="lsq-banner__body">{CHANNEL_RULES[channel]}</p>
          </div>
        </div>

        <div className="lsq-tpl-layout">
          <div className="lsq-tpl-list">
            <Button
              fullWidth
              icon={<Icon name="plus" size={16} />}
              disabled={busy || pending}
              onClick={() =>
                run(
                  () => createMessageTemplateAction(channel),
                  (id) => {
                    showToast('Template created.');
                    go({ id: id as string });
                  }
                )
              }
            >
              New Template
            </Button>

            {templates.length > 0 && (
              <div className="lsq-search lsq-int-search">
                <Icon name="search" size={16} />
                <input
                  type="search"
                  className="lsq-input"
                  aria-label="Search templates"
                  placeholder="Search templates"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            )}

            {templates.length === 0 && (
              <div className="lsq-card lsq-empty">
                <p className="lsq-empty__title">No {activeChannel?.label} Templates Yet</p>
                <p className="lsq-empty__body">Create one to reuse across campaigns.</p>
              </div>
            )}

            {templates.length > 0 && filteredTemplates.length === 0 && (
              <div className="lsq-card lsq-empty">
                <p className="lsq-empty__title">No Matches</p>
                <p className="lsq-empty__body">No templates match “{search}”.</p>
              </div>
            )}

            {filteredTemplates.length > 0 && (
              <ul className="lsq-tpl-list__items" aria-label={`${activeChannel?.label} templates`}>
                {filteredTemplates.map((t) => {
                  const active = t.id === selected?.id;
                  return (
                    <li key={t.id}>
                      <button
                        type="button"
                        className="lsq-tpl-item"
                        aria-current={active ? 'true' : undefined}
                        data-hidden={t.hidden ? 'true' : undefined}
                        onClick={() => go({ id: t.id })}
                      >
                        <span className="lsq-tpl-item__row">
                          <span className="lsq-tpl-item__name">{t.name}</span>
                          <Badge color={STATUS_COLOR[t.status] ?? 'gray'} text={STATUS_LABEL[t.status] ?? t.status} />
                        </span>
                        <span className="lsq-tpl-item__meta">
                          {t.campaignName ? `${t.campaignName} only` : 'Shared library'}
                          {t.hidden ? ' · hidden' : ''}
                          {t.usedBySteps > 0 ? ` · ${t.usedBySteps.toLocaleString()} step${t.usedBySteps === 1 ? '' : 's'}` : ''}
                        </span>
                        {t.updatedAt && <span className="lsq-tpl-item__meta">Updated {formatLsqDate(new Date(t.updatedAt))}</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {selected ? (
            <section className="lsq-card lsq-tpl-editor" aria-labelledby="tpl-editor-title">
              <div className="lsq-card__header">
                <div>
                  <h2 className="lsq-tpl-editor__title" id="tpl-editor-title">{selected.name}</h2>
                  <p className="lsq-card__sub">
                    {selected.campaignName ? `Override for ${selected.campaignName}` : 'Shared across every webinar'}
                    {selected.key ? ` · default for “${selected.key}”` : ''}
                    {selected.usedBySteps > 0 ? ` · used by ${selected.usedBySteps.toLocaleString()} cadence step${selected.usedBySteps === 1 ? '' : 's'}` : ''}
                  </p>
                </div>
                <Badge color={STATUS_COLOR[selected.status] ?? 'gray'} text={STATUS_LABEL[selected.status] ?? selected.status} dot />
              </div>

              <div className="lsq-card__body lsq-tpl-form">
                {isDraft && DRAFT_NOTE[channel] && (
                  <div className="lsq-banner" role="status">
                    <span className="lsq-banner__icon" aria-hidden="true">
                      <Icon name="edit" size={16} />
                    </span>
                    <div>
                      <p className="lsq-banner__title">Draft</p>
                      <p className="lsq-banner__body">{DRAFT_NOTE[channel]}</p>
                    </div>
                  </div>
                )}

                <Field
                  label="Template name"
                  error={nameError}
                  hint={channel === 'whatsapp' && !nameError ? 'Lowercase with underscores. Meta rejects other naming.' : undefined}
                >
                  {(p) => <input {...p} className="lsq-input" value={nameVal} onChange={(e) => set('name', e.target.value)} />}
                </Field>

                {selected.hasSubject && (
                  <Field label="Subject" error={subjectError}>
                    {(p) => <input {...p} className="lsq-input" value={subjectVal} onChange={(e) => set('subject', e.target.value)} />}
                  </Field>
                )}

                {channel === 'whatsapp' && (
                  <div className="lsq-tpl-pair">
                    <Field label="Category">
                      {(p) => (
                        <select
                          {...p}
                          className="lsq-select"
                          value={(value('category') as string) ?? 'Marketing'}
                          onChange={(e) => set('category', e.target.value)}
                        >
                          <option>Marketing</option>
                          <option>Utility</option>
                        </select>
                      )}
                    </Field>
                    <Field label="Language">
                      {(p) => <input {...p} className="lsq-input" value={(value('language') as string) ?? ''} onChange={(e) => set('language', e.target.value)} />}
                    </Field>
                  </div>
                )}

                {channel === 'sms' && (
                  <div className="lsq-tpl-pair">
                    <Field label="DLT content template ID" error={dltError}>
                      {(p) => <input {...p} className="lsq-input" value={dltVal} onChange={(e) => set('dltTemplateId', e.target.value)} placeholder="11071xxxxxxxx" />}
                    </Field>
                    <Field label="Sender ID" error={senderError}>
                      {(p) => <input {...p} className="lsq-input" value={senderVal} onChange={(e) => set('senderId', e.target.value)} placeholder="LSQWBR" />}
                    </Field>
                  </div>
                )}

                <Field label="Message" error={bodyError}>
                  {(p) => (
                    <>
                      <textarea {...p} className="lsq-input" rows={channel === 'email' ? 8 : 5} value={body} onChange={(e) => set('body', e.target.value)} />
                      {smsCheck && (
                        <p className="lsq-tpl-counter" data-warn={smsCheck.segments > 1 ? 'true' : undefined}>
                          <span>
                            {body.length.toLocaleString()} characters · {smsCheck.segments} segment{smsCheck.segments === 1 ? '' : 's'}
                          </span>
                          <span>{smsCheck.gsm7 ? 'GSM-7' : 'UCS-2 (non-GSM character present, 70 chars per segment)'}</span>
                        </p>
                      )}
                      {channel === 'whatsapp' && (
                        <p className="lsq-tpl-counter" data-over={body.length > WHATSAPP_BODY_LIMIT ? 'true' : undefined}>
                          <span>
                            {body.length.toLocaleString()} of {WHATSAPP_BODY_LIMIT.toLocaleString()} characters
                          </span>
                        </p>
                      )}
                      {channel === 'linkedin' && (
                        <p className="lsq-tpl-counter" data-warn={body.length > LINKEDIN_NOTE_LIMIT ? 'true' : undefined}>
                          <span>
                            {body.length.toLocaleString()} of {LINKEDIN_NOTE_LIMIT} characters
                          </span>
                          {body.length > LINKEDIN_NOTE_LIMIT && <span>LinkedIn trims connection notes at {LINKEDIN_NOTE_LIMIT}.</span>}
                        </p>
                      )}
                    </>
                  )}
                </Field>

                {channel === 'whatsapp' && (
                  <div className="lsq-tpl-pair">
                    <Field label="Footer">
                      {(p) => <input {...p} className="lsq-input" value={(value('footer') as string) ?? ''} onChange={(e) => set('footer', e.target.value)} />}
                    </Field>
                    <Field label="Buttons">
                      {(p) => (
                        <input
                          {...p}
                          className="lsq-input"
                          value={(value('buttons') as string) ?? ''}
                          onChange={(e) => set('buttons', e.target.value)}
                          placeholder="Register now (URL — {{link}})"
                        />
                      )}
                    </Field>
                  </div>
                )}

                <div className="lsq-stack lsq-stack--sm">
                  <p className="lsq-label">Merge fields</p>
                  <ul className="lsq-tpl-vars" aria-label="Available merge fields">
                    {TEMPLATE_VARIABLES.map((v) => (
                      <li key={v}>
                        <code className="lsq-tpl-var">{v}</code>
                      </li>
                    ))}
                  </ul>
                </div>

                {channel === 'whatsapp' && (
                  <div className="lsq-tpl-approval">
                    <div className="lsq-tpl-approval__text">
                      <p className="lsq-label">Meta approval</p>
                      <p className="lsq-hint">
                        {selected.status === 'approved'
                          ? 'Approved by Meta. This template can be used in cadences.'
                          : selected.status === 'pending'
                            ? 'Submitted to Meta. It becomes usable once approved.'
                            : 'Meta must approve this template before WhatsApp can send it.'}
                      </p>
                    </div>
                    <Badge color={STATUS_COLOR[selected.status] ?? 'gray'} text={STATUS_LABEL[selected.status] ?? selected.status} dot />
                    {selected.status !== 'approved' && (
                      <Button
                        hierarchy="secondary-color"
                        size="sm"
                        icon={<Icon name="send" size={16} />}
                        disabled={busy || pending || selected.status === 'pending'}
                        onClick={() =>
                          run(
                            () => submitForApprovalAction(selected.id),
                            (r) => showToast(r.ok ? 'Submitted to Meta — usable once approved.' : r.error)
                          )
                        }
                      >
                        {selected.status === 'pending' ? 'Awaiting Meta' : 'Submit To Meta'}
                      </Button>
                    )}
                  </div>
                )}

                {channel === 'sms' && (
                  <div className="lsq-tpl-approval">
                    <div className="lsq-tpl-approval__text">
                      <p className="lsq-label">DLT registration</p>
                      <p className="lsq-hint">Both identifiers must be registered with the DLT registry before a cadence can send this SMS.</p>
                    </div>
                    <div className="lsq-tpl-approval__badges">
                      <Badge color={dltVal.trim() ? 'success' : 'warning'} text={dltVal.trim() ? 'Template ID set' : 'Template ID missing'} dot />
                      <Badge color={senderVal.trim() ? 'success' : 'warning'} text={senderVal.trim() ? 'Sender ID set' : 'Sender ID missing'} dot />
                    </div>
                  </div>
                )}

                {showPreview && (
                  <div className="lsq-stack lsq-stack--sm">
                    <p className="lsq-label">Preview for {sampleContact.name}</p>
                    <div className="lsq-tpl-preview">
                      {selected.hasSubject && <p className="lsq-tpl-preview__subject">{renderPreview(subjectVal, sampleContact)}</p>}
                      {renderPreview(body, sampleContact) || <span className="lsq-hint">Nothing to preview yet.</span>}
                    </div>
                  </div>
                )}
              </div>

              <div className="lsq-card__footer lsq-tpl-actions">
                <Button
                  hierarchy="destructive-outline"
                  size="sm"
                  icon={<Icon name="trash" size={16} />}
                  disabled={busy || pending}
                  onClick={() => setConfirmDelete(true)}
                >
                  Delete
                </Button>

                <span className="lsq-tpl-actions__spacer" />

                <Button hierarchy="secondary" size="sm" icon={<Icon name="eye" size={16} />} disabled={busy || pending} onClick={() => setShowPreview((p) => !p)}>
                  {showPreview ? 'Hide Preview' : 'Preview'}
                </Button>

                <Button
                  hierarchy="secondary"
                  size="sm"
                  icon={<Icon name="sparkle" size={16} />}
                  disabled={busy || pending}
                  onClick={() =>
                    run(
                      () => rewriteMessageTemplateAction(selected.id),
                      (r) => {
                        if (r.ok) {
                          setDraft((d) => ({ ...d, subject: r.subject ?? null, body: r.body }));
                          showToast('Rewritten — review and save.');
                        } else {
                          showToast(r.error);
                        }
                      }
                    )
                  }
                >
                  Rewrite With AI
                </Button>

                {selected.hasSaved && (
                  <Button
                    hierarchy="secondary"
                    size="sm"
                    icon={<Icon name="undo" size={16} />}
                    disabled={busy || pending}
                    onClick={() =>
                      run(
                        () => revertMessageTemplateAction(selected.id),
                        (r) => {
                          setDraft({});
                          showToast(r.ok ? 'Reverted to last save.' : r.error);
                        }
                      )
                    }
                  >
                    Revert To Saved
                  </Button>
                )}

                <Button
                  hierarchy="secondary"
                  size="sm"
                  icon={<Icon name="copy" size={16} />}
                  disabled={busy || pending || dirty}
                  title={dirty ? 'Save the edits first. Duplicate copies the last saved version.' : undefined}
                  onClick={() =>
                    run(
                      () => duplicateMessageTemplateAction(selected.id),
                      (id) => {
                        showToast('Duplicated.');
                        go({ id: id as string });
                      }
                    )
                  }
                >
                  Duplicate
                </Button>

                {campaigns.length > 0 && (
                  <Button
                    hierarchy="secondary"
                    size="sm"
                    icon={<Icon name="share" size={16} />}
                    disabled={busy || pending || dirty}
                    title={dirty ? 'Save the edits first. Copy uses the last saved version.' : undefined}
                    onClick={() => setCopyModalOpen(true)}
                  >
                    Copy To Campaigns
                  </Button>
                )}

                <Button
                  hierarchy="secondary"
                  size="sm"
                  icon={<Icon name={selected.hidden ? 'eye' : 'eye-off'} size={16} />}
                  disabled={busy || pending}
                  onClick={() =>
                    run(
                      () => toggleMessageTemplateHiddenAction(selected.id, !selected.hidden),
                      (r) => showToast(r.hidden ? 'Hidden — its steps will stop sending.' : 'Unhidden.')
                    )
                  }
                >
                  {selected.hidden ? 'Unhide' : 'Hide'}
                </Button>

                <Button
                  size="sm"
                  icon={<Icon name="check" size={16} />}
                  disabled={busy || pending || !dirty}
                  onClick={() =>
                    run(
                      async () => {
                        const payload = {
                          name: value('name') as string,
                          subject: (value('subject') as string) ?? null,
                          body,
                          category: (value('category') as string) ?? null,
                          language: (value('language') as string) ?? null,
                          footer: (value('footer') as string) ?? null,
                          buttons: (value('buttons') as string) ?? null,
                          dltTemplateId: (value('dltTemplateId') as string) ?? null,
                          senderId: (value('senderId') as string) ?? null,
                        };

                        if (campaignId && !selected.campaignId) {
                          const copyRes = await copyIntoCampaignAction(selected.id, campaignId);
                          if (!copyRes.ok) {
                            // Nothing was saved — don't report success below, and
                            // don't clear the draft, or the failed edit is lost
                            // with no way to retry it.
                            showToast(copyRes.error || 'Failed to create campaign template override.');
                            return { ok: false as const };
                          }
                          await saveMessageTemplateAction(copyRes.id, payload);
                          return { ok: true as const, forkedId: copyRes.id };
                        }

                        await saveMessageTemplateAction(selected.id, payload);
                        return { ok: true as const, forkedId: null };
                      },
                      (result) => {
                        if (!result.ok) return;
                        setDraft({});
                        showToast(result.forkedId ? 'Saved as campaign copy.' : 'Template saved.');
                        if (result.forkedId) {
                          go({ id: result.forkedId, campaignId });
                        }
                      }
                    )
                  }
                >
                  {dirty ? 'Save Template' : 'Saved'}
                </Button>
              </div>
            </section>
          ) : (
            <div className="lsq-card lsq-empty">
              <span className="lsq-empty__icon" aria-hidden="true"><Icon name="template" size={32} /></span>
              <p className="lsq-empty__title">Create a Template To Get Started</p>
              <p className="lsq-empty__body">Use New Template to draft the first {activeChannel?.label} message.</p>
            </div>
          )}
        </div>
      </div>

      {copyModalOpen && selected && (
        <CopyTemplateModal
          isOpen={copyModalOpen}
          onClose={() => setCopyModalOpen(false)}
          templateId={selected.id}
          templateName={selected.name}
          templateChannel={selected.channel}
          templateKey={selected.key}
          templateBody={draft.body ?? selected.body}
          templateSubject={selected.hasSubject ? (draft.subject ?? selected.subject) : null}
          onSuccess={(summary) => {
            showToast(`Template ${summary}.`);
            router.refresh();
          }}
        />
      )}

      {pendingNav && (
        <ConfirmDialog
          title="Discard unsaved changes?"
          message={`You have unsaved edits to “${selected?.name ?? 'this template'}”. Switching to another template will discard them.`}
          confirmLabel="Discard and Switch"
          destructive
          onConfirm={() => {
            const target = pendingNav;
            setPendingNav(null);
            setDraft({});
            navigate(target);
          }}
          onClose={() => setPendingNav(null)}
        />
      )}

      {confirmDelete && selected && (
        <ConfirmDialog
          title={`Delete “${selected.name}”?`}
          message={
            selected.usedBySteps > 0
              ? !selected.campaignId && selected.key
                ? `This is the library default for "${selected.key}" — ${selected.usedBySteps} cadence step(s) across campaigns fall back to it with no template of their own. Point them at another template first.`
                : `This template is used by ${selected.usedBySteps} cadence step(s). Point them at another template first.`
              : selected.campaignId
              ? 'This permanently removes the campaign-specific copy. Its steps would fall back to the shared library default.'
              : 'This permanently removes the template. No cadence step currently depends on it.'
          }
          confirmLabel="Delete"
          destructive
          busy={busy}
          onConfirm={() =>
            run(
              () => deleteMessageTemplateAction(selected.id),
              (r) => {
                setConfirmDelete(false);
                if (r.ok) {
                  showToast('Template deleted.');
                  go({});
                } else {
                  showToast(r.error ?? 'Could not delete.');
                }
              }
            )
          }
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </>
  );
}
