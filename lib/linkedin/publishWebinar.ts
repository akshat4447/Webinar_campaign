// The publish orchestrator — one idempotent, resumable state machine per
// campaign:
//
//   (null) ──validate──▶ form_pending_review ──APPROVED form──▶ creating
//          ──POST /rest/events──▶ created_unpublished ──POST /rest/posts──▶ published
//
// Every stage persists BEFORE the next network call, so a crash between calls
// resumes from the stored URN instead of duplicating the event on LinkedIn.
// Constraints honored here, deliberately:
//   • the announcement post is NOT optional — until it exists LinkedIn won't
//     even serve GETs for the event;
//   • the registration form attaches at creation only, so an unapproved form
//     parks the run instead of letting a broken event go live.
import { db } from '@/lib/db';
import { revalidateCampaign } from '@/lib/revalidate';
import { upsertAttentionItem } from '@/lib/attentionItems';
import { createHash } from 'crypto';
import { linkedinMode, resolveOrganizationUrn } from './client';
import { validateCampaignForPublish, buildEventPayload, buildAnnouncementPostPayload, eventPublicUrl } from './events';
import { ensureApprovedRegistrationForm } from './registrationForms';
import { createEvent, deleteEvent, listEventsByOrganizer, publishAnnouncementPost } from './eventsApi';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function log(campaignId: string, text: string, dot = 'var(--accent-500)') {
  await db.activityLogEntry.create({ data: { campaignId, text, dot } });
}

function sandboxUrns(seed: string): { eventUrn: string; postUrn: string } {
  const h = createHash('sha1').update(seed).digest('hex');
  return { eventUrn: `urn:li:event:sbx${h.slice(0, 10)}`, postUrn: `urn:li:share:sbx${h.slice(10, 20)}` };
}

export interface PublishOutcome {
  ok: boolean;
  status: string | null;
  detail: string;
}

