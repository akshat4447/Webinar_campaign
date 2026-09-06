'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import { checkSmsBody } from '@/lib/channels';
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
}

const CHANNELS: { id: string; label: string }[] = [
  { id: 'email', label: 'Email' },
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'sms', label: 'SMS' },
  { id: 'linkedin', label: 'LinkedIn' },
];

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

function labelStyle(): React.CSSProperties {
  return {
    display: 'block',
    fontSize: 'var(--fs-label-2)',
    fontWeight: 'var(--fw-bold)',
    color: 'var(--n60)',
    marginBottom: 6,
  };
}

/** Variables every channel understands — the same {{merge}} tokens the send
 *  pipeline (lib/cadence.ts renderMergeFields) actually resolves. WhatsApp
 *  used to advertise Meta's numbered {{1}}..{{4}} scheme here, but nothing
 *  in this app ever resolved those: a template written that way failed
 *  validation, and would have gone out to a real recipient with the literal
 *  "{{1}}" text still in it. */
const TEMPLATE_VARIABLES = ['{{firstName}}', '{{company}}', '{{topic}}', '{{link}}', '{{date}}'];

function renderPreview(text: string, sample: { name: string; account: string }): string {
  return text
    .replace(/\{\{\s*firstName\s*\}\}/g, sample.name.split(' ')[0] || sample.name)
    .replace(/\{\{\s*company\s*\}\}/g, sample.account)
    .replace(/\{\{\s*topic\s*\}\}/g, 'Patient Journeys at Scale')
    .replace(/\{\{\s*link\s*\}\}/g, 'lsq.co/w/example')
    .replace(/\{\{\s*date\s*\}\}/g, 'Oct 15, 2026');
}

