# Production audit — 8 October 2026

The repository is ready for a reviewed code release with the checks below. Hosted production has not been provisioned or smoke-tested in this session. Follow [DEPLOYMENT.md](DEPLOYMENT.md) for the remaining environment and scheduling setup. This report contains no actual recipients, provider keys, CRM identifiers or raw delivery payloads.

## Scope and completed corrections

The review covered app routes and server actions, shared UI, styling and assets, provider clients and callbacks, registration and calendar links, cadence and durable jobs, attendance and analytics, Prisma schema/migrations, dependency tooling, deployment configuration, operational scripts, and unit/database/browser verification. Generated dependencies and build caches were treated as reproducible output rather than source.

| Area | Result |
| --- | --- |
| Runtime and dependencies | Node 24.x required across package, container and hosting configuration; Next packages pinned to 16.4.0; lockfile reproducible; full dependency audit clear. |
| Glob compatibility | Vulnerable lint dependency replaced through a scoped directory-glob adapter; real Next directory-discovery regression test plus install-time version/API contract guard. |
| Registration attribution | SMS is its own eighth registration channel across tracking links, Zoom URLs, UI, SQL totals and conversion denominators. SDR/Sales no longer borrows SMS counts. Existing explicit legacy SDR attribution cannot be reconstructed when its original source was lost. |
| Public registration | New outside-audience registrants stay unapproved and unscored. Confirmation and registered-only reminders continue; invitation outreach is blocked even with stop-on-registration disabled. Legacy unreviewed website approvals are corrected by migration. |
| Delivery reliability | Durable claims and receipts, unknown-outcome holds without automatic replay, cross-worker quotas, current consent and suppression, pause/stop checks, actual recipients and providers. |
| Worker processing | Leased, bounded worker; durable registration, audience and broadcast jobs; cursor recovery, heartbeat and outcome confirmation. |
| Registration privacy | Atomic capacity reservation, duplicate submission handling, generic email-only response, signed personal join/calendar access, timezone and duration correctness. |
| Integrations | Provider credentials encrypted at rest; real provider failures visible; provider OAuth and webhook signatures retained. LeadSquared trigger activity validation repairs stale cached activity mappings. |
| AI preview | Failed or empty Claude responses produce a failed preview; fabricated successful preview fallback removed. Built-in template suggestions remain explicitly distinguished from live AI output. |
| Attendance | Transactional import, custom attendance steps, correction support and no duplicate follow-up sends. |
| Scale | 50-row searched recipient pages; SQL analytics; bounded channel samples; 10,000-row load and concurrent browser/request checks. |
| UI | Public/studio route separation, responsive pages, no document overflow at tested sizes, modal focus/inert/Escape behavior and accessibility checks. |
| Hosting | Separate Render and Vercel files in the master repository; DB-backed health endpoint, small bounded connection pool, persistent keys, migration/runbook instructions, corrected paid Render pre-deploy and Vercel Hobby cron mismatch. |
| Repository hygiene | Old reports/screenshots, live test data, unused starter assets and obsolete tooling archived outside the repository. Future raw verification output is ignored. Font license retained; secrets and editor checkpoint refs excluded from push. |

## Release verification

| Check | Evidence |
| --- | --- |
| Unit tests | 112 suites; 1,028 tests passed. |
| PostgreSQL integration | 5 suites; 102 tests passed, including approval correction, outbound approval guard, registered confirmations/custom reminders, attribution, delivery/worker races and provider failures. |
| Migrations | All 16 migration directories apply to a fresh disposable database with zero schema drift; the application database also has zero schema drift. |
| TypeScript and ESLint | Typecheck passed; lint passed with zero warnings. |
| Production build | Next 16.4.0 webpack build passed. |
| Browser | 27 checks on desktop (1440 px) and mobile (390 px): routes, actual test registration, unapproved inbound record, attendee calendar, modal focus and serious/critical accessibility checks. |
| Load | 10,000 contacts/messages/sends; pagination/search/last-page access, bounded payloads, 24 concurrent requests, mobile accessibility/overflow and zero browser errors. |
| Dependency audit | Zero vulnerabilities across production and development dependencies at the audit time. |
| Deployment files | Render and Vercel configuration values validated against their published schemas. |
| Restore rehearsal | Every public table's row counts/content hashes matched; eight encrypted credentials recovered; restored database migration/schema checks passed. |
| Existing data | 14 campaigns, 19 contacts, 67 send records, one registered contact preserved through migration. |
| Credential scan | No configured live credentials or designated live test recipient in publishable files; no configured secret match in `main` history. |

Checks use isolated test databases and mocked/local provider responses; they do not claim end-to-end success for every external provider. Raw evidence is kept in ignored `artifacts/verification/` and protected local release logs. Clean-checkout and GitHub CI results are recorded in the release completion message.

## Explicit production limitations

- Operator authentication, authorization and cron authentication remain absent by the user's instruction. Anyone with access to the studio/worker endpoints can manage campaigns, export contacts and cause sends. This is an intentional exposure, not a security approval for unrestricted public hosting.
- Email delivery was confirmed by the designated test recipient. An SMS LeadSquared activity was verified in the earlier live test after the activity mapping fix; the recipient did not confirm SMS receipt. WhatsApp was not newly sent because the saved contact lacked opt-in. Configure and verify downstream LeadSquared automation for both channels before treating them as delivered.
- LinkedIn outreach is assisted/manual. It does not claim an automated message was sent. Provider entitlements, credentials, rate limits and actual account configuration still determine available functionality.
- Render and Vercel deployment files are prepared; no new cloud resources were purchased or deployed here. Production database/keys/origin, provider configuration, worker schedule and hosted smoke checks remain deployment steps.
- The local glob adapter is a temporary maintenance boundary, not a general replacement for the complete fast-glob API. The install guard deliberately blocks unreviewed Next plugin upgrades. Reassess when the upstream dependency is patched; the advisory currently lists no patched version. See [braces advisory GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).
- Larger audiences and longer provider latency can require additional job/worker capacity. The 10,000-record checks establish the tested size, not unlimited scale. Each LeadSquared exclusion snapshot must remain below the app's 10,000-member completeness limit.

## Further improvements

1. Add hosted availability alerts, database backup retention and alerting for stale worker heartbeat/unknown deliveries.
2. Establish staging with its own database and provider accounts, and exercise a hosted release/restore rehearsal.
3. Add automated downstream CRM delivery-status ingestion when the chosen LeadSquared automation exposes reliable receipts.
4. Replace the glob adapter once an upstream patched dependency is available; keep dependency update PRs subject to CI and adapter review.
5. Extract campaign defaults and intentional seed fixtures into separate modules during a future maintenance pass; consolidate dense provider/job code for easier review.

## Repository and cleanup

`main` was the only local/remote branch at the start of this release. All current application work is consolidated there; there were no feature branches to merge. Local editor checkpoint refs are not application branches and are not pushed.

Before cleanup, source/environment files and all Git refs were backed up to a protected directory outside the project. Removed files remain recoverable there, together with a pre-migration database dump. Local environment files and existing application data were preserved. Build output, generated Prisma code, dependencies and raw verification artifacts are ignored and reproducible.
