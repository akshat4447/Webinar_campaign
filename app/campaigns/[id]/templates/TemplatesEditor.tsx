'use client';

import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { NavButton } from '@/components/ui/NavButton';
import { Icon } from '@/components/ui/Icon';
import { saveTemplateAction, rewriteTemplateAction, duplicateTemplateAction, createCustomTemplateAction, deleteTemplateAction, toggleTemplateHiddenAction } from '@/lib/actions/templates';
import { BUILT_IN_TEMPLATE_IDS } from '@/lib/demo-data';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { validateTemplateContentForChannel } from '@/lib/messageValidation';
import { useRouter } from 'next/navigation';
import type { Template } from '@/lib/generated/prisma/client';

const knownVars = ['firstName', 'lastName', 'company', 'topic', 'link', 'date'];

function channelColor(channel: string): string {
  return channel === 'LinkedIn' ? 'gray blue' : channel === 'SMS' || channel === 'WhatsApp' ? 'warning' : 'blue';
}

function fillTemplate(str: string, campaignName: string, sample: { name: string; account: string }, link: string): string {
  return str
    .replace(/\{\{\s*firstName\s*\}\}/g, sample.name.split(' ')[0] || sample.name)
    .replace(/\{\{\s*company\s*\}\}/g, sample.account)
    .replace(/\{\{\s*topic\s*\}\}/g, campaignName)
    .replace(/\{\{\s*link\s*\}\}/g, link);
}

