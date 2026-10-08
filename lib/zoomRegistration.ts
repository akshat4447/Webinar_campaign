// Server-only. The ONE place a Studio contact becomes a Zoom registrant.
//
// Used by registerContact (at registration time) and by the reconcile sweep (retries), so both
// behave identically: pass the stored event kind, persist the personal join link, and turn a
// failure into a single, plain-language alert card instead of a log line nobody reads.

import { db } from '@/lib/db';
import { addZoomRegistrant, explainZoomRegistrantFailure, type ZoomEventKind, type ZoomRegistrantResult } from '@/lib/zoom/meetings';
import { resolveAttentionItems, upsertAttentionItem } from '@/lib/attentionItems';

export const ZOOM_REGISTRATION_ALERT = 'Zoom registration failed';

/** "Priya Nair Sharma" -> first "Priya", last "Nair Sharma". Zoom requires a first name. */
export function splitName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] || 'Attendee', lastName: parts.slice(1).join(' ') };
}

export type ZoomSyncOutcome = ZoomRegistrantResult | { ok: true; skipped: true };

export async function syncRegistrantToZoom(
  campaign: { id: string; zoomMeetingId: string | null; zoomEventType?: string | null },
  contact: { id: string; email: string | null; name: string; zoomJoinUrl?: string | null }
): Promise<ZoomSyncOutcome> {
  if (!campaign.zoomMeetingId || !contact.email) return { ok: true, skipped: true };
  if (contact.zoomJoinUrl) return { ok: true, skipped: true };

  const alertTitle = `${ZOOM_REGISTRATION_ALERT} — ${contact.name} (${contact.id.slice(-6)})`;
  const eventType = campaign.zoomEventType === 'webinar' || campaign.zoomEventType === 'meeting' ? (campaign.zoomEventType as ZoomEventKind) : undefined;
  const { firstName, lastName } = splitName(contact.name);
  const result = await addZoomRegistrant(campaign.zoomMeetingId, { email: contact.email, firstName, lastName }, { eventType });

  if (result.ok && result.joinUrl) {
    await db.contact.update({ where: { id: contact.id }, data: { zoomJoinUrl: result.joinUrl, zoomRegistrantId: result.registrantId || null } });
    // Learn which API family answered, so the next call does not need to probe.
    if (!eventType && result.eventType) {
      await db.campaign.update({ where: { id: campaign.id }, data: { zoomEventType: result.eventType } }).catch(() => undefined);
    }
    await resolveAttentionItems(campaign.id, [alertTitle]).catch(() => undefined);
    return result;
  }

  await upsertAttentionItem(campaign.id, {
    icon: 'ErrorProperty1Outline',
    color: 'error',
    title: alertTitle,
    detail: (result.reason ? explainZoomRegistrantFailure(result.reason) : result.error ?? 'Unknown Zoom error').slice(0, 600),
    actionsCsv: 'retry',
  }).catch(() => undefined);
  return result;
}
