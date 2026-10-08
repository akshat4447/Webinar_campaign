'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { Field } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { formatLsqDateTime } from '@/lib/dateFormat';
import { EmailGatewayPicker } from '@/components/wizard/EmailGatewayPicker';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import {
  updateCampaignName,
  updateCampaignSchedule,
  updateCampaignDescription,
  updateCampaignZoomLink,
  updateCampaignRegistrationFunnelAction,
  updateCampaignSpeakersAction,
  updateCampaignEmailProviderAction,
  updateCampaignCapacityAction,
} from '@/lib/actions/setup';
import { getIntegrationConfigMaskedAction } from '@/lib/actions/integrations';
import { improveDescriptionAction } from '@/lib/actions/description';
import {
  createZoomMeetingAction,
  linkZoomMeetingAction,
  listZoomMeetingsAction,
  unlinkZoomMeetingAction,
  fetchZoomEventDetailsAction,
  type ZoomMeeting,
} from '@/lib/actions/zoom';
import { toDateTimeLocal, parseLegacyWebinarDate, reminderDates, formatWebinarDate } from '@/lib/campaignDate';
import type { Campaign, Speaker } from '@/lib/generated/prisma/client';
import { SpeakerListEditor } from '@/components/speakers/SpeakerListEditor';
import type { SpeakerInput } from '@/lib/speakerUtils';
import { LandingPageIntegrationCard } from '@/components/landing/LandingPageIntegrationCard';
import { ChannelSelectionCard } from '@/components/channels/ChannelSelectionCard';
import {
  updateCampaignSelectedChannelsAction,
} from '@/lib/actions/setup';
import {
  parseSelectedChannels,
  type RegistrationChannelKey,
} from '@/lib/registrationChannels';

