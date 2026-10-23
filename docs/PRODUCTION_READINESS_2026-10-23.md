# Production readiness assessment — 23 October 2026

Follow-up fixes, repeat verification and current deployment blockers are recorded in [the remediation report](RELEASE_2026-10-23.md). The findings below preserve the original pre-fix audit.

**Decision: NO-GO for public production deployment in the current state.** Core application behavior is substantially functional, and the local database, browser and load tests largely pass. Security and deployment gaps still prevent a production sign-off. Passing a build or test suite does not resolve those gaps.

This assessment covers the current working tree, including its existing uncommitted work, at Git HEAD `4e8f485bf9357d5744a6feac9ddff5d75e8e583f`. It supersedes the readiness conclusion in the older `PRODUCTION_AUDIT.md` for this checkout. No application fixes, dependency upgrades, deployment, recipient messages or purchases were performed. Audit helpers and evidence are local under `artifacts/verification/production-audit-2026-10-23/`.

## Results at a glance

| Verification | Result | Evidence / qualification |
| --- | --- | --- |
| Unit tests | PASS | 125 suites, **1,253 tests**. |
| PostgreSQL integration tests | PASS | 13 suites, **203 tests**, including real transactions, races and provider failures against mocks/local fakes. |
| Migrations | PASS | All **20 SQL migrations** applied to a fresh disposable database; schema comparison reported no difference. Corrected count: the initial file count also included `migration_lock.toml`. |
| TypeScript | PASS | Route type generation and `tsc --noEmit`. |
| ESLint | PASS | Final `eslint --max-warnings=0`; see final logs. |
| Production build | CONDITIONAL | Default Turbopack and webpack builds completed on retry. Initial builds failed with a known-vulnerability security warning. Dependencies remain vulnerable. |
| Browser, accessibility and workflows | PASS ON REPEAT | **120 reported checks** across general UI, login, Zoom details, landing flow, workspace and wizard scripts; two initial navigation failures are documented below. Chrome only. |
| Large LeadSquared import | PASS | 12,000 leads imported through the UI, 12,000 stored, 27 fake-provider requests, zero throttling; about 45 seconds in this run. Integration tests also exercise 25,000 leads. |
| Apollo enrichment | PASS | Isolated repeat enriched 800/800 contacts with 80 fake-provider requests in about 6 seconds. A long HTTP 429 stopped after 30 without guessed emails; persisted cursor and explanatory UI verified. |
| Large-campaign navigation | PASS ON REPEAT | 10,000 contacts, messages and send records; next/last page, search, payload limits, mobile layout and accessibility passed on webpack and a diagnostic Turbopack repeat. |
| Authenticated load/stress | PASS WITH LATENCY DEGRADATION | **7,939 page requests**, up to **200 concurrent**, zero observed request failures; includes a two-minute sustained stage. Details below. |
| Registration race | PASS | 100 requests at concurrency 25 against 50 seats: exactly 50 registrations and 50 capacity rejections. |
| Backup/restore | PASS | All **22 public tables** restored with matching counts/content hashes; **7 encrypted credentials** decrypted successfully; restored schema/migration parity passed. |
| Standalone server | PASS LOCALLY | Generated `server.js` booted, authenticated campaign pages and a 40-request smoke stage passed, and all 13 referenced login JS/CSS assets returned 200 after copying static/public assets. |
| Dependency security | FAIL | npm audit: **4 affected packages: 1 critical, 1 high, 2 moderate**. |
| Public worker authorization | FAIL | Anonymous worker invocation returned 200 and wrote a heartbeat in the disposable database. |
| Live provider configuration | MIXED | LeadSquared, Netcore, Apollo and Claude read-only probes passed; saved Zoom token returned 401; LinkedIn was not configured. |
| Hosted production / Docker | NOT VERIFIED | No hosting deployment, Linux container execution, production-sized hardware test or cloud failover rehearsal. Docker was unavailable locally. |

The 120 browser checks are script-reported scenarios, not an additional assertion-level coverage metric. The unit/integration total is **1,456 passing tests**.

