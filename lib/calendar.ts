/**
 * Central Calendar Integration Utility
 *
 * Provides RFC 5545 iCalendar (.ics) generation, Google Calendar Web URLs,
 * and Outlook Live / Office 365 Web URLs for webinar campaigns.
 */

export interface CalendarSpeaker {
  name: string;
  title?: string | null;
  company?: string | null;
}

export interface CalendarEventInput {
  title: string;
  description?: string | null;
  location?: string | null;
  startTime: Date | string;
  endTime?: Date | string | null;
  durationMinutes?: number;
  speakers?: CalendarSpeaker[];
  speakerName?: string | null;
  speakerTitle?: string | null;
  campaignId?: string;
  token?: string;
}

export interface CalendarUrls {
  google: string;
  outlookLive: string;
  outlookOffice: string;
  ics: string | null;
}

/**
 * Format a Date to RFC 5545 / Google Calendar UTC basic format: YYYYMMDDTHHmmssZ
 */
export function formatCalendarUtcDate(date: Date): string {
  if (isNaN(date.getTime())) {
    throw new Error('Invalid Date passed to formatCalendarUtcDate');
  }
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * RFC 5545 §3.3.11 TEXT escaping:
 * Backslash first, then semicolon, comma, and literal newlines become \n.
 */
export function escapeIcsText(value: string): string {
  if (!value) return '';
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * Formats a list of speakers into a human-readable summary string.
 */
export function formatCalendarSpeakerList(
  speakers?: CalendarSpeaker[],
  legacySpeakerName?: string | null,
  legacySpeakerTitle?: string | null
): string {
  if (speakers && speakers.length > 0) {
    return speakers
      .map((s) => `• ${s.name}${s.title ? `, ${s.title}` : ''}${s.company ? ` (${s.company})` : ''}`)
      .join('\n');
  }
  if (legacySpeakerName) {
    return `• ${legacySpeakerName}${legacySpeakerTitle ? ` (${legacySpeakerTitle})` : ''}`;
  }
  return '';
}

/**
 * Resolves safe start and end Date objects from input.
 */
export function resolveCalendarDates(
  startTime: Date | string,
  endTime?: Date | string | null,
  durationMinutes = 60
): { start: Date; end: Date } {
  const start = startTime instanceof Date ? startTime : new Date(startTime);
  if (isNaN(start.getTime())) {
    const fallbackStart = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const fallbackEnd = new Date(fallbackStart.getTime() + durationMinutes * 60 * 1000);
    return { start: fallbackStart, end: fallbackEnd };
  }

  let end: Date;
  if (endTime) {
    const parsedEnd = endTime instanceof Date ? endTime : new Date(endTime);
    end = isNaN(parsedEnd.getTime())
      ? new Date(start.getTime() + durationMinutes * 60 * 1000)
      : parsedEnd;
  } else {
    end = new Date(start.getTime() + durationMinutes * 60 * 1000);
  }

  // Ensure end is strictly after start
  if (end.getTime() <= start.getTime()) {
    end = new Date(start.getTime() + durationMinutes * 60 * 1000);
  }

  return { start, end };
}

/**
 * Compiles description with speaker roster and location/join URL.
 */
export function buildCalendarFullDescription(event: CalendarEventInput): string {
  const parts: string[] = [];
  if (event.description?.trim()) {
    parts.push(event.description.trim());
  } else if (event.title?.trim()) {
    parts.push(event.title.trim());
  }

  const speakerSummary = formatCalendarSpeakerList(
    event.speakers,
    event.speakerName,
    event.speakerTitle
  );
  if (speakerSummary) {
    parts.push(`\nFeatured Speaker(s):\n${speakerSummary}`);
  }

  const location = event.location?.trim() || 'Online Webinar';
  parts.push(`\nJoin URL: ${location}`);

  return parts.join('\n');
}

/**
 * Builds Google Calendar web render URL.
 * Spec: https://calendar.google.com/calendar/render?action=TEMPLATE&text=...&dates=YYYYMMDDTHHmmssZ/YYYYMMDDTHHmmssZ&details=...&location=...
 */
export function buildGoogleCalendarUrl(event: CalendarEventInput): string {
  const { start, end } = resolveCalendarDates(
    event.startTime,
    event.endTime,
    event.durationMinutes
  );
  const title = event.title || 'Webinar Session';
  const location = event.location?.trim() || 'Online Webinar';
  const details = buildCalendarFullDescription(event);

  const datesParam = `${formatCalendarUtcDate(start)}/${formatCalendarUtcDate(end)}`;

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: datesParam,
    details: details,
    location: location,
  });

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/**
 * Builds Outlook Web compose URL.
 * Works for both Outlook Live (personal) and Office 365 (work accounts).
 */
export function buildOutlookCalendarUrl(
  event: CalendarEventInput,
  flavor: 'live' | 'office' = 'live'
): string {
  const { start, end } = resolveCalendarDates(
    event.startTime,
    event.endTime,
    event.durationMinutes
  );
  const title = event.title || 'Webinar Session';
  const location = event.location?.trim() || 'Online Webinar';
  const details = buildCalendarFullDescription(event);

  const baseUrl =
    flavor === 'office'
      ? 'https://outlook.office.com/calendar/0/deeplink/compose'
      : 'https://outlook.live.com/calendar/0/deeplink/compose';

  const params = new URLSearchParams({
    subject: title,
    startdt: start.toISOString(),
    enddt: end.toISOString(),
    body: details,
    location: location,
    path: '/calendar/action/compose',
    rru: 'addevent',
  });

  return `${baseUrl}?${params.toString()}`;
}

/**
 * Builds all 4 calendar URLs (Google, Outlook Live, Office 365, and ICS download).
 */
export function buildCalendarUrls(
  event: CalendarEventInput,
  apiOrigin?: string
): CalendarUrls {
  const google = buildGoogleCalendarUrl(event);
  const outlookLive = buildOutlookCalendarUrl(event, 'live');
  const outlookOffice = buildOutlookCalendarUrl(event, 'office');

  let ics: string | null = null;
  if (event.campaignId) {
    const origin = apiOrigin ? apiOrigin.replace(/\/$/, '') : '';
    const tokenQuery = event.token ? `?t=${encodeURIComponent(event.token)}` : '';
    ics = `${origin}/api/calendar/${encodeURIComponent(event.campaignId)}${tokenQuery}`;
  }

  return {
    google,
    outlookLive,
    outlookOffice,
    ics,
  };
}

/**
 * Generates RFC 5545 .ics file contents for Apple Calendar, Outlook Desktop, and Google Calendar import.
 */
export function generateIcsFeed(
  event: CalendarEventInput,
  options?: { uid?: string; organizerName?: string; organizerEmail?: string }
): string {
  const { start, end } = resolveCalendarDates(
    event.startTime,
    event.endTime,
    event.durationMinutes
  );
  const now = new Date();

  const title = event.title || 'Webinar Session';
  const location = event.location?.trim() || 'Online Webinar';
  const description = buildCalendarFullDescription(event);

  const uid = options?.uid || `webinar-${event.campaignId || Date.now()}@webinar-studio`;

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Webinar Studio//Webinar Campaign Engine//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${formatCalendarUtcDate(now)}`,
    `DTSTART:${formatCalendarUtcDate(start)}`,
    `DTEND:${formatCalendarUtcDate(end)}`,
    `SUMMARY:${escapeIcsText(title)}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
    `LOCATION:${escapeIcsText(location)}`,
    'STATUS:CONFIRMED',
    'BEGIN:VALARM',
    'TRIGGER:-PT15M',
    'ACTION:DISPLAY',
    'DESCRIPTION:Webinar starting in 15 minutes',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  return lines.join('\r\n');
}
