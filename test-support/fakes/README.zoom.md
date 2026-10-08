# Fake Zoom server

`zoomFake.ts` is a local, in-process fake of Zoom's OAuth server, REST API v2 and webhook sender, so the app's real Zoom client (`lib/zoom/*`) and webhook route can be tested over real HTTP with fault injection and no Zoom account. Node built-ins only.

## Use it in a test

```ts
import { startFakeZoom } from '@/test-support/fakes/zoomFake'; // or a relative import

const fake = await startFakeZoom();            // ephemeral port
process.env.ZOOM_OAUTH_BASE_URL = fake.oauthUrl; // token = <base>/oauth/token
process.env.ZOOM_API_BASE_URL   = fake.apiUrl;   // includes /v2
vi.resetModules();                               // lib/zoom/auth.ts reads these at import time
const { zoomRequest } = await import('@/lib/zoom/client');
// ... fake.reset() between tests, await fake.stop() at the end
```

The base URLs are read when `lib/zoom/auth.ts` is first imported, so set the env vars **before** (dynamically) importing the Zoom modules. See `zoomFake.test.ts` for the full pattern (mocking `@/lib/integrationConfig` with a Map and `@/lib/retry` `sleep`).

## Run it standalone

```
npx tsx test-support/fakes/runZoomFake.ts          # PORT=4010 by default
ZOOM_FAKE_WEBINARS=1 ZOOM_FAKE_LICENSED=0 PORT=4123 npx tsx test-support/fakes/runZoomFake.ts
```

Prints the env vars to point the app at it and seeds two meetings (one registration-enabled, one with the `approval_type: 2` trap).

## API

`startFakeZoom(opts?)` returns a `FakeZoom`:

| Member | Purpose |
|---|---|
| `oauthUrl`, `apiUrl`, `origin`, `port` | URLs. `apiUrl` ends in `/v2`. |
| `config` | Live mutable config: `hostLicensed`, `webinarAddOn`, `scopes`, `maxRegistrants`, `tokenTtlSec`, `maxPageSize`, `rateLimit` (`{perSecond}`), `strictAuthCodes`, `clientId`, `clientSecret`, `accountId`, `hostEmail`. Restored by `reset()`. |
| `state` | `meetings`, `webinars`, `registrants` (per event id), `pastParticipants`, `panelists`, `tokens` (every access token issued), `refreshTokens`, `authCodes`, `requestLog`, `faults`. |
| `setFault(rule)` / `clearFaults()` | Fault injection (below). |
| `reset()` / `stop()` | Clear everything / close the server. |
| `expireAllTokens()` | All access tokens now answer 401 `{code:124,message:"Invalid access token."}`; refresh tokens still work. |
| `advanceTime(ms)` | Moves the fake's clock (token expiry, "upcoming" filter). |
| `seedMeeting({kind?, topic?, start_time?, duration?, approval_type?, ...})` | Creates a meeting/webinar directly (bypasses licence/scope checks). |
| `seedRegistrant`, `seedPanelists`, `seedPastParticipants(id, rows, {replace?})` | Seed data. Participant rows are one per join session; `duration` is seconds. |
| `endMeeting(id)` | Marks ended (past participants become fetchable) and returns the `meeting.ended` / `webinar.ended` webhook event. |
| `meetingEndedEvent(id)`, `registrationCreatedEvent(id, registrantIdOrEmail)` | Webhook event builders (real shapes: ids are strings). |
| `sendWebhook(appUrl, secret, event, opts?)` | POSTs to `<appUrl>/api/webhooks/zoom` signed like Zoom (`v0=` + HMAC-SHA256 of `v0:<ts>:<rawBody>`, headers `x-zm-signature`, `x-zm-request-timestamp`). Returns the `Response`. Opts: `timestampOffsetSec`, `badSignature`, `omitHeaders`, `rawBody`, `path`. |
| `sendCrc(appUrl, secret)` | Sends `endpoint.url_validation`; returns `{ response, plainToken, expectedEncryptedToken }`. |

`sendZoomWebhook` / `sendZoomCrc` are also exported as standalone functions (no server needed).

### Fault injection

```ts
fake.setFault({ match: '/meetings/*/registrants', method: 'POST', status: 429,
                headers: { 'Retry-After': '2' }, times: 2 });
fake.setFault({ match: /^\/past_meetings\//, dropConnection: true });
fake.setFault({ match: '/oauth/token', delayMs: 500 });   // delay only, then answers normally
```

* `match`: glob (`*` matches anything including `/`) or RegExp, tested against the path **without** `/v2` and query (`/users/me/meetings`, `/oauth/token`).
* `times`: default 1; `'forever'` until `clearFaults()`. Rules are consumed in installation order; a rule that is spent is removed. Faults fire before auth and rate limiting. `InstalledFault.hits` counts uses.
* Without `status`/`dropConnection` the fault only delays.

### Endpoints

