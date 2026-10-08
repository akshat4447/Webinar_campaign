# Fake LeadSquared (LSQ) API

`lsqFake.ts` is an in-process HTTP server (node:http only) that mimics the LeadSquared
endpoints used by `lib/leadsquared.ts`, so integration tests can exercise the real client
over real HTTP without touching a tenant.

## In a vitest test

```ts
import { startFakeLsq } from '@/test-support/fakes/lsqFake'; // or a relative path

const fake = await startFakeLsq({ customFields: ['mx_Seniority'] });   // port 0 = ephemeral
process.env.LSQ_API_BASE_URL = fake.url;                                // e.g. http://127.0.0.1:54321/v2
// ...any non-empty accessKey / secretKey works (mock resolveIntegrationField, see lsqFake.test.ts)

fake.setFault({ match: 'Lists.Get', status: 429, headers: { 'Retry-After': '2' } }); // one-shot by default
fake.state.leads / leadsByEmail / activities / activityTypes / lists / sentEmails / webhooks / requestLog
fake.reset();            // wipe data, faults and log (keeps the same state object)
await fake.stop();
```

Options: `port`, `accessKey`/`secretKey` (strict credential check), `customFields`,
`activeUsers`, `inactiveUsers`, `apiCallerEnabled`, `strictActivityTypes`. The tenant config can
also be changed live via `fake.state.config`.

`lib/leadsquared.ts` imports `resolveIntegrationField` (DB-backed); in tests mock it
(`vi.mock('@/lib/integrationConfig', ...)`) and mock `sleep` from `@/lib/retry` so retries are instant.

## Fault rules

`{ match?, method?, times?: number | 'forever' (default 1), status?, body?, headers?, delayMs?, dropConnection?, mailDelivery? }`

- `match`: string = substring of the path relative to `/v2`; RegExp = tested against it.
- Rules are consumed in the order added; the first live matching rule handles the request.
- Faults run before authentication (like a gateway in front of LSQ).
- `status` omitted + `delayMs` = just a slow response; `dropConnection` destroys the socket.
- `mailDelivery: true` makes `SendEmailToLead` answer `500 MXMailDeliveryException` after
  sender/recipient validation passed.

## Run standalone

```bash
npx tsx test-support/fakes/runLsqFake.ts
npx tsx test-support/fakes/runLsqFake.ts --port=4010 --custom-fields=mx_Seniority,mx_Function --active-users=me@example.com
```

It prints the URL (`http://127.0.0.1:<port>/v2`) and runs until Ctrl-C. Then start the app with
`LSQ_API_BASE_URL=<that url>` plus any non-empty `LSQ_ACCESS_KEY`, `LSQ_SECRET_KEY`, `LSQ_HOST`.

## Implemented endpoints (all under `/v2`, auth via `accessKey` / `secretKey` query params)

| Method | Path |
| --- | --- |
| GET | `/LeadManagement.svc/LeadsMetaData.Get` |
| POST | `/LeadManagement.svc/Lead.CreateOrUpdate` |
| POST | `/LeadManagement.svc/Lead/Bulk/CreateOrUpdate` (max 25) |
| GET | `/LeadManagement.svc/Leads.GetByEmailAddress?emailaddress=` |
| GET | `/LeadManagement.svc/Leads.GetById?id=` |
| POST | `/LeadManagement.svc/Leads/Retrieve/BySearchParameter` |
| GET | `/LeadManagement.svc/Lists.Get` |
| POST | `/LeadSegmentation.svc/CreateEmptyList` |
| POST | `/LeadSegmentation.svc/AddLeadsToStaticList` |
| GET | `/LeadSegmentation.svc/Lists/EmptyStaticList?ListId=` |
| POST | `/ProspectActivity.svc/CreateType` |
| GET | `/ProspectActivity.svc/ActivityTypes.Get`, `/ProspectActivity.svc/ActivityType.Get?ActivityEvent=` |
| POST | `/ProspectActivity.svc/Bulk/CustomActivity/Add/ByLeadId` |
| POST | `/EmailMarketing.svc/SendEmailToLead` |
| GET | `/UserManagement.svc/Users.Get` |
| POST | `/Webhook.svc/Create` |

Application errors are HTTP 500 with `{ExceptionType: "MX…Exception", ExceptionMessage}`, like LSQ.
Other paths are 404, wrong methods 405, bad credentials 401.
