import { timingSafeEqual } from 'crypto';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveIntegrationField } from '@/lib/integrationConfig';
import { verifyRegistrationToken } from '@/lib/registration';
import { registerContact } from '@/lib/registerContact';
import { addEmailToSuppression } from '@/lib/netcore';

function timingSafeEqualStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

interface NetcoreWebhookEvent {
  TRANSID?: string | number;
  EVENT?: string;
  event?: string;
  EMAIL?: string;
  email?: string;
  URL?: string;
  url?: string;
  TIMESTAMP?: number;
  REASON?: string;
  reason?: string;
  MESSAGEID?: string;
  TAGS?: string[] | string;
}

export async function POST(req: Request) {
  const configuredSecret = (await resolveIntegrationField('netcore', 'webhookSecret')) || process.env.NETCORE_WEBHOOK_SECRET;

  // Header or query-param secret verification
  if (configuredSecret && configuredSecret.trim() !== '') {
    const url = new URL(req.url);
    const secretHeader = req.headers.get('x-netcore-secret') || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    const querySecret = url.searchParams.get('secret');
    const provided = secretHeader || querySecret;

    if (!provided || !timingSafeEqualStrings(provided, configuredSecret.trim())) {
      return NextResponse.json({ ok: false, error: 'Unauthorized: invalid or missing Netcore webhook secret' }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ ok: false, error: 'Server misconfiguration: NETCORE_WEBHOOK_SECRET is not configured' }, { status: 500 });
  } else {
    console.warn('[netcore-webhook] No webhookSecret configured — accepting UNSIGNED payload (dev only).');
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Malformed JSON payload' }, { status: 400 });
  }

  const rawEvents: NetcoreWebhookEvent[] = Array.isArray(body) ? body : typeof body === 'object' && body !== null ? [body] : [];
  if (rawEvents.length === 0) {
    return NextResponse.json({ ok: true, processed: 0 });
  }

  let registeredCount = 0;
  let suppressedCount = 0;
  let erroredCount = 0;

  for (const item of rawEvents) {
   try {
    const eventType = (item.EVENT || item.event || '').toLowerCase();
    const recipientEmail = (item.EMAIL || item.email || '').trim().toLowerCase();
    const targetUrl = item.URL || item.url || '';
    const reason = item.REASON || item.reason || null;

    if (!recipientEmail && !targetUrl) continue;

    // 1. Click event on webinar registration link -> Dual instant registration
    if (eventType === 'click') {
      const match = targetUrl.match(/\/r\/([a-zA-Z0-9_\-\.]+)/);
      if (match && match[1]) {
        const token = match[1];
        const verified = verifyRegistrationToken(token);
        if (verified.ok) {
          const regRes = await registerContact(verified.payload.campaignId, verified.payload.contactId, 'netcore_click');
          if (regRes.ok && !regRes.alreadyRegistered) {
            registeredCount++;
            await db.activityLogEntry.create({
              data: {
                campaignId: verified.payload.campaignId,
                text: `Netcore click-to-register: ${recipientEmail || 'Attendee'} registered for webinar (pre-registration outreach stopped)`,
                dot: 'var(--success-500)',
              },
            }).catch(() => {});
          }
        }
      }
    }

    // 2. Hard bounces -> Record in suppression list and fail pending sends
    else if (eventType === 'hardbounce' || eventType === 'bounce' || eventType === 'invalid' || eventType === 'drop') {
      if (recipientEmail) {
        await addEmailToSuppression(recipientEmail, 'bounce', reason || 'Hard bounce reported by Netcore', 'netcore');
        suppressedCount++;

        // Cancel any pending sends to this recipient
        const contacts = await db.contact.findMany({
          where: { email: { equals: recipientEmail, mode: 'insensitive' } },
          select: { id: true, campaignId: true },
        });

        if (contacts.length > 0) {
          await db.cadenceSend.updateMany({
            where: { contactId: { in: contacts.map((c) => c.id) }, status: { in: ['queued', 'processing'] } },
            data: { status: 'failed', claimedAt: null, error: `Hard bounce: ${reason || 'User unknown'}` },
          }).catch(() => {});
        }
      }
    }

    // 3. Unsubscribes and Spam complaints -> Add to suppression and unapprove contact
    else if (eventType === 'unsub' || eventType === 'unsubscribe' || eventType === 'spam') {
      if (recipientEmail) {
        const kind = eventType === 'spam' ? 'spam' : 'unsubscribe';
        await addEmailToSuppression(recipientEmail, kind, reason || `Netcore ${eventType} event`, 'netcore');
        suppressedCount++;

        await db.contact.updateMany({
          where: { email: { equals: recipientEmail, mode: 'insensitive' } },
          data: { approved: false, unsubscribedAt: new Date() },
        }).catch(() => {});
      }
    }
   } catch (itemErr) {
    // Isolate one malformed/DB-hiccup event from the rest of the batch —
    // without this, a single bad event 500s the whole delivery and loses the
    // result (and Netcore's retry) for every already-processed item too.
    erroredCount++;
    console.error('[netcore-webhook] event processing failed:', itemErr);
   }
  }

  // Per-item isolation (above) deliberately keeps one bad event from 500-ing
  // a whole batch. But if EVERY item in the batch errored, that's not "a few
  // malformed events" — it's almost certainly a systemic failure (DB outage,
  // etc.), and answering 200 would tell Netcore delivery succeeded, so it
  // would never retry and these events would be lost permanently.
  const allFailed = rawEvents.length > 0 && erroredCount === rawEvents.length;

  return NextResponse.json(
    {
      ok: !allFailed,
      processed: rawEvents.length,
      registered: registeredCount,
      suppressed: suppressedCount,
      ...(erroredCount > 0 ? { errored: erroredCount } : {}),
    },
    { status: allFailed ? 500 : 200 }
  );
}

export async function HEAD() {
  return new Response(null, { status: 200 });
}

export async function GET() {
  return NextResponse.json({
    status: 'active',
    endpoint: '/api/webhooks/netcore',
    description: 'Inbound webhook listener for Netcore Cloud delivery, bounce, unsubscribe, and click events',
  });
}
