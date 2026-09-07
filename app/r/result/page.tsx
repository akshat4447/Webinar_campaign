import { db } from '@/lib/db';
import { verifyRegistrationToken } from '@/lib/registration';
import { AttendeeCountdown } from './AttendeeCountdown';

const MESSAGES: Record<string, { title: string; body: string; tone: 'good' | 'bad' }> = {
  registered: { title: 'You’re registered!', body: 'We’ve saved your seat. Check below to add the session directly to your calendar so you don’t miss it.', tone: 'good' },
  already: { title: 'You’re already registered!', body: 'Your seat is saved. Check below to make sure you have the session saved to your calendar.', tone: 'good' },
  expired: { title: 'This link has expired', body: 'Registration links are valid for a limited time. Ask the sender for a fresh one.', tone: 'bad' },
  'bad-signature': { title: 'This link isn’t valid', body: 'It may have been altered in transit. Ask the sender for a fresh one.', tone: 'bad' },
  malformed: { title: 'This link isn’t valid', body: 'It looks incomplete — some mail clients truncate long links. Ask the sender for a fresh one.', tone: 'bad' },
  'unknown-campaign': { title: 'This webinar is no longer available', body: 'The event this link points to has been removed.', tone: 'bad' },
  'unknown-contact': { title: 'This link isn’t valid', body: 'We couldn’t match it to an invitation. Ask the sender for a fresh one.', tone: 'bad' },
};

function formatGoogleCalendarDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export const dynamic = 'force-dynamic';

