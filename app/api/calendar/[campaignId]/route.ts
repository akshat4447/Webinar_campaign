import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyRegistrationToken } from '@/lib/registration';

function formatIcsDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

// RFC 5545 §3.3.11 TEXT escaping: backslash first, then semicolon/comma,
// then a literal newline becomes the two-character sequence \n. Applies to
// every TEXT-valued property (SUMMARY, DESCRIPTION, LOCATION) alike —
// stripping punctuation to a space instead of escaping it (the previous
// approach for SUMMARY/LOCATION) produces a non-conformant file and silently
// mangles any campaign name/description that contains it.
function icsEscapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

export async function GET(request: Request, ctx: RouteContext<'/api/calendar/[campaignId]'>) {
  const { campaignId } = await ctx.params;

  // This exposes a campaign's date, description, speaker, and Zoom join link —
  // only for the person who actually registered, not anyone who can guess or
  // enumerate a campaignId. Gated the same way the result page is: a signed,
  // TTL-checked registration token whose embedded campaignId must match.
  const token = new URL(request.url).searchParams.get('t');
  const verified = token ? verifyRegistrationToken(token) : null;
  if (!verified?.ok || verified.payload.campaignId !== campaignId) {
    return new NextResponse('Not found', { status: 404 });
  }

  const campaign = await db.campaign.findUnique({
    where: { id: campaignId },
    select: {
      id: true,
      name: true,
      description: true,
      scheduledAt: true,
      date: true,
      zoomLink: true,
      registrationLink: true,
      speakerName: true,
      speakerTitle: true,
    },
  });

  if (!campaign) {
    return new NextResponse('Webinar not found', { status: 404 });
  }

  const startTime = campaign.scheduledAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000);
  const endTime = new Date(startTime.getTime() + 60 * 60 * 1000); // 1 hour default
  const now = new Date();

  const location = campaign.zoomLink || campaign.registrationLink || 'Online Event';
  const speakerText = campaign.speakerName
    ? `\nFeatured Speaker: ${campaign.speakerName}${campaign.speakerTitle ? ` (${campaign.speakerTitle})` : ''}`
    : '';
  const description = `${campaign.description || campaign.name}${speakerText}\n\nJoin URL: ${location}`;

  const safeSummary = icsEscapeText(campaign.name);
  const safeDescription = icsEscapeText(description);
  const safeLocation = icsEscapeText(location);

  const icsContent = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Webinar Studio//Webinar Campaign Engine//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:webinar-${campaign.id}@webinar-studio`,
    `DTSTAMP:${formatIcsDate(now)}`,
    `DTSTART:${formatIcsDate(startTime)}`,
    `DTEND:${formatIcsDate(endTime)}`,
    `SUMMARY:${safeSummary}`,
    `DESCRIPTION:${safeDescription}`,
    `LOCATION:${safeLocation}`,
    'STATUS:CONFIRMED',
    'BEGIN:VALARM',
    'TRIGGER:-PT15M',
    'ACTION:DISPLAY',
    'DESCRIPTION:Webinar starting in 15 minutes',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  const safeFilename = campaign.name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);

  return new NextResponse(icsContent, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${safeFilename || 'webinar'}.ics"`,
      'Cache-Control': 'no-cache',
    },
  });
}
