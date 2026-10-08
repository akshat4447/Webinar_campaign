'use client';
import { useEffect, useState } from 'react';
import { getCampaignJobsAction, updateCampaignJobAction, confirmOperationOutcomeAction } from '@/lib/actions/jobs';
export function CampaignJobs({ campaignId }: { campaignId: string }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof getCampaignJobsAction>> | null>(null);
  const [error, setError] = useState('');
  const [evidence,setEvidence] = useState<Record<string,string>>({});
  const confirm=async(key:string,outcome:'accepted'|'rejected')=>{try{await confirmOperationOutcomeAction(campaignId,key,outcome,evidence[key]||'');setData(await getCampaignJobsAction(campaignId));}catch(err){setError(err instanceof Error?err.message:'Confirmation failed.');}};
  useEffect(() => {
    let active = true;
    const refresh = async () => { try { const next = await getCampaignJobsAction(campaignId); if (active) setData(next); } catch { if (active) setError('Could not refresh background job status.'); } };
    void refresh(); const timer = setInterval(refresh, 10_000);
    return () => { active = false; clearInterval(timer); };
  }, [campaignId]);
  const change = async (id: string, action: 'cancel' | 'retry') => { try { await updateCampaignJobAction(campaignId, id, action); setData(await getCampaignJobsAction(campaignId)); } catch (err) { setError(err instanceof Error ? err.message : 'Job update failed.'); } };
  if (!data) return error ? <p role="alert">{error}</p> : null;
  const jobs = data.jobs.filter(j => j.status !== 'completed' && j.status !== 'cancelled');
  return <section className="lsq-card lsq-card__body" aria-label="Background work">
<h2 className="lsq-card__title">Background work</h2>
    <p className="lsq-hint">{data.heartbeat ? `Last worker run: ${new Date(data.heartbeat.timestamp).toLocaleString()} · ${data.heartbeat.ok ? 'completed' : 'needs attention'}` : 'No background worker run recorded yet.'}</p>
    {error && <p role="alert">{error}</p>}
    {data.registrationFailures > 0 && <p>{data.registrationFailures} registration sync jobs need attention. Blocked or failed jobs retry automatically; uncertain CRM outcomes require provider review.</p>}
    {data.unknownSends > 0 && <p role="alert">{data.unknownSends} messages have uncertain provider outcomes. Check the provider before retrying; see delivery history in Results.</p>}
    {data.uncertainOperations.map(attempt => <details key={attempt.key}>
<summary>Uncertain {attempt.provider} operation · {attempt.sendId}</summary>
<p>{attempt.error}</p>
<label className="lsq-field">Provider receipt or rejection evidence
<input className="lsq-input" value={evidence[attempt.key]||''} onChange={e=>setEvidence(prev=>({...prev,[attempt.key]:e.target.value}))}/>
</label>
<button type="button" className="lsq-btn lsq-btn--secondary lsq-btn--sm" onClick={()=>confirm(attempt.key,'accepted')}>Confirm accepted</button>
<button type="button" className="lsq-btn lsq-btn--secondary lsq-btn--sm" onClick={()=>confirm(attempt.key,'rejected')}>Confirm rejected and retry</button>
</details>)}
    {jobs.map(j => <div key={j.id} className="lsq-toolbar">
<p>{j.kind}: {j.cursor}/{j.total} contacts · {j.status}{j.error ? ` · ${j.error}` : ''}</p>
<div>
{j.status === 'failed' &&
<button type="button" className="lsq-btn lsq-btn--secondary lsq-btn--sm" onClick={() => change(j.id, 'retry')}>Retry remaining</button>}
<button type="button" className="lsq-btn lsq-btn--tertiary lsq-btn--sm" onClick={() => change(j.id, 'cancel')}>Cancel job</button>
</div>
</div>)}
  </section>;
}
