// Starts the fake LeadSquared server standalone and keeps running until Ctrl-C.
//
//   npx tsx test-support/fakes/runLsqFake.ts [--port=4010] [--custom-fields=mx_Seniority,mx_Function]
//                                            [--active-users=me@example.com,you@example.com]
//                                            [--access-key=AK] [--secret-key=SK]

import { startFakeLsq, type FakeLsqOptions } from './lsqFake';

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}
const list = (v: string | undefined): string[] | undefined => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined);

async function main(): Promise<void> {
  const opts: FakeLsqOptions = {
    port: arg('port') ? Number(arg('port')) : 0,
    customFields: list(arg('custom-fields')),
    activeUsers: list(arg('active-users')),
    accessKey: arg('access-key'),
    secretKey: arg('secret-key'),
  };
  const fake = await startFakeLsq(opts);
  console.log(`Fake LeadSquared listening at ${fake.url}`);
  console.log('');
  console.log('Point the app at it:');
  console.log(`  LSQ_API_BASE_URL=${fake.url}`);
  console.log('  LSQ_ACCESS_KEY=any-non-empty   LSQ_SECRET_KEY=any-non-empty   LSQ_HOST=fake.local');
  console.log('');
  console.log('Press Ctrl-C to stop.');

  const shutdown = (): void => {
    void fake.stop().then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

void main();
