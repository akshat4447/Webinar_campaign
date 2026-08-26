'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { fetchLsqLeadByEmailAction, importLsqLeadByEmailAction, type LsqLeadLookup } from '@/lib/actions/setup';

/**
 * Pulls ONE lead's full record straight off the LeadSquared platform by email
 * and imports it into this campaign with every detail attached (phone,
 * company, designation + the existing LSQ lead id so future syncs update in
 * place instead of duplicating).
 */
export function SingleLeadLookupCard({ campaignId }: { campaignId: string }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [lead, setLead] = useState<LsqLeadLookup | null>(null);
  const [busy, setBusy] = useState<'fetch' | 'import' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function fetchLead() {
    setBusy('fetch');
    setError(null);
    setLead(null);
    setDone(null);
    const res = await fetchLsqLeadByEmailAction(email);
    if (res.ok) {
      setLead(res.lead);
    } else {
      setError(res.error);
    }
    setBusy(null);
  }

  async function importLead() {
    if (!lead) return;
    setBusy('import');
    const res = await importLsqLeadByEmailAction(campaignId, lead.email || email);
    setBusy(null);
    if (!res.ok) {
      setError(res.error ?? 'Import failed.');
      return;
    }
    setDone(`${lead.name} ${res.mode === 'updated' ? 'updated in place' : 'added to the campaign'} — phone, company, title and LSQ lead id all linked.`);
    setLead(null);
    setEmail('');
    router.refresh();
  }

  return (
    <div style={{ background: '#fff', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)', padding: '16px 18px' }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--n90)', marginBottom: 4 }}>Fetch a lead from LeadSquared</div>
      <div style={{ fontSize: 12, color: 'var(--n60)', lineHeight: 1.5, marginBottom: 10 }}>
        Enter a lead&apos;s email — their full record is pulled live from the platform (name, phone, company, designation, LSQ id) and imported
        here ready for scoring and outreach.
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          className="lsq-input"
          type="email"
          placeholder="lead.email@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && email.trim()) fetchLead();
          }}
          style={{ flex: 1, minWidth: 0 }}
        />
        <Button hierarchy="secondary" size="sm" onClick={fetchLead} disabled={busy !== null || !email.trim()}>
          {busy === 'fetch' ? 'Fetching…' : 'Fetch'}
        </Button>
      </div>

      {error && <div style={{ fontSize: 12, color: 'var(--danger-500)', marginTop: 8 }}>{error}</div>}

      {lead && (
        <div style={{ marginTop: 12, border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--n90)' }}>{lead.name}</div>
            {lead.lsqLeadId && <Badge color="blue" text="LSQ lead matched" dot />}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '90px minmax(0,1fr)', gap: '4px 10px', fontSize: 12 }}>
            <span style={{ color: 'var(--n50)' }}>Email</span>
            <span style={{ color: 'var(--n80)', overflowWrap: 'anywhere' }}>{lead.email}</span>
            <span style={{ color: 'var(--n50)' }}>Phone</span>
            <span style={{ color: lead.phone ? 'var(--n80)' : 'var(--warning-700)' }}>{lead.phone || '— missing on platform'}</span>
            <span style={{ color: 'var(--n50)' }}>Company</span>
            <span style={{ color: 'var(--n80)' }}>{lead.account || '—'}</span>
            <span style={{ color: 'var(--n50)' }}>Title</span>
            <span style={{ color: 'var(--n80)' }}>{lead.title || '—'}</span>
            {lead.extra.slice(0, 4).map(([k, v]) => (
              <span key={k} style={{ display: 'contents' }}>
                <span style={{ color: 'var(--n50)' }}>{k}</span>
                <span style={{ color: 'var(--n70)', overflowWrap: 'anywhere' }}>{v}</span>
              </span>
            ))}
          </div>
          <Button hierarchy="primary" size="sm" style={{ marginTop: 10 }} onClick={importLead} disabled={busy !== null}>
            {busy === 'import' ? 'Importing…' : 'Add to campaign'}
          </Button>
        </div>
      )}

      {done && (
        <div style={{ fontSize: 12, color: 'var(--success-700)', marginTop: 10, lineHeight: 1.5 }}>
          ✓ {done}
        </div>
      )}
    </div>
  );
}