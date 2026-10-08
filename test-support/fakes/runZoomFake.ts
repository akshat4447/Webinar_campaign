// Runs the fake Zoom server standalone:   npx tsx test-support/fakes/runZoomFake.ts
// Env: PORT (default 4010), ZOOM_FAKE_LICENSED=0, ZOOM_FAKE_WEBINARS=1.
import { startFakeZoom } from './zoomFake';

async function main() {
  const port = Number(process.env.PORT ?? 4010);
  const fake = await startFakeZoom({
    port,
    hostLicensed: process.env.ZOOM_FAKE_LICENSED !== '0',
    webinarAddOn: process.env.ZOOM_FAKE_WEBINARS === '1',
  });

  const soon = new Date(Date.now() + 2 * 864e5).toISOString();
  const withReg = fake.seedMeeting({ topic: 'Demo meeting (registration on)', start_time: soon, approval_type: 0 });
  const noReg = fake.seedMeeting({ topic: 'Demo meeting (registration OFF - the approval_type 2 trap)', start_time: soon });
  const webinar = fake.config.webinarAddOn ? fake.seedMeeting({ kind: 'webinar', topic: 'Demo webinar', start_time: soon, approval_type: 0 }) : null;

  const c = fake.config;
  console.log(`Fake Zoom listening on ${fake.origin}

Point the app at it:
  ZOOM_OAUTH_BASE_URL=${fake.oauthUrl}
  ZOOM_API_BASE_URL=${fake.apiUrl}
  ZOOM_CLIENT_ID=${c.clientId}
  ZOOM_CLIENT_SECRET=${c.clientSecret}
  ZOOM_ACCOUNT_ID=${c.accountId}        (Server-to-Server)
  ZOOM_HOST_EMAIL=${c.hostEmail}

Seeded:
  ${withReg.id}  ${withReg.topic}
  ${noReg.id}  ${noReg.topic}${webinar ? `\n  ${webinar.id}  ${webinar.topic}` : ''}

Host licensed: ${c.hostLicensed}   Webinar add-on: ${c.webinarAddOn}
Ctrl+C to stop.`);

  const shutdown = () => {
    fake.stop().finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
