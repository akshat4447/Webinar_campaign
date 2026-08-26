# Webinar Campaign Agent

An agent that runs B2B webinar campaigns end-to-end: import and score an audience with Claude, personalize multi-channel outreach (Email · LinkedIn · SMS · WhatsApp through LeadSquared), publish an official **LinkedIn Event** with a registration form, ingest every signup back through **Lead Sync**, and sync everything to **LeadSquared** as real leads and activities.

## Stack

- Next.js 16 (App Router, Turbopack dev) · React 19 · TypeScript strict
- Prisma 7 (`prisma-client` generator → `lib/generated/prisma`) on SQLite via `better-sqlite3`
- Anthropic SDK (scoring, personalization, enrichment, error diagnosis)
- Vitest · ESLint

## Getting started

```bash
npm install
cp .env.example .env.local      # fill in real values
npx prisma migrate deploy       # or: npx prisma migrate dev
npm run db:seed                 # optional demo data
npm run dev                     # http://localhost:3000
```

### `.env.local` keys (see `.env.example`)

| Group | Keys |
|---|---|
| LeadSquared | `LSQ_ACCESS_KEY` `LSQ_SECRET_KEY` `LSQ_HOST` `LSQ_SENDER_EMAIL` |
| Email safety | `SEND_MODE=sandbox\|live` · `SEND_ALLOWLIST_LEAD_EMAIL` |
| Claude | `ANTHROPIC_API_KEY` |
| LinkedIn Events | `LINKEDIN_MODE` `LINKEDIN_CLIENT_ID/SECRET` `LINKEDIN_REDIRECT_URI` `LINKEDIN_VERSION` `LINKEDIN_ORGANIZATION_URN` |

Everything can also be saved per-field from the **Integrations** page (DB wins over env). Never commit `.env.local`.

## Scripts

| Command | Purpose |
|---|---|
| `dev` / `build` / `start` / `lint` / `test` | standard |
| `db:seed` · `demo:reset` · `demo:tidy` | demo data lifecycle |
| `cadence:tick` | cron-style drain of due cadence sends (email/SMS/WA) |
| `linkedin:process` | retry/drain the LinkedIn registration queue |
| `backfill:templates` · `backfill:channels` | provision missing templates/steps on existing campaigns |
| `refresh:templates` | push improved default copy to never-edited templates only |
| `npx tsx scripts/e2e-journey.ts` | live end-to-end journey regression (sandbox-aware) |
| `npx tsx scripts/deep-audit-db.ts` | per-campaign completeness snapshot |

## Integrations & delivery modes

| Integration | Mode switch | Notes |
|---|---|---|
| LeadSquared | always live | leads, lists, email, custom activities, SMS/WA strategies |
| Claude | key required | scoring, personalization, enrichment |
| Apollo | key required | pre-flight people-match before any LinkedIn touch |
| LinkedIn Events | `LINKEDIN_MODE=sandbox\|live` | sandbox simulates every call; webhook still processes fixtures |

Channel strategies for SMS/WhatsApp (**Integrations → LeadSquared**): `trigger` (default — the app posts a *WebinarAgent Channel Trigger* activity and an LSQ Automation program sends via your connected gateway) or `direct` (paste your tenant's endpoint path). Full guide embedded on that panel, plus [apidocs.leadsquared.com](https://apidocs.leadsquared.com/) and [help.leadsquared.com](https://help.leadsquared.com/).

## LinkedIn Event wiring (live mode)

1. Developer portal → create app, request **Events** product access + **Lead Sync**.
2. Integrations → LinkedIn → save Client ID/Secret → **Connect with LinkedIn**.
3. Point your Lead Sync webhook at `POST {origin}/api/webhooks/linkedin` and set `LINKEDIN_CLIENT_SECRET` — payloads are HMAC-verified (`X-LI-Signature`) and production fails closed without a secret.
4. Publish from a campaign's Setup tab; registrations stream back automatically into Scoring → LeadSquared.

## Project layout

```
app/                    routes (pages + api/auth/linkedin/*, api/webhooks/linkedin)
lib/linkedin/           Events API client, OAuth, forms, webhook contract, orchestrator, ingest
lib/channels.ts         pure channel routing + SMS segment math
lib/channelDelivery.ts  trigger/direct strategies for SMS & WhatsApp
lib/cadenceReadiness.ts green-status validation for Templates/Personalize
scripts/                operational CLIs (ticks, drains, backfills, audits)
```