OAuth: `POST /oauth/token` (`authorization_code`, `refresh_token` (rotating), `account_credentials`; params in body or query; Basic auth), `GET /oauth/authorize` (302 back with `code` + `state`).

REST (all need `Authorization: Bearer`; scope-checked, 400 code 4711 when missing): `GET /users/{me|id|email}`; `GET|POST /users/{u}/meetings`; `GET|POST /users/{u}/webinars`; `GET|PATCH|DELETE /meetings/{id}`, `/webinars/{id}`; `GET|POST /meetings/{id}/registrants`, `/webinars/{id}/registrants`; `PUT .../registrants/status`; `GET /webinars/{id}/panelists`; `GET /past_meetings/{id|uuid}/participants`; `POST /webinars/{id}/tracking_sources` (404), `GET` (empty list). Lists page with `page_size` / `next_page_token`.

## Real Zoom behaviours reproduced

* `settings.approval_type` defaults to **2** (no registration); only 0/1 enable it and produce `registration_url`. `registration_type` alone does nothing.
* Add registrant on an approval-2 meeting: 400 `{code:3027}`; same email again returns the existing registrant (201).
* Unlicensed host: registration settings are silently ignored on create and PATCH.
* Refresh tokens rotate on every use; the old one then fails.
* Server-to-Server tokens cannot use `/users/me`.
* No tracking-source API.
* Past participants 404 until the meeting has ended.

## ASSUMPTIONS (not verified against a live Zoom account)

Update this list when a live smoke test confirms or contradicts any of them.

1. S2S `me`: 400 `{code:1010, message:"User does not belong to this account: me."}` (status 400 per the brief; exact code/message guessed).
2. Missing webinar add-on: HTTP **400** `{code:200, message:"Webinar plan is missing"}` on every webinar endpoint (not 404).
3. Unlicensed host adding a registrant to an event that does have registration on: 400 `{code:200, message:"Only available for Licensed users."}`. The approval check (3027) is evaluated before the licence check.
4. Registrant cap: 400 `{code:3001, message:"... registrant limit reached (N)."}` (code per the brief). Cap = min(`config.maxRegistrants`, the event's `registrants_restrict_number` if > 0). Duplicates never count against it.
5. Registering for an ended meeting: 400 `{code:3001}`; deleted/unknown meeting: 404 `{code:3001, "Meeting does not exist: id."}`.
6. Manual approval (`approval_type 1`): the add-registrant response has no `join_url` until the registrant is approved (`PUT .../registrants/status`).
7. Registrant validation: `email` format, `first_name` required, `first_name`/`last_name` max 64 chars; the order of checks (event exists, ended, approval, licence, body) is a guess. `participant_pin_code` is never returned.
8. Scope names are the granular names in `docs/ZOOM_AND_LSQ_SETUP.md` (`meeting:update:meeting`, `meeting:delete:meeting`, `meeting:read:list_registrants`, `meeting:update:registrant_status`, `webinar:read:list_panelists`, ...). The `:admin` variant satisfies any check for either token kind; the 4711 message names the plain scope for user tokens and the `:admin` scope for S2S tokens (real Zoom may list both).
9. `GET /past_meetings/{id}/participants` also serves webinar ids (real Zoom may require the Reports API for webinars). Meeting uuid lookup works too.
10. `GET /users/{id}/webinars` list items do not include `registration_url` (the app reads it from the list, so it will be `null` there); the single-webinar GET does.
11. Real Zoom's list `type=upcoming` semantics: here a non-ended event whose `start_time + duration` has not passed (or with no start). Default `type` is `scheduled` for meetings.
12. `page_size` above the maximum is clamped (not rejected); next page tokens are opaque offsets (`fz1.<offset>.<rand>`), never expire; a bad token is 400 `{code:300}`.
13. Rate limit: fixed 1-second window, 429 `{code:429}` with `Retry-After` in whole seconds; it applies to the REST API only. Real Zoom's limits are per-category and also daily.
14. Refresh does not invalidate the previously issued access token (it just expires on its own). Auth codes are accepted blindly unless `config.strictAuthCodes` (then single-use, redirect_uri must match).
15. OAuth error bodies: bad grant `{reason:"Invalid Token!",error:"invalid_request"}` for a used/unknown refresh token, `Invalid account id` for a wrong S2S account, `unsupported_grant_type` for others (reasons are paraphrased).
16. Unknown REST route: 404 `{code:404, message:"Not Found: ..."}`; invalid JSON body: 400 `{code:300, message:"Request Body should be a valid JSON object."}`.
17. Webhook events: `event_ts` is epoch ms; `registrant` payload omits `create_time`; the sender does not send Zoom's legacy `authorization` verification-token header.
18. `start_time` is normalised to `YYYY-MM-DDTHH:mm:ssZ` (ms stripped); a value without a zone designator is read as UTC (the `timezone` field is stored but not applied).
