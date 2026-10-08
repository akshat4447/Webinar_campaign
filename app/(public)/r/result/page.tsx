import { getAttendee } from '@/lib/attendee';
import { buildCalendarUrls } from '@/lib/calendar';
import { parseLegacyWebinarDate } from '@/lib/campaignDate';
import { AttendeeCountdown } from './AttendeeCountdown';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { formatLsqDateTime, timeZoneLabel } from '@/lib/dateFormat';

type Tone = 'success' | 'warning' | 'error' | 'neutral';

// One entry per status the link handlers can send here. Titles are Title Case, bodies are sentence
// case, and none of them blames the reader: a broken link is a link problem.
const MESSAGES: Record<string, { title: string; body: string; tone: Tone; icon: 'check-circle' | 'x-circle' | 'clock'; success: boolean }> = {
  registered: { title: 'Registration Confirmed', body: 'A seat is saved for this webinar. Add the session to a calendar so it is not missed.', tone: 'success', icon: 'check-circle', success: true },
  already: { title: 'Already Registered', body: 'A seat is already saved for this webinar. Check below that the session is in a calendar.', tone: 'success', icon: 'check-circle', success: true },
  expired: { title: 'Link Expired', body: 'Registration links are valid for a limited time. Ask the sender for a fresh link.', tone: 'warning', icon: 'clock', success: false },
  'bad-signature': { title: 'Link Not Recognised', body: 'This link may have been altered on the way. Ask the sender for a fresh link.', tone: 'error', icon: 'x-circle', success: false },
  malformed: { title: 'Link Looks Incomplete', body: 'Some mail clients shorten long links. Ask the sender for a fresh link, or copy the full address from the original message.', tone: 'error', icon: 'x-circle', success: false },
  'unknown-campaign': { title: 'Webinar Not Available', body: 'The event this link points to has been removed.', tone: 'neutral', icon: 'x-circle', success: false },
  closed: { title: 'Registration Is Closed', body: 'This webinar has ended or is no longer taking registrations. Ask the organiser about the recording.', tone: 'neutral', icon: 'clock', success: false },
  'unknown-contact': { title: 'Invitation Not Found', body: 'This link could not be matched to an invitation. Ask the sender for a fresh link.', tone: 'error', icon: 'x-circle', success: false },
};

export const dynamic = 'force-dynamic';

