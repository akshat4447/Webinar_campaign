'use client';
import { useState } from 'react';
import { confirmDeliveryOutcomeAction } from '@/lib/actions/jobs';
type Row = { id: string; stepKey: string; status: string; recipient: string | null; renderedSubject: string | null; renderedBody: string | null; providerMessageId: string | null; deliveryOutcome: string | null; error: string | null };
export function DeliveryHistory({ campaignId, rows }: { campaignId: string; rows: Row[] }) {
  const [error, setError] = useState('');
  const [evidence, setEvidence] = useState<Record<string,string>>({});
  const [resolved, setResolved] = useState<Record<string,string>>({});
  async function confirm(row: Row, outcome: 'accepted' | 'rejected') {
    try { await confirmDeliveryOutcomeAction(campaignId, row.id, outcome, evidence[row.id] || ''); setResolved(prev => ({...prev,[row.id]:outcome})); }
    catch(err) { setError(err instanceof Error ? err.message : 'Confirmation failed.'); }
  }
  return <section className="lsq-card">
<div className="lsq-card__header">
<h2 className="lsq-card__title">Delivery history</h2>
<p className="lsq-hint">Latest 50 messages. Accepted means the provider accepted the request; queued means CRM automation received the trigger.</p>
</div>
<div className="lsq-card__body">
    {error && <p role="alert">{error}</p>}{!rows.length && <p>No dispatch attempts yet.</p>}
    {rows.map(row => <details key={row.id} className="lsq-wiz-details">
<summary>{row.recipient || 'Unresolved recipient'} · {row.stepKey} · {resolved[row.id] || row.deliveryOutcome || row.status}</summary>
<p>{row.renderedSubject}</p>
<pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{row.renderedBody || 'Rendered content has not been recorded yet.'}</pre>{row.providerMessageId && <p>Provider receipt: {row.providerMessageId}</p>}{row.error && <p>{row.error}</p>}
      {row.status === 'unknown' && !resolved[row.id] && <div>
<label className="lsq-field">Provider receipt or rejection evidence<input className="lsq-input" value={evidence[row.id] || ''} onChange={e=>setEvidence(prev=>({...prev,[row.id]:e.target.value}))} />
</label>
<p className="lsq-hint">Confirm only after checking the provider. A rejected message returns to the queue.</p>
<button type="button" className="lsq-btn lsq-btn--secondary" onClick={()=>confirm(row,'accepted')}>Confirm accepted</button>
<button type="button" className="lsq-btn lsq-btn--secondary" onClick={()=>confirm(row,'rejected')}>Confirm rejected and retry</button>
</div>}
    </details>)}
  </div>
</section>;
}