export function TemplatesEditor({
  campaignId,
  campaignName,
  initialTemplates,
  registrationLink,
  sampleContact,
}: {
  campaignId: string;
  campaignName: string;
  initialTemplates: Template[];
  registrationLink: string;
  sampleContact: { name: string; account: string };
}) {
  const [templates, setTemplates] = useState(initialTemplates);
  const [selectedId, setSelectedId] = useState(initialTemplates[0].id);
  const [rewriting, setRewriting] = useState(false);
  const [rewriteError, setRewriteError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newChannel, setNewChannel] = useState('Email');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; label: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const router = useRouter();

  const selected = templates.find((t) => t.id === selectedId)!;
  const dirty = selected.savedBody === null ? true : selected.subject !== selected.savedSubject || selected.body !== selected.savedBody;

  const validation = useMemo(
    () => validateTemplateContentForChannel(selected.subject, selected.body, selected.hasSubject, knownVars, selected.channel),
    [selected]
  );

  function isCustom(tpl: Template): boolean {
    return !BUILT_IN_TEMPLATE_IDS.includes(tpl.key.split('-copy-')[0]);
  }

  async function addTemplate() {
    setAdding(true);
    setAddError(null);
    const res = await createCustomTemplateAction(campaignId, { label: newLabel, channel: newChannel });
    setAdding(false);
    if (!res.ok || !res.key) {
      setAddError(res.error ?? 'Could not create the template.');
      return;
    }
    setShowAdd(false);
    setNewLabel('');
    router.refresh();
  }

  async function hideToggle(tpl: Template) {
    const nextHidden = !tpl.hidden;
    // Optimistic local update first: router.refresh() re-renders the server
    // component but does NOT reseed this client component's useState, so without
    // this the eye icon and row opacity would not change until a full reload.
    setTemplates((ts) => ts.map((t) => (t.id === tpl.id ? { ...t, hidden: nextHidden } : t)));
    if (tpl.id === selectedId) updateSelected({ hidden: nextHidden });
    await toggleTemplateHiddenAction(campaignId, tpl.id, nextHidden);
    router.refresh();
  }

  async function removeTemplate() {
    if (!confirmDelete) return;
    setDeleting(true);
    await deleteTemplateAction(campaignId, confirmDelete.id);
    setDeleting(false);
    setConfirmDelete(null);
    if (selectedId === confirmDelete.id) {
      const remaining = templates.filter((t) => t.id !== confirmDelete.id);
      if (remaining[0]) setSelectedId(remaining[0].id);
    }
    setTemplates((ts) => ts.filter((t) => t.id !== confirmDelete.id));
    router.refresh();
  }

  function updateSelected(patch: Partial<Template>) {
    setTemplates((ts) => ts.map((t) => (t.id === selectedId ? { ...t, ...patch } : t)));
  }

  async function rewrite() {
    setRewriting(true);
    setRewriteError(null);
    const res = await rewriteTemplateAction(selectedId);
    setRewriting(false);
    if (!res.ok) {
      setRewriteError(res.error);
      return;
    }
    updateSelected({ subject: res.subject, body: res.body });
  }

  async function duplicate() {
    const newId = await duplicateTemplateAction(campaignId, selectedId);
    const orig = templates.find((t) => t.id === selectedId)!;
    setTemplates((ts) => [...ts, { ...orig, id: newId, label: `${orig.label} (copy)` }]);
    setSelectedId(newId);
  }

  async function save() {
    setSaving(true);
    const { savedAt } = await saveTemplateAction(selectedId, selected.subject, selected.body);
    setSaving(false);
    updateSelected({ savedSubject: selected.subject, savedBody: selected.body, savedAt: new Date(savedAt) });
  }

  function revert() {
    updateSelected({ subject: selected.savedSubject, body: selected.savedBody ?? selected.body });
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 260px) minmax(0, 1fr)', gap: 20, alignItems: 'start' }}>
      <div style={{ background: '#fff', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)', padding: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Button
          hierarchy="secondary"
          size="sm"
          style={{ margin: '4px 6px 8px 6px' }}
          onClick={() => setShowAdd((v) => !v)}
        >
          {showAdd ? 'Cancel' : '+ Add template'}
        </Button>
        {showAdd && (
          <div style={{ margin: '0 6px 10px 6px', padding: 10, border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input className="lsq-input" type="text" placeholder="Step name (e.g. Post-demo follow-up)" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} />
            <select className="lsq-select" value={newChannel} onChange={(e) => setNewChannel(e.target.value)} style={{ height: 32, fontSize: 12.5 }}>
              <option>Email</option>
              <option>LinkedIn</option>
              <option>SMS</option>
              <option>WhatsApp</option>
            </select>
            {addError && <div style={{ fontSize: 11, color: 'var(--danger-500)' }}>{addError}</div>}
            <Button hierarchy="primary" size="sm" onClick={addTemplate} disabled={adding || !newLabel.trim()}>
              {adding ? 'Creating…' : 'Create step'}
            </Button>
          </div>
        )}
        {templates.map((tpl) => (
          <div
            key={tpl.id}
            onClick={() => setSelectedId(tpl.id)}
            style={{
              padding: '10px 12px',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
              background: tpl.id === selectedId ? 'var(--accent-50)' : 'transparent',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              opacity: tpl.hidden ? 0.55 : 1,
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 600, color: tpl.hidden ? 'var(--n50)' : tpl.id === selectedId ? 'var(--accent-700)' : 'var(--n80)', overflowWrap: 'anywhere' }}>
              {tpl.label}
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              <Badge color={channelColor(tpl.channel)} text={tpl.channel} />
              {/* Icon buttons must stopPropagation (row selects) AND update local
                  state optimistically — router.refresh() alone leaves this
                  client component's list stale until a full reload. */}
              <span
                role="button"
                aria-label={tpl.hidden ? `Show ${tpl.label}` : `Hide ${tpl.label}`}
                title={tpl.hidden ? 'Show in Personalize & Schedule' : 'Hide from Personalize & Schedule'}
                onClick={(e) => {
                  e.stopPropagation();
                  hideToggle(tpl);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 24,
                  height: 24,
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  color: tpl.hidden ? 'var(--n50)' : 'var(--n70)',
                }}
              >
                <Icon name={tpl.hidden ? 'eye-off' : 'eye'} size={15} />
              </span>
              {isCustom(tpl) && (
                <span
                  role="button"
                  aria-label={`Delete ${tpl.label}`}
                  title="Delete this custom step"
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirmDelete({ id: tpl.id, label: tpl.label });
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 24,
                    height: 24,
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                    color: 'var(--danger-500)',
                  }}
                >
                  <Icon name="trash" size={14} />
                </span>
              )}
            </span>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ background: '#fff', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)', padding: '18px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 12, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--n90)' }}>{selected.label}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 600, color: dirty ? 'var(--warning-700)' : 'var(--success-700)' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: dirty ? 'var(--warning-700)' : 'var(--success-500)', flexShrink: 0 }} />
                {dirty ? 'Unsaved changes' : selected.savedAt ? `Saved ${new Date(selected.savedAt).toLocaleTimeString('en-GB', { hour12: false })}` : 'Not yet saved'}
              </div>
              {/* Previously there was no single pass/fail signal here — only a row
                  of individual badges with no summary, so an invalid template
                  (missing link, unknown variable) looked no more urgent than a
                  fine one. This is the first thing an operator sees. */}
              <Badge
                color={validation.valid ? 'success' : 'error'}
                text={validation.valid ? 'Valid' : `${validation.issues.filter((i) => i.severity === 'error').length} issue${validation.issues.filter((i) => i.severity === 'error').length === 1 ? '' : 's'}`}
                dot
              />
              {selected.hidden && <Badge color="gray" text="Hidden" dot />}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {dirty && selected.savedBody !== null && (
                <Button hierarchy="tertiary" size="sm" onClick={revert}>
                  Revert
                </Button>
              )}
              <Button hierarchy="tertiary" size="sm" onClick={duplicate}>
                Duplicate
              </Button>
              <Button hierarchy="secondary-color" size="sm" onClick={rewrite} disabled={rewriting}>
                {rewriting ? 'Rewriting…' : '✦ AI rewrite'}
              </Button>
              <Button hierarchy={dirty ? 'primary' : 'secondary'} size="sm" disabled={!dirty || saving} onClick={save}>
                {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
              </Button>
            </div>
          </div>
          {rewriteError && <div style={{ fontSize: 12.5, color: 'var(--danger-500)', marginBottom: 12 }}>{rewriteError}</div>}
          {selected.hasSubject && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: 'var(--n60)', marginBottom: 6 }}>Subject</div>
              <input className="lsq-input" type="text" value={selected.subject ?? ''} onChange={(e) => updateSelected({ subject: e.target.value })} />
            </div>
          )}
          <div>
            <div style={{ fontSize: 12, color: 'var(--n60)', marginBottom: 6 }}>Message body</div>
            <textarea className="lsq-input" rows={6} value={selected.body} onChange={(e) => updateSelected({ body: e.target.value })} />
          </div>
        </div>

        <div style={{ background: '#fff', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)', padding: '18px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--n90)', minWidth: 0 }}>
              Message preview — sample contact: {sampleContact.name}, {sampleContact.account}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {validation.issues.length === 0 ? (
                <Badge color="success" text="No issues found" />
              ) : (
                validation.issues.map((issue, i) => <Badge key={i} color={issue.severity === 'error' ? 'error' : 'warning'} text={issue.message} />)
              )}
            </div>
          </div>
          <div style={{ background: 'var(--n10)', borderRadius: 'var(--radius-md)', padding: 16 }}>
            {selected.hasSubject && (
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--n90)', marginBottom: 8 }}>{fillTemplate(selected.subject ?? '', campaignName, sampleContact, registrationLink)}</div>
            )}
            <div style={{ fontSize: 13, color: 'var(--n80)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{fillTemplate(selected.body, campaignName, sampleContact, registrationLink)}</div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 12, color: 'var(--n60)', maxWidth: '52ch' }}>
            This template goes to everyone as-is. To rewrite it per recipient — by seniority, function and industry — continue to
            Personalize.
          </div>
          <NavButton href={`/campaigns/${campaignId}/personalize`}>Continue to personalize</NavButton>
        </div>
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete "${confirmDelete.label}"?`}
          message="This removes the template, its cadence step and any personalized copies. Queued sends for it are deleted too."
          confirmLabel="Delete step"
          destructive
          busy={deleting}
          onConfirm={removeTemplate}
          onClose={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}