export default async function RegistrationResultPage(props: PageProps<'/r/result'>) {
  const sp = await props.searchParams;
  const status = typeof sp.status === 'string' ? sp.status : 'malformed';
  const tokenParam = typeof sp.t === 'string' ? sp.t : null;

  const msg = MESSAGES[status] ?? MESSAGES.malformed;
  const isSuccess = msg.tone === 'good';

  // Public: seen by whoever clicks the link, not just the operator. Only ever
  // look up (and show) a campaign's details when the request carries the same
  // signed, TTL-checked registration token /r/[token] verified — never trust a
  // raw campaignId query param, or anyone who can guess/enumerate one could
  // see another registrant's webinar name, description, speaker, and Zoom link.
  const verified = tokenParam ? verifyRegistrationToken(tokenParam) : null;
  let campaign = null;
  if (verified?.ok) {
    campaign = await db.campaign.findUnique({
      where: { id: verified.payload.campaignId },
      select: {
        id: true,
        name: true,
        date: true,
        scheduledAt: true,
        description: true,
        speakerName: true,
        speakerTitle: true,
        zoomLink: true,
        registrationLink: true,
      },
    });
  }

  const title = campaign?.name || 'Webinar Session';
  const startTime = campaign?.scheduledAt ? new Date(campaign.scheduledAt) : null;
  const endTime = startTime ? new Date(startTime.getTime() + 60 * 60 * 1000) : null;
  const location = campaign?.zoomLink || campaign?.registrationLink || 'Online Zoom Session';
  const details = `${campaign?.description || title}${campaign?.speakerName ? `\n\nSpeaker: ${campaign.speakerName}` : ''}\n\nJoin Link: ${location}`;

  // Calendar URLs
  const googleCalUrl = startTime && endTime
    ? `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${formatGoogleCalendarDate(startTime)}/${formatGoogleCalendarDate(endTime)}&details=${encodeURIComponent(details)}&location=${encodeURIComponent(location)}`
    : null;

  const outlookCalUrl = startTime && endTime
    ? `https://outlook.live.com/calendar/0/deeplink/compose?subject=${encodeURIComponent(title)}&startdt=${startTime.toISOString()}&enddt=${endTime.toISOString()}&body=${encodeURIComponent(details)}&location=${encodeURIComponent(location)}`
    : null;

  const icsUrl = campaign && tokenParam ? `/api/calendar/${campaign.id}?t=${encodeURIComponent(tokenParam)}` : null;

  return (
    <main
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '32px 16px',
        minHeight: '100vh',
        background: 'var(--n10)',
      }}
    >
      <div
        className="lsq-card"
        style={{
          padding: '36px 32px',
          maxWidth: 520,
          width: '100%',
          textAlign: 'center',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-panel)',
          background: '#fff',
        }}
      >
        {/* Status Icon */}
        <div
          aria-hidden="true"
          style={{
            width: 48,
            height: 48,
            margin: '0 auto 16px',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 22,
            background: isSuccess ? 'var(--success-100)' : 'var(--danger-100)',
            color: isSuccess ? 'var(--success-700)' : 'var(--danger-700)',
          }}
        >
          {isSuccess ? '✓' : '!'}
        </div>

        <h1 style={{ fontSize: 'var(--fs-heading-4)', fontWeight: 700, color: 'var(--n90)', margin: '0 0 8px' }}>
          {msg.title}
        </h1>

        <div style={{ fontSize: 'var(--fs-body)', fontWeight: 600, color: 'var(--accent-600)', marginBottom: 8 }}>
          {title}
        </div>

        <p style={{ fontSize: 'var(--fs-label-1)', color: 'var(--n60)', lineHeight: 1.6, margin: '0 0 16px' }}>
          {msg.body}
        </p>

        {isSuccess && campaign && (
          <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 20, marginTop: 16 }}>
            {/* Countdown */}
            {campaign.scheduledAt && (
              <>
                <div style={{ fontSize: 'var(--fs-label-2)', fontWeight: 600, color: 'var(--n50)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Webinar Starts In
                </div>
                <AttendeeCountdown scheduledAt={campaign.scheduledAt.toISOString()} />
              </>
            )}

            {/* Event Meta Box */}
            <div style={{ background: 'var(--n10)', borderRadius: 'var(--radius-md)', padding: '14px 16px', textAlign: 'left', marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 14 }}>📅</span>
                <span style={{ fontSize: 'var(--fs-label-1)', fontWeight: 600, color: 'var(--n80)' }}>
                  {campaign.date || (startTime ? startTime.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' }) : 'Date TBD')}
                </span>
              </div>
              {campaign.speakerName && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 14 }}>🎙️</span>
                  <span style={{ fontSize: 'var(--fs-label-1)', color: 'var(--n70)' }}>
                    {campaign.speakerName} {campaign.speakerTitle ? `(${campaign.speakerTitle})` : ''}
                  </span>
                </div>
              )}
              {location && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 14 }}>📍</span>
                  <span style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n60)', overflowWrap: 'anywhere' }}>
                    {campaign.zoomLink ? 'Online Webinar (join link below)' : 'Online Webinar (join link will be sent to your inbox)'}
                  </span>
                </div>
              )}
            </div>

            {/* 1-Click Calendar Add Actions */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 'var(--fs-label-2)', fontWeight: 700, color: 'var(--n70)', marginBottom: 10 }}>
                SAVE TO YOUR CALENDAR
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
                {googleCalUrl && (
                  <a
                    href={googleCalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '8px 14px',
                      borderRadius: 'var(--radius-md)',
                      background: '#fff',
                      border: '1px solid var(--border-subtle)',
                      fontSize: 'var(--fs-label-1)',
                      fontWeight: 600,
                      color: 'var(--n80)',
                      textDecoration: 'none',
                      boxShadow: 'var(--shadow-card)',
                    }}
                  >
                    <span>📅</span> Google Calendar
                  </a>
                )}
                {outlookCalUrl && (
                  <a
                    href={outlookCalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '8px 14px',
                      borderRadius: 'var(--radius-md)',
                      background: '#fff',
                      border: '1px solid var(--border-subtle)',
                      fontSize: 'var(--fs-label-1)',
                      fontWeight: 600,
                      color: 'var(--n80)',
                      textDecoration: 'none',
                      boxShadow: 'var(--shadow-card)',
                    }}
                  >
                    <span>📧</span> Outlook
                  </a>
                )}
                {icsUrl && (
                  <a
                    href={icsUrl}
                    download
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '8px 14px',
                      borderRadius: 'var(--radius-md)',
                      background: '#fff',
                      border: '1px solid var(--border-subtle)',
                      fontSize: 'var(--fs-label-1)',
                      fontWeight: 600,
                      color: 'var(--n80)',
                      textDecoration: 'none',
                      boxShadow: 'var(--shadow-card)',
                    }}
                  >
                    <span>📥</span> Apple / iCal (.ics)
                  </a>
                )}
              </div>
            </div>

            {/* Direct Join Link if available */}
            {campaign.zoomLink && (
              <div style={{ marginTop: 18 }}>
                <a
                  href={campaign.zoomLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'block',
                    padding: '10px 18px',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--accent-500)',
                    color: '#fff',
                    fontWeight: 700,
                    fontSize: 'var(--fs-label-1)',
                    textDecoration: 'none',
                  }}
                >
                  Join Meeting Room Directly
                </a>
              </div>
            )}
          </div>
        )}

        <div style={{ marginTop: 24, fontSize: 'var(--fs-label-2)', color: 'var(--n50)' }}>
          Powered by LeadSquared Webinar Campaign Engine
        </div>
      </div>
    </main>
  );
}
