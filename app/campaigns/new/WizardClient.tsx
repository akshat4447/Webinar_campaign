'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { LeadImportCard } from '../[id]/setup/LeadImportCard';
import { EnrichmentCard } from '../[id]/setup/EnrichmentCard';
import type { EnrichmentStats } from '@/lib/actions/enrichment';
import {
  createCampaignFromWizardAction,
  getWizardScorePreviewAction,
  improveDraftDescriptionAction,
  saveWizardMessagingAction,
  updateWizardDetailsAction,
  type WizardDetails,
} from '@/lib/actions/wizard';
import { createZoomMeetingAction, linkZoomMeetingAction, listZoomMeetingsAction, type ZoomMeeting } from '@/lib/actions/zoom';
import { runScoringAction, updateScoringConfigAction } from '@/lib/actions/scoring';
import { validateWizardDetails } from '@/lib/wizardValidation';
import { DEFAULT_ENABLED_CHANNELS } from '@/lib/channels';
import { toDateTimeLocal } from '@/lib/campaignDate';

const STEPS = ['Webinar details', 'Audience', 'Enrich & score', 'Message & channels'];

const TONES = ['Warm & concise', 'Direct & professional', 'Consultative', 'Friendly & casual', 'Formal & executive'];
const LENGTHS = ['Short (~60 words)', 'Medium (~100 words)', 'Long (~150 words)'];

// Same textarea, different job: in AI mode this is a brief Claude reads (never
// sent as-is), in Templatized mode it becomes the literal invite email body —
// so each mode needs its own default, and templatized's MUST carry {{link}}
// or an operator who never edits it ships an invite with no registration link.
const DEFAULT_BRIEF_BY_MODE = {
  ai: 'Invite the reader to a live session on the webinar topic, tied to the operational problem their role owns. Lead with the problem, not a pitch. Keep it short and specific.',
  templatized: "Hi {{firstName}}, join us for a live session on {{topic}} — we'll dig into how teams at companies like {{company}} are tackling this. Save your spot here: {{link}}",
} as const;

const CHANNEL_CADENCE: Record<string, string> = {
  email: 'Invite · +4d nudge · +7d final · T-1d and T-1h reminders · follow-ups',
  linkedin: 'Day 1 touch · T-1d reminder (assisted, one-click send)',
  whatsapp: 'Invite at launch · registration confirmation',
  sms: 'Invite at launch · T-1h reminder',
};

interface WizardCampaign {
  id: string;
  name: string;
  description: string | null;
  scheduledAt: string | null;
  speakerName: string | null;
  speakerTitle: string | null;
  capacity: number | null;
  registrationLink: string | null;
  zoomLink: string | null;
  msgMode: string;
  tone: string | null;
  msgLength: string | null;
  aiInstructions: string | null;
  brief: string | null;
  oneClickSignup: boolean;
  scoringPrompt: string;
  scoringCriteria: string;
  scoringThreshold: number;
}

function label(text: string) {
  return (
    <div style={{ fontSize: 'var(--fs-label-2)', fontWeight: 'var(--fw-bold)', color: 'var(--n60)', marginBottom: 6 }}>
      {text}
    </div>
  );
}

function Toggle({ on, onChange, ariaLabel }: { on: boolean; onChange: () => void; ariaLabel: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={ariaLabel}
      onClick={onChange}
      style={{
        position: 'relative',
        width: 34,
        height: 20,
        flexShrink: 0,
        borderRadius: 'var(--radius-full)',
        background: on ? 'var(--accent-500)' : 'var(--n40)',
        border: 'none',
        cursor: 'pointer',
        transition: 'var(--transition-colors)',
      }}
    >
      <span
        style={{
          position: 'absolute',
          width: 14,
          height: 14,
          top: 3,
          left: on ? 17 : 3,
          background: '#fff',
          borderRadius: '50%',
          transition: 'left var(--dur-fast) var(--ease-standard)',
        }}
      />
    </button>
  );
}

