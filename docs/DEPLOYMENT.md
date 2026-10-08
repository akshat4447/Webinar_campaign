# Deployment: one repository, two hosting targets

The canonical repository is `akshat4447/Webinar_campaign`, branch `main`. The root `render.yaml` and `vercel.json` deploy the same application. A separate copy of the source or a duplicate `master` branch is unnecessary. GitHub CI validates pushes and pull requests with disposable PostgreSQL databases; it does not provision hosting.

## Shared release requirements

1. Use Node **24.x**, persistent PostgreSQL 16 or newer, and the committed lockfile (`npm ci`).
2. Set `DATABASE_URL`, the final HTTPS `APP_ORIGIN`, and two independent persistent secrets: `REGISTRATION_SECRET` and `CREDENTIALS_ENCRYPTION_KEY`, each at least 32 characters. Generate each separately with `openssl rand -hex 32`. Keep these values in hosting environment settings, never in GitHub files.
3. Back up the existing database and both keys. An empty hosting database does not contain the existing local campaigns or integration settings. Restore the intended backup before migration if moving existing data.
4. Apply `npm run db:migrate:deploy` against the intended database before serving the release. The approval correction migration revokes only unreviewed, unscored website registrations; it preserves manual and scored decisions.
5. For older installations with plaintext saved credentials, run `npm run credentials:encrypt` once with the persistent encryption key. The operation is idempotent. Retain both keys across releases; replacing them can invalidate credentials or attendee links.
6. Configure the actual providers in Integrations, sender identity, webhook secrets, provider callback URLs, and CRM activity/automation mapping. Do not run demo seed/reset scripts as deployment steps.
7. Check `GET /api/health` returns HTTP 200, open the studio and a public registration page, and test a designated attendee's registration, confirmation, personal calendar and join link. Check worker heartbeat and provider delivery records before launching audience outreach.

The operator studio and worker endpoint have **no authentication or authorization**, by request. Anyone who can reach those endpoints can operate the app, export contacts and initiate provider actions. Signed attendee links and provider webhook signatures remain enforced.

## Render: `render.yaml`

Create or update a Blueprint using the repository's `main` branch. The template declares an always-on paid web service (`0.5c-512mb`) and paid PostgreSQL (`0.1c-256mb`, 5 GB, version 16). Applying the Blueprint provisions billable resources; storing this file in GitHub does not.

The Blueprint installs with `npm ci`, builds the app, applies migrations with the pre-deploy command, starts `npm start`, and checks `/api/health`. Fill the prompted origin and persistent keys. Provider settings can be saved through Integrations. Automatic deployment waits for repository checks to pass.

The web service enables five-minute cadence and Zoom timers. These make real provider calls after configuration. Database leases prevent overlapping cadence workers; keep a single primary deployment responsible for scheduling. A free sleeping web service and an expiring free database are unsuitable substitutes for these production settings. Render restricts the pre-deploy command to paid services. See [Render deployment commands](https://render.com/docs/deploys#pre-deploy-command), [compute plans](https://render.com/docs/compute-plans), and the [Blueprint specification](https://render.com/docs/blueprint-spec).

## Vercel: `vercel.json`

Import the same repository with the Next.js preset and `main` as the production branch. The configuration uses `npm ci`, `npm run build`, and a 120-second maximum for API functions. The studio layout also specifies 120 seconds for its server functions. Set the shared production environment variables and leave `CADENCE_AUTOTICK=false` and `ZOOM_AUTOSYNC=false` unless deliberately enabling Zoom synchronization through the scheduled worker. Process timers do not provide dependable serverless scheduling.

Provision an external persistent PostgreSQL database and use the database provider's serverless connection pooling when available. Each application instance limits its pool to five connections; total connections still increase with instance concurrency. Preview deployments need their own database and signing/encryption keys.

Run the migration release step from a trusted terminal or release job before promoting a deployment:

```sh
# Supply the intended production environment through your secret manager.
npm ci
npm run db:migrate:deploy
```

Vercel does not run Render's pre-deploy command. Database credentials supplied to a release job must match the intended environment. Take a backup before migration; rolling back application code does not reverse a data migration.

**Configure a five-minute scheduler.** The base configuration intentionally has no native cron entry: Vercel Hobby accepts only daily cron schedules. Use an external scheduler to call `GET https://YOUR_ORIGIN/api/cron/cadence` every five minutes, or on Vercel Pro add this root property:

```json
"crons": [{ "path": "/api/cron/cadence", "schedule": "*/5 * * * *" }]
```

To include Zoom synchronization in the shared worker set `ZOOM_AUTOSYNC=true`; do not depend on its process-local timer. A scheduler request can make actual configured provider calls. Verify heartbeat on campaign Background work. See [Vercel Node versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions), [cron plan limits](https://vercel.com/docs/cron-jobs/usage-and-pricing), and [function limits](https://vercel.com/docs/functions/limitations).

## Docker and other targets

The Dockerfile uses Node 24, builds a standalone Next server, runs as a non-root user and excludes local environment files and verification artifacts. Migrate the database externally before starting the image. A Docker daemon was unavailable for this audit, so container execution is not claimed. `netlify.toml` remains an optional Node 24 configuration; it needs the same external migration and worker schedule setup.

## Operational verification and recovery

Do not enable two hosting deployments against the same production database and origin without deliberately choosing the worker owner and provider callback target. Keep preview environments isolated.

After deployment verify health, callback origins, signature-verified webhooks, SMS/WhatsApp activity types and fields, and downstream CRM automation. A successful LeadSquared activity proves CRM handoff; it does not prove handset delivery. WhatsApp requires recorded recipient opt-in.

Monitor worker errors, stale leases, queued/unknown delivery outcomes, database connections, quotas and provider rejections. For uncertain delivery, inspect provider evidence and use the outcome-confirmation UI; automatic replay is intentionally blocked. Keep encrypted backups and keys separately protected. `npm run test:recovery` rehearses restoration without modifying source data and requires database create/drop privileges plus `pg_dump` and `pg_restore`.