export default async function RegistrationResultPage(props: PageProps<'/r/result'>) {
  const sp = await props.searchParams;
  const status = typeof sp.status === 'string' ? sp.status : 'malformed';
  const tokenParam = typeof sp.t === 'string' ? sp.t : null;

  const msg = MESSAGES[status] ?? MESSAGES.malformed;
  const isSuccess = msg.success;

  // Public: seen by whoever clicks the link, not just the operator. Only ever
  // look up (and show) a campaign's details when the request carries the same
  // signed, TTL-checked registration token /r/[token] verified — never trust a
  // raw campaignId query param, or anyone who can guess/enumerate one could
  // see another registrant's webinar name, description, speaker, and Zoom link.
  const attendee = await getAttendee(tokenParam);
  const campaign = attendee?.campaign ?? null;
  const joinUrl = attendee?.joinUrl ?? null;

  const title = campaign?.name || 'Webinar Session';
  const startTime = campaign?.scheduledAt
    ? new Date(campaign.scheduledAt)
    : (campaign?.date ? parseLegacyWebinarDate(campaign.date) : null);
  const eventWhen = campaign && startTime ? `${formatLsqDateTime(startTime, campaign.timezone)} ${timeZoneLabel(startTime, campaign.timezone)}` : campaign?.date || 'Date to be announced';
  const endTime = startTime ? new Date(startTime.getTime() + (campaign?.durationMinutes ?? 60) * 60 * 1000) : null;
  const location = joinUrl || 'Joining details will be provided by the organizer';

  // Calendar URLs
  const calUrls = campaign && startTime
    ? buildCalendarUrls({
        title,
        description: campaign.description || title,
        location,
        startTime,
        endTime,
        speakers: campaign.speakers,
        speakerName: campaign.speakerName,
        speakerTitle: campaign.speakerTitle,
        campaignId: campaign.id,
        token: tokenParam || undefined,
      })
    : null;

  const googleCalUrl = calUrls?.google || null;
  const outlookCalUrl = calUrls?.outlookLive || null;
  const officeCalUrl = calUrls?.outlookOffice || null;
  const icsUrl = calUrls?.ics || null;

  const calendarLinks = [
    googleCalUrl && { href: googleCalUrl, label: 'Google Calendar', icon: 'calendar', download: false },
    outlookCalUrl && { href: outlookCalUrl, label: 'Outlook.com', icon: 'mail', download: false },
    officeCalUrl && { href: officeCalUrl, label: 'Microsoft 365', icon: 'calendar', download: false },
    icsUrl && { href: icsUrl, label: 'Apple or iCal (.ics)', icon: 'download', download: true },
  ].filter(Boolean) as { href: string; label: string; icon: string; download: boolean }[];

  return (
    <>
      <p className="pub-brand">Webinar Registration</p>
      <section className="lsq-card" aria-labelledby="result-title">
        <div className="lsq-card__body lsq-stack lsq-stack--lg lsq-home-result">
          <div className="lsq-stack">
            <div>
              <span className="lsq-home-result__icon" data-tone={msg.tone} aria-hidden="true">
                <Icon name={msg.icon} size={28} />
              </span>
            </div>
            <h1 className="lsq-home-result__title" id="result-title" aria-live={isSuccess ? 'polite' : 'assertive'}>
              {msg.title}
            </h1>
            {campaign && <p className="lsq-home-result__webinar">{title}</p>}
            <p className="lsq-home-result__body">{isSuccess && !attendee ? 'Registration saved. Your organizer will provide joining details by email.' : msg.body}</p>
          </div>

          {isSuccess && campaign && (
            <div className="lsq-home-result__section">
              {campaign.scheduledAt && (
                <div className="lsq-stack lsq-stack--sm">
                  <p className="lsq-home-result__eyebrow">Webinar starts in</p>
                  <AttendeeCountdown scheduledAt={campaign.scheduledAt.toISOString()} />
                </div>
              )}

              <ul className="lsq-home-meta">
                <li>
                  <Icon name="calendar" size={16} />
                  <span className="lsq-home-meta__text">{eventWhen}</span>
                </li>
                {campaign.speakers && campaign.speakers.length > 0 ? (
                  <li>
                    <Icon name="users" size={16} />
                    <div className="lsq-home-meta__text">
                      <span className="lsq-home-meta__sub">Featured speakers</span>
                      <ul className="lsq-home-speakers">
                        {campaign.speakers.map((spk) => (
                          <li key={spk.id}>
                            <span className="lsq-avatar lsq-avatar--sm" aria-hidden="true">{spk.name.charAt(0).toUpperCase()}</span>
                            <span>
                              <strong>{spk.name}</strong>
                              {(spk.title || spk.company) && (
                                <span className="lsq-home-meta__sub"> — {[spk.title, spk.company].filter(Boolean).join(', ')}</span>
                              )}
                            </span>
                            {spk.isPrimary && <Badge color="blue light" text="Keynote" />}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </li>
                ) : campaign.speakerName ? (
                  <li>
                    <Icon name="user" size={16} />
                    <span className="lsq-home-meta__text">
                      {campaign.speakerName}
                      {campaign.speakerTitle ? ` (${campaign.speakerTitle})` : ''}
                    </span>
                  </li>
                ) : null}
                {location && (
                  <li>
                    <Icon name="video" size={16} />
                    <span className="lsq-home-meta__text">
                      {joinUrl ? 'Online webinar. The join link is below.' : 'Online webinar. The join link will be sent by email.'}
                    </span>
                  </li>
                )}
              </ul>

              {joinUrl && (
                <a
                  href={joinUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="lsq-btn lsq-btn--lg lsq-btn--primary lsq-home-linkbtn lsq-home-full"
                >
                  <Icon name="video" size={18} />
                  Join the Webinar
                </a>
              )}

              {calendarLinks.length > 0 && (
                <div className="lsq-stack lsq-stack--sm">
                  <p className="lsq-home-result__eyebrow" id="result-cal">Save to calendar</p>
                  <div className="lsq-home-cal" role="group" aria-labelledby="result-cal">
                    {calendarLinks.map((l) => (
                      <a
                        key={l.label}
                        href={l.href}
                        {...(l.download ? { download: true } : { target: '_blank', rel: 'noopener noreferrer' })}
                        className="lsq-btn lsq-btn--lg lsq-btn--secondary lsq-home-linkbtn"
                      >
                        <Icon name={l.icon} size={18} />
                        {l.label}
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </section>
      <p className="pub-foot">Powered by LeadSquared Webinar Campaign Engine</p>
    </>
  );
}
