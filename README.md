# Webinar Studio

A webinar operations app: prepare an audience, score and enrich contacts, approve messages, schedule outreach, register attendees, sync Zoom/LeadSquared, and review attendance and delivery history.

The operator app and worker endpoint have no login, role checks, or authorization gates, as requested. Provider OAuth, verified webhooks, and signed attendee links remain part of the integration and attendee workflows. Delivery uses actual configured providers and actual selected recipients; there is no delivery sandbox, allowlist redirection, simulated clock, or fabricated integration success.

## Setup

Use Node 24.x and PostgreSQL 16 or newer. Install the dependencies, copy `.env.example` to `.env.local`, and configure `DATABASE_URL`, `APP_ORIGIN`, and two independently generated persistent keys: `REGISTRATION_SECRET` and `CREDENTIALS_ENCRYPTION_KEY` (at least 32 characters each). Keep encrypted database backups together with securely stored copies of the keys.

```sh
npm ci
npm run db:migrate:deploy
npm run dev
```

Configure the actual providers on Integrations. Email can use LeadSquared or Netcore with a valid sender; phone channels can use a configured public HTTPS gateway or a LeadSquared automation trigger. A trigger accepted by CRM is reported as queued, not confirmed recipient delivery. LinkedIn outreach remains assisted/manual. Missing provider configuration produces a visible blocked/failed result.

The optional seed/reset scripts create demo records; they are not deployment steps. The `emailSimulated` contact field records an inferred, unverified address and prevents sending guesses. It is not a delivery mode.

## Workers and recovery

Run `npm run cadence:tick` or schedule `GET /api/cron/cadence` every five minutes. Both call the same database-leased worker for registrations, due sends, broadcasts, attendance, and audience jobs. `ZOOM_AUTOSYNC=true` also enables Zoom synchronization through that worker. On a persistent Node server, `CADENCE_AUTOTICK=true` enables the optional timer. Timers default off; external schedules are needed on serverless deployments. Choose a schedule deliberately: a worker can make actual provider calls.

Registration, scoring, enrichment, and broadcasts persist their work and cursor. Campaign pages show progress and the latest worker heartbeat. Failed audience batches can retry their remaining work. Provider responses that are lost or ambiguous are held as uncertain and are never automatically resent. Check provider records, then supply receipt/rejection evidence in Background work or Results to confirm the outcome. Confirmed rejection returns the operation to the queue; confirmed acceptance preserves its receipt. Broadcasts preserve per-recipient results across retries. Pause/stop and current consent are checked before dispatch.

Daily dispatch limits are shared across workers and broadcasts using the campaign timezone. LeadSquared exclusion snapshots expire after five minutes; dispatch fails closed when a complete snapshot cannot be fetched. Each configured exclusion list must contain fewer than 10,000 members. Public email registration gives a generic confirmation; personal join/calendar data requires a valid signed attendee link.

## Verification

```sh
npm test
npm run test:integration
npm run typecheck
npm run lint
npm run build
npm audit
```

Unit tests cannot use the application database. Integration tests create a uniquely named database, apply migrations, require zero schema drift, exercise real database transactions with mocked/local providers, and drop the database. Set `TEST_DATABASE_ADMIN_URL` to a dedicated PostgreSQL server whose user can create/drop test databases. External provider requests are blocked unless explicitly mocked.

Browser verification uses an installed Chrome browser and a production build:

```sh
npm run build -- --webpack
npm run test:ui
npm run test:load
```

`test:ui` creates its own database and local server on port 3100, disables timers and provider credentials, checks desktop/mobile routes, registration, personal calendar links, modal focus, and serious/critical accessibility violations, then removes the test database. Screenshots/results are in `artifacts/verification/browser/`. Existing operational scripts such as channel probes and end-to-end live journeys can call real providers; use the isolated test commands for regression verification.

Campaign messaging and LinkedIn recipient queues use 50-row server pages with search. Overview/channel analytics aggregate in SQL and keep recipient previews bounded. `test:load` creates 10,000 contacts, 10,000 messages and 10,000 send records, verifies pagination/search and page payload budgets, exercises 24 concurrent page requests, and drops its database. It uses a local production server on port 3102 and makes no external provider calls.

The full dependency audit includes development tools. The small `tooling/next-glob-compat` package preserves the Next ESLint plugin's synchronous directory-glob interface with `tinyglobby`, including absolute paths and brace patterns, to remove its vulnerable `braces` dependency chain. It is covered by compatibility tests and an install-time Next version/API guard, and installed from the lockfile with `npm ci`. Next packages are pinned; upgrades deliberately require review of this adapter.

For a read-only recovery rehearsal against the configured application database:

```sh
npm run test:recovery
```

This requires `pg_dump` and `pg_restore`, creates a protected temporary backup, restores it into a disposable database, compares every public table's counts and content hashes, verifies encrypted credential recovery and migration parity, then removes the restore database and temporary dump. Keep persistent encryption/registration keys backed up separately.

Read-only live connection checks and activity inspection are available separately:

```sh
npm run verify:providers
npx tsx scripts/inspect-activities.ts designated-recipient@example.com
```

Adding `-- --email EMAIL --phone E164_PHONE` to `verify:providers` sends real, idempotent tests to those recipients after checking known-contact eligibility. Configure both phone channels to LeadSquared Automation on Integrations when using CRM delivery. The app validates the selected activity type and required Channel, Cadence Step and Message fields. A CRM activity receipt proves the handoff; verify downstream delivery in LeadSquared automation/gateway logs. WhatsApp requires recorded opt-in.

## Deployment

Render, Netlify, Vercel, and the Docker image require PostgreSQL, Node 24, the two persistent keys, and the correct public origin. Build with `npm ci --include=dev && npm run build`. The current `render.yaml` creates a free web service and free PostgreSQL for temporary testing, applies migrations before startup, and uses Render's assigned URL automatically. Its background timers are disabled; the service sleeps after 15 idle minutes and the database expires after 30 days. Follow [the Render setup and scheduling instructions](docs/DEPLOYMENT.md#render-renderyaml) before expecting unattended campaigns. Other targets require a separate migration release step using `npm run db:migrate:deploy` before serving the new version; preview builds must use their own database. The Docker runner expects the database to be migrated externally.

For an existing installation, back up the database and keys, deploy migrations, and run `npm run credentials:encrypt` once to encrypt legacy stored provider secrets. The command is idempotent and never prints secret values. Do not change `CREDENTIALS_ENCRYPTION_KEY` without decrypting/re-encrypting existing credentials or reconnecting the providers. Changing `REGISTRATION_SECRET` invalidates previously issued attendee links; retain its value across restarts and deployments.

Provider callback URLs are `/api/auth/zoom/callback` and `/api/auth/linkedin/callback`. Webhook routes verify the provider signatures with configured provider secrets. This is separate from operator authentication. Keep webhook tokens out of proxy/access-log query strings. Contact exports and database backups contain personal data; retain them only as needed for the campaign and recovery process.


The latest audit and release checks are in [docs/PRODUCTION_AUDIT.md](docs/PRODUCTION_AUDIT.md). Deployment instructions for both providers are in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
