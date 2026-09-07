# Webinar Studio

An agent that runs B2B webinar campaigns end-to-end: import and score an audience with Claude, enrich sparse contacts with real Apollo/Apify calls, personalize multi-channel outreach (Email · LinkedIn · SMS · WhatsApp through LeadSquared), create and sync a **Zoom** meeting, publish an official **LinkedIn Event** with a registration form, ingest every signup back through **Lead Sync**, and sync everything to **LeadSquared** as real leads and activities.

## Stack

- Next.js 16 (App Router, Turbopack) · React 19 · TypeScript strict
- Prisma 7 (`prisma-client` generator → `lib/generated/prisma`) on **Postgres**, via the `@prisma/adapter-pg` driver adapter
- Anthropic SDK (scoring, personalization, enrichment, copy angles, post-event debrief, error diagnosis)
- Vitest · ESLint

## Local setup

Needs a real Postgres database — there's no SQLite fallback.

```bash
npm install
createdb webinar_studio_dev          # or use any Postgres instance you already have
cp .env.example .env.local           # fill in real values, at least DATABASE_URL
npx prisma migrate dev               # applies schema, generates the client
npm run db:seed                      # optional demo data (5 sample campaigns)
npm run dev                          # http://localhost:3000
```

## Environment variables

See `.env.example` for the full, commented list. Summary:

| Group | Keys | Required? |
|---|---|---|
| Database | `DATABASE_URL` | **Yes** — a Postgres connection string |
| Claude | `ANTHROPIC_API_KEY` | Yes — scoring/personalization/enrichment won't run without it |
| LeadSquared | `LSQ_ACCESS_KEY` `LSQ_SECRET_KEY` `LSQ_HOST` `LSQ_SENDER_EMAIL` | Yes — all real sends and CRM sync go through LSQ |
| Send safety | `SEND_MODE=sandbox\|live` · `SEND_ALLOWLIST_LEAD_EMAIL` | Yes — sandbox by default; every send redirects to the allowlisted lead until you flip this |
| Apollo | `APOLLO_API_KEY` | Optional — real email-match enrichment + LinkedIn pre-send verification; falls back to a clearly-flagged, unverified guess when absent |
| Apify | *(Integrations page only, no env var)* | Optional — real web-context grounding for enrichment |
| Zoom | `ZOOM_MODE` `ZOOM_CLIENT_ID/SECRET` `ZOOM_REDIRECT_URI` `ZOOM_AUTOSYNC` | Optional — meeting creation + attendance import |
| LinkedIn | `LINKEDIN_MODE` `LINKEDIN_CLIENT_ID/SECRET` `LINKEDIN_REDIRECT_URI` `LINKEDIN_VERSION` `LINKEDIN_ORGANIZATION_URN` | Optional — Events publishing + Lead Sync |
| One-click sign-up | `REGISTRATION_SECRET` `APP_ORIGIN` | Set an explicit `REGISTRATION_SECRET` in any real deployment — the fallback is a well-known dev-only string |
| Background automation | `CADENCE_AUTOTICK[_SECONDS]` `ZOOM_AUTOSYNC[_SECONDS]` | Optional, off by default — see "Background automation" below before enabling either in production |

Almost everything above can *also* be set per-field from the **Integrations** page once the app is running — a saved DB value always wins over its env var equivalent, so you can bootstrap with env vars and then rotate credentials live without a redeploy.

## Deploying

The app needs one thing neither platform gives you by default: a **real, network-reachable Postgres database** — never a local file. Both `render.yaml` and `netlify.toml` in this repo are ready to use as-is, and both drive scheduled cadence sends through one real HTTP endpoint, `GET /api/cron/cadence` (`app/api/cron/cadence/route.ts`) — the same one `vercel.json` wires up for Vercel Cron. Protect it in any real deployment by setting `CRON_SECRET`; the route runs unauthenticated if it's left unset.

### Render (recommended — supports full background automation)

1. Push this repo to GitHub, then in Render: **New → Blueprint**, point it at the repo. Render reads `render.yaml` and provisions, together: a free Postgres database, the web service (build runs `prisma migrate deploy` before `next build`), and a lightweight cron job that calls `/api/cron/cadence` every 5 minutes.
2. After the first deploy, open the **web service → Environment** and fill in the secrets `render.yaml` left blank (`sync: false`): `ANTHROPIC_API_KEY`, LSQ credentials, `CRON_SECRET` (pick any random string), Zoom/LinkedIn OAuth app credentials, etc. — or skip most of these and configure them from the running app's **Integrations** page instead, which always wins over env vars.
3. Open the **cadence-cron job's Environment** and set the *same* `CRON_SECRET` value you just picked, so its request to the web service authenticates. `APP_URL` in `render.yaml` already points at `https://webinar-studio.onrender.com` — update it if you renamed the service or attached a custom domain.
4. For Zoom/LinkedIn OAuth: create each app in its developer portal with the redirect URI `https://<your-service>.onrender.com/api/auth/{zoom,linkedin}/callback`. The app derives its own origin from Render's proxy headers, so `ZOOM_REDIRECT_URI`/`LINKEDIN_REDIRECT_URI` only need setting if you put a custom domain in front and see a mismatch.
5. Keep `SEND_MODE=sandbox` until you've verified templates and sender identity from the Integrations page — flipping to `live` is a real, deliberate decision, not a default.

