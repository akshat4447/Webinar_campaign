import { NextResponse } from 'next/server';
import { getAttendee } from '@/lib/attendee';
import { generateIcsFeed } from '@/lib/calendar';
import { parseLegacyWebinarDate } from '@/lib/campaignDate';

export async function GET(request: Request, ctx: RouteContext<'/api/calendar/[campaignId]'>) {
  const { campaignId } = await ctx.params;

  // This exposes a campaign's date, description, speaker, and Zoom join link —
  // only for the person who actually registered, not anyone who can guess or
  // enumerate a campaignId. Gated the same way the result page is: a signed,
  // TTL-checked registration token whose embedded campaignId must match.
  const searchParams = new URL(request.url).searchParams;
  const token = searchParams.get('t');
  const attendee = await getAttendee(token, campaignId);
  if (!attendee) return new NextResponse('Not found', { status: 404 });
  const campaign = attendee.campaign;

  const startTime = campaign.scheduledAt
    ?? (campaign.date ? parseLegacyWebinarDate(campaign.date) : null)
    ;
  if (!startTime) return new NextResponse('This webinar is not scheduled.', { status: 409 });
  const endTime = new Date(startTime.getTime() + (campaign.durationMinutes || 60) * 60 * 1000);

  const location = attendee.joinUrl || 'Join details will be provided by the organizer';

  const icsContent = generateIcsFeed({
    title: campaign.name,
    description: campaign.description || campaign.name,
    location,
    startTime,
    endTime,
    speakers: campaign.speakers,
    speakerName: campaign.speakerName,
    speakerTitle: campaign.speakerTitle,
    campaignId: campaign.id,
  });

  const safeFilename = campaign.name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);

  return new NextResponse(icsContent, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${safeFilename || 'webinar'}.ics"`,
      'Cache-Control': 'private, no-store'
      , 'Referrer-Policy': 'no-referrer',
    },
  });
}
