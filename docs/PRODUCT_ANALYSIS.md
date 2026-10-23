# Webinar Studio: product analysis and roadmap

Written from the code and from the work done so far (setup wizard, registration, cadence, results, LinkedIn, Integrations). It is not based on usage data: the app records none about itself, and no real provider account has been exercised. Where a claim is an inference rather than something found in the code, it says so.

## 1. Who it is for and what it has to deliver

**Primary user:** a demand-generation or events marketer running recurring webinars, with SDRs and sales following up. **Job to be done:** fill a session with the right people, get them to show up, and turn attendance into pipeline, without spending days on setup or babysitting sends.

The funnel the product serves: audience, invite, register, remind, attend, follow up, pipeline.

| Stage | What exists today | Strength |
|---|---|---|
| Set up | Six-step wizard, now autosaving and resumable; Zoom link or create; two registration modes; template library | Strong |
| Audience | CSV and LeadSquared list import, enrichment, AI scoring and approval, suppression lists | Strong |
| Invite | Multi-channel cadence (email, WhatsApp, SMS, LinkedIn assisted), AI or templated copy, test sends, send windows and quotas | Strong |
| Register | Hosted form, external landing page snippet, signed links, per-channel attribution, Zoom and LeadSquared sync | Strong |
| Remind and attend | Reminder steps, calendar file, broadcast reminder, attendance import from Zoom | Medium |
| Follow up | Attendee and no-show follow-up, AI debrief and talking points | Medium |
| Pipeline and learning | Persona learning, results and dashboard views | Weak: no revenue loop |

The product is deep at the front of the funnel and thin at the back. Almost everything after "attended" stops at a report instead of an action in the CRM.

## 2. The biggest risks to adoption (fix before adding features)

These decide whether anyone dares to launch a real campaign, so they outrank every feature below.

1. **No sign-in, no roles, no audit trail.** Anyone who can reach the studio can send to real audiences and export contacts (stated in docs/DEPLOYMENT.md). Real sends are now possible because sandbox mode was removed. A team cannot adopt this, and it cannot be put on a public address, until there is login, at least admin and member roles, and a record of who launched, paused or edited what.
2. **"It silently does nothing" on the free hosting tier.** Cadence jobs only run when something calls the worker endpoint; on the default free setup nothing does. A marketer who launches and sees no sends will conclude the product is broken. The app needs a visible "scheduler is not running" warning on launch and on the dashboard, and a one-click way to set up the scheduler.
3. **No safety net at first send.** There is a test-send, but no "this is exactly who gets what, and when" preview before launch, no hold period after launch to catch a mistake, and no per-webinar volume cap with a confirmation. A wrong list on a real mailbox is the worst thing the product can do.
4. **No failure alerts.** Problems show inside the app (attention items, worker heartbeat) but nobody is told. Failed sends, a disconnected Zoom token or a stuck import should reach email or Slack.
5. **No data about itself.** There are no product analytics, so every priority below is a judgement. Add a few events now (section 5) so the next review is not.

## 3. Opportunities, ranked

Scored for value to the user against effort. "Inferred" marks things I did not find in the code and believe are absent; confirm before building.

### Now: trust, reliability, time to first launch
| # | Idea | Why it matters | Effort |
|---|---|---|---|
| 1 | Sign-in with admin and member roles; audit log | Unblocks team use and public hosting | M |
| 2 | Launch preview and a hold window (for example, 10 minutes to cancel); per-webinar volume cap | Removes the fear of the first send | M |
| 3 | Scheduler health banner and guided setup | Prevents the "nothing happened" failure | S |
| 4 | Alerts by email or Slack for failures, expiring tokens, stuck jobs | Problems found by the system, not by the customer | S |
| 5 | Clone a webinar (settings, cadence, copy, audience rules) and recurring series (inferred: no whole-webinar clone found; template copy exists) | Most teams run the same webinar monthly; setup is the repeat cost | M |
| 6 | Setup checklist on a draft ("Zoom linked, audience imported, copy reviewed") with launch blockers in plain words | Cuts abandoned drafts; builds on the new autosave | S |