A `Dockerfile` is also in the repo (multi-stage, uses `next.config.ts`'s `output: 'standalone'`) if you'd rather deploy as a Render **Docker** web service instead of the native Node runtime above — either works; the Blueprint uses native Node because it's simpler to wire secrets into.

### Netlify

1. **Add a new site → Import an existing project**, point it at this repo. Netlify reads `netlify.toml`, installs the Next.js Runtime plugin, and runs `prisma migrate deploy` before every build.
2. In **Site configuration → Environment variables**, set `DATABASE_URL` (pointing at a real hosted Postgres — Render's own, Neon, and Supabase all work), `CRON_SECRET`, plus whichever credentials you want to bootstrap with; the rest can be configured later from the Integrations page.
3. There is no long-lived process on Netlify's serverless functions, so `CADENCE_AUTOTICK`/`ZOOM_AUTOSYNC` (see "Background automation" below) don't run here at all — leave them unset and drive `/api/cron/cadence` from a Netlify Scheduled Function or an external cron service instead (step 4).
4. Add a scheduler that calls `GET https://<your-site>.netlify.app/api/cron/cadence` with header `Authorization: Bearer <CRON_SECRET>` every 5 minutes — a [Netlify Scheduled Function](https://docs.netlify.com/functions/scheduled-functions/), a GitHub Actions workflow on a `schedule:` trigger, or a free service like cron-job.org all work.

### Background automation (matters on either platform)

`CADENCE_AUTOTICK` and `ZOOM_AUTOSYNC` (see `instrumentation.ts`) are **in-process timers** — convenient for a single, always-on server, but they stop the moment that process restarts, and would double-process sends if the service ever scaled to more than one instance. `/api/cron/cadence` sidesteps this entirely by doing the same work as a stateless, externally-triggered HTTP call instead.

- **Render**: `render.yaml`'s cron job already calls that endpoint on a schedule — don't also set `CADENCE_AUTOTICK` on the web service, or sends get processed twice. `ZOOM_AUTOSYNC` is left on the web service itself, which is fine for exactly one instance (there's no equivalent HTTP endpoint for Zoom sync yet).
- **Netlify**: neither timer runs at all — see step 4 above; there's no in-process alternative here, the endpoint is the only option.

## Scripts

| Command | Purpose |
|---|---|
| `dev` / `build` / `start` / `lint` / `test` | standard |
| `db:seed` · `demo:reset` · `demo:tidy` | demo data lifecycle |
| `db:migrate:deploy` | applies pending migrations without prompting (what deploys run) |
| `cadence:tick` | cron-style drain of due cadence sends (email/SMS/WA) |
| `linkedin:process` | retry/drain the LinkedIn registration queue |
| `backfill:templates` · `backfill:channels` | provision missing templates/steps on existing campaigns |
| `refresh:templates` | push improved default copy to never-edited templates only |
| `npx tsx scripts/e2e-journey.ts` | live end-to-end journey regression (sandbox-aware) |
| `npx tsx scripts/deep-audit-db.ts` | per-campaign completeness snapshot |
| `npx tsx scripts/cleanup-autocreated-lists.ts` | empties/unlinks LeadSquared lists this app auto-created |
| `npx tsx scripts/verify-channel-dispatcher.ts` | exercises the SMS/WhatsApp trigger-vs-direct dispatcher live |

## Integrations & delivery modes

| Integration | Mode switch | Notes |
|---|---|---|
| LeadSquared | always live | leads, lists, email, custom activities, SMS/WA strategies |
| Claude | key required | scoring, personalization, enrichment, copy angles, post-event debrief |
| Apollo | key optional | real email-match enrichment + pre-flight verification before any LinkedIn touch; falls back to a flagged, unverified guess when absent |
| Apify | token optional (Integrations page) | grounds enrichment in a real web-search result per company |
| Zoom | `ZOOM_MODE=sandbox\|live` | user-managed OAuth; meeting creation and attendance import both run automatically once connected |
| LinkedIn Events | `LINKEDIN_MODE=sandbox\|live` | sandbox simulates every call; webhook still processes fixtures |
| SMS / WhatsApp | per-channel `trigger` (via LeadSquared Automation) or `direct` (your own HTTP gateway) | configured on the Integrations page's SMS & WhatsApp Business card |

## LinkedIn Event wiring (live mode)

1. Developer portal → create app, request **Events** product access + **Lead Sync**.
2. Integrations → LinkedIn → save Client ID/Secret → **Connect with LinkedIn**.
3. Point your Lead Sync webhook at `POST {origin}/api/webhooks/linkedin` and set `LINKEDIN_CLIENT_SECRET` — payloads are HMAC-verified (`X-LI-Signature`) and production fails closed without a secret.
4. Publish from a campaign's Setup tab; registrations stream back automatically into Scoring → LeadSquared.

## Project layout

```
app/                    routes (pages + api/auth/{zoom,linkedin}/*, api/webhooks/linkedin, api/calendar)
lib/db.ts               Prisma client singleton (Postgres via @prisma/adapter-pg)
lib/linkedin/           Events API client, OAuth, forms, webhook contract, orchestrator, ingest
lib/zoom/               OAuth, meetings, attendance
lib/channels.ts         pure channel routing + SMS segment math
lib/channelDelivery.ts  trigger/direct strategies for SMS & WhatsApp
lib/cadenceReadiness.ts green-status validation for Templates/Personalize
lib/claude.ts           every Anthropic call the app makes
scripts/                operational CLIs (ticks, drains, backfills, audits) — each loads env via lib/loadEnv
```
