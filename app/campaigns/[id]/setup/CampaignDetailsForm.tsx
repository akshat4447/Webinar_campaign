'use client';

import { useState, useTransition } from 'react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { updateCampaignName, updateCampaignSchedule, updateCampaignDescription, updateCampaignZoomLink } from '@/lib/actions/setup';
import { improveDescriptionAction } from '@/lib/actions/description';
import { toDateTimeLocal, parseLegacyWebinarDate, reminderDates } from '@/lib/campaignDate';
import type { Campaign } from '@/lib/generated/prisma/client';

export function CampaignDetailsForm({ campaign, serverNow }: { campaign: Campaign; serverNow: number }) {
  const [name, setName] = useState(campaign.name);
  const [description, setDescription] = useState(campaign.description ?? '');
  const [zoomLink, setZoomLink] = useState(campaign.zoomLink ?? '');
  const [linkState, setLinkState] = useState<{ kind: 'zoom' | 'other' | 'empty'; host?: string } | { error: string } | null>(
    campaign.zoomLink ? { kind: 'zoom' } : null
  );
  // Fall back to parsing the legacy display string so campaigns created before
  // the picker existed still show their date rather than an empty field.
  const initial = campaign.scheduledAt ?? parseLegacyWebinarDate(campaign.date);
  const [when, setWhen] = useState(toDateTimeLocal(initial));
  const [display, setDisplay] = useState(campaign.date);
  const [autosave, setAutosave] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [improving, setImproving] = useState(false);
  const [improveError, setImproveError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function save(fn: () => Promise<unknown>) {
    setAutosave('saving');
    startTransition(async () => {
      await fn();
      setAutosave('saved');
    });
  }

  function saveWhen(value: string) {
    setWhen(value);
    setAutosave('saving');
    startTransition(async () => {
      const res = await updateCampaignSchedule(campaign.id, value);
      if (res.ok) setDisplay(res.display);
      setAutosave('saved');
    });
  }

  function saveLink() {
    setAutosave('saving');
    startTransition(async () => {
      const res = await updateCampaignZoomLink(campaign.id, zoomLink);
      setLinkState(res.ok ? { kind: res.kind, host: 'host' in res ? res.host : undefined } : { error: res.error });
      setAutosave('saved');
    });
  }

  async function improve() {
    setImproving(true);
    setImproveError(null);
    const res = await improveDescriptionAction(campaign.id, description);
    setImproving(false);
    if (!res.ok) {
      setImproveError(res.error);
      return;
    }
    setDescription(res.description);
    save(() => updateCampaignDescription(campaign.id, res.description));
  }

  const scheduled = when ? new Date(when) : null;
  const valid = scheduled && !Number.isNaN(scheduled.getTime());
  const reminders = valid ? reminderDates(scheduled) : null;
  // `serverNow` comes from the server render rather than Date.now() here —
  // reading the clock during render is impure and would mismatch on hydration.
  const isPast = valid ? scheduled.getTime() < serverNow : false;

  const fmt = (d: Date) => d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--n90)' }}>Webinar details</div>
        {autosave !== 'idle' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 600, color: autosave === 'saving' ? 'var(--warning-700)' : 'var(--success-700)' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: autosave === 'saving' ? 'var(--warning-700)' : 'var(--success-500)', flexShrink: 0 }} />
            {autosave === 'saving' ? 'Saving…' : 'Saved'}
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 16 }}>
        {/* Event link first — pasting it is the natural first action */}
        <div>
          <div style={{ fontSize: 12, color: 'var(--n60)', marginBottom: 6 }}>Zoom webinar or event link</div>
          <input
            className="lsq-input"
            type="url"
            inputMode="url"
            placeholder="https://your-org.zoom.us/webinar/register/WN_xxxxxxxx"
            value={zoomLink}
            onChange={(e) => setZoomLink(e.target.value)}
            onBlur={saveLink}
          />
          {linkState && 'error' in linkState && <div style={{ fontSize: 11.5, color: 'var(--danger-500)', marginTop: 6 }}>{linkState.error}</div>}
          {linkState && 'kind' in linkState && linkState.kind === 'zoom' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
              <Badge color="success" text="Zoom link recognised" />
              <span style={{ fontSize: 11.5, color: 'var(--n60)' }}>Used as the join link in reminder emails.</span>
            </div>
          )}
          {linkState && 'kind' in linkState && linkState.kind === 'other' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
              <Badge color="blue" text={linkState.host ?? 'Custom host'} />
              <span style={{ fontSize: 11.5, color: 'var(--n60)' }}>Not a Zoom URL — saved anyway and used as the join link.</span>
            </div>
          )}
        </div>

        <div>
          <div style={{ fontSize: 12, color: 'var(--n60)', marginBottom: 6 }}>Webinar topic</div>
          <input className="lsq-input" type="text" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => save(() => updateCampaignName(campaign.id, name))} />
        </div>

        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
            <div style={{ fontSize: 12, color: 'var(--n60)' }}>Webinar description</div>
            <Button hierarchy="secondary-color" size="sm" onClick={improve} disabled={improving}>
              {improving ? 'Improving…' : '✦ Improve with AI'}
            </Button>
          </div>
          <textarea
            className="lsq-input"
            rows={4}
            placeholder="What the session covers, who it's for, and what they'll walk away able to do. Rough notes are fine — Improve with AI will tidy them up."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={() => save(() => updateCampaignDescription(campaign.id, description))}
          />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 6 }}>
            <span style={{ fontSize: 11, color: 'var(--n50)' }}>Claude uses this when scoring relevance and writing templates.</span>
            <span style={{ fontSize: 11, color: 'var(--n50)', fontVariantNumeric: 'tabular-nums' }}>{description.length} chars</span>
          </div>
          {improveError && <div style={{ fontSize: 11.5, color: 'var(--danger-500)', marginTop: 6 }}>{improveError}</div>}
        </div>

        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
            <div style={{ fontSize: 12, color: 'var(--n60)' }}>Date &amp; time</div>
            <div style={{ fontSize: 11.5, color: 'var(--n50)' }}>{display}</div>
          </div>
          <input className="lsq-input" type="datetime-local" value={when} onChange={(e) => saveWhen(e.target.value)} style={{ height: 38 }} />
          {isPast && (
            <div style={{ fontSize: 11.5, color: 'var(--warning-700)', marginTop: 6 }}>
              This date is in the past — reminder steps would all be overdue the moment the cadence launches.
            </div>
          )}
          {reminders && !isPast && (
            <div style={{ marginTop: 10, background: 'var(--n10)', borderRadius: 'var(--radius-sm)', padding: '10px 12px' }}>
              <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--n60)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
                Reminders resolve to
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 18px', fontSize: 11.5, color: 'var(--n70)' }}>
                <span>
                  <strong style={{ color: 'var(--n90)' }}>T-3d</strong> {fmt(reminders.t3)}
                </span>
                <span>
                  <strong style={{ color: 'var(--n90)' }}>T-1d</strong> {fmt(reminders.t1d)}
                </span>
                <span>
                  <strong style={{ color: 'var(--n90)' }}>T-1h</strong> {fmt(reminders.t1h)}
                </span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--n50)', marginTop: 6 }}>Change any of these per-step on the Schedule tab.</div>
            </div>
          )}
        </div>

        <div>
          <div style={{ fontSize: 12, color: 'var(--n60)', marginBottom: 6 }}>Registration link (bot-led sign-up)</div>
          <input className="lsq-input" type="text" defaultValue={campaign.registrationLink ?? ''} readOnly style={{ background: 'var(--n10)', color: 'var(--n60)' }} />
        </div>
      </div>
    </Card>
  );
}
