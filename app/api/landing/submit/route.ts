import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyRegistrationToken, mintRegistrationToken } from '@/lib/registration';
import { registerContact, registerContactTx, scheduleRegistrationJobs } from '@/lib/registerContact';
import { registrationAvailability } from '@/lib/registrationAvailability';
import { buildCalendarUrls } from '@/lib/calendar';
import { parseLegacyWebinarDate } from '@/lib/campaignDate';
import { parseLandingPayload } from '@/lib/landingInput';
import { allowRequest, clientIp } from '@/lib/rateLimit';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

const json = (body: Record<string, unknown>, status: number, extra: Record<string, string> = {}) =>
  NextResponse.json(body, { status, headers: { ...CORS_HEADERS, ...extra } });

// Per-IP and per-(campaign,email) ceilings for this unauthenticated endpoint.
const IP_LIMIT = { limit: 10, windowMs: 60_000 };
const EMAIL_LIMIT = { limit: 3, windowMs: 10 * 60_000 };

/**
 * Public registration beacon for landing pages (CORS-open by design, so it must
 * be defensive): bodies are validated and length-capped, a honeypot silently
 * drops bots, and both the caller's IP and the target email are rate limited so
 * the endpoint cannot be used to mass-create contacts or to trigger
 * confirmation emails to someone else's address.
 */
export async function POST(req: NextRequest) {
  try {
    const ip = await allowRequest({ scope: 'landing-ip', key: clientIp(req.headers), ...IP_LIMIT });
    if (!ip.allowed) {
      return json({ ok: false, error: 'Too many requests — please try again shortly' }, 429, { 'Retry-After': String(ip.retryAfterSec) });
    }

    let raw: unknown = null;
    try {
      raw = JSON.parse(await req.text());
    } catch {
      raw = null;
    }
    const parsed = parseLandingPayload(raw);
    if (!parsed.ok) return json({ ok: false, error: parsed.error }, 400);
    const { token, firstName, lastName, phone, company, jobTitle, source, email, honeypotTripped } = parsed.data;

    // A bot filled the hidden field: answer exactly like success, do nothing.
    if (honeypotTripped) return json({ ok: true, alreadyRegistered: false }, 200);

    let campaignId = parsed.data.campaignId;
    let contactId: string | null = null;

    // Strategy 1: Cryptographic Bearer Token
    if (token && typeof token === 'string') {
      const verified = verifyRegistrationToken(token);
      if (!verified.ok) return json({ ok: false, error: 'Invalid registration link' }, 400);
      if (verified.ok) {
        campaignId = verified.payload.campaignId;
        contactId = verified.payload.contactId;
      }
    }

    // Validate campaign exists
    if (!campaignId) {
      return json({ ok: false, error: 'campaignId or valid registration token is required' }, 400);
    }

    const campaign = await db.campaign.findUnique({
      where: { id: campaignId },
    });

    if (!campaign) {
      return json({ ok: false, error: 'Campaign not found' }, 404);
    }

    // Strategy 2: If no token contactId or token was unverified, resolve contact by email
    if (!contactId) {
      if (!email) {
        return json({ ok: false, error: 'Email address or valid token is required for registration' }, 400);
      }

      // Without a token anyone can submit anyone's email, so bound how often one
      // address can be (re)registered — a victim must not be mail-bombed.
      const perEmail = await allowRequest({ scope: 'landing-email', key: `${campaignId}:${email}`, ...EMAIL_LIMIT });
      if (!perEmail.allowed) {
        return json({ ok: false, error: 'Too many attempts for this email — please try again later' }, 429, { 'Retry-After': String(perEmail.retryAfterSec) });
      }

      const inbound = await db.$transaction(async tx => {
        await tx.$queryRaw`SELECT "id" FROM "Campaign" WHERE "id" = ${campaignId} FOR UPDATE`;
        const current = await tx.campaign.findUniqueOrThrow({ where: { id: campaignId } });
        let contact = await tx.contact.findFirst({ where: { campaignId, email: { equals: email.trim().toLowerCase(), mode: 'insensitive' } } });
        if (contact?.registeredAt) return { closed: null, accepted: true };
        const availability = registrationAvailability(current);
        if (!availability.open) return { closed: availability.reason, accepted: false };
        if (!contact) contact = await tx.contact.create({ data: {
          campaignId, name: [firstName, lastName].filter(Boolean).join(' ') || email.split('@')[0], email: email.trim().toLowerCase(), phone: phone || null,
          account: company || 'Inbound Registrant', vertical: current.vertical || 'Unassigned', title: jobTitle || 'Registrant', function: 'General', seniority: 'Professional',
          score: null, approved: false, source: 'Website Registration', extraFieldsJson: JSON.stringify({ inboundSource: source }),
        } });
        const result = await registerContactTx(tx, campaignId, contact.id, source, undefined, { enforceAvailability: true });
        if (!result.ok) throw new Error('Registration reservation failed.');
        return { closed: null, accepted: true, contactId: contact.id };
      }, { timeout: 15_000 });
      if (inbound.closed) return json({ ok: false, error: 'Registration is closed', reason: inbound.closed }, 409);
      if (inbound.contactId) scheduleRegistrationJobs(inbound.contactId);
      // An email address alone never reveals attendee bearer credentials or a personal join URL.
      return json({ ok: true, message: 'Registration saved. Joining details will be provided by email.' }, 200);
    }

    // A closed webinar (ended / archived / full) takes no NEW registrations — but someone who is already
    // registered still gets their confirmation back. Enforced inside registerContact so every entry point agrees.
    const result = await registerContact(campaignId, contactId, source, undefined, { enforceAvailability: true });

    if (!result.ok) {
      if (result.reason === 'closed') return json({ ok: false, error: 'Registration is closed', reason: result.closedReason }, 409);
      return json({ ok: false, error: result.reason }, 400);
    }

    const regToken = mintRegistrationToken(campaignId, contactId);
    const origin = req.nextUrl?.origin || '';
    const effectiveStartTime = campaign.scheduledAt ?? (campaign.date ? parseLegacyWebinarDate(campaign.date) : null);
    const calendar = effectiveStartTime
      ? buildCalendarUrls(
          {
            title: campaign.name,
            description: campaign.description || campaign.name,
            location: result.joinUrl || campaign.zoomLink || campaign.registrationLink || 'Online Event',
            startTime: effectiveStartTime,
            durationMinutes: campaign.durationMinutes,
            campaignId: campaign.id,
            token: regToken,
          },
          origin
        )
      : null;

    return json(
      {
        ok: true,
        alreadyRegistered: result.alreadyRegistered,
        token: regToken,
        joinUrl: result.joinUrl,
        campaignName: result.campaignName,
        campaignId: result.campaignId,
        scheduledAt: result.scheduledAt,
        calendar,
      },
      200
    );
  } catch (err) {
    // Log the detail; never echo internals (DB errors, stack hints) to a public caller.
    console.error('[api/landing/submit] Registration beacon error:', err);
    return json({ ok: false, error: 'Internal server error' }, 500);
  }
}
