import { zoomMode, zoomRequest, zoomIsConfigured } from './client';

export interface ZoomMeeting {
  id: string;
  topic: string;
  startTime: string | null;
  duration: number | null;
  joinUrl: string;
}

export interface ZoomParticipant {
  name: string;
  email: string | null;
  durationMinutes: number;
}

// Sandbox fixtures. Shaped exactly like the live response so the code paths
// either side of the boundary are identical — a sandbox that returns a
// convenient shape hides the bugs it exists to surface.
function fixtureMeetings(): ZoomMeeting[] {
  const day = (n: number) => new Date(Date.now() + n * 864e5).toISOString();
  return [
    { id: '81234567890', topic: 'Weekly product demo', startTime: day(2), duration: 45, joinUrl: 'https://example.zoom.us/j/81234567890' },
    { id: '81234567891', topic: 'Partner sync', startTime: day(6), duration: 60, joinUrl: 'https://example.zoom.us/j/81234567891' },
    { id: '81234567892', topic: 'Customer roundtable', startTime: day(15), duration: 60, joinUrl: 'https://example.zoom.us/j/81234567892' },
  ];
}

interface ZoomListResponse {
  meetings?: { id: number | string; topic: string; start_time?: string; duration?: number; join_url: string }[];
}

/** Upcoming meetings on the connected account. */
export async function listUpcomingMeetings(): Promise<ZoomMeeting[]> {
  if (zoomMode() === 'sandbox' || !(await zoomIsConfigured())) return fixtureMeetings();

  const json = await zoomRequest<ZoomListResponse>('/users/me/meetings?type=upcoming&page_size=50');
  return (json.meetings ?? []).map((m) => ({
    id: String(m.id),
    topic: m.topic,
    startTime: m.start_time ?? null,
    duration: m.duration ?? null,
    joinUrl: m.join_url,
  }));
}

export interface CreateMeetingInput {
  topic: string;
  startTime: Date | null;
  durationMinutes?: number;
  agenda?: string;
}

/** Create a meeting on the connected account. */
export async function createMeeting(input: CreateMeetingInput): Promise<ZoomMeeting> {
  if (zoomMode() === 'sandbox' || !(await zoomIsConfigured())) {
    const id = `sandbox-${Date.now()}`;
    return {
      id,
      topic: input.topic,
      startTime: input.startTime?.toISOString() ?? null,
      duration: input.durationMinutes ?? 60,
      joinUrl: `https://example.zoom.us/j/${id}`,
    };
  }

  const created = await zoomRequest<{ id: number | string; topic: string; start_time?: string; duration?: number; join_url: string }>(
    '/users/me/meetings',
    {
      method: 'POST',
      body: JSON.stringify({
        topic: input.topic,
        // 2 = scheduled meeting. Webinars (type 5) need the paid add-on, and
        // failing over to a meeting is better than failing outright.
        type: 2,
        start_time: input.startTime?.toISOString(),
        duration: input.durationMinutes ?? 60,
        agenda: input.agenda?.slice(0, 2000),
        settings: { join_before_host: false, waiting_room: false },
      }),
    }
  );

  return {
    id: String(created.id),
    topic: created.topic,
    startTime: created.start_time ?? null,
    duration: created.duration ?? null,
    joinUrl: created.join_url,
  };
}

interface ZoomParticipantsResponse {
  participants?: { name?: string; user_email?: string; duration?: number }[];
  next_page_token?: string;
}

/**
 * Attendance for a finished meeting.
 *
 * Deliberately the Meetings API's /past_meetings/.../participants (granular
 * scope meeting:read:list_past_participants), not the Reports API's
 * /report/meetings/.../participants — that one only grants via
 * report:read:list_meeting_participants:admin or :master, which a
 * User-managed OAuth app can't get for a normal (non-admin) connected
 * account. This endpoint is what an individual Zoom user can actually
 * authorize for their own past meetings.
 */
export async function fetchParticipants(meetingId: string): Promise<ZoomParticipant[]> {
  if (zoomMode() === 'sandbox' || !(await zoomIsConfigured())) return [];

  const out: ZoomParticipant[] = [];
  let pageToken = '';
  do {
    const qs = new URLSearchParams({ page_size: '300', ...(pageToken ? { next_page_token: pageToken } : {}) });
    const json = await zoomRequest<ZoomParticipantsResponse>(`/past_meetings/${meetingId}/participants?${qs}`);
    for (const p of json.participants ?? []) {
      out.push({
        name: p.name ?? '',
        email: p.user_email || null,
        durationMinutes: Math.round((p.duration ?? 0) / 60),
      });
    }
    pageToken = json.next_page_token ?? '';
  } while (pageToken);

  return out;
}
