// Pure LinkedIn Event contract — payload builders, validators, URL helpers.
// No I/O and no imports: the network half lives in eventsApi.ts, and keeping
// this file dependency-free means vitest exercises the exact structures we
// send to LinkedIn without a single mock.

// LinkedIn rejects longer event names outright; validate before the API does.
export const LINKEDIN_EVENT_NAME_MAX = 150;
export const LINKEDIN_EVENT_DESCRIPTION_MAX = 3000;

// The app models webinars as point-in-time (scheduledAt + a Zoom join link),
// but a LinkedIn Event occupies a window and requires an endDateTime. Two
// hours is the display window on LinkedIn; the Zoom meeting is the real
// boundary. Not configurable until a real webinar proves otherwise.
export const DEFAULT_EVENT_DURATION_MS = 2 * 60 * 60 * 1000;

export interface PublishValidationFields {
  name: string;
  description: string | null;
  scheduledAt: Date | string | null;
  zoomLink: string | null;
  organizationUrn?: string | null;
}

/**
 * Everything that must be true before we dare call POST /rest/events.
 * Runs identically in sandbox and live mode — sandbox should refuse the same
 * inputs live would refuse, so the dry-run actually predicts the real result.
 */
export function validateCampaignForPublish(
  fields: PublishValidationFields,
  now: Date,
  opts: { requireOrganizer: boolean }
): { ok: true } | { ok: false; error: string } {
  const name = (fields.name ?? '').trim();
  if (!name) return { ok: false, error: 'The webinar has no name yet — set it on the Setup tab.' };
  if (name.length > LINKEDIN_EVENT_NAME_MAX) {
    return { ok: false, error: `Event name is ${name.length} chars; LinkedIn allows at most ${LINKEDIN_EVENT_NAME_MAX}.` };
  }

  const description = (fields.description ?? '').trim();
  if (!description) return { ok: false, error: 'The webinar has no description yet — LinkedIn Events require one.' };
  if (description.length > LINKEDIN_EVENT_DESCRIPTION_MAX) {
    return { ok: false, error: `Description is ${description.length} chars; keep it under ${LINKEDIN_EVENT_DESCRIPTION_MAX}.` };
  }

  const scheduledAt = fields.scheduledAt ? new Date(fields.scheduledAt) : null;
  if (!scheduledAt || Number.isNaN(scheduledAt.getTime())) {
    return { ok: false, error: 'Set the webinar date/time on the Setup tab before publishing — LinkedIn needs a real schedule.' };
  }
  if (scheduledAt.getTime() <= now.getTime()) {
    return { ok: false, error: 'The webinar date is in the past — reschedule before publishing to LinkedIn.' };
  }

  const zoomLink = (fields.zoomLink ?? '').trim();
  if (!/^https?:\/\/\S+/i.test(zoomLink)) {
    return { ok: false, error: 'Add a valid Zoom (https://…) join link on the Setup tab — it becomes the event\'s registration destination.' };
  }

  if (opts.requireOrganizer) {
    const org = (fields.organizationUrn ?? '').trim();
    if (!/^urn:li:organization:\d+$/.test(org)) {
      return { ok: false, error: 'Connect the LinkedIn integration and pick a Page you administer before publishing.' };
    }
  }

  return { ok: true };
}

export interface BuildEventPayloadArgs {
  name: string;
  description: string;
  startTimeMs: number;
  organizationUrn: string;
  externalUrl: string;
  registrationFormUrn: string;
  endTimeMs?: number;
}

/** Exact body for POST /rest/events — field names match the REST contract. */
export function buildEventPayload(args: BuildEventPayloadArgs) {
  return {
    name: args.name.trim(),
    description: args.description.trim(),
    startDateTime: { time: args.startTimeMs },
    endDateTime: { time: args.endTimeMs ?? args.startTimeMs + DEFAULT_EVENT_DURATION_MS },
    organizer: {
      organizerType: 'ORGANIZATION',
      value: args.organizationUrn,
    },
    eventRegistrationsSettings: {
      registrationEnabled: true,
      externalUrl: args.externalUrl,
      registrationFormSettings: {
        registrationForm: args.registrationFormUrn,
      },
    },
  };
}

/** Exact body for POST /rest/posts — the announcement that makes the event real. */
export function buildAnnouncementPostPayload(args: {
  organizationUrn: string;
  eventName: string;
  eventUrl: string;
  dateDisplay: string;
  description: string;
}) {
  // First sentence-ish teaser, hard-capped so the post never drowns the link.
  const teaser = args.description.replace(/\s+/g, ' ').trim().slice(0, 180);
  const commentary = `${args.eventName}\n\n${teaser}${args.description.length > 180 ? '…' : ''}\n\n📅 ${args.dateDisplay}\n\nRegister here: ${args.eventUrl}`;
  return {
    author: args.organizationUrn,
    commentary,
    visibility: 'PUBLIC',
    distribution: {
      feedDistribution: 'MAIN_FEED',
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    lifecycleState: 'PUBLISHED',
    isReshareDisabledByAuthor: false,
  };
}

/** urn:li:event:{id} → https://www.linkedin.com/events/{id}; tolerates bare ids. */
export function eventPublicUrl(eventUrn: string): string {
  const id = eventUrn.replace(/^urn:li:event:/, '').trim();
  return `https://www.linkedin.com/events/${id}`;
}