### Next: raise registration and attendance, close the loop
| # | Idea | Why it matters | Effort |
|---|---|---|---|
| 7 | Branded, editable registration page: agenda, speaker bios and photos, countdown, mobile polish, optional custom questions | The page is where invites convert; today it is functional, not persuasive | M |
| 8 | Smarter reminders: recommended timing per channel from past events, "join now" message at start, WhatsApp and SMS reminders on by default where consent exists | Show rate is the metric sales feels | M |
| 9 | Recording and replay automation: pull the Zoom recording, send "sorry we missed you" with replay to no-shows, on-demand page | Registrants who miss the live event are the cheapest second conversion | M |
| 10 | Post-event survey and rating (inferred: none today), with one-click booking link in the follow-up | Gives sales a warm signal and gives marketing quality feedback | M |
| 11 | Push follow-up into LeadSquared as tasks and stage changes for high-intent attendees, with the debrief attached | The AI debrief is a report today; the value is the action | M |
| 12 | Cross-webinar fatigue control and a preference page: cap touches per person across live webinars, honour unsubscribe in one place | Protects the sender mailbox and the brand | M |
| 13 | A/B test for subject lines and first message (inferred: none) with automatic winner for the rest of the audience | Cheapest measurable lift on invites | M |

### Later: intelligence and scale
| # | Idea | Why it matters | Effort |
|---|---|---|---|
| 14 | Revenue attribution: webinar to opportunity and revenue, cost per registrant and per attendee by channel | Answers "was it worth it" and justifies the budget | L |
| 15 | Learning loop: predict show rate, recommend send time and channel mix, suggest audiences that look like past attendees | Turns history into advice; persona learning is the seed | L |
| 16 | Dashboard that compares webinars (trends, channel ROI, benchmarks) with a scheduled digest email and shareable report | Stakeholders read reports, not studios | M |
| 17 | Team features: comments, assignments, copy approval before send | Needs sign-in first | M |
| 18 | More reach: Microsoft Teams and Google Meet as event sources, multilingual pages and emails, attendee-local time on the page | Widens who can use it | L |

## 4. Suggested sequence

1. **Four weeks, trust:** items 1 to 4 plus the instrumentation in section 5. Nothing else is worth launching to a team until these are in.
2. **Four weeks, repeat use:** items 5, 6 and 7. This lowers the cost of the second and tenth webinar, which is where retention comes from.
3. **Six weeks, outcomes:** items 8 to 11. These move show rate and pipeline, the numbers that justify the product.
4. **After that:** 12, 13, then 14 to 16 once there is data to learn from.

## 5. How to know it is working

Instrument these first (events inside the app, not provider data):

- **Time to first launch** (draft created to launch) and **draft abandonment** by wizard step. The new autosave records the step reached, so this can start immediately.
- **Launch confidence:** share of launches that are paused or edited within an hour (a proxy for mistakes the preview should have caught).
- **Registration conversion by channel** and by registration mode (hosted form versus external page).
- **Show rate** (attended divided by registered) and its change after reminder changes.
- **Follow-up completion:** share of no-shows who received a replay and of high-intent attendees who got a CRM task.
- **Repeat usage:** webinars per account per quarter, and share created by cloning.

## 6. Decisions needed from the product owner

1. Who is the buyer and the user: your own team, LeadSquared customers, or both? That decides sign-in, multi-tenant data and billing, and whether the roadmap is internal tooling or a product.
2. Is the target a public deployment? If yes, item 1 is a blocker, not a feature.
3. Which outcome to optimise first: registrations, show rate, or pipeline. This sets the order of section 3's "Next" list.
4. Is a hold window before first send acceptable to customers, or must sends start immediately on launch?
5. Which provider integrations matter beyond LeadSquared and Zoom (Slack for alerts, Teams, Google Meet)?