export async function publishWebinarToLinkedIn(campaignId: string): Promise<PublishOutcome> {
  const campaign = await db.campaign.findUniqueOrThrow({ where: { id: campaignId } });

  if (campaign.linkedinEventStatus === 'published' && campaign.linkedinEventUrn) {
    return { ok: true, status: 'published', detail: `Already live: ${eventPublicUrl(campaign.linkedinEventUrn)}` };
  }

  const mode = linkedinMode();
  const validation = validateCampaignForPublish(
    {
      name: campaign.name,
      description: campaign.description,
      scheduledAt: campaign.scheduledAt,
      zoomLink: campaign.zoomLink,
    },
    campaign.simulatedNow ?? new Date(),
    { requireOrganizer: mode === 'live' }
  );
  if (!validation.ok) {
    await upsertAttentionItem(campaignId, {
      icon: 'ErrorProperty1Outline',
      color: 'warning',
      title: 'LinkedIn publish blocked',
      detail: validation.error,
      actionsCsv: 'fix',
    });
    await revalidateCampaign(campaignId);
    return { ok: false, status: campaign.linkedinEventStatus, detail: validation.error };
  }
  const scheduledAt = new Date(campaign.scheduledAt!);

  // Resume support: a crash after "created" but before "published" retries
  // only the post step using the persisted event URN.
  let eventUrn = campaign.linkedinEventUrn;

  try {
    let regFormUrn = campaign.linkedinRegFormUrn;

    if (!eventUrn) {
      // Stage 0: approved registration form (attachable at creation ONLY).
      let organizationUrn: string | undefined;
      if (mode === 'live') {
        organizationUrn = await resolveOrganizationUrn();
        if (!organizationUrn || !/^urn:li:organization:\d+$/.test(organizationUrn)) {
          throw new Error('No connected LinkedIn Page — connect the integration and authorize a Page you administer.');
        }
        const form = await ensureApprovedRegistrationForm({
          organizationUrn,
          displayName: `${campaign.name} — Registration`,
          description: `Registration for the live webinar "${campaign.name}". We use your details only to send the joining link and relevant follow-ups.`,
        });
        regFormUrn = form.formUrn;
        await db.campaign.update({ where: { id: campaignId }, data: { linkedinRegFormUrn: regFormUrn } });
        if (form.status !== 'APPROVED') {
          const detail =
            form.status === 'REJECTED'
              ? 'LinkedIn rejected the registration form — review its questions/data permissions in the developer portal.'
              : `Registration form is awaiting LinkedIn review. The event attaches the form at creation, so publishing resumes once it's APPROVED.`;
          await db.campaign.update({
            where: { id: campaignId },
            data: { linkedinEventStatus: 'form_pending_review', linkedinEventError: detail },
          });
          await upsertAttentionItem(campaignId, {
            icon: 'InformationProperty1Outline',
            color: 'warning',
            title: 'LinkedIn publish waiting on form review',
            detail,
            actionsCsv: 'retry,view',
          });
          await log(campaignId, `LinkedIn publish parked — registration form ${form.formUrn} is ${form.status}`, 'var(--warning-700)');
          await revalidateCampaign(campaignId);
          return { ok: false, status: 'form_pending_review', detail };
        }
      } else {
        regFormUrn = sandboxUrns(`${campaignId}:form`).eventUrn.replace('urn:li:event:', 'urn:li:registrationForm:');
      }

      // Duplicate-adoption guard: someone may have hand-created this same
      // event before wiring the integration — adopt rather than double-post.
      if (mode === 'live' && organizationUrn) {
        try {
          const existing = await listEventsByOrganizer(organizationUrn);
          const match = existing.find(
            (e) => e.name.trim() === campaign.name.trim() && e.startMs !== null && Math.abs(e.startMs - scheduledAt.getTime()) < 60_000
          );
          if (match) {
            eventUrn = match.eventUrn;
            await log(campaignId, `Adopted existing LinkedIn event "${match.name}" (${match.eventUrn}) instead of creating a duplicate`);
          }
        } catch {
          /* advisory-only */
        }
      }

      // Stage 1: create the event.
      if (!eventUrn) {
        if (mode === 'live') {
          eventUrn = await createEvent(
            buildEventPayload({
              name: campaign.name,
              description: campaign.description!,
              startTimeMs: scheduledAt.getTime(),
              organizationUrn: organizationUrn!,
              externalUrl: campaign.zoomLink!,
              registrationFormUrn: regFormUrn!,
            })
          );
        } else {
          await sleep(400); // make the staged progress visible in the UI
          eventUrn = sandboxUrns(`${campaignId}:event`).eventUrn;
        }
        // Persist BEFORE announcing — resume point if the next call dies.
        await db.campaign.update({
          where: { id: campaignId },
          data: {
            linkedinEventUrn: eventUrn,
            linkedinRegFormUrn: regFormUrn,
            linkedinEventStatus: 'created_unpublished',
            linkedinEventError: null,
          },
        });
        await log(campaignId, `Created LinkedIn Event ${eventPublicUrl(eventUrn)}${mode === 'sandbox' ? ' (sandbox — no live API call)' : ''}`);
      }
    }

    // Stage 2: the mandatory announcement post — an unposted event can't even
    // be fetched or updated, so publishing it is part of "create", not polish.
    if (!(campaign.linkedinPostUrn && campaign.linkedinEventStatus === 'published')) {
      const postUrn =
        mode === 'live'
          ? await publishAnnouncementPost(
              buildAnnouncementPostPayload({
                organizationUrn: (await resolveOrganizationUrn())!,
                eventName: campaign.name,
                eventUrl: eventPublicUrl(eventUrn),
                dateDisplay: campaign.date,
                description: campaign.description ?? '',
              })
            )
          : sandboxUrns(`${campaignId}:post`).postUrn;

      await db.campaign.update({
        where: { id: campaignId },
        data: { linkedinPostUrn: postUrn, linkedinEventStatus: 'published', linkedinEventError: null },
      });
      await log(
        campaignId,
        `Published "${campaign.name}" to LinkedIn${mode === 'sandbox' ? ' (sandbox — no live API call)' : ''} — next human step: click “Invite connections” on the event page`,
        'var(--success-500)'
      );
    }

    await revalidateCampaign(campaignId);
    return { ok: true, status: 'published', detail: `Live at ${eventPublicUrl(eventUrn)}` };
  } catch (err) {
    const message = String(err instanceof Error ? err.message : err).slice(0, 300);
    // If the event itself never came into existence, clear partial linkage so
    // the next attempt starts clean; if it exists, keep the URN for a resume.
    await db.campaign.update({
      where: { id: campaignId },
      data: eventUrn
        ? { linkedinEventStatus: 'created_unpublished', linkedinEventError: message }
        : { linkedinEventStatus: 'failed', linkedinEventError: message, linkedinEventUrn: null, linkedinRegFormUrn: null },
    });
    await upsertAttentionItem(campaignId, {
      icon: 'ErrorProperty1Outline',
      color: 'error',
      title: 'LinkedIn publish failed',
      detail: message,
      actionsCsv: 'retry',
    });
    await log(campaignId, `LinkedIn publish failed: ${message}`, 'var(--danger-500)');
    await revalidateCampaign(campaignId);
    return { ok: false, status: eventUrn ? 'created_unpublished' : 'failed', detail: message };
  }
}

/** Cancels/deletes the remote event (best-effort in live mode) and clears all local linkage. */
export async function cancelLinkedInEvent(campaignId: string): Promise<PublishOutcome> {
  const campaign = await db.campaign.findUniqueOrThrow({ where: { id: campaignId }, select: { name: true, linkedinEventUrn: true } });
  if (linkedinMode() === 'live' && campaign.linkedinEventUrn) {
    try {
      await deleteEvent(campaign.linkedinEventUrn);
    } catch (err) {
      // Already deleted remotely is fine — clearing locally is still correct.
      console.warn('cancelLinkedInEvent: remote delete failed:', String(err));
    }
  }
  await db.campaign.update({
    where: { id: campaignId },
    data: {
      linkedinEventUrn: null,
      linkedinPostUrn: null,
      linkedinRegFormUrn: null,
      linkedinEventStatus: 'canceled',
      linkedinEventError: null,
      linkedinInvitedAt: null,
    },
  });
  await log(campaignId, `Unlinked the LinkedIn Event from "${campaign.name}" (status: canceled)`, 'var(--warning-700)');
  await revalidateCampaign(campaignId);
  return { ok: true, status: 'canceled', detail: 'Event unlinked from this webinar.' };
}
