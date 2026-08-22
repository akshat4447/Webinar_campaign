'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { updatePersonalizationPromptAction, getDefaultPersonalizationPromptAction } from '@/lib/actions/personalize';

const ALWAYS_TRUE = [
  "Keeps the template's offer and registration link exactly as given — never altered, shortened, or dropped.",
  'Personalizes only from real data on file: title, seniority, function, company, industry, and why the contact scored as they did — never invents an initiative, a connection, or a metric.',
  'Writes the real name and company into the message — no {{merge}} tokens left behind.',
  "Matches the channel's format: LinkedIn stays under 60 words with no subject line; email keeps a subject under 60 characters and a body under 120 words.",
];

export function PromptModal({
  campaignId,
  campaignName,
  prompt,
  onClose,
  onSaved,
}: {
  campaignId: string;
  campaignName: string;
  prompt: string;
  onClose: () => void;
  onSaved: (prompt: string) => void;
}) {
  const [text, setText] = useState(prompt);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const dirty = text !== prompt;

  async function save() {
    if (!dirty) return;
    setSaving(true);
    await updatePersonalizationPromptAction(campaignId, text);
    setSaving(false);
    onSaved(text);
  }

  async function reset() {
    setResetting(true);
    const defaultText = await getDefaultPersonalizationPromptAction();
    setResetting(false);
    setText(defaultText);
  }

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(16,20,25,0.45)', zIndex: 1200 }} />
      <div
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 600,
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
        <div style={{ flexShrink: 0, padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'start', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--n90)' }}>How Claude drafts these messages</div>
            <div style={{ fontSize: 12, color: 'var(--n60)', marginTop: 3 }}>{campaignName}</div>
          </div>
          <div onClick={onClose} style={{ cursor: 'pointer', width: 28, height: 28, borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Icon name="close" size={16} style={{ color: 'var(--n60)' }} />
          </div>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: '18px 20px 20px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--n60)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
              Always true, regardless of what&apos;s below
            </div>
            <div style={{ background: 'var(--n10)', borderRadius: 'var(--radius-md)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {ALWAYS_TRUE.map((line, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, fontSize: 12.5, color: 'var(--n70)', lineHeight: 1.5 }}>
                  <span style={{ flexShrink: 0 }}>•</span>
                  <span>{line}</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--n60)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
              Personalization instructions for this webinar
            </div>
            <textarea
              className="lsq-input"
              rows={7}
              value={text}
              onChange={(e) => setText(e.target.value)}
              style={{ width: '100%' }}
            />
            <div style={{ fontSize: 11.5, color: 'var(--n50)', marginTop: 8, lineHeight: 1.5 }}>
              Applies to every step on this webinar — invite, nudge, follow-ups, and LinkedIn. Existing drafts aren&apos;t rewritten
              automatically; use Regenerate to apply new instructions.
            </div>
          </div>
        </div>

        <div style={{ flexShrink: 0, padding: '14px 20px', borderTop: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <Button hierarchy="tertiary" size="sm" onClick={reset} disabled={resetting || saving}>
            {resetting ? 'Resetting…' : 'Reset to default'}
          </Button>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button hierarchy="secondary" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button hierarchy="primary" size="sm" onClick={save} disabled={!dirty || saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