export function WizardClient({
  step,
  campaign,
  contactCount,
  scoredCount,
  enrichmentStats,
  initialChannels,
}: {
  step: number;
  campaign: WizardCampaign | null;
  contactCount: number;
  scoredCount: number;
  enrichmentStats: EnrichmentStats | null;
  initialChannels?: Record<string, boolean>;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [zoomChoice, setZoomChoice] = useState<'existing' | 'new' | 'manual'>('manual');
  const [zoomMeetings, setZoomMeetings] = useState<ZoomMeeting[] | null>(null);
  const [zoomMeetingId, setZoomMeetingId] = useState('');
  const [zoomLoading, setZoomLoading] = useState(false);
  const [zoomError, setZoomError] = useState<string | null>(null);

  async function pickExistingZoom(force = false) {
    setZoomChoice('existing');
    setZoomError(null);
    if (zoomMeetings && !force) return;
    setZoomLoading(true);
    try {
      const res = await listZoomMeetingsAction();
      if (!res.ok) {
        setZoomError(res.error);
        return;
      }
      setZoomMeetings(res.meetings);
      if (res.meetings.length === 0) setZoomError('No upcoming meetings found on this Zoom account.');
    } catch (err) {
      setZoomError(err instanceof Error ? err.message : 'Failed to list Zoom meetings');
    } finally {
      setZoomLoading(false);
    }
  }

  function selectZoomMeeting(id: string) {
    setZoomMeetingId(id);
    const meeting = zoomMeetings?.find((m) => m.id === id);
    if (!meeting) return;
    // "pulled from Zoom — title, date and time set automatically", same as the
    // prototype. Still editable afterward, in case the internal Zoom topic
    // isn't what the invite should say.
    const start = meeting.startTime ? new Date(meeting.startTime) : null;
    const localStr = start ? toDateTimeLocal(start) : '';
    setDetails((d) => ({
      ...d,
      title: meeting.topic,
      date: localStr ? localStr.slice(0, 10) : d.date,
      time: localStr ? localStr.slice(11, 16) : d.time,
      zoomLink: meeting.joinUrl,
    }));
  }

  const scheduled = campaign?.scheduledAt ? new Date(campaign.scheduledAt) : null;
  const local = scheduled ? toDateTimeLocal(scheduled) : '';

  const [details, setDetails] = useState<WizardDetails>({
    title: campaign?.name && campaign.name !== 'Untitled webinar' ? campaign.name : '',
    date: local ? local.slice(0, 10) : '',
    time: local ? local.slice(11, 16) : '',
    speakerName: campaign?.speakerName ?? '',
    speakerTitle: campaign?.speakerTitle ?? '',
    description: campaign?.description ?? '',
    capacity: campaign?.capacity ? String(campaign.capacity) : '',
    registrationLink: campaign?.registrationLink ?? '',
    zoomLink: campaign?.zoomLink ?? '',
  });

  const [scoring, setScoring] = useState({
    prompt: campaign?.scoringPrompt ?? '',
    criteria: campaign?.scoringCriteria ?? '',
    threshold: campaign?.scoringThreshold ?? 70,
  });
  const [scoreOpen, setScoreOpen] = useState(false);
  const [preview, setPreview] = useState<{ id: string; name: string; title: string; account: string; score: number | null }[]>([]);

  const [messaging, setMessaging] = useState({
    msgMode: (campaign?.msgMode as 'ai' | 'templatized') ?? 'ai',
    tone: campaign?.tone ?? TONES[0],
    msgLength: campaign?.msgLength ?? LENGTHS[0],
    aiInstructions:
      campaign?.aiInstructions ??
      "Lead with the operational problem the reader's role owns — not a pitch or flattery. Vary the angle by seniority and function. Keep the offer and registration link exactly as given.",
    brief: campaign?.brief ?? DEFAULT_BRIEF_BY_MODE.ai,
    oneClickSignup: campaign?.oneClickSignup ?? true,
    channels:
      initialChannels ??
      ({
        email: DEFAULT_ENABLED_CHANNELS.has('email'),
        linkedin: DEFAULT_ENABLED_CHANNELS.has('linkedin'),
        whatsapp: DEFAULT_ENABLED_CHANNELS.has('whatsapp'),
        sms: DEFAULT_ENABLED_CHANNELS.has('sms'),
      } as Record<string, boolean>),
  });

  const set = (k: keyof WizardDetails, v: string) => setDetails((d) => ({ ...d, [k]: v }));

  function go(nextStep: number, id = campaign?.id) {
    router.push(`/campaigns/new?${new URLSearchParams({ ...(id ? { id } : {}), step: String(nextStep) })}`);
  }

  async function continueFromDetails() {
    const next = validateWizardDetails(details);
    if (Object.keys(next).length) {
      setErrors(next);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const id = campaign ? campaign.id : await createCampaignFromWizardAction(details);
      if (campaign) await updateWizardDetailsAction(campaign.id, details);

      if (zoomChoice === 'existing' && zoomMeetingId) {
        const r = await linkZoomMeetingAction(id, zoomMeetingId);
        if (!r.ok) showToast(r.error);
      } else if (zoomChoice === 'new') {
        const r = await createZoomMeetingAction(id);
        showToast(r.ok ? 'Zoom meeting created.' : `Zoom meeting not created: ${r.error}`);
      }

      if (!campaign) showToast('Draft created — now bring the audience.');
      go(1, id);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save webinar details');
    } finally {
      setBusy(false);
    }
  }

  async function improve() {
    setBusy(true);
    try {
      const r = await improveDraftDescriptionAction(details.title, details.description);
      if (r.ok && r.description) {
        set('description', r.description);
        showToast('Description rewritten — edit as you like.');
      } else {
        showToast(r.ok ? 'Nothing returned.' : r.error);
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to improve description');
    } finally {
      setBusy(false);
    }
  }

  async function runScoring() {
    if (!campaign) return;
    setBusy(true);
    try {
      await updateScoringConfigAction(campaign.id, {
        prompt: scoring.prompt,
        criteria: scoring.criteria,
        threshold: scoring.threshold,
      });
      const res = await runScoringAction(campaign.id);
      const rows = await getWizardScorePreviewAction(campaign.id);
      setPreview(rows);
      showToast(
        res.ok
          ? `Scored ${res.scoredCount} contact${res.scoredCount === 1 ? '' : 's'}${res.preservedManualApprovals ? ` — ${res.preservedManualApprovals} manual approval(s) left untouched` : ''}.`
          : (res.error ?? 'Scoring failed.')
      );
      router.refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Scoring failed');
    } finally {
      setBusy(false);
    }
  }

  async function continueFromScore() {
    if (!campaign) {
      go(3);
      return;
    }
    setBusy(true);
    try {
      await updateScoringConfigAction(campaign.id, {
        prompt: scoring.prompt,
        criteria: scoring.criteria,
        threshold: scoring.threshold,
      });
      go(3);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save scoring config');
    } finally {
      setBusy(false);
    }
  }

  async function launch() {
    if (!campaign) return;
    setBusy(true);
    try {
      await saveWizardMessagingAction(campaign.id, messaging);
      showToast('Webinar set up — review the cadence before launching sends.');
      router.push(`/campaigns/${campaign.id}/overview`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save messaging');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div style={{ fontSize: 'var(--fs-label-2)', fontWeight: 'var(--fw-bold)', color: 'var(--n50)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        New webinar
      </div>
      <h1 style={{ fontSize: 'var(--fs-heading-3)', fontWeight: 'var(--fw-bold)', color: 'var(--n90)', margin: '4px 0 0' }}>
        {STEPS[step]}
      </h1>
      <div style={{ display: 'flex', gap: 6, margin: '16px 0 22px' }}>
        {STEPS.map((s, i) => (
          <div
            key={s}
            title={s}
            style={{ flex: 1, height: 4, borderRadius: 'var(--radius-full)', background: i <= step ? 'var(--accent-500)' : 'var(--n20)' }}
          />
        ))}
      </div>

      <div className="lsq-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {step === 0 && (
          <>
            <div>
              {label('Webinar title')}
              <input
                className="lsq-input"
                value={details.title}
                onChange={(e) => set('title', e.target.value)}
                placeholder="e.g. Patient Journeys at Scale"
                style={errors.title ? { boxShadow: 'inset 0 0 0 1px var(--danger-500)' } : undefined}
              />
              {errors.title && <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--danger-500)', marginTop: 4 }}>{errors.title}</div>}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                {label('Date')}
                <input
                  className="lsq-input"
                  type="date"
                  value={details.date}
                  onChange={(e) => set('date', e.target.value)}
                  style={errors.date ? { boxShadow: 'inset 0 0 0 1px var(--danger-500)' } : undefined}
                />
                {errors.date && <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--danger-500)', marginTop: 4 }}>{errors.date}</div>}
              </div>
              <div>
                {label('Time')}
                <input className="lsq-input" type="time" value={details.time} onChange={(e) => set('time', e.target.value)} />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                {label('Speaker')}
                <input className="lsq-input" value={details.speakerName} onChange={(e) => set('speakerName', e.target.value)} placeholder="Full name" />
              </div>
              <div>
                {label('Speaker title')}
                <input className="lsq-input" value={details.speakerTitle} onChange={(e) => set('speakerTitle', e.target.value)} placeholder="e.g. VP, Success" />
              </div>
            </div>

            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                {label('Description')}
                <Button hierarchy="tertiary" size="sm" disabled={busy} onClick={improve}>
                  Improve with AI
                </Button>
              </div>
              <textarea
                className="lsq-input"
                rows={3}
                value={details.description}
                onChange={(e) => set('description', e.target.value)}
                placeholder="What will attendees learn?"
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                {label('Capacity')}
                <input className="lsq-input" type="number" min={1} value={details.capacity} onChange={(e) => set('capacity', e.target.value)} placeholder="200" />
              </div>
              <div>
                {label('Registration link')}
                <input className="lsq-input" value={details.registrationLink} onChange={(e) => set('registrationLink', e.target.value)} placeholder="https://…" />
              </div>
            </div>

            <div>
              {label('Zoom event')}
              <div style={{ display: 'flex', gap: 10 }}>
                {(
                  [
                    { id: 'manual', title: 'Paste a link', blurb: 'Type or paste a Zoom join link' },
                    { id: 'existing', title: 'Use existing event', blurb: 'Pick a meeting already on Zoom' },
                    { id: 'new', title: 'Create new event', blurb: "We'll create it in Zoom" },
                  ] as const
                ).map((opt) => {
                  const active = zoomChoice === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => (opt.id === 'existing' ? pickExistingZoom() : setZoomChoice(opt.id))}
                      style={{
                        flex: 1,
                        textAlign: 'left',
                        padding: '10px 12px',
                        borderRadius: 'var(--radius-md)',
                        cursor: 'pointer',
                        border: 'none',
                        background: active ? 'var(--accent-50)' : 'transparent',
                        boxShadow: `inset 0 0 0 1px ${active ? 'var(--accent-500)' : 'var(--border-subtle)'}`,
                      }}
                    >
                      <div style={{ fontWeight: 'var(--fw-bold)', fontSize: 'var(--fs-label-1)' }}>{opt.title}</div>
                      <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n50)', marginTop: 2 }}>{opt.blurb}</div>
                    </button>
                  );
                })}
              </div>

              {zoomChoice === 'manual' && (
                <input
                  className="lsq-input"
                  style={{ marginTop: 10 }}
                  value={details.zoomLink}
                  onChange={(e) => set('zoomLink', e.target.value)}
                  placeholder="https://your-org.zoom.us/j/…"
                />
              )}

              {zoomChoice === 'existing' && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n60)' }}>Choose from connected Zoom account:</span>
                    <button
                      type="button"
                      onClick={() => pickExistingZoom(true)}
                      disabled={zoomLoading}
                      style={{ background: 'none', border: 'none', color: 'var(--accent-500)', fontSize: 'var(--fs-label-2)', cursor: 'pointer', padding: 0 }}
                    >
                      {zoomLoading ? 'Refreshing…' : '↻ Refresh list'}
                    </button>
                  </div>
                  {zoomLoading ? (
                    <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n50)' }}>Loading meetings…</div>
                  ) : zoomMeetings && zoomMeetings.length > 0 ? (
                    <select
                      className="lsq-select"
                      style={{ width: '100%', height: 36 }}
                      value={zoomMeetingId}
                      onChange={(e) => selectZoomMeeting(e.target.value)}
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
                  {zoomError && <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--danger-500)', marginTop: 5 }}>{zoomError}</div>}
                  {zoomMeetingId && (
                    <div style={{ display: 'flex', gap: 10, background: 'var(--success-100)', borderRadius: 'var(--radius-md)', padding: '10px 12px', marginTop: 8 }}>
                      <span style={{ color: 'var(--success-700)', flexShrink: 0 }} aria-hidden="true">✓</span>
                      <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--success-700)' }}>
                        Pulled from Zoom — title, date and time filled in automatically. Edit them above if needed.
                      </div>
                    </div>
                  )}
                </div>
              )}

              {zoomChoice === 'new' && (
                <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n50)', marginTop: 8 }}>
                  A Zoom meeting is created from the title, date and time above when you continue.
                </div>
              )}
            </div>
          </>
        )}

        {step === 1 && campaign && (
          <>
            <LeadImportCard campaignId={campaign.id} existingContactCount={contactCount} existingScoredCount={scoredCount} />
            {contactCount > 0 && (
              <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--n60)' }}>
                {contactCount.toLocaleString()} contact{contactCount === 1 ? '' : 's'} imported. Every column that has no
                first-class field is kept alongside the contact, so nothing you supplied is discarded.
              </div>
            )}
          </>
        )}

        {step === 2 && campaign && (
          <>
            {enrichmentStats && <EnrichmentCard campaignId={campaign.id} stats={enrichmentStats} />}

            <div style={{ boxShadow: 'inset 0 0 0 1px var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: '14px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <div>
                  <div style={{ fontSize: 'var(--fs-label-1)', fontWeight: 'var(--fw-bold)', color: 'var(--n90)' }}>Relevance scoring</div>
                  <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n50)', marginTop: 2 }}>
                    Every contact scored 0–100 against this webinar&apos;s topic. Approved at {scoring.threshold} and above.
                  </div>
                </div>
                <Button hierarchy="tertiary" size="sm" onClick={() => setScoreOpen((o) => !o)}>
                  {scoreOpen ? 'Hide criteria' : 'Edit criteria'}
                </Button>
              </div>

              {scoreOpen && (
                <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div>
                    {label('Scoring prompt')}
                    <textarea className="lsq-input" rows={3} value={scoring.prompt} onChange={(e) => setScoring((s) => ({ ...s, prompt: e.target.value }))} />
                  </div>
                  <div>
                    {label('Criteria')}
                    <textarea className="lsq-input" rows={2} value={scoring.criteria} onChange={(e) => setScoring((s) => ({ ...s, criteria: e.target.value }))} />
                  </div>
                  <div style={{ maxWidth: 160 }}>
                    {label('Approval threshold')}
                    <input
                      className="lsq-input"
                      type="number"
                      min={0}
                      max={100}
                      value={scoring.threshold}
                      onChange={(e) => setScoring((s) => ({ ...s, threshold: Number(e.target.value) }))}
                    />
                  </div>
                </div>
              )}

              <div style={{ marginTop: 12 }}>
                <Button size="sm" disabled={busy || contactCount === 0} onClick={runScoring}>
                  {scoredCount > 0 ? 'Re-run scoring' : 'Run scoring'}
                </Button>
                {contactCount === 0 && (
                  <span style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n50)', marginLeft: 10 }}>Import contacts first.</span>
                )}
              </div>
            </div>

            {preview.length > 0 && (
              <div style={{ boxShadow: 'inset 0 0 0 1px var(--border-subtle)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                {preview.map((r) => (
                  <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderBottom: '1px solid var(--border-subtle)' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 'var(--fs-label-1)', fontWeight: 'var(--fw-semibold)' }}>{r.name}</div>
                      <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n50)' }}>
                        {r.title} · {r.account}
                      </div>
                    </div>
                    <div
                      className="lsq-num"
                      style={{
                        fontWeight: 'var(--fw-bold)',
                        color: (r.score ?? 0) >= 85 ? 'var(--success-700)' : (r.score ?? 0) >= 70 ? 'var(--accent-500)' : 'var(--warning-700)',
                      }}
                    >
                      {r.score}
                    </div>
                  </div>
                ))}
                <div style={{ padding: '10px 14px', fontSize: 'var(--fs-label-2)', color: 'var(--n50)' }}>
                  Top {preview.length} shown. Adjust approvals any time on the Audience tab.
                </div>
              </div>
            )}
          </>
        )}

        {step === 3 && campaign && (
          <>
            {label('How should messages be written?')}
            <div style={{ display: 'flex', gap: 10 }}>
              {(
                [
                  { id: 'templatized', title: 'Templatized', blurb: 'One fixed message per step, same for everyone' },
                  { id: 'ai', title: 'AI-personalized', blurb: 'Claude writes a unique message per contact' },
                ] as const
              ).map((opt) => {
                const active = messaging.msgMode === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() =>
                      setMessaging((m) => {
                        // Only swap the default text for the mode being left —
                        // never touch a brief the operator actually wrote.
                        const leavingDefault = DEFAULT_BRIEF_BY_MODE[m.msgMode];
                        const brief = m.brief === leavingDefault ? DEFAULT_BRIEF_BY_MODE[opt.id] : m.brief;
                        return { ...m, msgMode: opt.id, brief };
                      })
                    }
                    style={{
                      flex: 1,
                      textAlign: 'left',
                      padding: '12px 14px',
                      borderRadius: 'var(--radius-md)',
                      cursor: 'pointer',
                      border: 'none',
                      background: active ? 'var(--accent-50)' : 'transparent',
                      boxShadow: `inset 0 0 0 1px ${active ? 'var(--accent-500)' : 'var(--border-subtle)'}`,
                    }}
                  >
                    <div style={{ fontWeight: 'var(--fw-bold)', fontSize: 'var(--fs-label-1)' }}>{opt.title}</div>
                    <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n50)', marginTop: 2 }}>{opt.blurb}</div>
                  </button>
                );
              })}
            </div>

            <div>
              {label(messaging.msgMode === 'ai' ? 'Message brief' : 'Message template')}
              <textarea
                className="lsq-input"
                rows={3}
                value={messaging.brief}
                onChange={(e) => setMessaging((m) => ({ ...m, brief: e.target.value }))}
              />
            </div>

            {messaging.msgMode === 'ai' && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    {label('Tone')}
                    <select className="lsq-select" style={{ width: '100%', height: 36 }} value={messaging.tone} onChange={(e) => setMessaging((m) => ({ ...m, tone: e.target.value }))}>
                      {TONES.map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    {label('Length')}
                    <select className="lsq-select" style={{ width: '100%', height: 36 }} value={messaging.msgLength} onChange={(e) => setMessaging((m) => ({ ...m, msgLength: e.target.value }))}>
                      {LENGTHS.map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  {label('AI instructions')}
                  <textarea
                    className="lsq-input"
                    rows={3}
                    value={messaging.aiInstructions}
                    onChange={(e) => setMessaging((m) => ({ ...m, aiInstructions: e.target.value }))}
                  />
                  <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n50)', marginTop: 6 }}>
                    What to emphasise or avoid. The offer, the registration link and the compliance copy are fixed in code
                    and are never overridden from here.
                  </div>
                </div>
              </>
            )}

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 14px', boxShadow: 'inset 0 0 0 1px var(--border-subtle)', borderRadius: 'var(--radius-md)' }}>
              <div>
                <div style={{ fontSize: 'var(--fs-label-1)', fontWeight: 'var(--fw-bold)' }}>One-click sign-up</div>
                <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n50)', marginTop: 2 }}>
                  Every message carries a pre-filled link, so a click registers the contact — no landing-page form.
                </div>
              </div>
              <Toggle
                on={messaging.oneClickSignup}
                ariaLabel="One-click sign-up"
                onChange={() => setMessaging((m) => ({ ...m, oneClickSignup: !m.oneClickSignup }))}
              />
            </div>

            {label('Channels')}
            {(['email', 'linkedin', 'whatsapp', 'sms'] as const).map((ch) => (
              <div
                key={ch}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  padding: '12px 14px',
                  boxShadow: 'inset 0 0 0 1px var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  opacity: messaging.channels[ch] ? 1 : 0.55,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 'var(--fs-label-1)', fontWeight: 'var(--fw-bold)', textTransform: 'capitalize' }}>{ch}</div>
                  {messaging.channels[ch] && (
                    <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n50)', marginTop: 1 }}>{CHANNEL_CADENCE[ch]}</div>
                  )}
                </div>
                <Toggle
                  on={messaging.channels[ch]}
                  ariaLabel={`${ch} channel`}
                  onChange={() => setMessaging((m) => ({ ...m, channels: { ...m.channels, [ch]: !m.channels[ch] } }))}
                />
              </div>
            ))}
            <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n50)' }}>
              You can add or remove individual steps — three emails or twenty-five — on the Cadence planner afterwards.
            </div>
          </>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 20 }}>
        <div>
          {step > 0 && (
            <Button hierarchy="secondary" disabled={busy} onClick={() => go(step - 1)}>
              Back
            </Button>
          )}
        </div>
        {step === 3 ? (
          <Button disabled={busy} onClick={launch}>
            {busy ? 'Saving…' : 'Finish setup'}
          </Button>
        ) : (
          <Button disabled={busy} onClick={step === 0 ? continueFromDetails : step === 2 ? continueFromScore : () => go(step + 1)}>
            {busy ? 'Saving…' : 'Continue'}
          </Button>
        )}
      </div>
    </>
  );
}
