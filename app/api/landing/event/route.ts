import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAttendee } from '@/lib/attendee';
import { buildGoogleCalendarUrl, buildOutlookCalendarUrl, generateIcsFeed, type CalendarEventInput } from '@/lib/calendar';
import { parseLegacyWebinarDate } from '@/lib/campaignDate';
import { allowRequest, clientIp } from '@/lib/rateLimit';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

const json = (body: Record<string, unknown>, status: number, extra: Record<string, string> = {}) =>
  NextResponse.json(body, { status, headers: { ...CORS_HEADERS, ...extra } });

const IP_LIMIT = { limit: 30, windowMs: 60_000 };

/**
 * What the landing page's calendar pop-up needs after someone registers: the webinar's name and time, ready-made
 * Google and Outlook links, and the .ics text. CORS-open like the registration beacon, so it only ever says what the
 * public page already says. The personal join link is added only for a valid registration token; without one the
 * calendar entry says the joining details arrive by email.
 */
export async function GET(req: NextRequest) {
  try {
    const ip = await allowRequest({ scope: 'landing-event', key: clientIp(req.headers), ...IP_LIMIT });
    if (!ip.allowed) return json({ ok: false, error: 'Too many requests' }, 429, { 'Retry-After': String(ip.retryAfterSec) });

    const params = req.nextUrl.searchParams;
    const campaignId = params.get('c') ?? '';
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(campaignId)) return json({ ok: false, error: 'A webinar is required' }, 400);

    const attendee = await getAttendee(params.get('t'), campaignId);
    const campaign = attendee?.campaign ?? (await db.campaign.findUnique({
      where: { id: campaignId },
      include: { speakers: { orderBy: [{ order: 'asc' }, { id: 'asc' }] } },
    }));
    if (!campaign || campaign.archived) return json({ ok: false, error: 'Webinar not found' }, 404);

    const start = campaign.scheduledAt ?? (campaign.date ? parseLegacyWebinarDate(campaign.date) : null);
    if (!start) return json({ ok: true, event: null }, 200);
    const end = new Date(start.getTime() + (campaign.durationMinutes || 60) * 60 * 1000);

    const personal = Boolean(attendee?.joinUrl);
    const input: CalendarEventInput = {
      title: campaign.name,
      description: campaign.description || campaign.name,
      location: attendee?.joinUrl || 'Joining details will be sent to you by email',
      startTime: start,
      endTime: end,
      speakers: campaign.speakers,
      speakerName: campaign.speakerName,
      speakerTitle: campaign.speakerTitle,
      campaignId: campaign.id,
    };

    return json(
      {
        ok: true,
        event: { title: campaign.name, start: start.toISOString(), end: end.toISOString(), personal },
        calendar: {
          google: buildGoogleCalendarUrl(input),
          outlookLive: buildOutlookCalendarUrl(input, 'live'),
          outlookOffice: buildOutlookCalendarUrl(input, 'office'),
          ics: generateIcsFeed(input),
        },
      },
      200,
      { 'Cache-Control': personal ? 'private, no-store' : 'public, max-age=60' }
    );
  } catch (err) {
    console.error('[api/landing/event] error:', err);
    return json({ ok: false, error: 'Internal server error' }, 500);
  }
}
