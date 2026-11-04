// Prints (or writes) the complete Framer component for a webinar, with the Studio script built in.
//
//   npm run framer:component -- <webinar id>            prints it
//   npm run framer:component -- <webinar id> --out UniversalWebinarLanding.tsx
//
// Uses this app's public address (APP_ORIGIN) and the webinar's Zoom event and landing page. Generate it again whenever either
// the address or the webinar changes, then paste it over the component in Framer and publish.
import { writeFileSync } from 'node:fs';

async function main() {
  const args = process.argv.slice(2);
  const outAt = args.indexOf('--out');
  const out = outAt >= 0 ? args[outAt + 1] : null;
  const id = args.find((a, i) => !a.startsWith('--') && i !== outAt + 1);
  if (!id) {
    console.error('Usage: npm run framer:component -- <webinar id> [--out file.tsx]');
    process.exit(1);
  }
  const { db } = await import('../lib/db');
  const { appOrigin } = await import('../lib/appOrigin');
  const { classifyHost } = await import('../lib/linkHost');
  const { generateFramerComponent } = await import('../lib/framerComponent');
  const campaign = await db.campaign.findUnique({ where: { id }, select: { id: true, name: true, zoomMeetingId: true, registrationLink: true } });
  if (!campaign) {
    console.error(`No webinar with the id ${id}.`);
    process.exit(1);
  }
  const origin = appOrigin();
  if (classifyHost(origin) === 'temporary') {
    console.error(`Note: ${origin} is a temporary address (a tunnel or this machine). The file works while it stays reachable; generate it again if it changes.`);
  }
  const text = generateFramerComponent({ apiOrigin: origin, campaignId: campaign.id, zoomId: campaign.zoomMeetingId, landingUrl: campaign.registrationLink });
  if (out) {
    writeFileSync(out, text);
    console.error(`Wrote ${out} for "${campaign.name}" (${campaign.id}), sending registrations to ${origin}.`);
  } else {
    process.stdout.write(text);
  }
  await db.$disconnect();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
