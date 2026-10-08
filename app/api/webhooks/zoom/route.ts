import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { registerContact } from '@/lib/registerContact';
import { resolveIntegrationField } from '@/lib/integrationConfig';
import { claimOnce, idemKey, release } from '@/lib/idempotency';
import { verifyZoomSignature, zoomCrcResponse } from '@/lib/zoom/webhookSecurity';
import { markMeetingEnded } from '@/lib/zoomEnded';

import { resolveContactRegistrationChannel } from '@/lib/registrationChannels';

export const dynamic = 'force-dynamic';

interface ZoomRegistrant {
  id?: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  org?: string;
  job_title?: string;
  join_url?: string;
  create_time?: string;
  tracking_source?: string;
  source?: string;
}

interface ZoomEvent {
  event?: string;
  event_ts?: number;
  payload?: {
    plainToken?: string;
    object?: { id?: string | number; uuid?: string; registrant?: ZoomRegistrant };
  };
}

/**
 * Zoom Webhook Handler
 *
 * Every request is authenticated with Zoom's HMAC-SHA256 signature
 * (`x-zm-signature` over `v0:{x-zm-request-timestamp}:{body}`) — an unsigned or
 * stale request is rejected with 401 before anything is parsed or written.
 * Without a configured secret token the endpoint refuses everything: there is
 * no default secret.
 *
 * Handles:
 * 1. Zoom endpoint URL validation (CRC challenge `endpoint.url_validation`)
 * 2. `webinar.registration_created` & `meeting.registration_created`
 * 3. `meeting.ended` & `webinar.ended` — records the end so attendance (and the
 *    LeadSquared attended / no-show follow-up) is imported within minutes
 *    instead of waiting for the slow fallback poll.
 *
 * Events are de-duplicated on (event, event_ts, object id, registrant) so a
 * Zoom retry never registers twice. If processing fails the claim is released
 * and a 500 is returned so Zoom redelivers.
 */
export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  const secret = await resolveIntegrationField('zoom', 'webhookSecret');
  if (!secret) {
    console.error('[zoom-webhook] No webhook secret token configured (Integrations → Zoom or ZOOM_WEBHOOK_SECRET) — rejecting all events.');
    return NextResponse.json({ ok: false, error: 'Webhook secret not configured' }, { status: 401 });
  }

  const verdict = verifyZoomSignature({
    secret,
    rawBody,
    signature: req.headers.get('x-zm-signature'),
    timestamp: req.headers.get('x-zm-request-timestamp'),
  });
  if (!verdict.ok) {
    console.warn(`[zoom-webhook] rejected request: ${verdict.reason}`);
    return NextResponse.json({ ok: false, error: 'Invalid signature' }, { status: 401 });
  }

  let event: ZoomEvent;
  try {
    event = JSON.parse(rawBody) as ZoomEvent;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON payload' }, { status: 400 });
  }

  // 1. Zoom Webhook URL Validation challenge
  if (event.event === 'endpoint.url_validation') {
    const plainToken = event.payload?.plainToken;
    if (!plainToken) return NextResponse.json({ ok: false, error: 'Missing plainToken' }, { status: 400 });
    return NextResponse.json(zoomCrcResponse(secret, plainToken));
  }

  const obj = event.payload?.object;
  const meetingId = String(obj?.id ?? '');
  const registrant = obj?.registrant;

  const isRegistration = event.event === 'webinar.registration_created' || event.event === 'meeting.registration_created';
  const isEnded = event.event === 'meeting.ended' || event.event === 'webinar.ended';
  if (!isRegistration && !isEnded) {
    return NextResponse.json({ ok: true, ignored: event.event });
  }

  if (!meetingId || (isRegistration && !registrant?.email)) {
    return NextResponse.json({ ok: false, error: 'Missing meetingId or registrant email' }, { status: 400 });
  }

  const dedupeKey = idemKey('zoom-event', event.event, event.event_ts, meetingId, registrant?.id ?? registrant?.email?.toLowerCase());
  if (!(await claimOnce(dedupeKey))) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  try {
    // Find campaign by Zoom Meeting ID
    const campaign = await db.campaign.findFirst({ where: { zoomMeetingId: meetingId } });
    if (!campaign) {
      console.warn(`[Zoom Webhook] Received ${event.event} for unlinked Zoom meeting: ${meetingId}`);
      return NextResponse.json({ ok: true, note: 'No matching campaign found' });
    }

    if (isEnded) {
      await markMeetingEnded(campaign.id, event.event_ts ? new Date(event.event_ts) : new Date());
      return NextResponse.json({ ok: true, ended: campaign.id });
    }

    const reg = registrant as ZoomRegistrant;
    const email = (reg.email as string).trim().toLowerCase();
    const existingContact = await db.contact.findFirst({
      where: { campaignId: campaign.id, email: { equals: email, mode: 'insensitive' } },
    });

    const regDate = reg.create_time ? new Date(reg.create_time) : new Date();
    const rawSource = reg.tracking_source || reg.source || '';
    const regSource = rawSource ? resolveContactRegistrationChannel({ registrationSource: rawSource, id: '' }, new Map()) : 'zoom';

    if (existingContact) {
      await registerContact(campaign.id, existingContact.id, regSource, regDate);
      if (reg.join_url) {
        await db.contact.update({
          where: { id: existingContact.id },
          data: { zoomJoinUrl: reg.join_url, zoomRegistrantId: String(reg.id || '') },
        });
      }
    } else {
      // Direct / organic Zoom registrant: create contact record in this campaign
      const fullName = `${reg.first_name || ''} ${reg.last_name || ''}`.trim() || 'Attendee';

      const newContact = await db.contact.create({
        data: {
          campaignId: campaign.id,
          name: fullName,
          email,
          account: reg.org || 'Direct Sign-up',
          title: reg.job_title || 'Attendee',
          function: 'General',
          seniority: 'Professional',
          vertical: campaign.vertical || 'General',
          source: 'Zoom',
          approved: true,
          approvedManually: true,
          registeredAt: regDate,
          registrationSource: regSource,
          zoomJoinUrl: reg.join_url || null,
          zoomRegistrantId: String(reg.id || ''),
        },
      });

      await registerContact(campaign.id, newContact.id, regSource, regDate);
    }

    return NextResponse.json({ ok: true, registered: email });
  } catch (err) {
    // Let Zoom redeliver: give the claim back so the retry is not swallowed as a duplicate.
    await release(dedupeKey).catch(() => undefined);
    console.error('[Zoom Webhook Error]:', err);
    return NextResponse.json({ ok: false, error: 'Processing failed' }, { status: 500 });
  }
}
