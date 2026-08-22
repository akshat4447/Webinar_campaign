'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Avatar } from '@/components/ui/Avatar';
import {
  generatePersonalizedAction,
  regeneratePersonalizedAction,
  savePersonalizedAction,
  markReviewedAction,
  markAllReviewedAction,
  discardPersonalizedAction,
  repairLinksAction,
} from '@/lib/actions/personalize';
import type { GenerateResult } from '@/lib/personalization';
import { PromptModal } from './PromptModal';

interface MessageState {
  id: string;
  subject: string | null;
  body: string;
  rationale: string | null;
  status: string;
  linkStale: boolean;
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
}

const statusMeta: Record<string, { color: string; label: string }> = {
  draft: { color: 'blue', label: 'AI draft' },
  edited: { color: 'warning', label: 'Edited' },
  reviewed: { color: 'success', label: 'Reviewed' },
};

export function PersonalizeClient({
  campaignId,
  campaignName,
  hasDescription,
  steps,
  activeStepKey,
  activeStepLabel,
  activeChannel,
  templateSubject,
  templateBody,
  rows: initialRows,
  currentLink,
  personalizationPrompt,
  confirmThreshold,
}: {
  campaignId: string;
  campaignName: string;
  hasDescription: boolean;
  steps: StepOption[];
  activeStepKey: string;
  activeStepLabel: string;
  activeChannel: 'email' | 'linkedin';
  templateSubject: string | null;
  templateBody: string;
  rows: Row[];
  currentLink: string;
  personalizationPrompt: string;
  confirmThreshold: number;
}) {
  const [rows, setRows] = useState(initialRows);
  const [selectedId, setSelectedId] = useState<string | null>(initialRows.find((r) => r.message)?.contactId ?? initialRows[0]?.contactId ?? null);
  const [generating, setGenerating] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const [showTemplate, setShowTemplate] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const [savedPrompt, setSavedPrompt] = useState(personalizationPrompt);
  // Text as it stands in the DB, keyed by message id — lets the editor tell a
  // real edit from an untouched message, so saving can't demote a reviewed
  // message back to "edited" for nothing.
  const [baseline, setBaseline] = useState<Record<string, { subject: string | null; body: string }>>(() =>
    Object.fromEntries(
      initialRows.filter((r) => r.message).map((r) => [r.message!.id, { subject: r.message!.subject, body: r.message!.body }])
    )
  );
  const router = useRouter();

  const selected = rows.find((r) => r.contactId === selectedId) ?? null;
  const generatedCount = rows.filter((r) => r.message).length;
  const unreviewed = rows.filter((r) => r.message && r.message.status !== 'reviewed').length;
  const staleLinkCount = rows.filter((r) => r.message?.linkStale).length;
  const base = selected?.message ? baseline[selected.message.id] : undefined;
  const dirty = !!selected?.message && (!base || base.subject !== selected.message.subject || base.body !== selected.message.body);

  async function repairStaleLinks() {
    setRepairing(true);
    const { count, bodies } = await repairLinksAction(campaignId, activeStepKey);
    setRepairing(false);
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

  async function runGenerate() {
    setConfirming(false);
    setGenerating(true);
    setNotice(null);
    const res = await generatePersonalizedAction(campaignId, activeStepKey);
    setGenerating(false);
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
  }

  function onGenerateClick() {
    if (rows.length > confirmThreshold) setConfirming(true);
    else runGenerate();
  }

  async function regenerate(contactId: string) {
    setBusyRow(contactId);
    const res = await regeneratePersonalizedAction(campaignId, contactId, activeStepKey);
    setBusyRow(null);
    if (!res.ok) {
      setNotice({ tone: 'bad', text: res.error ?? 'Could not regenerate.' });
      return;
    }
    if (res.messages) applyWritten(res.messages);
    setNotice({ tone: 'good', text: 'Rewritten.' });
    router.refresh();
  }

  function patchSelected(patch: Partial<MessageState>) {
    setRows((rs) => rs.map((r) => (r.contactId === selectedId && r.message ? { ...r, message: { ...r.message, ...patch } } : r)));
  }

  async function save() {
    if (!selected?.message || !dirty) return;
    const { id, subject, body } = selected.message;
    setSaving(true);
    await savePersonalizedAction(id, subject, body);
    setSaving(false);
    setBaseline((bl) => ({ ...bl, [id]: { subject, body } }));
    patchSelected({ status: 'edited' });
  }

  async function review() {
    if (!selected?.message) return;
    await markReviewedAction(selected.message.id);
    patchSelected({ status: 'reviewed' });
  }

  async function reviewAll() {
    const n = await markAllReviewedAction(campaignId, activeStepKey);
    setRows((rs) => rs.map((r) => (r.message ? { ...r, message: { ...r.message, status: 'reviewed' } } : r)));
    setNotice({ tone: 'good', text: `${n} message${n === 1 ? '' : 's'} marked reviewed.` });
  }

  async function discard() {
    const n = await discardPersonalizedAction(campaignId, activeStepKey);
    setNotice({ tone: 'good', text: `Discarded ${n}. This step falls back to the shared template.` });
    router.refresh();
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Step picker — "define the event you want personalized copy for" */}
      <div style={{ background: '#fff', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)', padding: '16px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--n90)' }}>Personalize a step</div>
            <div style={{ fontSize: 12, color: 'var(--n60)', marginTop: 2, maxWidth: '64ch' }}>
              Each message is rewritten from the approved template for one person, using their title, seniority, function, industry
              and why they scored as they did. The offer and the registration link stay exactly as the template has them.
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
          {steps.map((s) => {
            const active = s.key === activeStepKey;
            return (
              <div
                key={s.key}
                onClick={() => router.push(`/campaigns/${campaignId}/personalize?step=${s.key}`)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 7,
                  padding: '7px 12px',
                  borderRadius: 'var(--radius-full)',
                  cursor: 'pointer',
                  fontSize: 12.5,
                  fontWeight: 600,
                  background: active ? 'var(--accent-500)' : 'var(--n10)',
                  color: active ? '#fff' : 'var(--n70)',
                }}
              >
                {s.label}
                {s.count > 0 && (
                  <span
                    style={{
                      fontSize: 10.5,
                      fontWeight: 700,
                      padding: '1px 6px',
                      borderRadius: 'var(--radius-full)',
                      background: active ? 'rgba(255,255,255,0.24)' : 'var(--n20)',
                      color: active ? '#fff' : 'var(--n60)',
                    }}
                  >
                    {s.count}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {!hasDescription && (
          <div style={{ marginTop: 12, fontSize: 11.5, color: 'var(--warning-700)' }}>
            This campaign has no description yet — adding one on Setup gives the AI much more to work with than the topic alone.
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
          {confirming ? (
            <>
              <span style={{ fontSize: 12.5, color: 'var(--warning-700)', fontWeight: 600 }}>
                {rows.length} recipients — this makes ~{Math.ceil(rows.length / 5)} Claude calls. Continue?
              </span>
              <Button hierarchy="secondary" size="sm" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
              <Button hierarchy="primary" size="sm" onClick={runGenerate}>
                Generate anyway
              </Button>
            </>
          ) : (
            <>
              <Button hierarchy="primary" size="md" onClick={onGenerateClick} disabled={generating || rows.length === 0}>
                {generating ? 'Writing…' : generatedCount > 0 ? `Regenerate all ${rows.length}` : `Generate for ${rows.length} approved`}
              </Button>
              {unreviewed > 0 && (
                <Button hierarchy="secondary" size="md" onClick={reviewAll}>
                  Mark {unreviewed} reviewed
                </Button>
              )}
              {generatedCount > 0 && (
                <Button hierarchy="tertiary" size="md" onClick={discard}>
                  Discard &amp; use template
                </Button>
              )}
              <Button hierarchy="tertiary" size="md" onClick={() => setShowTemplate((v) => !v)}>
                {showTemplate ? 'Hide base template' : 'View base template'}
              </Button>
              <Button hierarchy="secondary-color" size="md" onClick={() => setPromptOpen(true)}>
                ✦ AI instructions
              </Button>
            </>
          )}
        </div>

        {staleLinkCount > 0 && (
          <div
            style={{
              marginTop: 12,
              background: 'var(--warning-100)',
              border: '1px solid var(--warning-700)',
              borderRadius: 'var(--radius-md)',
              padding: '10px 14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ fontSize: 12.5, color: 'var(--warning-700)', minWidth: 0 }}>
              The registration link changed since this copy was written — {staleLinkCount} message{staleLinkCount === 1 ? '' : 's'} still point
              {staleLinkCount === 1 ? 's' : ''} at the old one. Current link: <strong>{currentLink}</strong>
            </div>
            <Button hierarchy="secondary" size="sm" onClick={repairStaleLinks} disabled={repairing}>
              {repairing ? 'Updating…' : 'Update links'}
            </Button>
          </div>
        )}

        {notice && (
          <div style={{ marginTop: 12, fontSize: 12.5, color: notice.tone === 'good' ? 'var(--success-700)' : 'var(--danger-500)' }}>{notice.text}</div>
        )}

        {showTemplate && (
          <div style={{ marginTop: 12, background: 'var(--n10)', borderRadius: 'var(--radius-md)', padding: 14 }}>
            <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--n60)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
              Base template · {activeStepLabel}
            </div>
            {templateSubject && <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--n90)', marginBottom: 6 }}>{templateSubject}</div>}
            <div style={{ fontSize: 12.5, color: 'var(--n70)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{templateBody}</div>
          </div>
        )}
      </div>

      {rows.length === 0 ? (
        <div style={{ background: '#fff', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)', padding: '32px 24px', textAlign: 'center', fontSize: 13, color: 'var(--n60)' }}>
          No approved contacts yet — approve some on the Scoring tab, then personalize.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 320px) minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
          {/* Recipient list */}
          <div style={{ background: '#fff', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)', overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--n90)' }}>Recipients</span>
              <span style={{ fontSize: 11.5, color: 'var(--n60)' }}>
                {generatedCount} of {rows.length} written
              </span>
            </div>
            <div style={{ maxHeight: 560, overflowY: 'auto' }}>
              {rows.map((r) => {
                const active = r.contactId === selectedId;
                const meta = r.message ? statusMeta[r.message.status] ?? statusMeta.draft : null;
                return (
                  <div
                    key={r.contactId}
                    onClick={() => setSelectedId(r.contactId)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '10px 16px',
                      cursor: 'pointer',
                      borderLeft: active ? '3px solid var(--accent-500)' : '3px solid transparent',
                      background: active ? 'var(--accent-50)' : 'transparent',
                      borderBottom: '1px solid var(--border-subtle)',
                    }}
                  >
                    <Avatar name={r.name} size={30} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--n90)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--n60)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.seniority} · {r.account}
                      </div>
                    </div>
                    {r.message?.linkStale ? (
                      <Badge color="warning" text="Old link" />
                    ) : meta ? (
                      <Badge color={meta.color} text={meta.label} />
                    ) : (
                      <span style={{ fontSize: 10.5, color: 'var(--n50)' }}>—</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Editable preview */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {!selected ? null : !selected.message ? (
              <div style={{ background: '#fff', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)', padding: '28px 24px', textAlign: 'center' }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--n90)', marginBottom: 6 }}>Nothing written for {selected.name} yet</div>
                <div style={{ fontSize: 12.5, color: 'var(--n60)', marginBottom: 16 }}>Generate the whole step, or just this one recipient.</div>
                <Button hierarchy="secondary" size="sm" onClick={() => regenerate(selected.contactId)} disabled={busyRow === selected.contactId}>
                  {busyRow === selected.contactId ? 'Writing…' : 'Write this one'}
                </Button>
              </div>
            ) : (
              <>
                <div style={{ background: '#fff', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)', padding: '18px 20px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--n90)' }}>{selected.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--n60)' }}>
                        {selected.title} · {selected.account} · {selected.vertical}
                        {selected.score !== null ? ` · score ${selected.score}` : ''}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <Button hierarchy="tertiary" size="sm" onClick={() => regenerate(selected.contactId)} disabled={busyRow === selected.contactId}>
                        {busyRow === selected.contactId ? 'Rewriting…' : 'Regenerate'}
                      </Button>
                      <Button hierarchy={dirty ? 'primary' : 'secondary'} size="sm" onClick={save} disabled={saving || !dirty}>
                        {saving ? 'Saving…' : dirty ? 'Save edit' : 'Saved'}
                      </Button>
                      {selected.message.status !== 'reviewed' && (
                        <Button hierarchy={dirty ? 'secondary' : 'primary'} size="sm" onClick={review}>
                          Mark reviewed
                        </Button>
                      )}
                    </div>
                  </div>

                  {selected.message.rationale && (
                    <div style={{ display: 'flex', gap: 9, background: 'var(--accent-50)', borderRadius: 'var(--radius-md)', padding: '10px 12px', marginBottom: 14 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent-700)', letterSpacing: '0.05em', flexShrink: 0, paddingTop: 2 }}>ANGLE</span>
                      <span style={{ fontSize: 12.5, color: 'var(--n80)', lineHeight: 1.5 }}>{selected.message.rationale}</span>
                    </div>
                  )}

                  {activeChannel === 'email' && (
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: 12, color: 'var(--n60)', marginBottom: 6 }}>Subject</div>
                      <input className="lsq-input" type="text" value={selected.message.subject ?? ''} onChange={(e) => patchSelected({ subject: e.target.value })} />
                    </div>
                  )}
                  <div>
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
                      <div style={{ fontSize: 12, color: 'var(--n60)' }}>{activeChannel === 'linkedin' ? 'LinkedIn message' : 'Email body'}</div>
                      <div style={{ fontSize: 11, color: 'var(--n50)', fontVariantNumeric: 'tabular-nums' }}>
                        {selected.message.body.length} chars · {selected.message.body.trim().split(/\s+/).length} words
                      </div>
                    </div>
                    <textarea className="lsq-input" rows={activeChannel === 'linkedin' ? 5 : 9} value={selected.message.body} onChange={(e) => patchSelected({ body: e.target.value })} />
                  </div>
                </div>

                {/* What the AI was given — makes the personalization auditable */}
                <div style={{ background: '#fff', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)', padding: '16px 20px' }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--n90)', marginBottom: 10 }}>Signals used for {selected.name.split(' ')[0]}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: selected.personaNote ? 10 : 0 }}>
                    <Signal label="Seniority" value={selected.seniority} />
                    <Signal label="Function" value={selected.function} />
                    <Signal label="Industry" value={selected.vertical} />
                    <Signal label="Company" value={selected.account} />
                    <Signal label="Channel" value={activeChannel === 'linkedin' ? 'LinkedIn DM' : 'Email'} />
                  </div>
                  {selected.personaNote && (
                    <div style={{ fontSize: 12, color: 'var(--n70)', lineHeight: 1.55, background: 'var(--n10)', borderRadius: 'var(--radius-sm)', padding: '9px 11px' }}>
                      <strong style={{ color: 'var(--n90)' }}>Persona note:</strong> {selected.personaNote}
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: 'var(--n50)', marginTop: 10, lineHeight: 1.5 }}>
                    Years of experience and LinkedIn profile content aren&apos;t available in this build, so the AI is told not to
                    invent them — it personalizes on the signals above and the campaign brief for {campaignName}.
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {promptOpen && (
        <PromptModal
          campaignId={campaignId}
          campaignName={campaignName}
          prompt={savedPrompt}
          onClose={() => setPromptOpen(false)}
          onSaved={(next) => {
            setSavedPrompt(next);
            setPromptOpen(false);
            setNotice({ tone: 'good', text: 'Saved. Regenerate to apply the new instructions to existing drafts.' });
          }}
        />
      )}
    </div>
  );
}

function Signal({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: 'var(--n10)', borderRadius: 'var(--radius-sm)', padding: '5px 9px' }}>
      <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--n60)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
      <span style={{ fontSize: 12, color: 'var(--n90)', fontWeight: 600, marginLeft: 6 }}>{value}</span>
    </div>
  );
}