## Release blockers and findings

### B1 — Critical: vulnerable production framework

`package.json` pins Next.js to **16.4.0**. The current npm audit identifies three Next.js advisories: image-optimization RCE, Server Actions denial of service, and RCE involving `use cache` functions returning typed arrays. Initial build attempts stopped with a security warning; retrying produced a build without fixing the dependency.

The application uses App Router and Server Actions, matching the documented feature prerequisites for the denial-of-service advisory. This review did not run an RCE or exploit payload. The other advisories have narrower prerequisites: the image issue concerns glibc Linux and vulnerable image-processing dependencies; installed `sharp` here is 0.35.5, the advisory's workaround version. No application `use cache` directive or enabled Cache Components configuration was found in the inspected source. These distinctions limit claims about exploitability, but do not justify releasing the known-affected Next.js version.

**Required:** upgrade to a currently patched compatible release, regenerate the lockfile and rerun release verification. The audit resolver recommends 16.4.3; the three linked advisories list 16.4.1 as their initial patched 16.x release. Review the aligned Next packages and `scripts/check-tooling.cjs`, whose guard explicitly pins the ESLint plugin to 16.4.0. A blind package-version edit can break installation.

Sources: [Next.js image advisory](https://github.com/vercel/next.js/security/advisories/GHSA-2464-fhr4-w9xw), [Server Actions DoS advisory](https://github.com/vercel/next.js/security/advisories/GHSA-p3m5-59mp-jv5r), [cache advisory](https://github.com/vercel/next.js/security/advisories/GHSA-673q-mjm6-r5xr). Raw package findings: [dependency-audit.json](../artifacts/verification/production-audit-2026-10-23/dependency-audit.json).

### B2 — High: anyone can invoke the campaign worker

[`app/api/cron/cadence/route.ts`](../app/api/cron/cadence/route.ts) calls `runWorkerTick()` without checking a scheduler secret, authorization header or operator session. [`lib/auth.ts`](../lib/auth.ts) deliberately marks `/api/cron/*` public.

**Confirmed:** an unauthenticated request to `/api/cron/cadence` returned HTTP 200, completed a tick and persisted `worker.lastTick` in an isolated database. No due outreach was seeded, so no message was sent. The production worker's code processes due sends, registrations, broadcasts and other jobs using configured providers. Its database lease prevents overlapping workers; it does not authorize callers or enforce an intended schedule.

**Required:** authenticate scheduler requests and reject anonymous/invalid callers before entering the worker. Retain the lease, consent, quota and idempotency controls. The older documentation describes this exposure as intentional; that does not make it appropriate for unrestricted public hosting.

### B3 — High: the supplied Render configuration is a preview configuration

[`render.yaml`](../render.yaml) selects free web and PostgreSQL plans, disables the cadence timer and Zoom autosync, and does not provision an external recurring worker schedule. `vercel.json` and `netlify.toml` likewise do not supply a working recurring schedule. An external scheduler may exist outside this repository; none was verified.

Free Render services sleep and free PostgreSQL expires; Render explicitly advises against these instances for production. See [Render's free-instance documentation](https://render.com/docs/free).

**Required:** select persistent production infrastructure, configure and authenticate the recurring worker, set the public HTTPS origin, configure persistent independent keys and credentials, provision backups/retention and alerts, then perform a hosted smoke test. Otherwise queued work can remain idle even while the website itself responds successfully.

### F1 — High priority hardening: authorization exists only at the request gate for operator actions

The operator sign-in works in tested routes. However, server-action modules such as [`lib/actions/campaigns.ts`](../lib/actions/campaigns.ts) do not independently verify the session before creating, archiving or deleting records. The broad static-extension exclusions in `proxy.ts` are another reason to avoid making that proxy the sole security boundary.

The audit replayed a known archive action without a cookie against the protected home route, public login/registration/result routes and a static-looking path. **None of those five probes changed the campaign. No authentication bypass is claimed.** This is a confirmed architectural gap, rather than a demonstrated exploit.

**Required before security sign-off:** centralize operator-session validation at the server-action/data-access boundary and cover unauthenticated calls there. Keep the current proxy for redirects and early rejection. Next.js explicitly recommends authentication and authorization inside each action: [official data-security guidance](https://nextjs.org/docs/app/guides/data-security).

### F2 — Medium: login abuse protection depends on trusted forwarding headers

`clientIp()` in [`lib/rateLimit.ts`](../lib/rateLimit.ts) trusts the first `X-Forwarded-For` value. On a directly exposed Node server, ten incorrect login attempts with ten caller-supplied values all reached credential validation; none hit the per-IP limit. Same-address limiting passed in the login journey. Hosted impact depends on whether the actual ingress replaces untrusted forwarding headers.

**Action:** establish the trusted proxy boundary, validate it on the selected host, and add an account-level limit/backoff or upstream abuse control. The shared limiter intentionally fails open during ledger failure, including when used for login; review whether authentication should use a stricter failure policy.

### F3 — Medium: one published concurrency test measures the login page

The raw `fetch()` concurrency loop in [`scripts/test-load.ts`](../scripts/test-load.ts) does not attach the authenticated browser's cookie. Fetch follows the sign-in redirect and gets HTTP 200. The webpack run reported bodies of about 10 KB and 26–52 ms per batch for this section; these figures must **not** be presented as authenticated campaign-page capacity.

**Action:** attach a valid session and assert the final URL and expected campaign content. The new audit stress harness does attach the session and checks campaign content, providing the replacement measurements below. The existing load script's browser pagination/search checks are authenticated and remain useful.

### F4 — Medium: browser-test provider isolation is incomplete

[`scripts/test-apollo-enrichment.ts`](../scripts/test-apollo-enrichment.ts) clears several provider environment variables but leaves LeadSquared credentials available through `.env.local`. Browser request interception does not block requests from the Next.js server. Its first server log contained LeadSquared list-request failures with HTTP 401 during an otherwise fake-Apollo test.

An isolated repeat explicitly blanked `LSQ_ACCESS_KEY`, `LSQ_SECRET_KEY` and `LSQ_HOST`; both Apollo scenarios passed. No successful CRM mutation was observed in the earlier run.

**Action:** clear all unrelated provider credentials/base URLs and enforce server-side network isolation for disposable journeys. Keep separate, deliberately invoked live checks. A disposable database alone is insufficient protection from external effects.

### F5 — Medium: navigation tests have intermittent failures

The initial default-build load run failed waiting five seconds for `51–100 of 10,000` after clicking Next page. The webpack run passed, and an instrumented default-build repeat also passed. The first wizard run failed waiting for the draft shortcut after navigating to Integrations; its repeat passed all 28 scenarios.

These are **unresolved intermittent failures**, not proven deterministic product defects and not clean first-pass results. Some initial runs overlapped other tests. Add failure-time screenshots, response logs and readiness conditions; repeat in CI on the target build mode before using these journeys as a release gate. The dedicated stress ramp below ran after the principal browser journeys had completed; the sustained stage briefly overlapped an isolated Apollo browser rerun.

### F6 — Configuration and operational gaps

- The live **saved Zoom access token returned 401**. The probe deliberately did not refresh tokens or mutate saved credentials. Automatic renewal is covered with local fakes, but the current live refresh credentials/scopes still need validation. This result does not prove that the app's automatic refresh will fail.
- **LinkedIn has no saved access token.** Assisted/manual outreach is intentional; OAuth/event publishing and ingestion still require the relevant connection and provider permissions when those features are needed.
- The current local environment has operator credentials and two sufficiently long independent keys. Its origin is local HTTP and both timers are disabled. Those are local-development observations, not assertions about an unseen hosting environment.
- `/api/health` checks database connectivity only. It does not establish valid login configuration, healthy providers, correct public origin, a functioning schedule or recent worker progress.
- CSP and HSTS are not configured in the application's response headers. HTTPS ingress may provide HSTS; this was not tested. Review a compatible CSP and production transport policy.
- The app has one shared operator credential, without per-user roles, individual attribution or selective session revocation. It is not verified as a multi-tenant or multi-role product.
- The working tree already contained extensive staged, unstaged and untracked changes. Package the reviewed source, migrations and lockfile into an identifiable release before deployment.
- Local build tracing copied `.env` into the standalone server bundle. Build the deployable artifact in a clean release environment; the Docker build context already excludes `.env*`. Do not upload a locally generated bundle without reviewing its included environment files.

### F7 — Medium: malformed/unauthenticated action probes produce uncaught-error logs

The negative server-action replay probes produced four `ECONNRESET` / `Error: aborted` entries logged as `uncaughtException`. A standalone-server repeat with phase markers placed these errors during the action-probe phase, before authenticated page warmup. The server continued to serve subsequent authenticated requests and the registration race, and the attempts caused no campaign mutation.

**Action:** investigate request-abort handling and repeat these probes after the framework security upgrade. Zero HTTP request failures in the authenticated stress stages must not be described as zero server errors across the entire audit.

## Component and function assessment

The static inventory covers **329 source modules, 120 TSX files and 1,302 named callables**, including nested named handlers and operational scripts. Generated Prisma/Next output and anonymous callbacks are excluded. **139 source modules are directly referenced by test files**; this is an import relationship, not a coverage percentage. No statement of 100% function, branch or line coverage is made.

Every inventoried module and named callable can be inspected in these files:

- [Module inventory with source hashes and related test files](../artifacts/verification/production-audit-2026-10-23/module-inventory.csv)
- [TSX/component-file inventory](../artifacts/verification/production-audit-2026-10-23/component-inventory.csv)
- [Named function/method inventory with locations and test references](../artifacts/verification/production-audit-2026-10-23/function-inventory.csv)

The inventories identify what exists and its direct test relationships. A symbol appearing in a test is not proof that all of its branches executed. The following matrix states the behavioral evidence and its limits.

| Component / function family | Assessment | Behavior exercised and remaining limits |
| --- | --- | --- |
| App shell, sidebar, home, dashboard, workspace tabs | PASS in tested flows | Desktop/mobile routes, draft shortcuts, navigation, campaign summaries and overflow checks. No Firefox/Safari run. |
| Login form, session signing, proxy, logout | PASS with hardening findings | Wrong/right credentials, keyboard submission, redirects, forged/expired cookies, sign-out, public/protected route distinction and same-address rate limit. See F1/F2. |
| New campaign wizard and review/launch cards | PASS on repeat | Details, channels, schedule, speakers, draft resume, launch locking and incomplete-readiness errors. |
| Draft autosave, queue, local mirror, unload API | PASS on repeat | Immediate navigation, refresh, device backup, network outage, two-tab conflicts, creation races, revision merging and launched/deleted draft refusal. |
| Campaign lifecycle and setup actions | PASS in covered tests | Pause/stop, past-date restart guard, reschedule, restart retaining sent history, launch readiness and completion. Individual action authentication remains a hardening gap. |
| CSV import, mapping, preflight and consent parsing | PASS in covered tests | Header mapping, name handling, validation, phone/email checks, consent and inbound approval rules. Arbitrarily large CSV uploads were not benchmarked. |
| LeadSquared list import, field discovery and lead sync | PASS with fake / live read-only PASS | 12,000-lead UI import and large-list integration cases, rate-limit handling, cursor continuation, deduplication and field errors. Live metadata GET passed. No live lead write performed. |
| Audience table, score bands, approvals and exports | PASS in covered tests | Pagination/filtering, scoring configuration, approval guards and full matching export behavior. Live AI scoring quality was not assessed. |
| Claude scoring, copy, angle suggestions and debrief | PASS with mocks / live models GET PASS | Response/failure handling and UI states; configured model was listed by live API. No paid inference or assessment of real generated content in this audit. Debrief fallback is explicitly marked in the UI. |
| Apollo enrichment and moderation | PASS with fake / live health PASS | Bulk matching, progress, 800 contacts, locked/missing values, long 429, persisted stop and absence of guessed deliverable email. No live enrichment credit spend. |
| Template library, copy modal and merge fields | PASS in covered tests | Rendering, template relationships, merge/link behavior, copy modal focus containment, inert background, Escape and focus restoration. |
| Messaging editor, configuration and recipient pager | PASS on repeat | Step modes, draft display, search, next/last page, mobile layout and bounded payloads. Initial pagination timeout is retained as F5. |
| Cadence timing, rules, sequence, pause/resume and quotas | PASS in unit/integration/browser coverage | Schedule/timezone rules, due sends, pause during dispatch, current consent, shared quotas and launch errors. Provider throughput limits remain account-specific. |
| Durable delivery guard, receipts and retry controls | PASS in integration coverage | Single dispatch under races, receipts/rendered content, uncertain-outcome hold, rejection-authorized retry, no blind resend and cross-campaign confirmation refusal. |
| Broadcast reminders | PASS with mocks | Personalized dispatch, per-recipient results, pause, consent and unknown-outcome recovery. No mass live send or end-to-end high-volume dispatch benchmark. |
| Netcore email and suppression | PASS with mocks / live domains GET PASS | Missing/rejected provider behavior, suppression and webhook cases; live API authentication passed. Inbox arrival, DKIM/SPF/DMARC and deliverability were not verified. |
| SMS/WhatsApp gateway and CRM trigger delivery | PASS with mocks; LIVE DELIVERY UNVERIFIED | Channel eligibility, STOP/opt-in, trigger fields, failures and queued-versus-delivered semantics. No handset message or downstream CRM automation receipt checked. |
| LinkedIn queue, resolver and event mapping | PASS in covered tests; LIVE UNCONFIGURED | Mapping/signatures/manual queue behavior in covered suites. Provider permissions, live publishing and lead-sync delivery not verified. |
| Zoom OAuth, event lookup and attendee registration | PASS with fake; LIVE TOKEN CHECK FAILED | Six detail scenarios and OAuth wizard return; connection/registration integration tests cover renewal/failure branches. Saved live access token returned 401 without refresh. |
| Public registration and landing forms | PASS | Validation, closed registration, inbound unapproved records, deduplication, attribution, custom external form flow, generic email-only response and concurrent capacity enforcement. |
| Signed attendee links and calendars | PASS | Invalid link rejection, personal join/calendar privacy, timezone/duration and registered confirmation behavior. No real invitation link was sent. |
| Webhook receivers | PASS in covered unit tests | Zoom/Netcore route cases and LinkedIn signature/payload parsing. Live provider subscriptions/redelivery through public ingress were not exercised. |
| Worker leasing, jobs, reconciliation and housekeeping | PASS in integration coverage; PUBLIC AUTH FAIL | Duplicate worker exclusion, cursors, durable retries, registration reconciliation and draft cleanup. Hosted recurring schedule not verified. |
| Overview, analytics, results, attendance and post-event | PASS in covered tests | SQL aggregates, channel counts, attendance import/corrections/rollback, history, account follow-up and results controls. |
| Shared UI primitives, dialogs, drawers and toasts | PASS in exercised pages | Axe serious/critical checks, tested responsive sizes and modal keyboard behavior. Each primitive's every state was not independently rendered. |
| Chat widget and history | PARTIAL | Appears across tested pages; persistence/error code inspected and code compiles. No dedicated live conversational journey, long-history load test or answer-quality evaluation. |
| Database, encryption and backups | PASS locally | Fresh migrations, zero drift, transaction/race coverage, encryption/tamper checks and read-only source backup with full restore verification. Managed backup retention/PITR unverified. |
| Dependency/glob compatibility and install guard | FUNCTIONAL PASS / SECURITY FAIL | Adapter tests and guard pass; Next upgrade requires deliberate compatibility review. Current dependency audit fails. |
| Seed/reset/backfill/encryption CLI operations | REVIEWED, NOT ALL EXECUTED | Destructive/demo and live operational scripts were not run against application data. They are included in the inventory; no blanket runtime pass is claimed. |
| Hosting, container and CI configuration | PARTIAL / NO PRODUCTION SIGN-OFF | Local production builds and standalone startup/assets pass; CI commands inspected. No clean-clone install, remote CI result, Docker build, cloud deployment or rollback executed here. |

## Load, stress and integrity measurements

The dedicated harness used a production Turbopack build on this Mac with Node **24.18.0** and local PostgreSQL **16.15**, one application server with the configured five-connection pool, **10,000 contacts**, **10,000 personalized messages** and **10,000 send records**. It mixed overview, audience, messaging, cadence and results requests. It attached a valid operator session and checked the expected campaign content in each response. No provider credentials or active due-send campaigns were configured in this database.

These are local full-response timings, including body consumption, with the load generator and database on the same machine. They are not Core Web Vitals, geographic user experience, hosted capacity guarantees or per-provider dispatch throughput.

| Concurrent requests | Requests in stage | Requests/sec | Median | p95 | p99 | Failed |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 20 | 27.06 | 25 ms | 58 ms | 69 ms | 0 |
| 8 | 160 | 68.23 | 93 ms | 289 ms | 304 ms | 0 |
| 24 | 240 | 68.99 | 198 ms | 985 ms | 1,079 ms | 0 |
| 50 | 300 | 64.42 | 429 ms | 2,226 ms | 2,370 ms | 0 |
| 100 | 400 | 58.34 | 1,086 ms | 5,349 ms | 5,662 ms | 0 |
| 200 | 400 | 53.90 | 2,735 ms | 7,241 ms | 7,251 ms | 0 |

The ramp completed **1,520 requests**. The additional **120-second sustained stage** used concurrency 24 with a 30 ms per-worker pause and completed **6,419 requests**, zero failures, 53.34 requests/sec, median 272 ms, p95 1,264 ms, p99 1,616 ms and maximum 2,034 ms. The largest response across this sustained stage was 209,026 bytes. Sampled peak server RSS during the ramp was about **701 MiB**; this is not total machine or container memory consumption.

Five post-stress database health requests all returned 200, taking 31, 3, 2, 2 and 2 ms. No failure threshold or breaking point was reached; latency and throughput degradation were observed at higher concurrency. A production latency SLO and target hardware still need to be defined and tested. A two-minute run does not establish overnight stability or memory-leak absence.

The first exploratory ramp ran alongside other browser work and had materially noisier timings; use the dedicated ramp above for this report. Raw measurements and executable-helper source are retained for inspection, including this qualification.

### Registration contention

In a separate public-registration race, 100 distinct synthetic submissions ran with concurrency 25 against a campaign limited to 50 seats. All requests completed in about 445 ms: **50 returned 200 and 50 returned 409**. The database contained exactly 50 registered contacts, the campaign counter was 50, and none of these inbound contacts was approved for invitation outreach.

Fifteen simultaneous repeat submissions for an already registered email created no additional contacts and revealed no bearer token or personal join URL. Two returned generic success and thirteen were limited with 429. The race used varied synthetic forwarding-header identities to avoid conflating capacity correctness with the per-IP limiter; this is not a claim that one IP may bypass the normal registration quota.

## Recovery, secrets and operational evidence

The source-database backup used a consistent read-only snapshot, restored into a disposable database and compared every public table's row count and content hash. All 22 matched; seven encrypted credentials recovered using the existing key. The temporary backup and restore database were removed. This demonstrates one local recovery rehearsal, not managed backup retention or cross-region recovery.

A targeted scan compared five configured long secret values against 632 publishable-source/browser-bundle files and found no exact matches. Environment files are untracked. This is a targeted leakage check, not a full Git-history or general entropy scan, and does not cover short passwords or every possible secret transformation.

Live checks used GET requests only and made no database writes, recipient sends, paid inference requests or token refreshes. A passed provider health probe proves API acceptance for that read operation; it does not prove delivery, account entitlements for every endpoint, or downstream CRM processing.

## Evidence and reproduction

Raw evidence is ignored by Git and retained locally. It may need to be copied separately when sharing this report.

| Evidence | Location |
| --- | --- |
| Unit/integration | `artifacts/verification/production-audit-2026-10-23/unit.log`, `integration.log` |
| Build attempts | `build.log`, `build-retry.log`, `login.log`, `journey-build.log` in the audit directory |
| Final static checks | `lint-final.log`, `typecheck-final.log`, `tooling.log` in the audit directory |
| Browser scenario results and screenshots | `artifacts/verification/browser/`, `login/`, `zoom-details/`, `landing-flow/`, `workspace-screens/`, `wizard-journeys/` |
| Import/enrichment | `lsq-import.log`, `apollo-isolated.log` in the audit directory; corresponding scenario directories under `artifacts/verification/` |
| Initial and repeated navigation results | `load-baseline.log`, `load-webpack.log`, `load-turbopack-diagnostic.log`, `wizard.log`, `wizard-retry.log` |
| Corrected authenticated stress | [runtime-deep/runtime-results.json](../artifacts/verification/production-audit-2026-10-23/runtime-deep/runtime-results.json) and `runtime-deep.log` |
| Standalone startup, request-abort investigation and assets | `standalone-smoke/` and [standalone-assets.json](../artifacts/verification/production-audit-2026-10-23/standalone-assets.json) in the audit directory |
| Read-only live checks | [provider-readonly-results.json](../artifacts/verification/production-audit-2026-10-23/provider-readonly-results.json) |
| Backup | `artifacts/verification/backup-recovery.json` and audit `recovery.log` |
| Source/function inventory and leakage scan | `module-inventory.csv`, `component-inventory.csv`, `function-inventory.csv`, `inventory-summary.json` |

Audit-only helper scripts are stored as `.cjs.txt`/`.ts.txt` so retained evidence does not become application lint/typecheck input. To repeat them, copy to the original filename in the same directory first. The stress harness requires PostgreSQL create/drop permission, a production build at `.next-production-audit`, port 3114 and `AUDIT_DEEP=1`; it creates and removes its own database. Do not point operational scripts at production merely to reproduce a test.

The existing regression commands used were `npm test`, `npm run test:integration`, `npm run typecheck`, `npm run lint -- --max-warnings=0`, `npm run build`, `npm run build -- --webpack`, `npm run test:ui`, `test:login`, `test:zoom`, `test:landing`, `test:workspace`, `test:wizard`, `test:lsq-import`, `test:apollo`, `test:load` and `test:recovery`. Browser journeys reused the freshly generated `.next-journeys` build with `SKIP_BUILD=1`; the general UI used `.next-production-audit`. Inspect each script's environment isolation before rerunning.

## Conditions for a production sign-off

1. Patch Next.js and the development dependency advisories; update the compatibility guard and lockfile; complete a clean install and the release checks without the known-vulnerability build interruption.
2. Authenticate the worker and add session checks at the operator action/data-access boundary; verify the chosen ingress's forwarding-header handling.
3. Provision persistent production hosting/database, a recurring authenticated worker, HTTPS origin, independent persistent keys, backup retention and availability/job alerts.
4. Validate the live Zoom renewal path and required scopes; configure LinkedIn if its connected features are part of the release. Perform deliberately authorized designated-recipient delivery checks and downstream CRM verification separately.
5. Correct the unauthenticated concurrency test and server-side provider-isolation gaps. Investigate the intermittent navigation failures and obtain repeatable CI runs.
6. Deploy the identifiable reviewed release to staging, verify migrations, signed attendee URLs, login, public webhooks, worker processing and restore/rollback on that infrastructure, then test the agreed production load and latency target.

**Current interpretation:** the main app is suitable for further controlled staging validation. It is not yet approved for unrestricted public production use or unattended live campaigns.
