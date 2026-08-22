'use client';

import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { NavButton } from '@/components/ui/NavButton';
import { saveTemplateAction, rewriteTemplateAction, duplicateTemplateAction } from '@/lib/actions/templates';
import type { Template } from '@/lib/generated/prisma/client';

const knownVars = ['firstName', 'lastName', 'company', 'topic', 'link', 'date'];

function channelColor(channel: string): string {
  return channel === 'LinkedIn' ? 'gray blue' : 'blue';
}

function fillTemplate(str: string, campaignName: string, sample: { name: string; account: string }, link: string): string {
  return str
    .replace(/\{\{\s*firstName\s*\}\}/g, sample.name.split(' ')[0] || sample.name)
    .replace(/\{\{\s*company\s*\}\}/g, sample.account)
    .replace(/\{\{\s*topic\s*\}\}/g, campaignName)
    .replace(/\{\{\s*link\s*\}\}/g, link);
}

function validateTemplate(subject: string | null | undefined, body: string, hasSubject: boolean) {
  const text = (hasSubject ? `${subject ?? ''} ` : '') + body;
  const used = (text.match(/\{\{\s*[\w.]+\s*\}\}/g) ?? []).map((m) => m.replace(/[{}\s]/g, ''));
  const unknown = Array.from(new Set(used.filter((v) => !knownVars.includes(v))));
  const resolved = Array.from(new Set(used.filter((v) => knownVars.includes(v))));
  const hasLink = /\{\{\s*link\s*\}\}/.test(text) || /https?:\/\/|lsq\.co/.test(text);
  const bodyLen = body.length;
  const spam = ['free', 'guaranteed', 'act now', 'limited time', 'click here', 'risk-free'].filter((w) => text.toLowerCase().includes(w));

  const badges: { color: string; text: string }[] = [];
  badges.push(
    unknown.length
      ? { color: 'error', text: `${unknown.length} unknown variable${unknown.length > 1 ? 's' : ''}: ${unknown.map((u) => `{{${u}}}`).join(', ')}` }
      : { color: 'success', text: resolved.length ? `${resolved.length} variables resolved` : 'No variables used' }
  );
  badges.push(hasLink ? { color: 'success', text: 'Registration link present' } : { color: 'error', text: 'No registration link' });
  badges.push(bodyLen > 900 ? { color: 'warning', text: `Body long — ${bodyLen} chars` } : { color: 'success', text: `Length ${bodyLen} chars` });
  if (spam.length) badges.push({ color: 'warning', text: `Spam-trigger words: ${spam.join(', ')}` });
  if (hasSubject && (subject ?? '').length > 60) badges.push({ color: 'warning', text: `Subject ${subject!.length} chars — may truncate` });
  return badges;
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

  const selected = templates.find((t) => t.id === selectedId)!;
  const dirty = selected.savedBody === null ? true : selected.subject !== selected.savedSubject || selected.body !== selected.savedBody;

  const badges = useMemo(() => validateTemplate(selected.subject, selected.body, selected.hasSubject), [selected]);

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
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 600, color: tpl.id === selectedId ? 'var(--accent-700)' : 'var(--n80)' }}>{tpl.label}</span>
            <Badge color={channelColor(tpl.channel)} text={tpl.channel} />
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
              {badges.map((b, i) => (
                <Badge key={i} color={b.color} text={b.text} />
              ))}
            </div>
          </div>
          <div style={{ background: 'var(--n10)', borderRadius: 'var(--radius-md)', padding: 16 }}>
            {selected.hasSubject && (
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--n90)', marginBottom: 8 }}>{fillTemplate(selected.subject ?? '', campaignName, sampleContact, registrationLink)}</div>
            )}
            <div style={{ fontSize: 13, color: 'var(--n80)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{fillTemplate(selected.body, campaignName, sampleContact, registrationLink)}</div>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <NavButton href={`/campaigns/${campaignId}/schedule`}>Continue to schedule</NavButton>
        </div>
      </div>
    </div>
  );
}
