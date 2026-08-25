// Lead Sync webhook receiver — the app's entry point for every LinkedIn
// Event registration. Contract honored here:
//   • respond 200 FAST; LinkedIn retries non-200s, so anything slow or risky
//     happens in `after()` against an idempotent queue row.
//   • GET with ?challengeCode is LinkedIn's webhook-verification handshake —
//     echo it back verbatim within a second.
//   • X-LI-Signature = hex(HMAC-SHA256(rawBody, clientSecret)) — verified
//     whenever a secret is configured, skipped otherwise (local dev).
import { after } from 'next/server';
import { db } from '@/lib/db';
import { resolveIntegrationField } from '@/lib/integrationConfig';
import { parseLeadActionPayload, verifyLinkedInSignature } from '@/lib/linkedin/webhook';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const challengeCode = new URL(request.url).searchParams.get('challengeCode');
  if (challengeCode) return Response.json({ challengeCode });
  return Response.json({ status: 'ok', service: 'linkedin-event-lead-sync' });
}

export async function POST(request: Request) {
  const raw = await request.text();

  let secret = '';
  try {
    secret = (await resolveIntegrationField('linkedin', 'clientSecret')) || process.env.LINKEDIN_CLIENT_SECRET || '';
  } catch {
    /* DB not reachable yet — fall through to unsigned handling below */
  }
  if (secret) {
    const signature = request.headers.get('x-li-signature') ?? '';
    if (!verifyLinkedInSignature(raw, secret, signature)) {
      return new Response('Invalid signature', { status: 401 });
    }
  }

  const parsed = parseLeadActionPayload(raw);
  if (!parsed.ok) {
    // Wrong topic/leadType isn't an error — acknowledge so LinkedIn stops retrying.
    if (parsed.reason === 'ignored_type') return Response.json({ ignored: true, detail: parsed.detail }, { status: 202 });
    return Response.json({ error: parsed.detail }, { status: 400 });
  }

  const campaign = await db.campaign.findFirst({
    where: { linkedinEventUrn: parsed.eventUrn },
    select: { id: true },
  });

  // Redelivery semantics: a pure duplicate (same action) must NOT re-run the
  // pipeline — but a *state change* (a withdraw arriving after the signup was
  // processed) must be requeued, or it would be recorded yet never applied.
  const existing = await db.linkedinRegistration.findUnique({
    where: { responseUrn: parsed.responseUrn },
    select: { leadAction: true },
  });
  await db.linkedinRegistration.upsert({
    where: { responseUrn: parsed.responseUrn },
    create: {
      responseUrn: parsed.responseUrn,
      eventUrn: parsed.eventUrn,
      campaignId: campaign?.id ?? null,
      organizationUrn: parsed.organizationUrn,
      formUrn: parsed.formUrn,
      leadAction: parsed.leadAction,
      occurredAt: parsed.occurredAtMs ? new Date(parsed.occurredAtMs) : null,
      // Unmapped events are terminal — park them processed with the reason so
      // the retry loop doesn't chase them forever. Mapped ones stay queued.
      processedAt: campaign ? null : new Date(),
      error: campaign ? null : 'No campaign is mapped to this LinkedIn event (event was not published by this app).',
    },
    update:
      existing && existing.leadAction !== parsed.leadAction
        ? { leadAction: parsed.leadAction, processedAt: null, error: null }
        : { leadAction: parsed.leadAction },
  });

  after(async () => {
    const { processPendingLinkedinRegistrations } = await import('@/lib/linkedin/ingest');
    try {
      await processPendingLinkedinRegistrations(10);
    } catch (err) {
      console.error('linkedin webhook after-processing failed:', err);
    }
  });

  return Response.json({ received: true });
}