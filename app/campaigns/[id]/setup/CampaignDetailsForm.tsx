'use client';

import { useState, useTransition } from 'react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { updateCampaignName, updateCampaignSchedule, updateCampaignDescription, updateCampaignZoomLink, updateCampaignRegistrationLink } from '@/lib/actions/setup';
import { improveDescriptionAction } from '@/lib/actions/description';
import { createZoomMeetingAction, linkZoomMeetingAction, listZoomMeetingsAction, unlinkZoomMeetingAction, type ZoomMeeting } from '@/lib/actions/zoom';
import { toDateTimeLocal, parseLegacyWebinarDate, reminderDates, formatWebinarDate } from '@/lib/campaignDate';
import type { Campaign } from '@/lib/generated/prisma/client';

export function CampaignDetailsForm({ campaign, serverNow, onDone }: { campaign: Campaign; serverNow: number; onDone?: () => void }) {
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
  const [registrationLink, setRegistrationLink] = useState(campaign.registrationLink ?? '');
  const [regLinkError, setRegLinkError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Zoom sync — fetching the event straight from a connected Zoom account,
  // rather than only ever pasting a link by hand.
  const [zoomMeetingId, setZoomMeetingId] = useState(campaign.zoomMeetingId);
  const [zoomMode, setZoomMode] = useState(campaign.zoomMode);
  const [zoomPicker, setZoomPicker] = useState<'closed' | 'browsing'>('closed');
  const [zoomMeetings, setZoomMeetings] = useState<ZoomMeeting[] | null>(null);
  const [zoomLoading, setZoomLoading] = useState(false);
  const [zoomBusy, setZoomBusy] = useState(false);
  const [zoomError, setZoomError] = useState<string | null>(null);
  const [zoomNote, setZoomNote] = useState<string | null>(null);

  async function browseZoomMeetings() {
    setZoomPicker('browsing');
    setZoomError(null);
    setZoomNote(null);
    if (zoomMeetings) return;
    setZoomLoading(true);
    const res = await listZoomMeetingsAction();
    setZoomLoading(false);
    if (!res.ok) {
      setZoomError(res.error);
      return;
    }
    setZoomMeetings(res.meetings);
    if (res.meetings.length === 0) setZoomError('No upcoming meetings found on this Zoom account.');
  }

  async function applyZoomMeeting(meetingId: string) {
    setZoomBusy(true);
    setZoomError(null);
    const res = await linkZoomMeetingAction(campaign.id, meetingId);
    setZoomBusy(false);
    if (!res.ok) {
      setZoomError(res.error);
      return;
    }
    // Everything the meeting carries lands in the same fields the manual
    // inputs edit, so the form reflects it immediately rather than needing a
    // refresh to catch up with what the server action just saved.
    setName(res.meeting.topic);
    setZoomLink(res.meeting.joinUrl);
    setLinkState({ kind: 'zoom' });
    setZoomMeetingId(res.meeting.id);
    setZoomMode('existing');
    if (res.meeting.startTime) {
      const start = new Date(res.meeting.startTime);
      setWhen(toDateTimeLocal(start));
      setDisplay(formatWebinarDate(start));
    }
    setZoomPicker('closed');
    setZoomNote(`Synced from Zoom: "${res.meeting.topic}".`);
  }

  async function createNewZoomMeeting() {
    setZoomBusy(true);
    setZoomError(null);
    setZoomNote(null);
    const res = await createZoomMeetingAction(campaign.id);
    setZoomBusy(false);
    if (!res.ok) {
      setZoomError(`Zoom meeting not created: ${res.error}`);
      return;
    }
    setZoomLink(res.meeting.joinUrl);
    setLinkState({ kind: 'zoom' });
    setZoomMeetingId(res.meeting.id);
    setZoomMode('new');
    setZoomNote(`Created "${res.meeting.topic}" on Zoom, from this webinar's current title, date and description.`);
  }

  async function unlinkZoom() {
    setZoomBusy(true);
    await unlinkZoomMeetingAction(campaign.id);
    setZoomBusy(false);
    setZoomMeetingId(null);
    setZoomMode(null);
    setZoomNote('Unlinked — the join link above is kept as a plain value.');
  }

  function save(fn: () => Promise<unknown>) {
    setAutosave('saving');
    startTransition(async () => {
      try {
        const res = await fn();
        if (res && typeof res === 'object' && 'ok' in res && !(res as { ok: boolean }).ok) {
          setAutosave('idle');
          return;
        }
        setAutosave('saved');
      } catch {
        setAutosave('idle');
      }
    });
  }

  function saveWhen(value: string) {
    setWhen(value);
    setAutosave('saving');
    startTransition(async () => {
      try {
        const res = await updateCampaignSchedule(campaign.id, value);
        if (res.ok) {
          setDisplay(res.display);
          setAutosave('saved');
        } else {
          setAutosave('idle');
        }
      } catch {
        setAutosave('idle');
      }
    });
  }

  function saveLink() {
    setAutosave('saving');
    startTransition(async () => {
      try {
        const res = await updateCampaignZoomLink(campaign.id, zoomLink);
        if (res.ok) {
          setLinkState({ kind: res.kind, host: 'host' in res ? res.host : undefined });
          setAutosave('saved');
        } else {
          setLinkState({ error: res.error });
          setAutosave('idle');
        }
      } catch {
        setAutosave('idle');
      }
    });
  }

  // Was previously a readOnly input with no save handler at all — pasting a
  // new link here had no effect. Any personalized copy that inlined the old
  // link is flagged stale on the Personalize tab (isLinkStale) and repaired
  // there with "Update links", rather than silently rewritten here.
  function saveRegistrationLink() {
    setRegLinkError(null);
    setAutosave('saving');
    startTransition(async () => {
      try {
        const res = await updateCampaignRegistrationLink(campaign.id, registrationLink);
        if (res.ok) {
          setAutosave('saved');
        } else {
          setRegLinkError(res.error);
          setAutosave('idle');
        }
      } catch {
        setAutosave('idle');
      }
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
        <div style={{ fontSize: 'var(--fs-body)', fontWeight: 700, color: 'var(--n90)' }}>Webinar details</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {autosave !== 'idle' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-label-2)', fontWeight: 600, color: autosave === 'saving' ? 'var(--warning-700)' : 'var(--success-700)' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: autosave === 'saving' ? 'var(--warning-700)' : 'var(--success-500)', flexShrink: 0 }} />
              {autosave === 'saving' ? 'Saving…' : 'Saved'}
            </div>
          )}
          {onDone && (
            <Button hierarchy="secondary" size="sm" onClick={onDone}>
              Done editing
            </Button>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 16 }}>
        {/* Event link first — pasting it is the natural first action */}
        <div>
          <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--n60)', marginBottom: 6 }}>Zoom webinar or event link</div>
          <input
            className="lsq-input"
            type="url"
            inputMode="url"
            placeholder="https://your-org.zoom.us/webinar/register/WN_xxxxxxxx"
            value={zoomLink}
            onChange={(e) => setZoomLink(e.target.value)}
            onBlur={saveLink}
          />
          {linkState && 'error' in linkState && <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--danger-500)', marginTop: 6 }}>{linkState.error}</div>}
          {zoomMeetingId ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              <Badge color="success" text={zoomMode === 'new' ? 'Created on Zoom' : 'Linked to Zoom'} />
              <span style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n60)' }}>
                Title, date and join link stay in sync with this Zoom meeting each time you re-fetch it.
              </span>
              <button
                type="button"
                onClick={unlinkZoom}
                disabled={zoomBusy}
                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 'var(--fs-label-2)', color: 'var(--n50)', textDecoration: 'underline' }}
              >
                Unlink
              </button>
            </div>
          ) : (
            <>
              {linkState && 'kind' in linkState && linkState.kind === 'zoom' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
                  <Badge color="success" text="Zoom link recognised" />
                  <span style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n60)' }}>Used as the join link in reminder emails.</span>
                </div>
              )}
              {linkState && 'kind' in linkState && linkState.kind === 'other' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
                  <Badge color="blue" text={linkState.host ?? 'Custom host'} />
                  <span style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n60)' }}>Not a Zoom URL — saved anyway and used as the join link.</span>
                </div>
              )}
            </>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <Button hierarchy="secondary" size="sm" onClick={browseZoomMeetings} disabled={zoomBusy}>
              {zoomMeetingId ? 'Fetch a different event' : 'Fetch from Zoom'}
            </Button>
            {!zoomMeetingId && (
              <Button hierarchy="secondary" size="sm" onClick={createNewZoomMeeting} disabled={zoomBusy}>
                {zoomBusy ? 'Creating…' : 'Create Zoom meeting'}
              </Button>
            )}
          </div>

          {zoomPicker === 'browsing' && (
            <div style={{ marginTop: 10 }}>
              {zoomLoading ? (
                <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n50)' }}>Loading meetings…</div>
              ) : zoomMeetings && zoomMeetings.length > 0 ? (
                <select
                  className="lsq-select"
                  style={{ width: '100%', height: 36 }}
                  value=""
                  disabled={zoomBusy}
                  onChange={(e) => e.target.value && applyZoomMeeting(e.target.value)}
                >
                  <option value="">Choose a meeting…</option>
                  {zoomMeetings.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.topic}
                      {m.startTime ? ` — ${new Date(m.startTime).toLocaleString('en-GB')}` : ''}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>
          )}
          {zoomError && <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--danger-500)', marginTop: 8 }}>{zoomError}</div>}
          {zoomNote && (
            <div style={{ display: 'flex', gap: 8, background: 'var(--success-100)', borderRadius: 'var(--radius-md)', padding: '10px 12px', marginTop: 8 }}>
              <span style={{ color: 'var(--success-700)', flexShrink: 0 }} aria-hidden="true">✓</span>
              <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--success-700)' }}>{zoomNote}</div>
            </div>
          )}
          <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n50)', marginTop: 8, lineHeight: 1.5 }}>
            Pulls straight from your connected Zoom account (Integrations → Zoom) — pick an upcoming meeting to link, or
            create one from this webinar&apos;s current title and date. Paste a link above instead if Zoom isn&apos;t
            connected.
          </div>
        </div>

        <div>
          <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--n60)', marginBottom: 6 }}>Webinar topic</div>
          <input className="lsq-input" type="text" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => save(() => updateCampaignName(campaign.id, name))} />
        </div>

        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
            <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--n60)' }}>Webinar description</div>
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
            <span style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n50)' }}>Claude uses this when scoring relevance and writing templates.</span>
            <span style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n50)', fontVariantNumeric: 'tabular-nums' }}>{description.length} chars</span>
          </div>
          {improveError && <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--danger-500)', marginTop: 6 }}>{improveError}</div>}
        </div>

        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
            <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--n60)' }}>Date &amp; time</div>
            <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n50)' }}>{display}</div>
          </div>
          <input className="lsq-input" type="datetime-local" value={when} onChange={(e) => saveWhen(e.target.value)} style={{ height: 38 }} />
          {isPast && (
            <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--warning-700)', marginTop: 6 }}>
              This date is in the past — reminder steps would all be overdue the moment the cadence launches.
            </div>
          )}
          {reminders && !isPast && (
            <div style={{ marginTop: 10, background: 'var(--n10)', borderRadius: 'var(--radius-sm)', padding: '10px 12px' }}>
              <div style={{ fontSize: 'var(--fs-label-2)', fontWeight: 600, color: 'var(--n60)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
                Reminders resolve to
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 18px', fontSize: 'var(--fs-label-2)', color: 'var(--n70)' }}>
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
              <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n50)', marginTop: 6 }}>Change any of these per-step on the Schedule tab.</div>
            </div>
          )}
        </div>

        <div>
          <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--n60)', marginBottom: 6 }}>Registration link (bot-led sign-up)</div>
          <input
            className="lsq-input"
            type="text"
            value={registrationLink}
            onChange={(e) => setRegistrationLink(e.target.value)}
            onPaste={(e) => {
              // onChange alone should catch a paste too, but some browsers/extensions
              // intercept paste in ways that skip the synthetic change event — reading
              // clipboardData directly here means a paste can never silently no-op.
              const pasted = e.clipboardData.getData('text');
              if (pasted) {
                e.preventDefault();
                setRegistrationLink(pasted);
              }
            }}
            onBlur={saveRegistrationLink}
            placeholder="lsq.co/w/your-webinar-slug"
          />
          {regLinkError && <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--danger-500)', marginTop: 6 }}>{regLinkError}</div>}
          <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n50)', marginTop: 6 }}>
            Sent in every invite/nudge/reminder. Changing it flags any already-personalized copy as using an old link — repair it from the Personalize tab.
          </div>
        </div>
      </div>
    </Card>
  );
}
