import { NextResponse } from 'next/server';
import { ensureAbsoluteUrl, verifyRegistrationToken } from '@/lib/registration';
import { registerContact } from '@/lib/registerContact';
import { cleanSource } from '@/lib/landingInput';
import { db } from '@/lib/db';
import { registrationModeOf } from '@/lib/inviteLink';
import { buildLandingPageUrl } from '@/lib/landingPageServer';

// One-click sign-up. A contact clicks the link in their invite and is
// registered outright — no landing page, no form.
//
// GET, because it is reached by clicking a link in an email. That means it
// must be safe to call repeatedly: mail clients prefetch, security scanners
// follow links, and people click twice. Everything here is idempotent.
export async function GET(request: Request, ctx: RouteContext<'/r/[token]'>) {
  const { token } = await ctx.params;
  const origin = new URL(request.url).origin;

  const verified = verifyRegistrationToken(token);
  if (!verified.ok) {
    // Deliberately vague to the visitor and specific in the URL, so support can
    // tell an expired link from a forged one without telling an attacker.
    return NextResponse.redirect(`${origin}/r/result?status=${verified.reason}`);
  }

  const searchParams = new URL(request.url).searchParams;
  // The channel tag comes from a query string anyone can edit: reduce it to a short slug (else the default).
  const rawSource = searchParams.get('source');
  const cleaned = rawSource ? cleanSource(rawSource) : 'one_click';
  const source = cleaned === 'framer_landing_page' && rawSource?.toLowerCase() !== 'framer_landing_page' ? 'one_click' : cleaned;

  // External-landing-page webinars: a short link expands to the full landing URL. The visitor still
  // registers through the page's own form, so nothing is registered here.
  const campaign = await db.campaign.findUnique({
    where: { id: verified.payload.campaignId },
    select: { id: true, name: true, zoomMeetingId: true, registrationMode: true, registrationLink: true, oneClickSignup: true, landingPrefill: true },
  });
  if (campaign && registrationModeOf(campaign) === 'external' && campaign.registrationLink) {
    const contact = await db.contact.findUnique({
      where: { id: verified.payload.contactId },
      select: { id: true, campaignId: true, name: true, email: true, phone: true, account: true, title: true },
    });
    if (contact && contact.campaignId === campaign.id) {
      const target = buildLandingPageUrl({
        landingPageUrl: campaign.registrationLink,
        campaign: { id: campaign.id, name: campaign.name, zoomMeetingId: campaign.zoomMeetingId },
        contact,
        channel: source === 'one_click' ? 'email' : source,
        apiOrigin: origin,
        prefill: Boolean(campaign.landingPrefill),
      });
      if (target) return NextResponse.redirect(target);
    }
  }

  const result = await registerContact(verified.payload.campaignId, verified.payload.contactId, source, undefined, { enforceAvailability: true });

  if (!result.ok) {
    return NextResponse.redirect(`${origin}/r/result?status=${result.reason}`);
  }

  // If the webinar is happening right now or starting within 15 minutes, send straight to the join link.
  // Otherwise, route to the Attendee Calendar Hub where they can save it to Google/Outlook Calendar and .ics.
  const isStartingSoon =
    result.scheduledAt &&
    result.scheduledAt.getTime() - Date.now() <= 15 * 60 * 1000 &&
    result.scheduledAt.getTime() - Date.now() >= -3 * 60 * 60 * 1000;

  if (isStartingSoon && result.joinUrl) {
    return NextResponse.redirect(ensureAbsoluteUrl(result.joinUrl));
  }

  // Carry the same signed token forward rather than a raw campaignId — the
  // result page re-verifies it before showing any campaign detail, so this
  // stays gated to the person who actually registered instead of anyone who
  // can guess or enumerate a campaignId in the URL.
  const autoCalParam = !result.alreadyRegistered ? '&autoCal=1' : '';
  return NextResponse.redirect(
    `${origin}/r/result?status=${result.alreadyRegistered ? 'already' : 'registered'}&t=${encodeURIComponent(token)}${autoCalParam}`
  );
}
