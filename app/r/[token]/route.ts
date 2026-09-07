import { NextResponse } from 'next/server';
import { ensureAbsoluteUrl, verifyRegistrationToken } from '@/lib/registration';
import { registerContact } from '@/lib/registerContact';

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

  const result = await registerContact(verified.payload.campaignId, verified.payload.contactId, 'one_click');

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
  return NextResponse.redirect(
    `${origin}/r/result?status=${result.alreadyRegistered ? 'already' : 'registered'}&t=${encodeURIComponent(token)}`
  );
}
