# Deployment: one repository, two hosting targets

The canonical repository is `akshat4447/Webinar_campaign`, branch `main`. The root `render.yaml` and `vercel.json` deploy the same application. A separate copy of the source or a duplicate `master` branch is unnecessary. GitHub CI validates pushes and pull requests with disposable PostgreSQL databases; it does not provision hosting.

## Shared release requirements

1. Use Node **24.x**, persistent PostgreSQL 16 or newer, and the committed lockfile (`npm ci`).
2. Set `DATABASE_URL`, the final HTTPS `APP_ORIGIN`, and two independent persistent secrets: `REGISTRATION_SECRET` and `CREDENTIALS_ENCRYPTION_KEY`, each at least 32 characters. Render supplies the origin automatically through `RENDER_EXTERNAL_URL`; set `APP_ORIGIN` explicitly for a custom domain. Generate each key separately with `openssl rand -hex 32`. Keep these values in hosting environment settings, never in GitHub files.
3. Back up the existing database and both keys. An empty hosting database does not contain the existing local campaigns or integration settings. Restore the intended backup before migration if moving existing data.
4. Apply `npm run db:migrate:deploy` against the intended database before serving the release. The approval correction migration revokes only unreviewed, unscored website registrations; it preserves manual and scored decisions.
5. For older installations with plaintext saved credentials, run `npm run credentials:encrypt` once with the persistent encryption key. The operation is idempotent. Retain both keys across releases; replacing them can invalidate credentials or attendee links.
6. Configure the actual providers in Integrations, sender identity, webhook secrets, provider callback URLs, and CRM activity/automation mapping. Do not run demo seed/reset scripts as deployment steps.
7. Check `GET /api/health` returns HTTP 200, open the studio and a public registration page, and test a designated attendee's registration, confirmation, personal calendar and join link. Check worker heartbeat and provider delivery records before launching audience outreach.

The operator studio and worker endpoint have **no authentication or authorization**, by request. Anyone who can reach those endpoints can operate the app, export contacts and initiate provider actions. Signed attendee links and provider webhook signatures remain enforced.

## Render: `render.yaml`

The current template creates **one free full-stack Next.js web service and one free PostgreSQL 16 database**. It deploys both the frontend and backend together; Vercel is not required for this setup. Both resources explicitly use `plan: free`; no paid worker, cron job or disk is declared.

### Deploy the free Blueprint

1. In the [Render dashboard](https://dashboard.render.com), choose **New → Blueprint** and connect `akshat4447/Webinar_campaign` from GitHub.
2. Select branch **main** and Blueprint path **render.yaml**. Render reads the committed file from GitHub; uploading a local YAML alone does not supply the application code.
3. Review the resource list: `webinar-studio` and `webinar-studio-db` must both show **Free**. A workspace supports only one free PostgreSQL database. This file targets a fresh free setup; do not assume it can convert an existing paid database into a free one.
4. Fill the two prompted keys. For a new empty installation, run the following command **twice** and use a different output for each key:

   ```sh
   openssl rand -hex 32
   ```

   When restoring existing data, reuse its original keys. If moving existing campaigns, restore the intended database backup before the app's first successful startup; the template otherwise starts with an empty database. Subsequent Blueprint updates do not prompt again for `sync: false` values; maintain them in the service's Environment settings.
5. Apply the Blueprint. The database's internal connection URL is wired automatically into `DATABASE_URL`. The build runs `npm ci --include=dev && npm run build`; explicitly including development dependencies preserves the required build/install tooling under `NODE_ENV=production`.
6. Startup runs `npm run db:migrate:deploy && npm start`. Migration failure prevents the app from serving. This also runs on restarts and wake-ups; already-applied migrations are skipped. Free services cannot use Render's paid pre-deploy command. The health check is `/api/health`, and future automatic deployments wait for GitHub checks to pass.
7. Open the assigned `https://…onrender.com` URL and check `/api/health` returns HTTP 200. The app uses Render's assigned URL for absolute links without another environment setting. For a custom domain, add its HTTPS URL as `APP_ORIGIN`, redeploy, and update provider callbacks.
8. Configure providers through **Integrations** and verify a designated test registration and email before launching a campaign. Configure SMS and WhatsApp through the intended LeadSquared activities/automation; a CRM activity receipt is not proof of handset delivery.

### Free-tier scheduling and lifetime

`CADENCE_AUTOTICK=false` and `ZOOM_AUTOSYNC=false` keep process timers disabled during setup. **Scheduled cadence jobs, queued background work and automatic Zoom synchronization do not run unattended with this default configuration.** For a controlled cadence test, call `GET https://YOUR_ORIGIN/api/cron/cadence`; this can make real provider calls. Zoom synchronization also requires `ZOOM_AUTOSYNC=true`. A dependable scheduler must be deliberately configured before expecting automatic campaigns to work; sleeping process timers are insufficient.

Free web services sleep after **15 minutes** without inbound traffic and typically take about a minute to wake. Free PostgreSQL has **1 GB** storage, expires after **30 days**, and has no managed backups. Back up or upgrade before expiry. These limits make this a temporary test deployment, not the production configuration described in the original audit. See [Render's free-tier limits](https://render.com/docs/free), [default public URL variables](https://render.com/docs/environment-variables), [deployment commands](https://render.com/docs/deploys#pre-deploy-command), and the [Blueprint specification](https://render.com/docs/blueprint-spec).

For ongoing production, upgrade the web and database plans and commit matching paid plan values to the Blueprint so future syncs preserve them. Move migrations to `preDeployCommand`, use `startCommand: npm start`, and deliberately enable one scheduler owner after provider verification. Retain the existing database and keys.

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
