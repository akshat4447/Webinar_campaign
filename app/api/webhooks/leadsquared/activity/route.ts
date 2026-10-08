import { timingSafeEqual } from 'crypto';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { registerContact } from '@/lib/registerContact';
import { getLeadById } from '@/lib/leadsquared';
import { resolveIntegrationField } from '@/lib/integrationConfig';
import { addEmailToSuppression } from '@/lib/netcore';
import { resolveContactRegistrationChannel } from '@/lib/registrationChannels';

export const dynamic = 'force-dynamic';

function timingSafeEqualStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * LeadSquared Inbound Activity Webhook
 *
 * Handles external registration triggers from:
 * 1. LeadSquared Process Automation: Trigger "Activity Added" (or Form Submitted) -> Action "Call Webhook"
 * 2. LeadSquared Global Webhook: "LeadActivity_Post_Create" (batched activity JSON array)
 * 3. LeadSquared Landing Page / Form submissions
 *
 * When an event is received:
 * - Identifies the contact (by EmailAddress or ProspectId / RelatedProspectId)
 * - Identifies the target campaign (by ?campaignId= query param, CampaignId attribute, or Webinar Name)
 * - Registers the contact with source 'leadsquared'
 * - Ejects the contact from pending pre-registration outreach cadence sends (sets status: 'skipped')
 * - Queues pre-webinar registrant countdown reminders (e.g. 1-hour before, doors open)
 */

export async function HEAD() {
  // LeadSquared validates webhooks with HEAD or GET during setup handshake
  return new NextResponse(null, { status: 200 });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: 'Webinar Campaign Studio',
    endpoint: '/api/webhooks/leadsquared/activity',
    message: 'LeadSquared activity webhook endpoint is live and ready to receive registration events.',
    supportedTriggers: [
      'Automation Action: Call Webhook (Activity Added / Form Submitted)',
      'Webhook Event: LeadActivity_Post_Create',
    ],
  });
}

interface LsqFieldItem {
  SchemaName?: string;
  Value?: string;
}

interface LsqActivityPayloadItem {
  EmailAddress?: string;
  Email?: string;
  email?: string;
  FirstName?: string;
  LastName?: string;
  Company?: string;
  Phone?: string;
  Mobile?: string;
  JobTitle?: string;
  RelatedProspectId?: string;
  ProspectID?: string;
  LeadId?: string;
  leadId?: string;
  CampaignId?: string;
  campaignId?: string;
  WebinarName?: string;
  webinarName?: string;
  Webinar?: string;
  EventName?: string;
  eventName?: string;
  Campaign?: string;
  ActivityEvent?: number | string;
  ActivityEventName?: string;
  ActivityName?: string;
  ActivityNote?: string;
  ActivityDateTime?: string;
  CreatedOn?: string;
  mx_Custom_1?: string;
  mx_Custom_2?: string;
  Fields?: LsqFieldItem[];
  Lead?: {
    EmailAddress?: string;
    ProspectID?: string;
    FirstName?: string;
    LastName?: string;
    Company?: string;
    Phone?: string;
  };
  Prospect?: {
    EmailAddress?: string;
    ProspectID?: string;
    FirstName?: string;
    LastName?: string;
    Company?: string;
    Phone?: string;
  };
}