export function CampaignDetailsForm({
  campaign,
  serverNow,
  onDone,
}: {
  campaign: Campaign & { speakers?: Speaker[] };
  serverNow: number;
  onDone?: () => void;
}) {
  const [name, setName] = useState(campaign.name);
  const [description, setDescription] = useState(campaign.description ?? '');
  const [zoomLink, setZoomLink] = useState(campaign.zoomLink ?? '');
  const [speakers, setSpeakers] = useState<SpeakerInput[]>(
    campaign.speakers && campaign.speakers.length > 0
      ? campaign.speakers.map((s) => ({
          id: s.id,
          name: s.name,
          title: s.title,
          company: s.company,
          bio: s.bio,
          avatarUrl: s.avatarUrl,
          linkedinUrl: s.linkedinUrl,
          isPrimary: s.isPrimary,
          order: s.order,
        }))
      : campaign.speakerName
        ? [{ name: campaign.speakerName, title: campaign.speakerTitle, isPrimary: true, order: 0 }]
        : []
  );
  const [linkState, setLinkState] = useState<{ kind: 'zoom' | 'other' | 'empty'; host?: string } | { error: string } | null>(
    campaign.zoomLink ? { kind: 'zoom' } : null
  );
  // Fall back to parsing the legacy display string so campaigns created before
  // the picker existed still show their date rather than an empty field.
  const initial = campaign.scheduledAt ?? parseLegacyWebinarDate(campaign.date);
  const [when, setWhen] = useState(toDateTimeLocal(initial, campaign.timezone));
  const [display, setDisplay] = useState(campaign.date);
  const [autosave, setAutosave] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [improving, setImproving] = useState(false);
  const [improveError, setImproveError] = useState<string | null>(null);
  const [registrationLink, setRegistrationLink] = useState(campaign.registrationLink ?? '');
  const [emailProvider, setEmailProvider] = useState<'leadsquared' | 'netcore'>(
    (campaign.emailProvider as 'leadsquared' | 'netcore') || 'leadsquared'
  );
  const [netcoreConfigured, setNetcoreConfigured] = useState(true);
  const [capacity, setCapacity] = useState<string>(
    campaign.capacity !== null && campaign.capacity !== undefined ? String(campaign.capacity) : ''
  );
  const [selectedChannels, setSelectedChannels] = useState<RegistrationChannelKey[]>(
    parseSelectedChannels(campaign.selectedChannels)
  );
  const [, startTransition] = useTransition();
  // syncSpeakersForCampaign does a full delete-then-recreate of the whole
  // roster, and SpeakerListEditor fires onCommit independently on every
  // blur/reorder/remove with no queueing of its own — two overlapping
  // commits (e.g. a reorder immediately followed by a bio edit) could race,
  // and whichever request happened to resolve last would silently win with
  // whatever (possibly stale) snapshot it was holding. Chaining each commit
  // onto the prior one's promise guarantees they reach the server in the
  // same order they were fired.
  const speakersSaveChain = useRef<Promise<unknown>>(Promise.resolve());

  // Selecting Netcore here saves immediately (no separate confirm step) — an
  // operator can pick it before ever configuring credentials, and the send
  // path now fails loudly rather than silently, but a warning here catches
  // it before the cadence launches instead of after the first failed send.
  useEffect(() => {
    getIntegrationConfigMaskedAction('netcore').then((cfg) => setNetcoreConfigured(!!cfg.apiKey?.hasValue));
  }, []);

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
  const [fetchingFromLink, setFetchingFromLink] = useState(false);
  const [linkFetchNote, setLinkFetchNote] = useState<{ text: string; tone: 'good' | 'bad' } | null>(null);

  async function fetchDetailsFromZoomLink() {
    const input = zoomLink.trim();
    if (!input) return;
    setFetchingFromLink(true);
    setLinkFetchNote(null);
    setZoomError(null);
    setZoomNote(null);

    try {
      const res = await fetchZoomEventDetailsAction(input);
      if (!res.ok) {
        setLinkFetchNote({ text: res.error, tone: 'bad' });
        setFetchingFromLink(false);
        return;
      }

      const m = res.meeting;
      setZoomBusy(true);
      const linkRes = await linkZoomMeetingAction(campaign.id, m.id);
      setZoomBusy(false);

      if (!linkRes.ok) {
        setLinkFetchNote({ text: linkRes.error, tone: 'bad' });
        setFetchingFromLink(false);
        return;
      }

      const cleanTopic = m.topic.replace(/^\[Webinar\]\s*/, '');
      setName(cleanTopic);
      setZoomLink(m.joinUrl);
      setLinkState({ kind: 'zoom' });
      setZoomMeetingId(m.id);
      setZoomMode('existing');

      if (m.registrationUrl) {
        setRegistrationLink(m.registrationUrl);
      }

      if (m.capacity) {
        setCapacity(String(m.capacity));
      }
      if (m.agenda) {
        setDescription(m.agenda);
      }
      if (m.startTime) {
        const start = new Date(m.startTime);
        setWhen(toDateTimeLocal(start, campaign.timezone));
        setDisplay(formatWebinarDate(start, campaign.timezone));
      }
      if (m.speakers && m.speakers.length > 0) {
        setSpeakers(
          m.speakers.map((s, idx) => ({
            name: s.name,
            title: s.title || (s.isPrimary ? 'Host & Keynote Speaker' : 'Panelist / Speaker'),
            company: s.company || 'LeadSquared',
            bio: s.bio,
            avatarUrl: s.avatarUrl,
            isPrimary: !!s.isPrimary,
            order: idx,
          }))
        );
      }

      const speakerCount = m.speakers?.length || 0;
      setLinkFetchNote({
        text: `Synced from Zoom: "${cleanTopic}". ${speakerCount > 0 ? `${speakerCount} speakers or panelists. ` : ''}${m.capacity ? `${m.capacity} seats. ` : ''}Registration links and schedule updated.`,
        tone: 'good',
      });
    } catch (err) {
      setLinkFetchNote({ text: err instanceof Error ? err.message : 'Failed to fetch details from Zoom', tone: 'bad' });
    } finally {
      setFetchingFromLink(false);
    }
  }

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
    setLinkFetchNote(null);
    const res = await linkZoomMeetingAction(campaign.id, meetingId);
    setZoomBusy(false);
    if (!res.ok) {
      setZoomError(res.error);
      return;
    }
    // Everything the meeting carries lands in the same fields the manual
    // inputs edit, so the form reflects it immediately rather than needing a
    // refresh to catch up with what the server action just saved.
    const cleanTopic = res.meeting.topic.replace(/^\[Webinar\]\s*/, '');
    setName(cleanTopic);
    setZoomLink(res.meeting.joinUrl);
    setLinkState({ kind: 'zoom' });
    setZoomMeetingId(res.meeting.id);
    setZoomMode('existing');
    if (res.meeting.registrationUrl) {
      setRegistrationLink(res.meeting.registrationUrl);
    }
    if (res.meeting.capacity) {
      setCapacity(String(res.meeting.capacity));
    }
    if (res.meeting.agenda) {
      setDescription(res.meeting.agenda);
    }
    if (res.meeting.startTime) {
      const start = new Date(res.meeting.startTime);
      setWhen(toDateTimeLocal(start, campaign.timezone));
      setDisplay(formatWebinarDate(start, campaign.timezone));
    }
    if (res.meeting.speakers && res.meeting.speakers.length > 0) {
      setSpeakers(
        res.meeting.speakers.map((s, idx) => ({
          name: s.name,
          title: s.title || (s.isPrimary ? 'Host & Keynote Speaker' : 'Panelist / Speaker'),
          company: s.company || 'LeadSquared',
          bio: s.bio,
          avatarUrl: s.avatarUrl,
          isPrimary: !!s.isPrimary,
          order: idx,
        }))
      );
    }
    setZoomPicker('closed');
    const speakerCount = res.meeting.speakers?.length || 0;
    setZoomNote(`Synced from Zoom: "${cleanTopic}". ${speakerCount > 0 ? `${speakerCount} speakers or panelists synced. ` : ''}Capacity and registration link updated.`);
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
    setLinkFetchNote(null);
    setZoomNote('Unlinked. The join link above is kept as a plain value.');
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



  function saveCapacity(value: string) {
    const trimmed = value.trim();
    const num = trimmed ? parseInt(trimmed, 10) : null;
    if (trimmed && (isNaN(num!) || num! < 1)) return;
    setAutosave('saving');
    startTransition(async () => {
      try {
        const res = await updateCampaignCapacityAction(campaign.id, num);
        if (res.ok) {
          setAutosave('saved');
        } else {
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

  const timeZone = campaign.timezone;
  const fmt = (d: Date) => formatLsqDateTime(d, timeZone);

  return (
    <div className="lsq-stack lsq-stack--lg">
      <div className="lsq-toolbar">
        <h2 className="lsq-card__title">Webinar Details</h2>
        <div className="lsq-toolbar__group">
          <span role="status" aria-live="polite">
            {autosave === 'saving' && <Badge color="warning" dot text="Saving" />}
            {autosave === 'saved' && <Badge color="success" dot text="Saved" />}
          </span>
          {onDone && (
            <Button hierarchy="secondary" size="sm" onClick={onDone}>
              Done Editing
            </Button>
          )}
        </div>
      </div>

      {/* Event link first: pasting it is the natural first action */}
      <section className="lsq-card" aria-labelledby="setup-zoom-title">
        <div className="lsq-card__header">
          <div>
            <h3 className="lsq-card__title" id="setup-zoom-title">Zoom Event</h3>
            <p className="lsq-card__sub">Link a Zoom event to sync the title, schedule, speakers and capacity.</p>
          </div>
        </div>
        <div className="lsq-card__body lsq-stack">
          <Field
            label="Zoom webinar or event link"
            error={linkState && 'error' in linkState ? linkState.error : undefined}
            hint="Pulls straight from the connected Zoom account (Integrations, Zoom). Pick an upcoming meeting to link, or paste a link or ID and select Fetch Details."
          >
            {(p) => (
              <div className="lsq-wiz-inputrow">
                <input
                  {...p}
                  className="lsq-input lsq-grow"
                  type="url"
                  inputMode="url"
                  placeholder="https://your-org.zoom.us/webinar/register/WN_xxxxxxxx or a Zoom meeting or webinar ID"
                  value={zoomLink}
                  onChange={(e) => setZoomLink(e.target.value)}
                  onBlur={saveLink}
                />
                <Button
                  hierarchy="secondary-color"
                  disabled={fetchingFromLink || !zoomLink.trim()}
                  loading={fetchingFromLink}
                  onClick={fetchDetailsFromZoomLink}
                >
                  {fetchingFromLink ? 'Fetching' : 'Fetch Details'}
                </Button>
              </div>
            )}
          </Field>

          {linkFetchNote && (
            <div className={`lsq-banner ${linkFetchNote.tone === 'good' ? 'lsq-banner--success' : 'lsq-banner--error'}`} role={linkFetchNote.tone === 'good' ? 'status' : 'alert'}>
              <span className="lsq-banner__icon" aria-hidden="true">
                <Icon name={linkFetchNote.tone === 'good' ? 'check-circle' : 'error'} size={16} />
              </span>
              <p className="lsq-banner__body">{linkFetchNote.text}</p>
            </div>
          )}

          {zoomMeetingId ? (
            <div className="lsq-cluster">
              <Badge color="success" text={zoomMode === 'new' ? 'Created on Zoom' : 'Linked to Zoom'} />
              <span className="lsq-hint lsq-wiz-wrap">
                Title, date, speakers, capacity and join link stay in sync with Zoom ID <strong>{zoomMeetingId}</strong>.
              </span>
              <Button hierarchy="tertiary" size="sm" onClick={unlinkZoom} disabled={zoomBusy}>
                Unlink
              </Button>
            </div>
          ) : (
            <>
              {linkState && 'kind' in linkState && linkState.kind === 'zoom' && (
                <div className="lsq-cluster">
                  <Badge color="success" text="Zoom link recognised" />
                  <span className="lsq-hint">Used as the join link in reminder emails. Select Fetch Details to sync the topic, speakers and capacity.</span>
                </div>
              )}
              {linkState && 'kind' in linkState && linkState.kind === 'other' && (
                <div className="lsq-cluster">
                  <Badge color="blue" text={linkState.host ?? 'Custom host'} />
                  <span className="lsq-hint">Not a Zoom URL. Saved anyway and used as the join link.</span>
                </div>
              )}
            </>
          )}

          <div className="lsq-cluster">
            <Button hierarchy="secondary" size="sm" onClick={browseZoomMeetings} disabled={zoomBusy}>
              {zoomMeetingId ? 'Fetch a Different Event' : 'Fetch From Zoom'}
            </Button>
            {!zoomMeetingId && (
              <Button hierarchy="secondary" size="sm" onClick={createNewZoomMeeting} loading={zoomBusy}>
                {zoomBusy ? 'Creating' : 'Create Zoom Meeting'}
              </Button>
            )}
          </div>

          {zoomPicker === 'browsing' &&
            (zoomLoading ? (
              <p className="lsq-hint" role="status">Loading meetings</p>
            ) : zoomMeetings && zoomMeetings.length > 0 ? (
              <Field label="Zoom meeting">
                {(p) => (
                  <select
                    {...p}
                    className="lsq-select"
                    value=""
                    disabled={zoomBusy}
                    onChange={(e) => e.target.value && applyZoomMeeting(e.target.value)}
                  >
                    <option value="">Choose a meeting</option>
                    {zoomMeetings.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.topic}
                        {m.startTime ? ` | ${formatLsqDateTime(new Date(m.startTime))}` : ''}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            ) : null)}

          {zoomError && (
            <div className="lsq-banner lsq-banner--error" role="alert">
              <span className="lsq-banner__icon" aria-hidden="true"><Icon name="error" size={16} /></span>
              <p className="lsq-banner__body">{zoomError}</p>
            </div>
          )}
          {zoomNote && (
            <div className="lsq-banner lsq-banner--success" role="status">
              <span className="lsq-banner__icon" aria-hidden="true"><Icon name="check-circle" size={16} /></span>
              <p className="lsq-banner__body">{zoomNote}</p>
            </div>
          )}
        </div>
      </section>

      <section className="lsq-card" aria-labelledby="setup-basics-title">
        <div className="lsq-card__header">
          <div>
            <h3 className="lsq-card__title" id="setup-basics-title">Basics</h3>
            <p className="lsq-card__sub">What the webinar is called and what attendees will learn.</p>
          </div>
        </div>
        <div className="lsq-card__body lsq-stack">
          <Field label="Webinar topic">
            {(p) => (
              <input
                {...p}
                className="lsq-input"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => save(() => updateCampaignName(campaign.id, name))}
              />
            )}
          </Field>

          <Field
            label="Webinar description"
            error={improveError}
            hint={`Claude uses this when scoring relevance and writing templates. ${description.length.toLocaleString()} characters.`}
          >
            {(p) => (
              <textarea
                {...p}
                className="lsq-input"
                rows={4}
                placeholder="What the session covers, who it is for and what attendees will walk away able to do. Rough notes are fine, since Improve With AI will tidy them up."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onBlur={() => save(() => updateCampaignDescription(campaign.id, description))}
              />
            )}
          </Field>
          <div className="lsq-cluster">
            <Button hierarchy="secondary-color" size="sm" icon={<Icon name="sparkle" size={14} />} onClick={improve} loading={improving}>
              {improving ? 'Improving' : 'Improve With AI'}
            </Button>
          </div>
        </div>
      </section>

      <section className="lsq-card" aria-labelledby="setup-speakers-title">
        <div className="lsq-card__body">
          <SpeakerListEditor
            headingId="setup-speakers-title"
            speakers={speakers}
            onChange={setSpeakers}
            onCommit={(newSpeakers) => {
              const chained = speakersSaveChain.current
                .catch(() => {})
                .then(() => updateCampaignSpeakersAction(campaign.id, newSpeakers));
              speakersSaveChain.current = chained;
              save(() => chained);
            }}
          />
        </div>
      </section>

      <section className="lsq-card" aria-labelledby="setup-schedule-title">
        <div className="lsq-card__header">
          <div>
            <h3 className="lsq-card__title" id="setup-schedule-title">Schedule</h3>
            <p className="lsq-card__sub">When the session runs, in the webinar timezone.</p>
          </div>
        </div>
        <div className="lsq-card__body lsq-stack">
          <Field label="Date and time" hint={display ? `Scheduled for ${display}` : undefined}>
            {(p) => <input {...p} className="lsq-input" type="datetime-local" value={when} onChange={(e) => saveWhen(e.target.value)} />}
          </Field>
          <dl className="lsq-kv lsq-wiz-schedule-kv">
            <dt>Timezone</dt>
            <dd>{timeZone}</dd>
            <dt>Duration</dt>
            <dd>{campaign.durationMinutes} minutes</dd>
          </dl>
          {isPast && (
            <div className="lsq-banner lsq-banner--warning" role="status">
              <span className="lsq-banner__icon" aria-hidden="true"><Icon name="warning" size={16} /></span>
              <p className="lsq-banner__body">This date is in the past. Reminder steps would all be overdue the moment the cadence launches.</p>
            </div>
          )}
          {reminders && !isPast && (
            <div className="lsq-wiz-panel lsq-stack lsq-stack--sm">
              <h4 className="lsq-wiz-panel__title">Reminders resolve to</h4>
              <dl className="lsq-kv">
                <dt>T-3d</dt>
                <dd>{fmt(reminders.t3)}</dd>
                <dt>T-1d</dt>
                <dd>{fmt(reminders.t1d)}</dd>
                <dt>T-1h</dt>
                <dd>{fmt(reminders.t1h)}</dd>
              </dl>
              <p className="lsq-hint">Change any of these per step on the Cadence tab.</p>
            </div>
          )}
        </div>
      </section>

      <LandingPageIntegrationCard
        campaignId={campaign.id}
        campaignName={name}
        initialRegistrationLink={registrationLink}
        initialOneClickSignup={campaign.oneClickSignup}
        zoomMeetingId={zoomMeetingId}
        zoomLink={zoomLink}
        scheduledAt={campaign.scheduledAt}
        onSave={async (patch) => {
          const res = await updateCampaignRegistrationFunnelAction(campaign.id, patch);
          if (res.ok) {
            setRegistrationLink(patch.registrationLink);
            if (patch.zoomMeetingId !== undefined) {
              setZoomMeetingId(patch.zoomMeetingId || '');
            }
            if (patch.zoomLink !== undefined) {
              setZoomLink(patch.zoomLink || '');
            }
          }
        }}
        sampleContact={
          speakers[0]
            ? {
                name: speakers[0].name,
                title: speakers[0].title || undefined,
                account: speakers[0].company || undefined,
              }
            : undefined
        }
      />

      <ChannelSelectionCard
        selectedChannels={selectedChannels}
        onChange={(newChannels) => {
          setSelectedChannels(newChannels);
          save(() => updateCampaignSelectedChannelsAction(campaign.id, newChannels));
        }}
        zoomMeetingId={zoomMeetingId}
      />

      <section className="lsq-card" aria-labelledby="setup-gateway-title">
        <div className="lsq-card__header">
          <div>
            <h3 className="lsq-card__title" id="setup-gateway-title">Email Delivery</h3>
            <p className="lsq-card__sub">Which service sends the emails for this webinar.</p>
          </div>
        </div>
        <div className="lsq-card__body">
          <EmailGatewayPicker
            value={emailProvider}
            netcoreConfigured={netcoreConfigured}
            hint="Switch gateways anytime without losing contacts, scores or templates."
            onChange={(gw) => {
              setEmailProvider(gw);
              save(() => updateCampaignEmailProviderAction(campaign.id, gw));
            }}
          />
        </div>
      </section>

      <section className="lsq-card" aria-labelledby="setup-capacity-title">
        <div className="lsq-card__header">
          <div>
            <h3 className="lsq-card__title" id="setup-capacity-title">Capacity</h3>
            <p className="lsq-card__sub">Sets maximum attendee capacity and shows registration fullness on the Overview tab.</p>
          </div>
        </div>
        <div className="lsq-card__body">
          <Field label="Webinar seat capacity" optional>
            {(p) => (
              <input
                {...p}
                className="lsq-input lsq-wiz-narrow"
                type="number"
                min={1}
                max={100000}
                placeholder="e.g. 500 seats"
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
                onBlur={(e) => saveCapacity(e.target.value)}
              />
            )}
          </Field>
        </div>
      </section>
    </div>
  );
}
