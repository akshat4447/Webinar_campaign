import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { db } from '@/lib/db';
import { appOrigin } from '@/lib/appOrigin';
import { verifyRegistrationToken } from '@/lib/registration';
import { registrationModeOf, buildPublicLandingUrl } from '@/lib/inviteLink';
import { registrationAvailability, CLOSED_COPY } from '@/lib/registrationAvailability';
import { formatLsqDateTime, timeZoneLabel } from '@/lib/dateFormat';
import { RegisterForm } from './RegisterForm';

// Public, per-webinar registration page (registration mode "zoom"). Anyone with the link can register;
// someone arriving with a signed token (from an invite) gets their details pre-filled and, if they
// already registered, is sent straight to their confirmation.
export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const c = await db.campaign.findUnique({ where: { id }, select: { name: true } }).catch(() => null);
  return { title: c ? `Register — ${c.name}` : 'Webinar Registration' };
}

export default async function RegisterPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const channel = (first(sp.c) || 'website').toLowerCase().slice(0, 40);
  const token = first(sp.t) || null;

  const campaign = await db.campaign.findUnique({
    where: { id },
    select: {
      id: true, name: true, description: true, scheduledAt: true, date: true, timezone: true, durationMinutes: true,
      status: true, archived: true, capacity: true, registrations: true,
      registrationMode: true, registrationLink: true, oneClickSignup: true, zoomMeetingId: true,
      speakers: { orderBy: [{ order: 'asc' }, { id: 'asc' }], select: { name: true, title: true, company: true } },
    },
  });
  if (!campaign) notFound();

  // Webinars that use the operator's own landing page send people there instead — one front door per webinar.
  if (registrationModeOf(campaign) === 'external' && campaign.registrationLink) {
    const url = buildPublicLandingUrl({ landingPageUrl: campaign.registrationLink, campaign, channel, appOrigin: appOrigin() });
    if (url) redirect(url);
  }

  // Identity from a valid invite token (never from the query string).
  let defaults = { firstName: '', lastName: '', email: '' };
  const verified = token ? verifyRegistrationToken(token) : null;
  if (verified?.ok && verified.payload.campaignId === campaign.id) {
    const contact = await db.contact.findUnique({ where: { id: verified.payload.contactId }, select: { name: true, email: true, registeredAt: true, campaignId: true } });
    if (contact && contact.campaignId === campaign.id) {
      if (contact.registeredAt) redirect(`/r/result?status=already&t=${encodeURIComponent(token as string)}`);
      const [fn, ...rest] = contact.name.trim().split(/\s+/);
      defaults = { firstName: fn || '', lastName: rest.join(' '), email: contact.email ?? '' };
    }
  }

  const availability = registrationAvailability(campaign);
  const when = campaign.scheduledAt ? `${formatLsqDateTime(campaign.scheduledAt, campaign.timezone)} ${timeZoneLabel(campaign.scheduledAt, campaign.timezone)}` : campaign.date;
  const speakers = campaign.speakers.map((s) => [s.name, s.title].filter(Boolean).join(', ')).filter(Boolean);

  return (
    <>
      <p className="pub-brand">Webinar Registration</p>
      <section className="lsq-card" aria-labelledby="pub-title">
        <div className="lsq-card__body lsq-stack lsq-stack--lg">
          <div>
            <h1 id="pub-title" className="pub-title">{campaign.name}</h1>
            <p className="pub-meta">
              {when ? <span>{when}</span> : null}
              {speakers.length ? <span>{speakers.join(' · ')}</span> : null}
            </p>
          </div>

          {campaign.description ? <p className="lsq-hint lsq-home-prewrap">{campaign.description.slice(0, 600)}</p> : null}

          {availability.open ? (
            <RegisterForm campaignId={campaign.id} channel={channel} token={verified?.ok ? token : null} defaults={defaults} />
          ) : (
            <div className="lsq-banner lsq-banner--neutral" role="status">
              <div>
                <p className="lsq-banner__title">{CLOSED_COPY[availability.reason].title}</p>
                <p className="lsq-banner__body">{CLOSED_COPY[availability.reason].body}</p>
              </div>
            </div>
          )}
        </div>
      </section>
      <p className="pub-foot">Joining details and reminders are sent to the email address used to register.</p>
    </>
  );
}
