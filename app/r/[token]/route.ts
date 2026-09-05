import { NextResponse } from 'next/server';
import { verifyRegistrationToken } from '@/lib/registration';
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

  // Straight to the join link when there is one — the point of one-click is
  // that the contact ends up somewhere useful, not on a receipt page.
  if (result.joinUrl) return NextResponse.redirect(result.joinUrl);

  return NextResponse.redirect(
    `${origin}/r/result?status=${result.alreadyRegistered ? 'already' : 'registered'}&c=${encodeURIComponent(result.campaignName)}`
  );
}
