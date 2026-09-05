const MESSAGES: Record<string, { title: string; body: string; tone: 'good' | 'bad' }> = {
  registered: { title: 'You’re registered', body: 'We’ve saved your seat. Joining details are on their way to your inbox.', tone: 'good' },
  already: { title: 'You’re already registered', body: 'No need to do anything else — your seat is saved and the joining details are in your inbox.', tone: 'good' },
  expired: { title: 'This link has expired', body: 'Registration links are valid for a limited time. Ask the sender for a fresh one.', tone: 'bad' },
  'bad-signature': { title: 'This link isn’t valid', body: 'It may have been altered in transit. Ask the sender for a fresh one.', tone: 'bad' },
  malformed: { title: 'This link isn’t valid', body: 'It looks incomplete — some mail clients truncate long links. Ask the sender for a fresh one.', tone: 'bad' },
  'unknown-campaign': { title: 'This webinar is no longer available', body: 'The event this link points to has been removed.', tone: 'bad' },
  'unknown-contact': { title: 'This link isn’t valid', body: 'We couldn’t match it to an invitation. Ask the sender for a fresh one.', tone: 'bad' },
};

// The page a one-click link lands on when there is no join URL to send the
// visitor to, or when the link did not work. Public: this is seen by
// recipients, not operators, so it says nothing about campaigns or contacts.
export default async function RegistrationResultPage(props: PageProps<'/r/result'>) {
  const sp = await props.searchParams;
  const status = typeof sp.status === 'string' ? sp.status : 'malformed';
  const campaign = typeof sp.c === 'string' ? sp.c : null;
  const msg = MESSAGES[status] ?? MESSAGES.malformed;

  return (
    <main
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 32,
        minHeight: '100vh',
      }}
    >
      <div className="lsq-card" style={{ padding: '32px 34px', maxWidth: 460, textAlign: 'center' }}>
        <div
          aria-hidden="true"
          style={{
            width: 44,
            height: 44,
            margin: '0 auto 16px',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 20,
            background: msg.tone === 'good' ? 'var(--success-100)' : 'var(--warning-100)',
            color: msg.tone === 'good' ? 'var(--success-700)' : 'var(--warning-700)',
          }}
        >
          {msg.tone === 'good' ? '✓' : '!'}
        </div>
        <h1 style={{ fontSize: 'var(--fs-heading-4)', fontWeight: 'var(--fw-bold)', color: 'var(--n90)', margin: '0 0 8px' }}>
          {msg.title}
        </h1>
        {campaign && (
          <div style={{ fontSize: 'var(--fs-label-1)', fontWeight: 'var(--fw-semibold)', color: 'var(--n70)', marginBottom: 8 }}>
            {campaign}
          </div>
        )}
        <p style={{ fontSize: 'var(--fs-label-1)', color: 'var(--n60)', lineHeight: 1.6, margin: 0 }}>{msg.body}</p>
      </div>
    </main>
  );
}