export async function POST(request: Request) {
  try {
    const url = new URL(request.url);

    // Fail CLOSED outside development, exactly like the LinkedIn webhook: a
    // deployed receiver without a configured secret must reject everything
    // rather than accept fabricated registrations from anyone who finds the URL.
    const configuredSecret = await resolveIntegrationField('lsq', 'webhookSecret');
    const isDev = process.env.NODE_ENV !== 'production';
    if (configuredSecret) {
      const provided = request.headers.get('x-webhook-secret') || url.searchParams.get('secret') || '';
      if (!provided || !timingSafeEqualStrings(provided, configuredSecret)) {
        return NextResponse.json({ ok: false, error: 'Invalid or missing webhook secret' }, { status: 401 });
      }
    } else if (!isDev) {
      return NextResponse.json(
        { ok: false, error: 'Webhook secret not configured — refusing unsigned payloads in production' },
        { status: 500 }
      );
    } else {
      console.warn('[leadsquared-webhook] No webhookSecret configured — accepting UNSIGNED payload (dev only).');
    }

    const rawBody = await request.json().catch(() => null);
    if (!rawBody || typeof rawBody !== 'object') {
      return NextResponse.json({ ok: false, error: 'Invalid JSON payload' }, { status: 400 });
    }

    // Normalize batch array vs single object vs envelope
    const activities: LsqActivityPayloadItem[] = Array.isArray(rawBody)
      ? rawBody
      : Array.isArray((rawBody as { Activities?: LsqActivityPayloadItem[] }).Activities)
        ? (rawBody as { Activities: LsqActivityPayloadItem[] }).Activities
        : Array.isArray((rawBody as { Data?: LsqActivityPayloadItem[] }).Data)
          ? (rawBody as { Data: LsqActivityPayloadItem[] }).Data
          : [rawBody as LsqActivityPayloadItem];

    const queryCampaignId = url.searchParams.get('campaignId');

    const results: Array<{
      email?: string;
      leadId?: string;
      contactId?: string;
      campaignId?: string;
      status: 'registered' | 'already-registered' | 'skipped-not-found' | 'suppressed' | 'error';
      detail?: string;
    }> = [];

    for (const act of activities) {
     try {
      // 1. Extract email
      let email =
        act.EmailAddress ||
        act.Email ||
        act.email ||
        act.Lead?.EmailAddress ||
        act.Prospect?.EmailAddress ||
        act.Fields?.find((f) => f.SchemaName === 'EmailAddress' || f.SchemaName === 'Email')?.Value;

      // 2. Extract Lead ID
      const leadId =
        act.RelatedProspectId ||
        act.ProspectID ||
        act.LeadId ||
        act.leadId ||
        act.Lead?.ProspectID ||
        act.Prospect?.ProspectID ||
        act.Fields?.find((f) => f.SchemaName === 'ProspectID' || f.SchemaName === 'RelatedProspectId')?.Value;

      // 3. Extract campaign identifier (ID or Webinar Name)
      const campaignIdentifier =
        queryCampaignId ||
        act.CampaignId ||
        act.campaignId ||
        act.WebinarName ||
        act.webinarName ||
        act.Webinar ||
        act.EventName ||
        act.eventName ||
        act.Campaign ||
        act.mx_Custom_1 ||
        act.Fields?.find((f) => {
          const s = (f.SchemaName || '').toLowerCase();
          return s === 'mx_custom_1' || s.includes('webinar') || s.includes('campaign');
        })?.Value;

      // 4. Extract registration timestamp if available
      const rawDate = act.ActivityDateTime || act.CreatedOn;
      const registeredAt = rawDate && !isNaN(Date.parse(rawDate)) ? new Date(rawDate) : undefined;

      if (!email && !leadId) {
        results.push({
          status: 'skipped-not-found',
          detail: 'No EmailAddress or ProspectID found in activity payload',
        });
        continue;
      }

      // If leadId is present but email is missing, and no contact is cached with that leadId,
      // perform a live lookup to LeadSquared to resolve their email
      if (!email && leadId) {
        const existingByLeadId = await db.contact.findFirst({
          where: { lsqLeadId: String(leadId) },
        });
        if (existingByLeadId?.email) {
          email = existingByLeadId.email;
        } else {
          try {
            const fetched = await getLeadById(String(leadId));
            if (fetched?.EmailAddress) {
              email = fetched.EmailAddress;
            }
          } catch {
            // Live lookup fallback failed; proceed with leadId only
          }
        }
      }

      // 5. Resolve target Campaign
      let targetCampaign = null;
      if (campaignIdentifier) {
        // Try match by campaign primary key ID
        targetCampaign = await db.campaign.findUnique({ where: { id: campaignIdentifier } });
        if (!targetCampaign) {
          // Try match by webinar name
          targetCampaign = await db.campaign.findFirst({
            where: { name: { contains: campaignIdentifier, mode: 'insensitive' } },
            orderBy: { createdAt: 'desc' },
          });
        }
      }
      if (!targetCampaign) {
        // The payload (and URL) named no webinar we know. Guessing "the newest" silently
        // files a registrant under the wrong webinar whenever two are running, so only
        // resolve when it is unambiguous: the single active webinar, or the one this
        // person is already a contact of. Otherwise report it and let the operator add
        // ?campaignId= to the webhook URL.
        const active = await db.campaign.findMany({
          where: { status: { in: ['live', 'draft'] }, archived: false },
          orderBy: { createdAt: 'desc' },
          take: 50,
        });
        if (active.length === 1) {
          targetCampaign = active[0];
        } else if (active.length > 1) {
          const lookupEmail = email?.trim().toLowerCase();
          const member = await db.contact.findFirst({
            where: {
              campaignId: { in: active.map((c) => c.id) },
              OR: [
                ...(lookupEmail ? [{ email: { equals: lookupEmail, mode: 'insensitive' as const } }] : []),
                ...(leadId ? [{ lsqLeadId: String(leadId) }] : []),
              ],
            },
            orderBy: { createdAt: 'desc' },
            select: { campaignId: true },
          });
          targetCampaign = (member && active.find((c) => c.id === member.campaignId)) || null;
          if (!targetCampaign) {
            results.push({
              email: email ?? undefined,
              leadId: leadId ? String(leadId) : undefined,
              status: 'skipped-not-found',
              detail: `${active.length} webinars are active and none was named — add ?campaignId=<id> to the webhook URL (or send a CampaignId / WebinarName) so this registration lands in the right one`,
            });
            continue;
          }
        } else {
          targetCampaign = await db.campaign.findFirst({ orderBy: { createdAt: 'desc' } });
        }
      }

      // 6. Find or auto-create the Contact
      const normalizedEmail = email?.trim().toLowerCase();
      let contact = null;
      if (targetCampaign) {
        contact = await db.contact.findFirst({
          where: {
            campaignId: targetCampaign.id,
            OR: [
              ...(normalizedEmail ? [{ email: { equals: normalizedEmail, mode: 'insensitive' as const } }] : []),
              ...(leadId ? [{ lsqLeadId: String(leadId) }] : []),
            ],
          },
        });
      } else {
        // Match contact in the most recently active campaign
        contact = await db.contact.findFirst({
          where: {
            OR: [
              ...(normalizedEmail ? [{ email: { equals: normalizedEmail, mode: 'insensitive' as const } }] : []),
              ...(leadId ? [{ lsqLeadId: String(leadId) }] : []),
            ],
          },
          orderBy: { createdAt: 'desc' },
        });
      }

      // Check if this is an Opt-out / Unsubscribe activity. "opt(?:ed)?" so
      // LeadSquared's own standard activity name "Lead Opted Out" matches —
      // plain "opt[ -]?out" only matched "opt out"/"opt-out", never "opted out".
      const activityDescriptor = `${act.ActivityEventName ?? ''} ${act.ActivityName ?? ''} ${act.ActivityNote ?? ''}`.toLowerCase();
      const isOptOut = /unsub|opt(?:ed)?[ -]?out|do[ -]?not[ -]?(call|email)/i.test(activityDescriptor);

      if (isOptOut) {
        const emailToSuppress = contact?.email || normalizedEmail;
        if (emailToSuppress) {
          await addEmailToSuppression(emailToSuppress, 'unsubscribe', act.ActivityEventName || act.ActivityName || 'LeadSquared Opt-Out', 'leadsquared');
        }
        if (contact) {
          await db.contact.update({
            where: { id: contact.id },
            data: { approved: false, unsubscribedAt: new Date() },
          });
          await db.cadenceSend.updateMany({
            where: { contactId: contact.id, status: 'queued' },
            data: { status: 'skipped' },
          });
        }
        results.push({
          contactId: contact?.id,
          campaignId: contact?.campaignId,
          email: emailToSuppress ?? undefined,
          leadId: leadId ? String(leadId) : undefined,
          status: 'suppressed',
          detail: 'Contact opted out via LeadSquared activity and added to suppression list',
        });
        continue;
      }

      // If contact not found but email and target campaign exist: auto-create inbound registrant
      if (!contact && normalizedEmail && targetCampaign) {
        const rawAny = act as Record<string, unknown>;
        const firstName =
          act.FirstName ||
          act.Lead?.FirstName ||
          act.Prospect?.FirstName ||
          (rawAny.first_name as string) ||
          '';
        const lastName =
          act.LastName ||
          act.Lead?.LastName ||
          act.Prospect?.LastName ||
          (rawAny.last_name as string) ||
          '';
        const company =
          act.Company ||
          act.Lead?.Company ||
          act.Prospect?.Company ||
          (rawAny.company as string) ||
          'LeadSquared Lead';
        const phone =
          act.Phone ||
          act.Mobile ||
          act.Lead?.Phone ||
          act.Prospect?.Phone ||
          (rawAny.phone as string) ||
          null;
        const fullName = [firstName, lastName].filter(Boolean).join(' ') || normalizedEmail.split('@')[0];

        contact = await db.contact.create({
          data: {
            campaignId: targetCampaign.id,
            name: fullName,
            email: normalizedEmail,
            phone: phone ? String(phone).trim() : null,
            account: company ? String(company).trim() : 'LeadSquared Registrant',
            vertical: targetCampaign.vertical || 'Unassigned',
            title: act.JobTitle || (rawAny.title as string) || 'Registrant',
            function: 'General',
            seniority: 'Professional',
            score: null,
            approved: true,
            lsqLeadId: leadId ? String(leadId) : null,
            extraFieldsJson: JSON.stringify({
              inboundSource: 'leadsquared_webhook',
              registeredAt: new Date().toISOString(),
            }),
          },
        });
      }

      if (!contact) {
        results.push({
          email: email ?? undefined,
          leadId: leadId ? String(leadId) : undefined,
          status: 'skipped-not-found',
          detail: `Contact not found in ${targetCampaign ? `campaign "${targetCampaign.name}"` : 'any campaign'}`,
        });
        continue;
      }

      // Cache lsqLeadId if it wasn't saved yet
      if (leadId && !contact.lsqLeadId) {
        await db.contact.update({
          where: { id: contact.id },
          data: { lsqLeadId: String(leadId) },
        }).catch(() => null);
      }

      // 7. Register contact with resolved channel source
      // This immediately marks them registered, cancels pending outreach sends, and queues registered reminders
      let extractedSource = url.searchParams.get('channel') || url.searchParams.get('source') || act.mx_Custom_1 || '';
      if (!extractedSource && Array.isArray(act.Fields)) {
        for (const f of act.Fields) {
          const sn = (f.SchemaName || '').toLowerCase();
          if (sn.includes('channel') || sn.includes('source') || sn.includes('utm_source')) {
            extractedSource = f.Value || '';
            break;
          }
        }
      }
      const regSource = extractedSource
        ? resolveContactRegistrationChannel({ registrationSource: extractedSource, id: contact.id }, new Map())
        : 'leadsquared';

      try {
        const regResult = await registerContact(
          contact.campaignId,
          contact.id,
          regSource,
          registeredAt
        );

        if (!regResult.ok) {
          results.push({
            contactId: contact.id,
            campaignId: contact.campaignId,
            email: contact.email ?? undefined,
            status: 'error',
            detail: regResult.reason,
          });
          continue;
        }

        results.push({
          contactId: contact.id,
          campaignId: contact.campaignId,
          email: contact.email ?? undefined,
          leadId: leadId ? String(leadId) : undefined,
          status: regResult.alreadyRegistered ? 'already-registered' : 'registered',
          detail: regResult.alreadyRegistered
            ? 'Contact was already registered'
            : `Registered via LeadSquared sync — ejected from pre-registration cadence and queued ${regResult.queued} reminder(s)`,
        });
      } catch (regErr) {
        results.push({
          contactId: contact.id,
          campaignId: contact.campaignId,
          email: contact.email ?? undefined,
          status: 'error',
          detail: String(regErr),
        });
      }
     } catch (itemErr) {
      // Isolate one malformed/DB-hiccup item from the rest of the batch —
      // without this, a single bad activity would 500 the whole delivery and
      // LeadSquared would retry-storm every already-processed item too.
      results.push({
        email: (act.EmailAddress || act.Email || act.email) ?? undefined,
        status: 'error',
        detail: String(itemErr),
      });
     }
    }

    const registeredCount = results.filter((r) => r.status === 'registered').length;
    const alreadyRegisteredCount = results.filter((r) => r.status === 'already-registered').length;
    const errorCount = results.filter((r) => r.status === 'error').length;
    const first = results[0];

    // Per-item isolation (above) deliberately keeps one bad activity from
    // 500-ing the whole batch. But if EVERY item errored, that's almost
    // certainly a systemic failure (DB outage, etc.) rather than a few
    // malformed activities — answering 200 would tell LeadSquared delivery
    // succeeded, so it would never retry and these activities would be lost.
    const allFailed = results.length > 0 && errorCount === results.length;

    return NextResponse.json(
      {
        ok: !allFailed,
        received: activities.length,
        newRegistrations: registeredCount,
        alreadyRegistered: alreadyRegisteredCount,
        ...(errorCount > 0 ? { errored: errorCount } : {}),
        contactId: first?.contactId,
        campaignId: first?.campaignId,
        results,
      },
      { status: allFailed ? 500 : 200 }
    );
  } catch (err) {
    console.error('LeadSquared inbound activity webhook error:', err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
