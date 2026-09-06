'use client';

import { useState } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Checkbox } from '@/components/ui/Checkbox';
import { Button } from '@/components/ui/Button';
import { NavButton } from '@/components/ui/NavButton';
import { setApprovalAction, bulkSetApprovalAction, updateContactPhoneAction } from '@/lib/actions/scoring';
import { verifyInferredEmailsAction } from '@/lib/actions/enrichment';
import { useRouter } from 'next/navigation';
import type { Contact } from '@/lib/generated/prisma/client';

function scoreColor(score: number): string {
  if (score >= 85) return 'var(--success-700)';
  if (score >= 70) return 'var(--accent-500)';
  return 'var(--warning-700)';
}

function sourceColor(source: string): string {
  if (source === 'LinkedIn') return 'gray blue';
  if (source === 'LinkedIn+Apollo') return 'blue light';
  return 'gray';
}

export function ScoringTable({ campaignId, contacts: initialContacts, threshold }: { campaignId: string; contacts: Contact[]; threshold: number }) {
  const [contacts, setContacts] = useState(initialContacts);
  const [seen, setSeen] = useState(initialContacts);
  const [verifying, setVerifying] = useState(false);

  // Search, band filter and paging are executed by the database now and arrive
  // as props, so a new page must replace local state rather than be filtered
  // on top of.
  if (seen !== initialContacts) {
    setSeen(initialContacts);
    setContacts(initialContacts);
  }
  const router = useRouter();

  const unverifiedCount = contacts.filter((c) => c.emailSimulated && !c.emailVerified).length;

  async function verifyInferred() {
    setVerifying(true);
    await verifyInferredEmailsAction(campaignId);
    setContacts((cs) => cs.map((c) => (c.emailSimulated && !c.emailVerified ? { ...c, emailVerified: true } : c)));
    setVerifying(false);
    router.refresh();
  }

  // "Filtered" is now simply the page the server sent.
  const filtered = contacts;
  const approvedCount = contacts.filter((c) => c.approved).length;
  const allFilteredApproved = filtered.length > 0 && filtered.every((c) => c.approved);

  function toggle(c: Contact) {
    const next = !c.approved;
    setContacts((cs) => cs.map((x) => (x.id === c.id ? { ...x, approved: next } : x)));
    setApprovalAction(c.id, next);
  }

  function bulkSet(checked: boolean) {
    const ids = filtered.map((c) => c.id);
    setContacts((cs) => cs.map((x) => (ids.includes(x.id) ? { ...x, approved: checked } : x)));
    bulkSetApprovalAction(ids, checked);
  }

  function exportCsv() {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['Name', 'Account', 'Title', 'Function', 'Seniority', 'Vertical', 'Email', 'Source', 'Score', 'Approved'];
    const lines = [head.map(esc).join(',')].concat(
      filtered.map((c) => [c.name, c.account, c.title, c.function, c.seniority, c.vertical, c.email ?? '', c.source, c.score ?? '', c.approved ? 'Yes' : 'No'].map(esc).join(','))
    );
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'scored-invite-list.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  }

  return (
    <div style={{ background: '#fff', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)', overflow: 'hidden' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 'var(--fs-body)', fontWeight: 700, color: 'var(--n90)' }}>Scored invite list</div>
            <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--n60)', marginTop: 2 }}>
              {filtered.length} of {contacts.length} contacts shown
            </div>
          </div>
          <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--n70)', fontWeight: 600 }}>
            {approvedCount} of {contacts.length} approved
          </div>
        </div>
        
        {unverifiedCount > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'var(--warning-100)', borderRadius: 'var(--radius-md)', padding: '12px 14px', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ fontSize: 'var(--fs-label-1)', fontWeight: 700, color: 'var(--warning-700)', marginBottom: 2 }}>
                {unverifiedCount} inferred email{unverifiedCount === 1 ? '' : 's'} need verification
              </div>
              <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--n70)', lineHeight: 1.5 }}>
                Pattern-guessed from a name and company by enrichment — not supplied by the source. They can&apos;t be sent to
                until you confirm them.
              </div>
            </div>
            <Button hierarchy="secondary" size="sm" onClick={verifyInferred} disabled={verifying}>
              {verifying ? 'Verifying…' : `Verify ${unverifiedCount} email${unverifiedCount === 1 ? '' : 's'}`}
            </Button>
          </div>
        )}
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table className="lsq-table" style={{ width: '100%', minWidth: 900, borderCollapse: 'collapse', fontSize: 'var(--fs-label-1)' }}>
          <thead>
            <tr style={{ textAlign: 'left' }}>
              <th style={{ padding: '10px 20px', width: 20 }}>
                <Checkbox checked={allFilteredApproved} onChange={bulkSet} size={16} />
              </th>
              <th style={thStyle}>Contact</th>
              <th style={thStyle}>Account · vertical</th>
              <th style={thStyle}>Title / function</th>
              <th style={thStyle}>Source</th>
              <th style={thStyle}>Mobile (SMS/WA)</th>
              <th style={thStyle}>Relevance</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => {
              const score = c.score ?? 0;
              return (
                <tr key={c.id} style={{ borderTop: '1px solid var(--border-subtle)', opacity: c.approved ? 1 : 0.5 }}>
                  <td style={{ padding: '12px 20px' }}>
                    <Checkbox checked={c.approved} onChange={() => toggle(c)} />
                  </td>
                  <td style={{ padding: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <Avatar name={c.name} />
                      <div>
                        <div style={{ fontWeight: 600, color: 'var(--n90)' }}>{c.name}</div>
                        <div style={{ fontSize: 'var(--fs-label-2)', color: c.emailSimulated && !c.emailVerified ? 'var(--warning-700)' : 'var(--n60)' }}>
                          {c.seniority} ·{' '}
                          {c.emailSimulated
                            ? c.emailVerified
                              ? 'inferred · verified'
                              : 'inferred · needs verification'
                            : c.missingInfo
                            ? 'email missing'
                            : 'verified email'}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: 12, color: 'var(--n70)' }}>
                    {c.account}
                    <br />
                    <span style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n60)' }}>{c.vertical}</span>
                  </td>
                  <td style={{ padding: 12, color: 'var(--n70)' }}>
                    {c.title}
                    <br />
                    <span style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n60)' }}>{c.function}</span>
                  </td>
                  <td style={{ padding: 12 }}>
                    <Badge color={sourceColor(c.source)} text={c.source} />
                  </td>
                  <td style={{ padding: 12 }}>
                    <PhoneCell
                      contactId={c.id}
                      initial={c.phone ?? ''}
                      onChange={(phone) => setContacts((cs) => cs.map((x) => (x.id === c.id ? { ...x, phone: phone || null } : x)))}
                    />
                  </td>
                  <td style={{ padding: 12, minWidth: 170, whiteSpace: 'nowrap' }} title={[c.explanation, c.personaNote].filter(Boolean).join('\n\n') || undefined}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ background: 'var(--n20)', borderRadius: 'var(--radius-full)', height: 6, overflow: 'hidden', width: 70, flexShrink: 0 }}>
                        <div style={{ width: `${score}%`, height: '100%', background: scoreColor(score), borderRadius: 'var(--radius-full)' }} />
                      </div>
                      <span className="lsq-num" style={{ fontSize: 'var(--fs-label-1)', fontWeight: 700, color: scoreColor(score), width: 22, flexShrink: 0, textAlign: 'right' }}>{score}</span>
                      {score >= threshold && <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, color: 'var(--success-700)', flexShrink: 0 }}>AUTO</span>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && <div style={{ padding: '28px 20px', textAlign: 'center', fontSize: 'var(--fs-label-1)', color: 'var(--n60)' }}>No contacts match these filters.</div>}
      </div>

      <div style={{ padding: '16px 20px', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <Button hierarchy="secondary" onClick={exportCsv}>
          Export list (.csv)
        </Button>
        <NavButton href={`/campaigns/${campaignId}/messaging`}>Approve &amp; continue to messaging</NavButton>
      </div>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: '10px 12px',
  fontSize: 'var(--fs-label-2)',
  fontWeight: 600,
  color: 'var(--n60)',
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
};

/** Inline mobile editor — saves on blur/Enter; feeds the SMS/WhatsApp channels. */
function PhoneCell({ contactId, initial, onChange }: { contactId: string; initial: string; onChange: (phone: string) => void }) {
  const [draft, setDraft] = useState(initial);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (draft.trim() === initial.trim()) return;
    setState('saving');
    const res = await updateContactPhoneAction(contactId, draft);
    if (!res.ok) {
      setState('error');
      setError(res.error ?? 'Could not save.');
      return;
    }
    onChange(draft.trim());
    setState('saved');
    setError(null);
    setTimeout(() => setState('idle'), 1500);
  }

  return (
    <div>
      <input
        className="lsq-input"
        type="tel"
        value={draft}
        placeholder="add mobile…"
        onChange={(e) => {
          setDraft(e.target.value);
          if (state === 'saved') setState('idle');
        }}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        style={{ width: 140, height: 28, fontSize: 'var(--fs-label-1)' }}
      />
      {state === 'saving' && <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n60)', marginTop: 2 }}>saving…</div>}
      {state === 'saved' && <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--success-700)', marginTop: 2 }}>saved ✓</div>}
      {state === 'error' && <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--danger-500)', marginTop: 2 }}>{error}</div>}
    </div>
  );
}
