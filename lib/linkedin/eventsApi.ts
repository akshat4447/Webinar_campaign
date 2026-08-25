// Network half of the Events contract — thin wrappers around restRequest.
// Payload *shapes* live in ./events.ts (pure, tested); this file only knows
// how to call endpoints and read the id headers LinkedIn returns them under.

import { restRequest, responseIdFromHeaders, LinkedInError } from './client';

/** POST /rest/events → urn:li:event:{id} (id arrives in a response header). */
export async function createEvent(payload: ReturnType<typeof import('./events').buildEventPayload>): Promise<string> {
  const res = await restRequest('/events', { method: 'POST', body: payload });
  const id = responseIdFromHeaders(res.headers);
  if (!id) throw new LinkedInError(502, `Event created but no id header came back: ${res.text.slice(0, 200)}`);
  return `urn:li:event:${id.replace(/^urn:li:event:/, '')}`;
}

/** POST /rest/posts → the announcement post URN. Mandatory: an unposted event can't even be fetched. */
export async function publishAnnouncementPost(payload: ReturnType<typeof import('./events').buildAnnouncementPostPayload>): Promise<string> {
  const res = await restRequest('/posts', { method: 'POST', body: payload });
  const id = responseIdFromHeaders(res.headers);
  if (!id) throw new LinkedInError(502, `Post sent but no id header came back: ${res.text.slice(0, 200)}`);
  return id.startsWith('urn:') ? id : `urn:li:share:${id}`;
}

export interface OrganizerEventSummary {
  eventUrn: string;
  name: string;
  startMs: number | null;
}

/** GET /rest/events?q=eventsByOrganizer — used for the duplicate-adoption guard and reconciliation. */
export async function listEventsByOrganizer(organizationUrn: string): Promise<OrganizerEventSummary[]> {
  const res = await restRequest(`/events?q=eventsByOrganizer&organizer=${encodeURIComponent(organizationUrn)}&count=50`);
  const elements = (res.json as { elements?: Array<Record<string, unknown>> } | null)?.elements ?? [];
  return elements.map((e) => ({
    eventUrn: typeof e.eventUrn === 'string' ? e.eventUrn : String(e.id ?? ''),
    name: typeof e.name === 'string' ? e.name : '',
    startMs: typeof e.startDateTime === 'object' && e.startDateTime !== null && typeof (e.startDateTime as { time?: unknown }).time === 'number'
      ? (e.startDateTime as { time: number }).time
      : null,
  }));
}

export async function getEvent(eventUrn: string): Promise<Record<string, unknown> | null> {
  const res = await restRequest(`/events/${encodeURIComponent(eventUrn)}`);
  return (res.json as Record<string, unknown>) ?? null;
}

export async function deleteEvent(eventUrn: string): Promise<void> {
  await restRequest(`/events/${encodeURIComponent(eventUrn)}`, { method: 'DELETE' });
}