export function TemplatesLibrary({
  channel,
  counts,
  templates,
  selectedId,
  campaigns,
  sampleContact,
}: {
  channel: string;
  counts: Record<string, number>;
  templates: LibraryTemplate[];
  selectedId?: string;
  campaigns: { id: string; name: string }[];
  sampleContact: { name: string; account: string };
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();

  const selected = templates.find((t) => t.id === selectedId) ?? templates[0] ?? null;

  // Draft state is keyed by template id so switching selection cannot carry
  // one template's unsaved edits onto another.
  const [draftId, setDraftId] = useState<string | null>(selected?.id ?? null);
  const [draft, setDraft] = useState<Partial<LibraryTemplate>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  if (selected && draftId !== selected.id) {
    setDraftId(selected.id);
    setDraft({});
    setShowPreview(false);
  }

  const value = <K extends keyof LibraryTemplate>(field: K): LibraryTemplate[K] | undefined =>
    (draft[field] !== undefined ? draft[field] : selected?.[field]) as LibraryTemplate[K] | undefined;

  const set = (field: keyof LibraryTemplate, v: unknown) => setDraft((d) => ({ ...d, [field]: v }));
  const dirty = Object.keys(draft).length > 0;

  const go = (params: Record<string, string>) => {
    const qs = new URLSearchParams({ channel, ...params });
    router.push(`/templates?${qs.toString()}`);
  };

  async function run<T>(fn: () => Promise<T>, after?: (r: T) => void) {
    setBusy(true);
    try {
      const r = await fn();
      after?.(r);
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }

  const body = (value('body') as string) ?? '';
  const smsCheck = channel === 'sms' ? checkSmsBody(body) : null;

  return (
    <>
      <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid var(--border-subtle)', marginBottom: 18, flexWrap: 'wrap' }}>
        {CHANNELS.map((c) => {
          const active = c.id === channel;
          return (
            <button
              key={c.id}
              type="button"
              className="lsq-tab"
              data-active={active ? 'true' : 'false'}
              onClick={() => router.push(`/templates?channel=${c.id}`)}
              style={{
                padding: '10px 14px',
                fontSize: 'var(--fs-label-1)',
                fontWeight: 'var(--fw-bold)',
                color: active ? 'var(--accent-500)' : 'var(--n50)',
                background: 'none',
                borderStyle: 'solid',
                borderWidth: '0 0 2px 0',
                borderColor: active ? 'var(--accent-500)' : 'transparent',
                cursor: 'pointer',
              }}
            >
              {c.label} ({counts[c.id] ?? 0})
            </button>
          );
        })}
      </div>

      <div
        style={{
          display: 'flex',
          gap: 10,
          background: 'var(--accent-50)',
          borderRadius: 'var(--radius-lg)',
          padding: '12px 14px',
          marginBottom: 18,
        }}
      >
        <span style={{ color: 'var(--accent-700)', flexShrink: 0, fontWeight: 700 }} aria-hidden="true">
          ✓
        </span>
        <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--accent-700)', lineHeight: 1.55, maxWidth: '80ch' }}>
          {CHANNEL_RULES[channel]}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 300px) minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Button
            fullWidth
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
            + New template
          </Button>

          {templates.length === 0 && (
            <div className="lsq-card" style={{ padding: '18px 16px', fontSize: 'var(--fs-label-1)', color: 'var(--n60)' }}>
              No {CHANNELS.find((c) => c.id === channel)?.label} templates yet.
            </div>
          )}

          {templates.map((t) => {
            const active = t.id === selected?.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => go({ id: t.id })}
                className="lsq-card"
                style={{
                  padding: '12px 14px',
                  textAlign: 'left',
                  border: 'none',
                  cursor: 'pointer',
                  boxShadow: active ? 'inset 0 0 0 1px var(--accent-500)' : 'inset 0 0 0 1px var(--border-subtle)',
                  opacity: t.hidden ? 0.6 : 1,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                  <span
                    style={{
                      fontSize: 'var(--fs-label-1)',
                      fontWeight: 'var(--fw-bold)',
                      color: 'var(--n90)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {t.name}
                  </span>
                  <Badge color={STATUS_COLOR[t.status] ?? 'gray'} text={STATUS_LABEL[t.status] ?? t.status} />
                </div>
                <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n50)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {t.campaignName ? `${t.campaignName} only` : 'Shared library'}
                  {t.hidden ? ' · hidden' : ''}
                  {t.usedBySteps > 0 ? ` · ${t.usedBySteps} step${t.usedBySteps === 1 ? '' : 's'}` : ''}
                </div>
              </button>
            );
          })}
        </div>

        {selected ? (
          <div className="lsq-card" style={{ padding: '20px 22px' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 16 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 'var(--fs-heading-4)', fontWeight: 'var(--fw-bold)', color: 'var(--n90)' }}>{selected.name}</div>
                <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n50)', marginTop: 2 }}>
                  {selected.campaignName ? `Override for ${selected.campaignName}` : 'Shared across every webinar'}
                  {selected.key ? ` · default for “${selected.key}”` : ''}
                  {selected.usedBySteps > 0 ? ` · used by ${selected.usedBySteps} cadence step${selected.usedBySteps === 1 ? '' : 's'}` : ''}
                </div>
              </div>
              <Badge color={STATUS_COLOR[selected.status] ?? 'gray'} text={STATUS_LABEL[selected.status] ?? selected.status} dot />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={labelStyle()} htmlFor="tpl-name">
                  Template name
                </label>
                <input
                  id="tpl-name"
                  className="lsq-input"
                  value={(value('name') as string) ?? ''}
                  onChange={(e) => set('name', e.target.value)}
                />
                {channel === 'whatsapp' && (
                  <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n50)', marginTop: 5 }}>
                    Lowercase with underscores — Meta rejects other naming.
                  </div>
                )}
              </div>

              {selected.hasSubject && (
                <div>
                  <label style={labelStyle()} htmlFor="tpl-subject">
                    Subject
                  </label>
                  <input
                    id="tpl-subject"
                    className="lsq-input"
                    value={(value('subject') as string) ?? ''}
                    onChange={(e) => set('subject', e.target.value)}
                  />
                </div>
              )}

              {channel === 'whatsapp' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={labelStyle()} htmlFor="tpl-category">
                      Category
                    </label>
                    <select
                      id="tpl-category"
                      className="lsq-select"
                      style={{ width: '100%', height: 36 }}
                      value={(value('category') as string) ?? 'Marketing'}
                      onChange={(e) => set('category', e.target.value)}
                    >
                      <option>Marketing</option>
                      <option>Utility</option>
                    </select>
                  </div>
                  <div>
                    <label style={labelStyle()} htmlFor="tpl-language">
                      Language
                    </label>
                    <input
                      id="tpl-language"
                      className="lsq-input"
                      value={(value('language') as string) ?? ''}
                      onChange={(e) => set('language', e.target.value)}
                    />
                  </div>
                </div>
              )}

              {channel === 'sms' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={labelStyle()} htmlFor="tpl-dlt">
                      DLT content template ID
                    </label>
                    <input
                      id="tpl-dlt"
                      className="lsq-input"
                      value={(value('dltTemplateId') as string) ?? ''}
                      onChange={(e) => set('dltTemplateId', e.target.value)}
                      placeholder="11071xxxxxxxx"
                    />
                  </div>
                  <div>
                    <label style={labelStyle()} htmlFor="tpl-sender">
                      Sender ID
                    </label>
                    <input
                      id="tpl-sender"
                      className="lsq-input"
                      value={(value('senderId') as string) ?? ''}
                      onChange={(e) => set('senderId', e.target.value)}
                      placeholder="LSQWBR"
                    />
                  </div>
                </div>
              )}

              <div>
                <label style={labelStyle()} htmlFor="tpl-body">
                  Message
                </label>
                <textarea
                  id="tpl-body"
                  className="lsq-input"
                  rows={channel === 'email' ? 8 : 5}
                  value={body}
                  onChange={(e) => set('body', e.target.value)}
                />
                {smsCheck && (
                  <div
                    style={{
                      fontSize: 'var(--fs-label-2)',
                      color: smsCheck.segments > 1 ? 'var(--warning-700)' : 'var(--n50)',
                      marginTop: 5,
                    }}
                  >
                    {body.length} characters · {smsCheck.segments} segment{smsCheck.segments === 1 ? '' : 's'} ·{' '}
                    {smsCheck.gsm7 ? 'GSM-7' : 'UCS-2 (non-GSM character present — 70 chars per segment)'}
                  </div>
                )}
              </div>

              {channel === 'whatsapp' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={labelStyle()} htmlFor="tpl-footer">
                      Footer
                    </label>
                    <input
                      id="tpl-footer"
                      className="lsq-input"
                      value={(value('footer') as string) ?? ''}
                      onChange={(e) => set('footer', e.target.value)}
                    />
                  </div>
                  <div>
                    <label style={labelStyle()} htmlFor="tpl-buttons">
                      Buttons
                    </label>
                    <input
                      id="tpl-buttons"
                      className="lsq-input"
                      value={(value('buttons') as string) ?? ''}
                      onChange={(e) => set('buttons', e.target.value)}
                      placeholder="Register now (URL — {{link}})"
                    />
                  </div>
                </div>
              )}

              <div>
                <div style={labelStyle()}>Variables</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {TEMPLATE_VARIABLES.map((v) => (
                    <span
                      key={v}
                      style={{
                        fontSize: 'var(--fs-label-2)',
                        fontFamily: 'ui-monospace, Menlo, monospace',
                        background: 'var(--n10)',
                        borderRadius: 'var(--radius-sm)',
                        padding: '4px 9px',
                      }}
                    >
                      {v}
                    </span>
                  ))}
                </div>
              </div>

              {showPreview && (
                <div>
                  <div style={labelStyle()}>Preview for {sampleContact.name}</div>
                  <div
                    style={{
                      background: 'var(--n10)',
                      borderRadius: 'var(--radius-md)',
                      padding: '14px 16px',
                      fontSize: 'var(--fs-label-1)',
                      lineHeight: 1.55,
                      whiteSpace: 'pre-wrap',
                      overflowWrap: 'anywhere',
                    }}
                  >
                    {selected.hasSubject && (
                      <div style={{ fontWeight: 'var(--fw-bold)', marginBottom: 8 }}>
                        {renderPreview((value('subject') as string) ?? '', sampleContact)}
                      </div>
                    )}
                    {renderPreview(body, sampleContact) || <span style={{ color: 'var(--n50)' }}>Nothing to preview yet.</span>}
                  </div>
                </div>
              )}
            </div>

            <div
              style={{
                display: 'flex',
                gap: 8,
                flexWrap: 'wrap',
                marginTop: 18,
                paddingTop: 16,
                borderTop: '1px solid var(--border-subtle)',
              }}
            >
              <Button
                size="sm"
                disabled={busy || pending || !dirty}
                onClick={() =>
                  run(
                    () =>
                      saveMessageTemplateAction(selected.id, {
                        name: value('name') as string,
                        subject: (value('subject') as string) ?? null,
                        body,
                        category: (value('category') as string) ?? null,
                        language: (value('language') as string) ?? null,
                        footer: (value('footer') as string) ?? null,
                        buttons: (value('buttons') as string) ?? null,
                        dltTemplateId: (value('dltTemplateId') as string) ?? null,
                        senderId: (value('senderId') as string) ?? null,
                      }),
                    () => {
                      setDraft({});
                      showToast('Template saved.');
                    }
                  )
                }
              >
                {dirty ? 'Save template' : 'Saved'}
              </Button>

              <Button
                hierarchy="secondary"
                size="sm"
                disabled={busy || pending}
                onClick={() => setShowPreview((p) => !p)}
              >
                {showPreview ? 'Hide preview' : 'Preview'}
              </Button>

              <Button
                hierarchy="secondary"
                size="sm"
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
                Rewrite with AI
              </Button>

              {selected.hasSaved && (
                <Button
                  hierarchy="secondary"
                  size="sm"
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
                  Revert to saved
                </Button>
              )}

              <Button
                hierarchy="secondary"
                size="sm"
                disabled={busy || pending}
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

              <Button
                hierarchy="secondary"
                size="sm"
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

              {channel === 'whatsapp' && selected.status !== 'approved' && (
                <Button
                  hierarchy="secondary-color"
                  size="sm"
                  disabled={busy || pending || selected.status === 'pending'}
                  onClick={() =>
                    run(
                      () => submitForApprovalAction(selected.id),
                      (r) => showToast(r.ok ? 'Submitted to Meta — usable once approved.' : r.error)
                    )
                  }
                >
                  {selected.status === 'pending' ? 'Awaiting Meta' : 'Submit to Meta'}
                </Button>
              )}

              {!selected.campaignId && campaigns.length > 0 && selected.key && (
                <select
                  className="lsq-select"
                  style={{ height: 32 }}
                  value=""
                  disabled={busy || pending}
                  onChange={(e) => {
                    const cid = e.target.value;
                    if (!cid) return;
                    run(
                      () => copyIntoCampaignAction(selected.id, cid),
                      (r) => showToast(r.ok ? 'Copied into campaign — it can now diverge.' : r.error)
                    );
                  }}
                >
                  <option value="">Copy into campaign…</option>
                  {campaigns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}

              <Button
                hierarchy="destructive-outline"
                size="sm"
                disabled={busy || pending}
                onClick={() => setConfirmDelete(true)}
              >
                Delete
              </Button>
            </div>
          </div>
        ) : (
          <div className="lsq-card" style={{ padding: '28px 24px', fontSize: 'var(--fs-label-1)', color: 'var(--n60)' }}>
            Create a template to get started.
          </div>
        )}
      </div>

      {confirmDelete && selected && (
        <ConfirmDialog
          title={`Delete “${selected.name}”?`}
          message={
            selected.usedBySteps > 0
              ? `This template is used by ${selected.usedBySteps} cadence step(s). Point them at another template first.`
              : 'This permanently removes the template. Cadence steps using it would fall back to the library default.'
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
