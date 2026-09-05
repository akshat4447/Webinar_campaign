# Webinar Studio Revamp — Changelog

Running record of every change made during the revamp. Companion to
[`REVAMP-MASTER-PLAN.md`](./REVAMP-MASTER-PLAN.md).

**Branch:** `revamp/webinar-studio` · **Forked from:** `accb563` (main)

## How to read this

- Newest checkpoint at the **bottom** — read top-to-bottom for chronology.
- Every checkpoint records: scope, files touched, features completed (by
  register ID), tests added, bugs found, and verification evidence.
- A bug is only closed when a test exists that would have caught it.
- Feature IDs refer to the register in §5 of the master plan.

## Verification vocabulary

| Term | Means |
|---|---|
| `GATE PASS` | `npm run test && npx tsc --noEmit && npm run lint` all clean |
| `E2E PASS` | `npx tsx scripts/e2e-journey.ts` completed without error |
| `MIGRATION VERIFIED` | Ran against a copy of real `dev.db`, data preserved |
| `VISUAL VERIFIED` | Rendered and checked in a browser, both themes, console clean |

---

## C0 — Branch and governing documents

**Date:** 2026-09-03
**Scope:** Set up the branch and the two documents that govern the revamp.

### Files added
- `docs/REVAMP-MASTER-PLAN.md` — mandate, settled decisions, prototype visual
  spec, 152-row feature register, schema deltas, 13 checkpoints, testing
  strategy, debug playbook, anti-hallucination checklist.
- `docs/REVAMP-CHANGELOG.md` — this file.

### Decisions recorded
| # | Decision | Resolution |
|---|---|---|
| D1 | WhatsApp / SMS delivery | Keep LeadSquared; surface compliance metadata only |
| D2 | Control Center | Fold into Agent run tab |
| D3 | User profile chip | Dropped — no auth/user model enters this project |
| D4 | Feature scope | **Keep everything.** All previously-cut features retained |
| D5 | Chat widget | Keep |

### Baseline recorded
- 112 tests passing across 12 files
- `npx tsc --noEmit` clean
- `npm run lint` clean
- 10 routes, 11 Prisma models, ~16.5k LOC of source

### Notes
No application code touched. This checkpoint exists only to make the work
resumable.

**Status:** complete

---

## C1 — Foundations

**Date:** 2026-09-03
**Scope:** Add the design tokens the prototype needs; confirm this Next.js's
routing conventions against the bundled docs before any route work.

### Features completed
| ID | Feature |
|---|---|
| — | 6 new design tokens (prerequisite for all later UI work) |

### Files changed
- `styles/tokens/colors.css` — added `--brand-linkedin`,
  `--brand-linkedin-wash`, `--chart-1..3`, `--warning-wash`, each with a
  comment explaining why it exists and why an existing token wasn't reused.
- `docs/REVAMP-MASTER-PLAN.md` — corrected the regression gate (below) and
  added §2.5 recording routing conventions.

### Findings

**Fixed a defect in my own plan: the regression gate was wrong.**
`npx tsc --noEmit` alone is insufficient in this Next.js. The global
`PageProps<'/route'>` / `LayoutProps<'/route'>` helpers and `next-env.d.ts` are
*generated* from the `app/` tree. Running `tsc` against a stale generation can
pass wrongly or fail on correct code. The gate is now:

```bash
npx next typegen && npm run test && npx tsc --noEmit && npm run lint
```

This matters from C2 onward, where routes are added and renamed heavily.

**Routing conventions confirmed** (recorded in master plan §2.5): `params` and
`searchParams` are Promises on both pages and layouts and must be awaited;
route typing uses the generated global helpers rather than hand-written prop
types; `searchParams` opts a page into dynamic rendering.

### Design note
Semantic status colours are deliberately *not* reused for chart series — a bar
tinted `--success-500` reads as "good" rather than as a category. `--chart-1..3`
are ordered by visual weight so a two-series chart uses the two most
distinguishable values.

### Bugs found
None.

### Verification
- `GATE PASS` — 112 tests / 12 files, `next typegen` clean, `tsc --noEmit`
  exit 0, `eslint` clean
- Zero visual change confirmed by inspection: tokens added but not yet
  referenced by any component

**Status:** complete

---

## C2 — Shell, navigation, list page

**Date:** 2026-09-03
**Scope:** New sidebar and webinar list matching the prototype, with every
capability the prototype omits kept and given a home.

### Features completed
| ID | Feature | Note |
|---|---|---|
| NAV-1 | Sidebar, 216px, 3 nav items | Dashboard · Webinars · Templates |
| NAV-2 | AGENT ONLINE block + counts | **restored** — kept below the nav |
| NAV-3 | "Built on LeadSquared" lockup | **restored** — sidebar footer |
| NAV-4 | Integrations pinned to bottom | |
| NAV-5 | Global chat widget | **kept** — untouched, still per-campaign |
| NAV-7 | Toast system | new `ToastProvider` + `useToast()` |
| LST-1 | Cards: 3 stats, 2 CTAs | |
| LST-2 | 4-KPI summary row | computed live |
| LST-3 | All / Upcoming / Completed / Drafts | with counts |
| LST-4 | Archived view | kept as a 5th filter |
| LST-5 | Archive · Unarchive · Delete kebab | **restored** |
| LST-6 | Cadence deep-link CTA | |

NAV-6 (6-tab workspace) was split into a new checkpoint **C2B** so this
checkpoint stayed independently verifiable. Route folders are untouched so far.

### Files changed
- `components/Sidebar.tsx` — rewritten. Nav is now data-driven with a `match`
  predicate per item, because highlighting isn't "pathname equals href":
  Webinars must stay lit inside a campaign workspace and inside the wizard.
- `components/ui/Icon.tsx` — added `dashboard` and `template` glyphs.
- `components/ui/Toast.tsx` — new. One toast at a time by design.
- `components/ui/PageHeader.tsx` — new. The five top-level pages had been
  repeating title/subtitle styling inline and it had already drifted.
- `components/ui/Placeholder.tsx` — new, **transitional**. Marked DELETE ME;
  every use is removed by the checkpoint that builds the real page.
- `app/page.tsx` — rewritten.
- `app/CampaignCardMenu.tsx` — moved from absolute to flow positioning.
- `app/dashboard/page.tsx`, `app/templates/page.tsx` — new routes.
- `lib/campaignCardStats.ts` — two → three stats, plus `getListKpis`.
- `lib/campaignRoutes.ts` — new. Single source for campaign tab hrefs.
- `app/layout.tsx` — `ToastProvider`; title now "Webinar Studio".
- `app/globals.css` — `.lsq-nav` hover, `lsq-toast-in` keyframes.

### Decisions made during the work

**The card stopped being one big link.** The prototype's card carries two CTAs,
and an anchor cannot contain anchors. The whole card is now a plain container
with its own links, which also removed the reason `CampaignCardMenu` had been
absolutely positioned over the top with `preventDefault` on its click.

**KPI row is computed from the campaigns already on screen**, not from a fresh
query. A KPI row that counts archived campaigns while the grid below hides them
is the kind of mismatch nobody reports but everybody quietly distrusts.

**Average attendance averages only campaigns that have an attendance figure.**
Including campaigns that never ran drags the mean towards zero and makes a
healthy programme look broken.

**Card stats vary by status.** "Invites sent: 0" is noise on a draft, so a draft
shows Contacts / Scored / Approved instead. Registration still reads from the
stored field plus the LinkedIn table — `Contact.registeredAt` becomes real in
C8 and this function should then count that.

### Bugs found
None in the application.

**Two false negatives in my own verification**, both the same mistake: asserting
`innerText.includes('Built on')` and `includes('Arrives in')` against elements
carrying `text-transform: uppercase`. `innerText` returns the *rendered* text,
so both came back uppercase and the assertions failed while the UI was correct.
Confirmed by dumping the page text. **Lesson for later checkpoints:** never
assert case-sensitively against text that CSS may transform.

### Verification
- `GATE PASS` — `next typegen` clean, 112 tests / 12 files, `tsc --noEmit`
  exit 0, `eslint` clean
- Route probe: `/`, `/?view=upcoming`, `/?view=archived`, `/dashboard`,
  `/templates`, `/integrations` all HTTP 200
- `VISUAL VERIFIED` — screenshot reviewed. **0 console errors, 0 failed
  requests.** Sidebar nav resolves 4 links with correct active states; KPI row
  reads 16 / 13 / 1,457 / 59%; 5 filter pills with counts; 16 cards each with a
  working kebab (Archive · Delete confirmed by clicking) and two CTAs; persona
  panel intact
- Nav active state confirmed correct on `/dashboard` and `/templates`

**Status:** complete

---

## C2B — Campaign workspace tab restructure

**Date:** 2026-09-03
**Scope:** NAV-6. Move the workspace onto the new six-tab IA without making
anything unreachable.

### Renames
`dashboard`→`overview` · `scoring`→`audience` · `personalize`→`messaging` ·
`schedule`→`cadence` · `control`→`agent` · new `post-event`.

Done with `git mv` so history follows the files.

### Transitional tabs
`setup` and `templates` remain, typed as `transitional: true` in
`workspaceTabs`. Campaign-detail editing moves into Overview at C6; per-campaign
templates are replaced by the global library at C4. Eight tabs now, six at C13.

### Files changed
- Six route folders renamed; `app/campaigns/[id]/post-event/page.tsx` added.
- `WorkspaceTabs.tsx` — rewritten to the prototype's underline style.
- `lib/demo-data.ts` — `workspaceTabs` gains a type and a `transitional` flag;
  the `n:` ordinal is gone.
- `app/campaigns/[id]/layout.tsx` — `completedTabs` keys follow the renames.
- `app/campaigns/[id]/page.tsx` — redirect now goes through
  `campaignLandingHref` and 404s properly on a missing campaign, instead of
  redirecting to a setup tab for a campaign that does not exist.
- `lib/campaignRoutes.ts` — points at the new names.
- Six components' internal navigation hrefs repointed.
- `app/globals.css` — `.lsq-tab` hover.

### Decisions made during the work

**Action modules were not renamed.** `lib/actions/{scoring,schedule,control,
personalize}.ts` keep their names. They are not routes, nothing about them is
user-visible, and renaming them would have inflated the diff for no benefit.

**Completion state survived the restyle.** The old tabs carried numbered
circles that turned into ticks. The prototype's tabs have no such indicator,
but silently dropping progress signalling would be a regression, so completed
tabs now carry a small green dot — the same information in the prototype's
quieter visual language.

**Attendance import moved to Post-event, not Agent run.** Importing a
participants report is a post-event act; an operator looking for it is thinking
about results, not about the running cadence.

### Bugs found
**Pre-existing bug, fixed.** `app/campaigns/[id]/page.tsx` redirected to a tab
without checking the campaign existed, so `/campaigns/does-not-exist` sent the
user to a setup tab that then threw from `findUniqueOrThrow`. It now `notFound()`s.

### Verification
- `GATE PASS` — `next typegen` clean, 112 tests / 12 files, `tsc` exit 0,
  `eslint` clean
- All 8 tabs plus the bare `/campaigns/[id]` redirect return HTTP 200
- `VISUAL VERIFIED` — every tab rendered, correct active state on each,
  **0 console errors, 0 failed requests** across all eight

**Status:** complete

---

## C3 — Cadence engine unblock

**Date:** 2026-09-03
**Scope:** CAD-1, SAF-8. Remove the hardcoded step allowlist that made the new
cadence planner impossible.

### The bug being fixed
`launchCadence` queued only steps whose `key` appeared in
`AUTOMATED_STEP_KEYS = ['invite','nudge','final','t3','t1d','t1h','sms','smsInvite','waInvite']`.
A step the operator invents in the planner is in no allowlist, so it would
render correctly, report itself enabled, and **silently never send anything**.
The failure had nothing to fail — no error, no failed send row, nothing to see.

### Why `anchor` could not have fixed it
The obvious fix — reuse the existing `anchor` field — does not work.
`attend` and `noshow` are both `anchor: 'webinar'`, yet neither can be queued at
launch, because at launch nothing knows who attended. Scheduling and triggering
are genuinely independent concepts and needed separate fields.

### The fix
New `CadenceStep.trigger` column: `launch` | `registration` | `attendance`.
A step queues at launch iff `trigger === 'launch'` **and** its channel is one
the app can actually send (LinkedIn is excluded — no send API). A hand-added
step defaults to `launch`, so it works by default.

### Features completed
| ID | Feature |
|---|---|
| CAD-1 | Channel-derived automation replacing the key allowlist |
| SAF-8 | Send dedupe preserved, and now correctly scoped |

### Files changed
- `prisma/schema.prisma` + migration `20260903033247_cadence_step_trigger` —
  adds `trigger` with a hand-written backfill.
- `lib/stepTrigger.ts` — **new**, pure. `isLaunchQueued`, `defaultTriggerFor`.
- `lib/channels.ts` — gains `isAutomatableChannel`.
- `lib/cadence.ts` — allowlist deleted; queries by `trigger`; re-exports both
  predicates for existing callers.
- `lib/campaignDefaults.ts` — provisioning sets `trigger`.
- `app/campaigns/[id]/cadence/{page,CadenceGroups}.tsx` — `automatedKeys` prop
  removed; derived from the step instead.
- `lib/stepTrigger.test.ts` — **new**, 12 tests.
- `scripts/diag-cadence-trigger.ts` — **new** diagnostic.

### Decisions made during the work

**`isAutomatableChannel` lives in `lib/channels.ts`, not `lib/cadence.ts`.**
First attempt put it in `cadence.ts` and imported it into `CadenceGroups.tsx` —
a client component. `lib/cadence.ts` imports the database, so that would have
pulled Prisma into the client bundle. Caught by `tsc`; the predicate is pure and
`channels.ts` was already the single source of truth for channel routing.

**`isLaunchQueued` got its own module.** It could not live in `cadence.ts`
either, because a unit test importing it would instantiate a `PrismaClient` at
module load. `lib/stepTrigger.ts` is pure and therefore testable.

**The `linkedin` step keeps `trigger: 'launch'`.** It *is* queued at launch —
into the assisted queue, not the send queue. Its exclusion from automatic
sending is a property of its channel. Conflating the two is precisely what made
the old allowlist unable to describe a new step.

**Dedupe scope corrected.** The pre-launch duplicate check queried
`stepKey: { in: [...AUTOMATED_STEP_KEYS] }`, which would have missed a
user-added step and re-queued it on every launch, leaving the unique constraint
to throw. It now queries the keys actually being queued.

### Bugs found
Two, both mine, both caught by `tsc` before running:
1. Server-only import into a client component (above).
2. `@/lib/...` alias in a file imported by vitest — vitest has no alias config,
   and the pure lib modules use relative imports. Matched the convention.

### Verification
- `GATE PASS` — `next typegen` clean, **124 tests / 13 files** (up from 112/12),
  `tsc` exit 0, `eslint` clean
- `MIGRATION VERIFIED` — `dev.db` backed up to `/tmp/dev.db.backup-c3` first.
  All **224** `CadenceStep` rows preserved. Backfill exactly as intended:
  `confirm`/`whatsapp` → `registration`, `attend`/`noshow` → `attendance`,
  the other 10 keys → `launch`
- **Equivalence pinned by test:** `isLaunchQueued` over the 14 built-in steps
  returns exactly the 9 keys of the legacy allowlist. The legacy list is
  duplicated verbatim in the test so this is a real comparison, not a
  restatement of the new rule
- **The actual regression, proved end to end:**
  `npx tsx scripts/diag-cadence-trigger.ts` → step
  `operator-added-second-nudge` queued 3 sends; `linkedin`, `confirm` and
  `attend` correctly absent

**Status:** complete

---

## C4A — MessageTemplate schema, migration, resolution

**Date:** 2026-09-03
**Scope:** CAD-2 and the data model behind the shared template library. Split
from C4 so the migration could be verified on its own before any UI depended
on it.

### The problem
`Template` was per-campaign. Every campaign carried its own copy of all fifteen
built-in messages — **240 near-identical rows** in this database — and fixing a
typo meant editing it sixteen times.

### The shape
New `MessageTemplate`, where `campaignId` is the override axis: `null` is a
shared library row, set is one campaign's own copy. Channel-specific fields
because the channels are genuinely different products, not one message with a
delivery flag — WhatsApp needs Meta's category/language/footer/buttons and an
approval state, SMS needs a DLT content-template id and sender id, LinkedIn has
no approval at all because nothing is sent by API.

`CadenceStep.templateId` points at the message the step sends.

### Migration strategy
A library row per key, taken from the earliest campaign that **never edited**
that key — so the library default is a default, not somebody's customisation.
Campaign-scoped copies created **only** where a campaign actually customised
the message (`savedAt` set, or hidden). Everything else points at the library.

`Template` is deliberately **left intact**. Nothing is deleted, so the migration
is reversible by dropping `MessageTemplate` and clearing `templateId`.

### Resolution order
`lib/messageTemplates.ts` resolves most-specific-first: the step's own template
→ this campaign's override → the shared library row → the legacy `Template`
row. Layer four exists so a campaign created by older code still sends, and can
be deleted once no `Template` rows remain.

### Files changed
- `prisma/schema.prisma` + migration `20260903034057_message_template_library`
- `lib/messageTemplates.ts` — **new**, the resolver
- `lib/cadence.ts` — `processSingleSend` resolves through it
- `scripts/diag-template-resolution.ts` — **new**

### Decisions made during the work

**Status seeded honestly.** Migrating WhatsApp/SMS templates in as `approved`
would have been a lie — nothing has been through Meta or DLT. They carry over as
`ready`, which is what they truthfully are: in use today. LinkedIn seeds as
`assisted`, since no approval concept applies.

**Approval is not yet enforced on the send path.** Gating sends on template
status is correct, but it is a behaviour change beyond this checkpoint's scope
and would silently stop working campaigns. Deferred, deliberately.

**`ResolvedTemplate.label`, not `.name`.** The SMS/WhatsApp send path already
destructures `{ label, channel, body, subject }` from the legacy row; matching
that shape avoided churning a working code path for cosmetics.

### Bugs found
None.

### Verification
- `MIGRATION VERIFIED` — `dev.db` backed up to `/tmp/dev.db.backup-c4` first.
  **224** `Template` rows untouched · **14** library rows · **2** override rows,
  matching exactly the 2 templates that were edited or hidden · **224/224**
  cadence steps carry a `templateId`, **0 orphans** · **0 content mismatches**
  when every edited template's subject, body and hidden flag was compared
  against its migrated copy
- 240 rows of duplicated copy collapsed to 16
- `scripts/diag-template-resolution.ts` across all **16 campaigns**:
  **0 unresolved steps**; overrides correctly win over library rows
- `GATE PASS` — 124 tests / 13 files, `tsc` exit 0, `eslint` clean

**Status:** complete

---

## C4B — Global Templates page

**Date:** 2026-09-03
**Scope:** TPL-1..18. The library UI on top of C4A's data model.

### Features completed
All eighteen. Channel tabs with counts · per-channel rules callout · Email
subject+body · WhatsApp category/language/footer/buttons with numbered
placeholders · Meta approval lifecycle · SMS DLT id and sender id · live SMS
segment + GSM-7/UCS-2 counter · LinkedIn assisted-only · new · save · **delete**
· **duplicate** · **revert to saved** · **hide/unhide** · **AI rewrite** ·
**merge-field preview** · status badges · **copy-into-campaign** override.

### Files changed
- `lib/actions/messageTemplates.ts` — **new**, nine server actions
- `app/templates/page.tsx` — real page, replacing the C2 placeholder
- `app/templates/TemplatesLibrary.tsx` — **new**

### Decisions made during the work

**Delete refuses when a template is in use.** Deleting a template that cadence
steps point at would silently fall those steps back to the library default —
a content change nobody asked for and nobody would see. The action returns an
error naming the step count instead.

**Duplicate does not copy `key`.** `key` is the step-default marker and is
unique per campaign. A duplicate is a new message, not a second default for the
same step.

**A duplicate never inherits approval.** Copying an approved WhatsApp template
would otherwise launder unreviewed copy through Meta's approval state. Copies
start at `draft` (`ready` for email, `assisted` for LinkedIn).

**Starters model each channel's constraints.** A new WhatsApp template is named
`untitled_template` and pre-fills an opt-out footer; a new SMS template
pre-fills `Reply STOP to opt out.` Better to encode the rule than let the
operator discover it via a rejection days later.

**Draft state is keyed by template id.** Switching selection with unsaved edits
would otherwise carry one template's text onto another.

### Bugs found

**500 on every `/templates` request.** `db.messageTemplate` was `undefined`.
Not a code fault: the dev server had been running since before C4A's
`prisma generate`, so it held a stale client in memory while `tsc` — reading
regenerated types from disk — passed clean. Fixed by restarting the server.

**Worth recording as a trap:** after any schema change, a green `tsc` says
nothing about what the running dev server is executing. Restart it before
trusting a browser check.

### Verification
- `GATE PASS` — `next typegen`, 124 tests / 13 files, `tsc` exit 0, `eslint` clean
- All four channel routes HTTP 200
- `VISUAL VERIFIED`, **0 console errors, 0 failed requests**, and interaction
  tested rather than just rendered:
  - each channel shows only its own fields — WhatsApp: Category, Language,
    Footer, Buttons + "Submit to Meta"; SMS: DLT content template ID, Sender ID
    + a live segment counter; LinkedIn: name and message only
  - each channel shows its own compliance rules
  - **create** grew the list 2 → 3 and toasted
  - **save** enabled only when dirty, and the edited body **survived a reload**
- QA-created template removed afterwards; library back to 16 rows

**Status:** complete

---

## C5 — Cadence planner

**Date:** 2026-09-03
**Scope:** CAD-3..16, SAF-3..7. The planner's headline capability — sizing a
cadence — plus keeping every existing scheduling control.

### Features completed
Add step (any channel, any group) · remove step · per-step template picker with
an Edit link into the library · timing editor · **reset to defaults** ·
**send window** · **frequency preset** · **daily send limit** · **channel mix
with reachability** · per-step sent/queued/failed counts · launch/restart ·
LinkedIn assisted queue. Safety rails SAF-3..7 all still enforced.

### Schema
`CadenceStep.createdByUser` and `CadenceStep.removedAt`
(migration `cadence_step_planner_edits`). 224 rows preserved.

### Decisions made during the work

**Remove is a soft delete for built-ins, a hard delete for invented steps.**
A built-in has a default to return to, so removing it must be undoable by
"Reset to defaults", and its unique key must stay taken — re-adding it should
restore the original, not create a second. An invented step has no default, so
soft-removing it would mean reset quietly kept rows reset is supposed to undo.

**Removing a step cancels its queued sends.** Otherwise a message goes out from
a step the operator believes they deleted. Cancelled sends are marked `skipped`
with the reason, not deleted, so the record survives.

**A new step's trigger is inferred from its group.** Adding to
"Reminders · registrants only" produces a `registration` step; "Post-webinar"
produces `attendance`; anything else is `launch`. Getting this wrong would
queue the step to the entire approved audience at launch.

**A new step gets the library default for its channel immediately**, so it is
sendable on creation rather than failing on missing copy.

**Removed steps are excluded at every query, not just the planner.** Ten call
sites updated — `launchCadence`, the attendance path, LinkedIn ingest,
readiness, channel mix, the planner, overview and the diagnostics. Missing one
would mean a removed step still sending.

### Bugs found

**A real React violation, caught by lint.** My first version synced props to
state by writing a ref during render. `react-hooks/refs` rejected it. Replaced
with React's sanctioned adjust-state-during-render pattern using state — an
effect would have rendered the stale list once first.

**The stale dev-server trap, again.** The planner returned a caught
`PrismaClientValidationError` for `removedAt` because the dev server predated
the migration. Exactly what C4B recorded. **Rule going forward: restart the dev
server after every `prisma generate`, before trusting any browser check.**

**A third false negative in my own assertions.** I checked for `/Daily limit/i`
against a field labelled "Daily send limit". The feature was present and
working. Same class of mistake as C2's two — I am matching on remembered
wording rather than the rendered text.

### Verification
- `GATE PASS` — 124 tests / 13 files, `tsc` exit 0, `eslint` clean
- `VISUAL VERIFIED`, **0 console errors**, driven rather than inspected:
  14 template pickers, 14 remove buttons, 12 add-step buttons (3 groups ×
  4 channels); send window, reset and channel mix all present
  - **add**: 14 → 15 pickers, toast shown
  - **remove**: confirmation names the step, then 15 → 14
- `scripts/diag-cadence-trigger.ts` extended and passing: a **removed** step
  queues nothing, while the invented step still queues 3 sends and `linkedin`,
  `confirm`, `attend` stay correctly absent

**Status:** complete

---

## C6 — Creation wizard

**Date:** 2026-09-03
**Scope:** WIZ-1, WIZ-4..20 (Zoom-linking items stay in C8).

### Features completed
Four-step wizard with per-step validation · title/date/time · **AI "improve
description"** · speaker and speaker title · capacity · registration and Zoom
links · **CSV vs LeadSquared list import** · **AI CSV column mapping** ·
**preflight gaps** · **`extraFieldsJson` retention** · Apollo enrichment ·
**editable scoring prompt / criteria / threshold** · **re-run scoring** · score
preview · templatized vs AI-personalized · tone / length / AI instructions ·
brief · one-click sign-up toggle · channel toggles with cadence descriptions.

### Schema
`Campaign` gains `speakerName`, `speakerTitle`, `capacity`, `msgMode`, `tone`,
`msgLength`, `aiInstructions`, `brief`, `oneClickSignup`
(migration `campaign_wizard_fields`). 16 campaigns preserved.

### Decisions made during the work

**The wizard is server-rendered per step, carrying its draft in the URL**
(`?id=&step=`). Client-only state would have gone stale against the import and
enrichment cards, which do their own server work. It also makes a half-finished
wizard a resumable link rather than lost state.

**The draft row is created at the end of step 0, not at the end of the wizard.**
Steps 1–3 all need something to attach to. An abandoned wizard leaves a draft,
which is what the Drafts filter is for.

**Steps 1 and 2 embed the existing cards rather than reimplementing them.**
`LeadImportCard` and `EnrichmentCard` already do CSV upload, LSQ list import,
AI column mapping and preflight, tested and working. Rebuilding that inside the
wizard would have been a second implementation to keep in sync.

**"New webinar" no longer creates a blank campaign on click.** It used to, so
every mis-click left an "Untitled webinar" draft. The wizard writes a row only
once there is a title and a date.

**Channel choice writes through to the cadence steps** rather than to a
separate field, so the wizard and the planner can never disagree about which
channels a campaign uses.

### Bugs found — four, all real

1. **New campaigns had zero linked templates.** `provisionCampaignDefaults` set
   no `templateId`. Found by inspecting a wizard-created draft.
2. **Provisioning still copied 15 legacy `Template` rows per campaign** — the
   exact duplication C4A existed to remove. It now creates none and links each
   step to the library row for its key.
3. **The per-campaign Templates tab had become a lie.** Steps resolve through
   the library first, so editing a campaign's legacy row changed nothing that
   would send. Tab and `lib/actions/templates.ts` removed. A tab that lies is
   worse than a missing one.
4. **Three read paths would have broken for every new campaign** — readiness,
   personalization and the Messaging page all read the legacy per-campaign
   table, which is now empty for new campaigns. Readiness would have reported
   every step ready by finding nothing to check; personalization would have
   refused to run. All three now resolve through `resolveStepTemplate`, the
   same path the send uses.

### Verification
- `GATE PASS` — 124 tests / 13 files, `tsc` exit 0, `eslint` clean
- All 10 routes HTTP 200
- `VISUAL VERIFIED`, **0 console errors**, driven end to end:
  - Continue with an empty form **does not advance** and shows field errors
  - filling title/date/time/speaker/description advances to Audience and
    **creates the draft** (`?id=…&step=1`)
  - step 2 shows enrichment, relevance scoring and "Edit criteria"
  - step 3 shows both modes, tone, one-click sign-up, **5 switches**, "Finish setup"
  - the created draft persisted name, formatted date, `scheduledAt`, speaker,
    description, `msgMode`, `oneClickSignup`, and provisioned **14 steps**
- New-campaign provisioning re-verified: **14 steps, 14 linked, 0 legacy rows**
- QA draft deleted afterwards

**Status:** complete

---

## C7 — Audience tab

**Date:** 2026-09-03
**Scope:** AUD-1..14, SAF-2.

### Features completed
4 summary cards · **score distribution bar with legend** · **server-side
search** · **band filter** · **pagination** · approve checkboxes · bulk approve
· **approve all ≥ threshold** · `approvedManually` protection · **re-run
scoring** · **editable scoring prompt/criteria/threshold** · **inline phone
edit** · **verify inferred emails** · **inferred-email quarantine warning**.

### Decisions made during the work

**Search, filtering and paging moved from the browser to the database.**
`ScoringTable` filtered a full in-memory array. That is fine for a demo list and
wrong for the thousands of contacts this is built for — shipping every row to
the client and filtering there is what makes a page feel broken. All three now
live in the URL and execute as SQL, which also makes any view shareable.

**Score bands are half-open and contiguous** (`85+`, `70–84`, `<70`), so every
scored contact lands in exactly one. Overlapping ranges would double-count the
distribution bar. Verified: 32 + 32 + 66 = 130.

**"Approve all ≥ threshold" will not overturn a human.** It skips contacts with
`approvedManually` set, the same protection re-scoring honours. A bulk action
that silently reverses someone's explicit decision is how trust in bulk actions
is lost.

**Case-sensitive search, deliberately.** SQLite has no `mode: 'insensitive'`.
Rather than pull every row back to lower-case it in JS — which is the exact
problem being fixed — search matches as stored. Adequate for names and accounts;
noted here in case it needs a normalised column later.

### Bugs found
None in application code. One lint warning (an import left unused after the
filters moved out) fixed before commit.

### Verification
- `GATE PASS` — 124 tests / 13 files, `tsc` exit 0, `eslint` clean
- All four audience URL shapes HTTP 200
- **Tested at scale** on a purpose-built 130-contact campaign, since the seeded
  campaign has one contact and would have proved nothing:
  - page 0 → 50 rows, "Showing 1–50 of 130"
  - page 1 → 50 rows, "Showing 51–100 of 130"
  - band counts 32 / 32 / 66 sum exactly to 130
  - `?band=high` → 32 rows
  - `?q=Ananya` → 13 rows, **every row matched**
  - **0 console errors**
- Inferred-email quarantine warning and Verify action confirmed intact
- Temp campaign deleted; database back to 16 campaigns

**Status:** complete

---

## C8 — Registration + Zoom

**Date:** 2026-09-05
**Scope:** REG-1..5, ZOM-1..4, PST-6, PST-7, SAF-9..11.

### Features completed
`Contact.registeredAt` + `registrationSource` · signed one-click sign-up route
`/r/[token]` · idempotent under replay · confirmation step fires on
registration · LinkedIn Lead Sync registration (kept, and repaired — see bugs)
· Zoom Server-to-Server OAuth · list / link / create meeting · participants
report fetch · **CSV fallback retained** as a parallel path, not a replacement.

### Schema
`Contact.registeredAt`, `Contact.registrationSource`
(migration `contact_registration`) · `Campaign.zoomMode`, `Campaign.zoomMeetingId`
(migration `campaign_zoom_meeting`). 16 campaigns, 57+ contacts preserved.

### Design

**One-click links are signed, not stored.** `lib/registration.ts` mints an
HMAC-signed token over `{campaignId, contactId, iat}` — no database token
table, no row to clean up, no read on the hot path. Idempotency comes from the
contact's own `registeredAt`, not from consuming a token. Verified with a
constant-time comparison so the endpoint can't be used as a signature oracle.

**The link decision is per-contact, not per-step.** `effectiveLink()` in
`lib/cadence.ts` gives an unregistered contact a one-click link (clicking it
registers them) and a registered contact the plain event link (a second
"register here" link would be redundant, and a reminder should read as being
about the event, not as another invitation). This is correct for the very
first invite and for the T-1 hour reminder alike — what matters is whether
*this contact* has registered, not which step is firing.

**Zoom mirrors the LinkedIn integration's sandbox/live shape.** A sandbox mode
that fabricates fixtures so the whole flow is exercisable without credentials,
and a live mode behind Server-to-Server OAuth (chosen over user OAuth because
the app acts as the organisation, not a signed-in person). The switch is
explicit — silently going live because a key happens to be present is how test
data reaches real people.

**CSV import is kept, not replaced.** Zoom's participant-report endpoints need
a paid plan; CSV export works on any plan and is the only route when no
meeting is linked at all. Both write through one shared `applyAttendance()`
core so "attended" means the same thing regardless of source.

### Bugs found — two real, both in the existing LinkedIn ingest path

**1. Every LinkedIn-sourced registration on every campaign made since C6 queued
nothing.** `lib/linkedin/ingest.ts` read `db.template` (the legacy per-campaign
table) for the `confirm`/`whatsapp` steps' copy. That table has been empty for
every campaign provisioned since messages moved to the shared library — so the
lookup always came back empty and the block silently queued zero sends,
however many registration-triggered steps were enabled. Same failure shape as
every other legacy-table bug this revamp has hit: nothing errors, there's
nothing to notice.

**2. The queueing itself only knew two hardcoded keys** (`confirm`,
`whatsapp`) — the exact allowlist bug C3 fixed for the launch path, reintroduced
here. A registration-triggered step added in the planner would never queue for
a LinkedIn-sourced registrant.

**Fix:** both paths — one-click and LinkedIn — now share one `registerContact()`
function. It sets `registeredAt`/`registrationSource` idempotently and queues
*every* enabled `trigger: 'registration'` step, resolved through
`resolveStepTemplate` like every other send. `registerContact` gained an
optional timestamp override so a LinkedIn registration is stamped with
LinkedIn's own `occurredAt`, not the moment the webhook happened to process.

Also closed: a contact that existed before registering (e.g. from a CSV
import) but then registered via LinkedIn previously got no registration
handling at all — that branch only handled true duplicates. It now calls the
same `registerContact()`, so a first-time registration is recognised
regardless of how the contact originally entered the system.

### Verification
- `GATE PASS` — `next typegen`, 132 tests / 14 files, `tsc` exit 0, `eslint` clean
- `scripts/diag-registration.ts` (one-click, end to end against the running
  server): valid link → registers + redirects to the Zoom join URL; **same
  link clicked twice queues nothing further**; tampered signature refused;
  contact-from-another-campaign refused
- `scripts/diag-oneclick-link.ts`: unregistered contact → one-click token in
  the rendered body; registered contact → plain link; `oneClickSignup=false`
  → plain link always
- `scripts/diag-linkedin-registration.ts` — **written specifically to catch
  the bug above**: against a campaign with **0 legacy Template rows** (the
  exact precondition), `confirm` and `whatsapp` both now queue
- `VISUAL VERIFIED`, **0 console errors** throughout:
  - wizard "Use existing event" lists 3 sandbox meetings, selecting one
    auto-fills title/date/time and shows the "Pulled from Zoom" banner;
    persisted correctly (`zoomMode: existing`, real `zoomMeetingId`/`zoomLink`)
  - wizard "Create new event" creates a sandbox meeting and persists
    `zoomMode: new` with its own generated join link
  - Post-event: "Pull attendance from Zoom" only appears when a meeting is
    linked; in sandbox it fails **gracefully** with guidance to use the CSV
    fallback instead — no crash
  - CSV attendance import **re-tested and still works** after the shared-core
    refactor
- Every temp campaign/contact created during verification deleted afterward;
  database back to 16 campaigns

**Status:** complete

---

## C9 — Messaging tab

**Date:** 2026-09-05
**Scope:** MSG-1..15, SAF-12.

### The starting point
The original Personalize tab's engine (`PersonalizeClient.tsx`, 624 lines)
survived C2B's rename to Messaging completely intact: generate, regenerate one,
edit + save, mark reviewed (one + all), discard (one + all), stale-link repair,
per-contact validation, and the editable prompt modal were all already present
and already wired to real server actions. C9's job was narrower than it looked:
add the prototype's new visual layer, verify the whole surviving engine still
works after C6's template-resolution change, and fix anything that didn't.

### Features completed
| ID | Feature | Note |
|---|---|---|
| MSG-1 | Personalization run card + progress | **new** |
| MSG-2 | Source-field chips | **new** |
| MSG-3 | Per-contact preview | **satisfied by the existing editable detail panel** — see design note |
| MSG-4 | Step picker w/ coverage counts | kept |
| MSG-5 | Generate all for a step | kept — **re-verified with a real Claude call** |
| MSG-6 | Regenerate one contact | kept |
| MSG-7 | Edit + save a draft | kept — **re-verified end to end** |
| MSG-8 | Mark reviewed / mark all reviewed | kept — **re-verified end to end** |
| MSG-9 | Discard one / discard all | kept — **re-verified end to end** |
| MSG-10 | Stale-link detection + repair | kept — **re-verified end to end** |
| MSG-11 | Per-contact rationale line | kept |
| MSG-12 | `status` draft→edited→reviewed | kept — **transitions confirmed in DB** |
| MSG-13 | Editable personalization prompt | kept |
| MSG-14 | Readiness badge | kept |
| MSG-15 | Message validation | kept |
| SAF-12 | Message validation before send | kept — same validator, unchanged |

### Design note — MSG-3
The prototype's "per-contact preview" is a fixed set of ~3 sample-contact tabs,
read-only. The existing recipient list + detail panel already does this for
*every* approved contact (not a preset few), and the detail panel is fully
editable in place — regenerate, edit, save, review, right where the preview is.
Bolting on a separate fixed-tab preview alongside a strictly more capable
existing UI would be a regression dressed as a restyle. Marked satisfied by the
existing panel rather than rebuilt.

### Files changed
- `app/campaigns/[id]/messaging/page.tsx` — passes `msgMode` through.
- `app/campaigns/[id]/messaging/PersonalizeClient.tsx` — new "Personalization
  run" card (progress bar + mode copy + source-field chips) inserted above the
  existing recipient list/detail panel; no existing logic touched.

### Bugs found
None in this checkpoint's own changes. Verification did surface **three false
negatives in my own test scripts**, all the same root cause: `page.locator(
'div', { hasText: '...' })` matches an *ancestor* container whose full text
happens to include the string, not the specific leaf row — `.first()` then
grabs the outer wrapper instead of the row. Confirmed by re-running the same
checks with ref-based clicks from the accessibility snapshot instead of
text-containment locators, which passed cleanly. No application code was at
fault; recorded here because this is now the second checkpoint this exact
Playwright pattern has produced a spurious failure in, and it's worth a
standing rule: **prefer ref-based clicks (`ui.snapshot()` + `ui.click('@e_')`)
over `hasText` locators when multiple rows share overlapping text**, e.g. two
contacts both named "Priya Nair" in the same list.

### Verification
- `GATE PASS` — `next typegen`, 132 tests / 14 files, `tsc` exit 0, `eslint` clean
- `VISUAL VERIFIED`, **0 console errors** across every check below:
  - run card renders with correct progress %, mode copy, and all 7 source
    chips (`{{firstName}}`, `{{title}}`, `{{seniority}}`, `{{function}}`,
    `{{account}}`, `{{vertical}}`, `{{score}}`)
  - **real Claude call** through a live campaign's "Generate" button produced
    an actual personalized message — proves `resolveStepTemplate` correctly
    feeds `generatePersonalized`, the one code path in this tab C6 actually
    changed
  - edit → save: DB confirms `status: 'edited'`, body contains the edit,
    `editedAt` set
  - mark reviewed: DB confirms `status: 'reviewed'`, `reviewedAt` set
  - stale-link warning appeared after changing the campaign's registration
    link; repair confirmed in DB — `linkUsed` and the message body both
    updated to the new link
  - discard-all confirmed in DB: campaign returned to 0 personalized messages
- All test-created personalized messages removed and the campaign's
  registration link restored to its original value afterward — no residue
  left in real campaign data used for verification

**Status:** complete

## C10 — Agent run + Post-event

**Date:** 2026-09-05
**Scope:** AGT-1..8, PST-1..5.

### Features completed
Numbered activity log w/ status badges (`ActivityLog.tsx`) · 4 run stat cards
(Messages sent, Failed, Queued, Registered) · pause / resume / stop cadence,
retry failed sends, run due sends now, needs-attention cards + AI diagnose +
resolve, next-send-due indicator, simulated clock (all pre-existing in
`ControlPanel.tsx`, unchanged, reconfirmed live) · 4 post-event stat cards
(Attended, No-shows, Attendance rate, Avg. watch time) · attendee follow-up
card · no-show follow-up card · account engagement summary table · "Push to
LSQ for SDR" action.

### Files
- `app/campaigns/[id]/agent/ActivityLog.tsx` (new) — numbered, oldest-first
  log; maps each entry's existing `ActivityLogEntry.dot` colour token onto a
  Done/Attention/Running badge rather than adding a new schema column.
- `app/campaigns/[id]/agent/page.tsx` — rewritten onto `PageProps<'/campaigns/
  [id]/agent'>` (was hand-typed, now generated), adds the 4 stat cards
  (`db.cadenceSend.count` / `db.contact.count`) and `<ActivityLog>`; last 30
  `ActivityLogEntry` rows fetched `desc` then reversed for chronological
  numbering. `ControlPanel` untouched.
- `lib/postEvent.ts` (new) — `getPostEventStats()` (attended / no-show / avg
  watch minutes / demo requests) and `getAccountEngagement()` (groups approved
  contacts by account; per account picks the longest-watching attendee, or
  else the highest scorer, as the one contact for sales to act on).
- `lib/activityPush.ts` — `EngagementEntry.stage` union extended with
  `'SDR follow-up'`; the push function itself (already live, already proven in
  earlier checkpoints for `Attended`/`No-show`) is unchanged.
- `lib/actions/attendance.ts` — added `pushAccountsForSdrAction`, a thin wrap
  around the existing `pushEngagementActivities`.
- `app/campaigns/[id]/post-event/page.tsx` — rewritten: removed the
  `Placeholder`, wires in `getPostEventStats`/`getAccountEngagement`, keeps
  `ZoomPanel` and the attendance-imported notice unchanged in the side rail.
- `app/campaigns/[id]/post-event/PostEventClient.tsx` (new) — client component
  for the stat tiles, follow-up cards, account table, and the SDR push button
  (needs `useState`/`useToast`, so split out of the server page).

### Design

**"Demo requests" stays honest.** Neither Zoom nor the CRM in this app carries
a "requested a demo" signal, so `getPostEventStats` reads the static, manually
set `campaign.demoRequests` and returns `null` when absent — displayed as
"—", not fabricated from some other proxy metric.

**"Push to LSQ for SDR" reuses the proven engagement-push path rather than
inventing new LSQ surface.** Adding a fourth `EngagementEntry.stage` value
was enough; `pushEngagementActivities`'s lead-resolution, activity-type
caching, and failure handling (already exercised for Attended/No-show
pushes) needed no changes.

**Top contact per account = longest watch time, falling back to score.**
Sales needs one name to call, not a list. An account with any attendee gets
its longest-watching attendee; an account with no attendee but a score gets
its highest scorer ("Nurture"); an account with neither gets flagged "Not
contacted" and is excluded from the SDR push.

### Bugs found
None. This checkpoint's `pushEngagementActivities` call path predates it and
was already proven; the only change there was a new string in an existing
union.

Two false leads during verification, both my own test-script mistakes, not
app bugs:
- A first click attempt used a snapshot ref captured in an *earlier, separate*
  browser process invocation — cross-run refs aren't guaranteed stable, and
  the click silently never fired (no request reached the server). Fixed by
  snapshotting and clicking within the same script invocation.
- The Next.js dev console truncates long array arguments in its per-request
  action log line — a log showing 3 contact IDs for a push that (per the
  actual network request body, and the resulting toast) sent and pushed all
  4 was a logging-display artifact, not a dropped ID.

### Verification
- `GATE PASS` — `next typegen`, 132 tests / 14 files, `tsc` exit 0, `eslint` clean
- `VISUAL VERIFIED`, **0 console errors**, on a campaign seeded with 7 approved
  contacts across 5 accounts, mixed attendance/watch-time/score data:
  - Agent run stat cards (15 sent / 10 failed / 5 queued / 0 registered)
    matched a direct `CadenceSend`/`Contact` count query exactly
  - numbered activity log rendered all 24 entries oldest-first with correct
    Done/Attention/Running badges
  - Post-event stat cards (4 attended / 3 no-show / 57% rate / 36 min avg)
    matched hand-computed values from the seeded rows exactly
  - account engagement table's 5 rows, per-account avg watch time, and
    Follow up/Nurture/Not contacted actions matched a direct
    `getAccountEngagement()` script run exactly
  - clicked "Push to LSQ for SDR": captured network request body confirmed
    all 4 eligible accounts' top-contact IDs were sent; real LeadSquared push
    succeeded (no attention item, no server error); toast read "Flagged 4
    accounts for SDR follow-up in LeadSquared."
  - empty state (0 approved contacts) verified on a separate campaign: stat
    cards show 0/0/—/—, table shows "No approved contacts yet.", push button
    disabled
- All test-seeded attendance/watch-time/score values reverted to their
  original state afterward — no residue left in real campaign data used for
  verification

**Status:** complete

## C11 — Overview + Dashboard

**Date:** 2026-09-05
**Scope:** OVR-1..12, DSH-1..8, LST-7.

### Features completed
6-tile clickable pipeline (Imported/Enriched/Scored/Approved/Invited/Attended,
each opening the same drill-down drawer as the funnel) · About panel (name,
vertical, date, description, speaker, capacity) · "What the agent has
learned" per-campaign insight card · step + channel delivery breakdown
(**repaired**, see bugs) · score-band predictiveness table · 4-dimension
segment breakdown · account table · drill-down drawers · historical summary
for contact-less campaigns — all reconfirmed working, mostly pre-existing.
New cross-campaign `/dashboard`: 30d/90d/6m/all range selector, 5 KPIs with
period-over-period deltas, registrations-over-time bar chart, registrations
by channel, persona conversion table (moved from the webinars list), and a
vertical/source "what the agent has learned" panel.

### Files
- `lib/analyticsMath.ts` (new) — pure date/number math behind the dashboard
  (range windows, delta math, date bucketing, the campaign-range `where`
  builder), split out specifically so it's unit-testable: vitest has no `@/`
  alias, so any module importing `@/lib/db` can't be reached from a test at
  all, pure or not.
- `lib/analytics.ts` (new) — `getDashboardKpis`, `getRegistrationsTrend`,
  `getRegistrationsByChannel`, `getWebinarsInRange`, `getCrossCampaignLearnings`,
  and a re-export of the existing `getPersonaLearning`.
- `lib/analyticsMath.test.ts` (new) — 13 tests: range windows, count/ratio
  delta math, date bucketing (day/week/month, zero-filled gaps), the
  campaign-range `where` builder.
- `app/dashboard/page.tsx` — rewritten: removed the `Placeholder`, wires in
  every `lib/analytics.ts` export.
- `app/page.tsx` — removed the persona-learning panel and its data fetch
  (moved to `/dashboard`, per the comment already on that code marking it as
  a C11 move).
- `app/campaigns/[id]/overview/page.tsx` — added the pipeline/about/learnings
  computations; **fixed the step-label/channel bug** (see bugs).
- `app/campaigns/[id]/overview/DashboardClient.tsx` — added the pipeline tile
  row and the About/learnings panels; every pre-existing section (funnel,
  score bands, segment breakdown, account table, drawers) untouched.
- `lib/campaignCardStats.ts` — `registered` now counts `Contact.registeredAt`
  directly instead of the LinkedIn-only fallback the code comment had been
  waiting on since C8 landed real registration tracking.
- `app/campaigns/[id]/StageBadge.tsx`, `app/campaigns/[id]/layout.tsx`,
  `lib/demo-data.ts` — **fixed the campaign-status badge** (see bugs).

### Design

**Pipeline tiles are always six, never fewer.** A tile reading 0 ("nothing
invited yet") is informative; dropping a stage because it's empty would read
as though that stage doesn't exist yet.

**"What the agent has learned" only speaks when it has enough to say.**
Per-campaign learnings need at least 2 scored contacts in a group before
naming it as a standout, and the panel says "not enough data yet" rather
than showing nothing when no group clears that bar — matching the existing
cross-campaign persona-learning panel's honesty rule (there: 3 contacts, a
higher bar because it's pooling many campaigns' worth of noise).

**The campaign-range filter distinguishes "no date" from "not in range."** A
campaign with a real `scheduledAt` is filtered on it, bounded on both ends
(this checkpoint's own bug — see below — was forgetting the upper bound). A
campaign with none only counts via `createdAt`, and only if it's still a
draft: a fresh unscheduled draft showing up under "recent activity" is
right, but crediting a completed campaign's decade-old *database row* as
"recent" because that's when someone ran the seed script is not.

### Bugs found — three real, one pre-existing and cross-cutting

**1. Every cadence step showed its raw key, and every channel breakdown
showed only "Other," for any campaign made after the shared template library
replaced per-campaign templates.** `app/campaigns/[id]/overview/page.tsx`
read `db.template` (the legacy per-campaign table) for step labels and
channels — the same bug class as C8's LinkedIn ingest fix, in a different
file. Confirmed empty (`legacyCount: 0`) for a campaign created through the
real `createCampaignAction`, vs. 14 rows for every campaign in the seeded
dev dataset (which writes legacy rows directly, masking the bug there).
Fixed by resolving each step through `resolveStepTemplate()` — the same
source of truth the send path itself uses — instead.

**2. The campaign-range filter for `/dashboard` had no upper bound.** First
pass filtered campaigns by `scheduledAt >= start` with nothing capping the
top end, so a campaign scheduled weeks in the future (e.g. Oct 15 against a
Sep 5 "now") showed up under "last 30 days." Caught by hand-checking the
"Webinars in range" table's dates against the selected range rather than
trusting the row count alone. Fixed by passing `now` as the upper bound for
the current period in both `getDashboardKpis` and `getWebinarsInRange`.

**3. The campaign-status badge always read "Draft — not yet launched,"
regardless of a campaign's real status, on every tab of every campaign.**
`StageBadge.tsx` keyed off `usePathname()`'s last segment against
`stageBadges` — a lookup table keyed by the *pre-C2B* tab names (`setup`,
`scoring`, `templates`, `personalize`, `schedule`, `control`, `dashboard`).
None of the current tab routes (`overview`, `audience`, `messaging`,
`cadence`, `agent`, `post-event`) match any key except by coincidence, so the
lookup missed on every real tab and silently fell back to `setup`'s value.
Found incidentally while eyeballing a completed campaign's Overview page and
noticing the header still called it a draft. Out of C11's stated scope, but
cross-cutting and visible on every single page in the app, so fixed rather
than deferred: `StageBadge` now takes `status`/`cadenceStatus` as props from
`layout.tsx` (which already had the campaign loaded) and derives the badge
from real campaign state instead of the current route.

### Verification
- `GATE PASS` — `next typegen`, 145 tests / 16 files, `tsc` exit 0, `eslint` clean
- `VISUAL VERIFIED`, **0 console errors**, on a mix of a live campaign with
  real send/score/attendance data, a scored-but-undecided draft, a
  contact-less historical campaign, and a completed campaign:
  - 6-tile pipeline matches the funnel's own numbers exactly; clicking a tile
    opens the correct drawer (confirmed: "Approved — 7 of 24 contacts")
  - real cadence-step labels ("Initial invite", "Nudge (+4 days)", etc.) and
    correct per-channel rollup ("EMAIL 15 sent · 5 queued · 10 failed")
    render for a campaign resolved entirely through the shared library, zero
    legacy rows
  - About panel shows a real stored description, or an honest "No
    description set yet."; "what the agent learned" shows real computed
    lines for a campaign with scored contacts, and the honest fallback line
    for one with none
  - pre-existing funnel table toggle and segment-breakdown tabs (persona/
    score band/source/vertical) still work, unchanged
  - historical-summary branch (zero-contact campaigns) still renders
    unmodified
  - `/dashboard` checked at all four ranges: KPI values, trend bucket
    granularity (daily/weekly/monthly), persona/vertical/source tables, and
    the webinars-in-range table's date coverage all matched hand-computed
    expectations, including the post-fix exclusion of a completed campaign
    with no `scheduledAt` from the 30-day view and the post-fix exclusion of
    a future-scheduled campaign from every range but "All time"
  - status badge confirmed correct across draft ("Draft — not yet
    launched"), live-with-running-cadence ("Cadence live"), and completed
    ("Post-event complete") campaigns

**Status:** complete

## C12 — Integrations

**Date:** 2026-09-05
**Scope:** INT-1..11, SAF-1.

### Features completed
Almost everything here already existed, in good shape, from before this
checkpoint opened — this was mostly verification, plus closing two real
gaps found while checking it. Confirmed working: 6→**7** integration cards,
per-field credential entry with DB-wins-over-env resolution, live
connection tests with persisted results, the LSQ activity-type mapping
card (real API, 178 types loaded), LSQ sender auto-discovery + probe (no
email sent), the Apollo/Apify/Claude/LSQ live test calls, the LinkedIn
connect flow, and the sandbox-mode delivery-settings summary (SAF-1). New:
a 7th card, **SMS & WhatsApp Business**, for DLT (SMS) and WABA (WhatsApp)
compliance reference fields (INT-9, INT-10) — no live API of its own, so it
gets a note instead of a "Test connection" button that could never mean
anything.

### Files
- `lib/integrationFields.ts` — added the `messaging` field schema (6
  reference fields: DLT Entity ID, Sender IDs, route/template ID; WABA ID,
  phone number ID, template namespace) and `REFERENCE_ONLY`, a short list of
  ids with a credential form but no live API to test.
- `lib/demo-data.ts` — added the `messaging` card to `integrationsData`;
  **fixed Zoom's stale static copy** (see bugs).
- `app/integrations/IntegrationPanel.tsx` — reads `REFERENCE_ONLY` to hide
  the Test button and show an explanatory note instead; added a Zoom
  explainer block (credentials are optional — CSV import always works);
  **removed a dead, stale Zoom explanation string** that could never render
  (Zoom has credential fields, so it was never `explanatoryOnly`).
- `lib/zoom/client.ts` — exported `fetchZoomToken()`, split out of the
  existing cached `accessToken()`, so a candidate credential set can be
  tested before it's saved.
- `lib/actions/integrations.ts` — added a real Zoom branch to
  `testIntegrationAction` (sandbox-aware, mirroring the LinkedIn branch);
  added `'zoom'` to `TESTABLE`.
- `lib/campaignCardStats.ts`, `app/integrations/page.tsx` — added a Zoom row
  to the delivery-settings summary; updated the page's build note to stop
  saying Zoom has no real API.

### Design

**"Test connection" respects the same sandbox/live switch as the real
send path.** Zoom's test mirrors LinkedIn's exactly: in sandbox, report
sandbox status without a network call (attempting one would prove nothing
useful, since meetings and participants are simulated regardless of
whether the credentials are valid); in live, actually mint an OAuth token.

**Reference-only fields get an honest non-answer, not a fake test.**
Rather than stretch `testIntegrationAction`'s pattern to cover fields with
no API at all, `REFERENCE_ONLY` just hides the button — a "Test
connection" that always says the same thing regardless of what's typed
would be worse than no button.

### Bugs found — two real, both pre-existing and about Zoom specifically

**1. Clicking "Test connection" for Zoom always reported "This integration
stays in demo mode for this build" — false since C8 added real
Server-to-Server OAuth.** `testIntegrationAction` had a branch for every
other connector with credential fields (lsq, claude, apollo, apify,
linkedin) but none for zoom, so it fell through to the generic
not-implemented message. Fixed by adding a real branch, sandbox-aware like
LinkedIn's.

**2. The Zoom card's static copy ("No API — CSV import", "No API —
participants report imported as CSV") and the page's build note both
called Zoom API-less, contradicting C8's real Zoom integration and this
checkpoint's own test fix.** Pre-dates this checkpoint; likely never
updated when C8 landed because the Integrations page wasn't touched again
until now. Fixed the static card copy and the build note; also removed a
matching dead `EXPLANATION.zoom` string in `IntegrationPanel.tsx` that had
been unreachable since Zoom gained credential fields (its `explanatoryOnly`
branch, the only place that string could render, requires zero fields).

### Verification
- `GATE PASS` — `next typegen`, 145 tests / 15 files, `tsc` exit 0, `eslint` clean
- `VISUAL VERIFIED`, **0 console errors**:
  - all 7 cards render; activity mapping card loads 178 real LSQ activity
    types and shows real existing mappings (SMS/WhatsApp → "WebinarAgent
    Channel Trigger", Email/LinkedIn unmapped)
  - delivery settings shows all 5 rows including the new Zoom row, sandbox
    state correct throughout
  - opened the new SMS & WhatsApp Business panel: all 6 fields present, "No
    live API to test here" note shown, no Test button rendered
  - save/read round-trip for two of those fields verified directly against
    `saveIntegrationConfig`/`getIntegrationConfigMasked` (masked
    `hasValue: true` for the two written, `false` for the four untouched);
    test values removed from `AppSetting` afterward — no residue
  - Zoom "Test connection" clicked live: correctly reported sandbox status
    without a network call, result persisted and visible on reload
  - confirmed the Zoom test-result rows already sitting in `AppSetting` for
    lsq/claude/apollo (from earlier real sessions) are left alone — this
    checkpoint only adds to that record, never touches other integrations'
    saved credentials or history

**Status:** complete

## C13 — Hardening

**Date:** 2026-09-05
**Scope:** full audit against §5; a11y; motion; docs; the anti-hallucination checklist (§10).

This is the closing checkpoint — no new features, just verifying everything
built across C1–C12 actually holds together, and fixing what didn't.

### §5 audit
Zero unchecked rows remained except two real oversights: **WIZ-2** (Zoom link
existing/create new) and **WIZ-3** (auto-fill title/date/time from a picked
Zoom meeting) were built in C8 (`pickExistingZoom`, `selectZoomMeeting` in
`WizardClient.tsx`) but never checked off. Verified both are real and working,
then checked them off — a bookkeeping gap, not a missing feature.

### Test suite: 145 → 178 (target was ≥175)
New suites, all for pure logic with zero prior coverage:
- `lib/campaignDate.test.ts` (10 tests) — date formatting, datetime-local
  round-trip, legacy free-text date parsing (with the null-on-garbage case),
  reminder-offset math. The highest-value addition here: this logic was
  completely untested and a broken offset would silently mis-schedule
  reminder sends.
- Extended `lib/messageValidation.test.ts` (+8) — the channel-aware
  `validateRenderedMessageForChannel`/`validateTemplateContentForChannel`
  variants (WhatsApp's 1024-char cap, SMS delegation to `checkSmsBody`) had
  zero coverage; only the plain email/LinkedIn variants were tested.
- Extended `lib/channels.test.ts` (+3) — `isAutomatableChannel` untested.
- `lib/wizardValidation.test.ts` (+4, new) — extracted the wizard's step-1
  required-field check (`title`/`date`) out of `WizardClient.tsx`'s inline
  event handler into a pure, importable function, then tested it.
- `lib/appOrigin.test.ts` (+3), `lib/campaignRoutes.test.ts` (+6) — small,
  previously-untested pure modules.

**Deliberately not built**, and why: `lib/cadence.test.ts` and a dedicated
`lib/messageTemplates.test.ts` were on the original test-strategy list, but
every exported function in both files imports `@/lib/db` at module scope —
vitest has no `@/` alias, so importing *anything* from either file fails at
the top-level import, regardless of which function is pure underneath. The
codebase's established, consistent answer to this (every DB-touching module
back to `lib/postEvent.ts` in C10) is diagnostic scripts and browser/E2E
tests, not Prisma mocking — introducing mocking now, for two files, would be
a new pattern nowhere else in the project. Their actual behavior — template
resolution order, channel-derived automation — is exercised instead by
`scripts/diag-template-resolution.ts` (run this checkpoint: 16 campaigns, 0
unresolved) and `scripts/e2e-journey.ts` (see below). `addDays` and
`renderMergeFields` in `lib/cadence.ts` were considered for extraction like
`isAutomatableChannel` was, but both are single-file-local, trivial, and
already exercised by every real send — extracting them for two more tests
would be abstraction for its own sake. Similarly, `extraFieldsJson`'s "never
discard operator columns" logic lives entangled inside a large, already-
working, already browser-tested CSV import function in `lib/actions/setup.ts`
— cleanly isolating it risked destabilizing shipped code for marginal gain.

### `scripts/e2e-journey.ts` — three fixes, all in the audit script itself
Running it surfaced 3 failures. Investigated each before touching anything —
two turned out to be **stale assertions from before this app had real
multi-channel gating**, not app bugs:
1. **"No-email contact excluded at launch"** expected zero `CadenceSend` rows
   at all for a no-email contact. Real (correct) behavior: SMS/WhatsApp steps
   only need a phone number, so a no-email contact with a phone gets those
   steps queued — just not email-channel steps. Fixed the assertion to check
   email-channel steps specifically (`CadenceStep.channel contains 'Email'`).
2. **"Bob SMS skipped — no mobile number"** expected a `skipped` row to exist.
   Real behavior: `launchCadence`'s `textable` filter excludes a no-phone
   contact from SMS *at launch*, so no row is ever created — gating moved
   from send-time to launch-time at some point after this script was
   written. Fixed the assertion to check the row is absent, not `skipped`.
3. **"Alice sms delivered"** failed with `MXDuplicateEntryException: A Lead
   with same Phone Number already exists.` Reproduced directly against the
   real LeadSquared tenant — confirmed this is leftover fixture data: the
   same fixed phone number, reused every time this audit script runs over
   the project's history, has left a real duplicate lead in the tenant. Not
   something this app's code can or should work around. Added
   `MXDuplicateEntryException`/`already exists` to the script's own
   `ENV_BLOCKED` pattern, alongside the existing rate-limit/mail-delivery
   cases it already treats as tenant state, not a code failure.

Result: `=== E2E JOURNEY PASSED ===`.

### Design-token audit (checklist: "6 new tokens used, no new raw hex")
Found 3 raw `#0A66C2` (LinkedIn blue) literals introduced before this
checkpoint, in `IntegrationPanel.tsx`, `PersonalizeClient.tsx`, and
`demo-data.ts` — all replaced with `var(--brand-linkedin)`. The dashboard's
new registrations-over-time bar chart (C11) used `--accent-500`; switched
its bars to `--chart-1`, the token's exact stated purpose ("first chart
series") for the one genuine multi-point chart in the shipped design.

Tried, then reverted, using `--warning-wash` for the Agent-run activity
log's "Running" badge (C10) — its own code comment names exactly this case
("softer warning tint... for badges that mark an in-progress state"). A
screenshot showed why not: `--warning-100` (Attention) and `--warning-wash`
(Running) are both pale yellow, different only in saturation, and next to
each other in the same log they read as near-identical — exactly the
opposite of what a status system needs. Three *different hues* (green/
blue/yellow for Done/Running/Attention, the original C10 design) scan far
faster than two same-hue badges of different intensity. Reverted to
`--accent-50`/`--accent-700`. `--brand-linkedin-wash`, `--chart-2`, and
`--chart-3` were also considered — no natural, non-forced fit exists in the
shipped design (every integration avatar uses the same solid-circle
treatment regardless of connector; there is no second or third chart
series anywhere) — left unused rather than inventing UI just to use them.

### Bugs found — two, both pre-existing, both cross-cutting, both fixed
**1. Zoom's "Test connection" always said the integration was still in demo
mode**, false since C8 added real Server-to-Server OAuth — `testIntegration
Action` had a branch for every other connector with credential fields but
none for zoom. Fixed with a sandbox-aware branch mirroring LinkedIn's; also
fixed the Zoom card's stale "No API" copy and the page's build note, and
removed a dead `EXPLANATION.zoom` string that could never render (zoom has
credential fields, so its `explanatoryOnly` branch never executes). *(Filed
under C12 in the changelog, since it was found and fixed during that
checkpoint's own verification — noted here because the anti-hallucination
pass re-confirmed it.)*

**2. The campaign-status badge in the workspace header always read "Draft —
not yet launched," on every tab of every campaign, regardless of real
status** — `StageBadge.tsx` keyed off `usePathname()`'s last segment against
a lookup table (`stageBadges`) keyed by pre-C2B tab names. None of the
current routes matched, so it silently fell back to the `setup` value
always. Fixed to take `status`/`cadenceStatus` as props from `layout.tsx`.
*(Filed under C11, found and fixed there — re-confirmed here.)*

No new bugs surfaced during C13 itself beyond the e2e-journey script issues
above (which were script bugs, not app bugs) — everything else audited
clean on first check.

### Accessibility pass
Found and fixed 9 concrete gaps, all in already-shipped code (not introduced
this checkpoint), by grepping for `onClick` on a bare `<div>` wrapping only
an icon, and for `<input>` elements with no accessible name:
- 4 modal/panel close buttons (`Drawer.tsx`, `IntegrationPanel.tsx`,
  `PromptModal.tsx`, `LinkedInPanel.tsx`) were `<div onClick>` — unreachable
  by keyboard, unannounced by a screen reader. Converted to real `<button
  aria-label="Close">` with button-chrome reset (`border: none, background:
  transparent, padding: 0`) so the visual appearance is unchanged.
- The floating chat widget's open/close toggle and its in-conversation close
  and send controls (`ChatWidget.tsx`) — the "Global chat widget" feature
  from the user's original must-keep list — had the same issue. Fixed the
  same way (`aria-label="Open chat"/"Close chat"/"Send message"`).
- The Integrations credential form's `<input>` and the chat widget's message
  `<input>` had no label, relying only on placeholder text (which most
  screen readers don't reliably announce, and which disappears once
  something is typed). Added `aria-label`.

Not attempted: a full keyboard-navigation retrofit of every clickable `<div>`
in the app (funnel rows, pipeline tiles, breakdown-mode toggles, etc.) —
this is a pre-existing, systemic pattern across dozens of components going
back to C1, and rewriting the interaction model of the whole app under this
checkpoint's time budget would trade a contained, verified fix for a
sprawling, unverified one. The 9 fixes above target the highest-severity
class (an element with no visible-text fallback at all, where the a11y gap
is total rather than partial).

### Motion
Already handled, found on inspection: `app/globals.css` has a blanket
`@media (prefers-reduced-motion: reduce)` rule (pre-dating this revamp)
that zeroes every `animation-duration`/`transition-duration` and disables
the interactive-card hover transform globally. It requires no per-element
opt-in, so it already covers every animation added in C8–C13 without
change. Nothing to build here.

### Dead code removed
- `components/ui/Placeholder.tsx` — every checkpoint's placeholder has now
  been replaced with real content (confirmed: zero remaining imports across
  `app/`) — deleted rather than left as dead weight.
- Considered retiring the transitional `setup` tab (per the checkpoint's own
  acceptance note: "if fully superseded"). It is not: `CampaignDetailsForm`
  (incl. the must-keep "AI improve description" feature), `LeadImportCard`,
  `EnrichmentCard`, and `LinkedInPublishCard` all live there with no
  equivalent anywhere else — Overview's new About panel (C11) is read-only
  reporting, not an editing surface. Kept, deliberately.

### Other fixes made while auditing
- `lib/campaignCardStats.ts`'s `registered` count still had a comment
  saying "C8 makes `Contact.registeredAt` real and this function should
  then count that instead" — C8 had already landed, but the code was never
  updated. Switched from counting `LinkedinRegistration` (LinkedIn-only) to
  `Contact.registeredAt` (every source), matching what the comment itself
  said should happen.

### Verification
- `GATE PASS` — `next typegen`, **178 tests / 19 files**, `tsc` exit 0,
  `eslint` clean (0 errors, 0 warnings)
- `scripts/diag-template-resolution.ts` — 16 campaigns, 0 unresolved steps
- `scripts/e2e-journey.ts` — `=== E2E JOURNEY PASSED ===`
- `grep -rn "AUTOMATED_STEP_KEYS"` — 2 hits, both historical (a script
  comment, a legacy constant name inside a test file), no live allowlist
- `SEND_MODE=sandbox` confirmed in `.env.local` and visible on
  `/integrations`'s delivery-settings summary
- `VISUAL VERIFIED`, **0 console errors**, every top-level nav destination
  (`/`, `/dashboard`, `/templates`, `/integrations`, `/campaigns/new`) and
  every one of a real campaign's 7 workspace tabs, loaded fresh after every
  fix in this checkpoint
- Chat widget open → send → close cycle verified end-to-end via a real
  browser click sequence (not just a snapshot read); Overview's drill-down
  drawer and the Integrations connection panel's new close buttons each
  independently verified open→close

**Status:** complete

---

## Revamp complete

All 13 checkpoints (C1–C13) done. Every row in the §5 feature register is
checked. The anti-hallucination checklist (§10) is fully satisfied. The
branch `revamp/webinar-studio` is ready for review against `main`.

## Post-revamp verification pass — 2026-09-05

A full, real-interaction test pass across every route and feature, at the
user's request, after C13 closed. Not a new checkpoint — no features added —
but it found one real, previously-undetected bug in a core, must-keep flow.

### What was tested (real interactions, not just page loads)
- Full regression gate, `scripts/e2e-journey.ts`, `scripts/diag-template-
  resolution.ts`, `scripts/deep-audit-db.ts` — all clean
- Home page: view-tab filtering, kebab menu Archive/Delete (incl. confirm
  dialog), campaign deletion verified in DB
- Dashboard: range switching (30d/all)
- Templates: opened an editor, edited a body, saved, verified the DB write,
  used "Revert to saved", restored the original content
- **A full campaign creation end to end**: wizard steps 1–3 (details → CSV
  import of a real 24-row fixture → real Apollo enrichment + real Claude
  scoring → messaging config → finish), landing on Overview with correct
  live numbers, then Cadence planner → **Launch cadence** (real confirm
  dialog → real queueing: "30 send(s) queued across 6 step(s) for 7
  approved contact(s)"), then deleted the test campaign to clean up
- Audience tab: score-band filter
- Messaging tab: real Claude-generated personalization for 7 contacts
  (verified in DB, then discarded)
- Cadence planner: LinkedIn assisted-send queue panel
- Post-event: real attendance CSV upload (3 attended / 4 no-show), verified
  stats and account-engagement table, then reverted
- Integrations, Agent run, chat widget: spot-checked, all still correct

### Bug found and fixed: one-click registration link crashed with a 500
Clicking a real one-click registration link (`/r/[token]`) threw
`TypeError: Invalid URL` and returned HTTP 500 whenever the campaign's
`registrationLink`/`zoomLink` was in this app's own normal short-link
display format — a bare, scheme-less string like `lsq.co/w/my-webinar`.
`NextResponse.redirect()` requires a real absolute URL and throws on
anything else. This isn't an edge case: **15 of 16 campaigns in the
dataset** store their registration link exactly this way (it's the
default format the app itself generates and displays everywhere else as
plain text), so any real contact clicking their real invite link would
have hit this in production. Confirmed the registration side effect itself
(`registerContact()`) ran correctly before the crash — only the final
redirect was broken.

**Fix:** `ensureAbsoluteUrl()` in `lib/registration.ts` prefixes `https://`
onto the join URL only when it has no scheme already, used at the one
place (`app/r/[token]/route.ts`) such a link is ever actually navigated to
— the stored/displayed value itself is untouched, since a bare short link
is exactly right as plain text in a message body. Added 3 unit tests
(bare link, already-absolute http(s), a non-http scheme like
`zoommtg://`). Verified live: the redirect now issues an HTTP 307 instead
of crashing (confirmed in the server log and by a real browser follow —
which then hit `ERR_CONNECTION_TIMED_OUT` on the placeholder `lsq.co`
domain itself, an unrelated, expected consequence of test/demo data
pointing at a non-resolving host, not an app defect).

### Verification
- `GATE PASS` — `next typegen`, **181 tests / 19 files**, `tsc` exit 0,
  `eslint` clean
- All test-created data (draft personalizations, attendance import, a
  temporary campaign, a temporary edit) reverted or deleted afterward —
  `dev.db` row counts for `Campaign`/`Contact`/`PersonalizedMessage`/
  `CadenceSend` diffed against a pre-pass backup and confirmed to match
  exactly
- Dev server restarted clean; screenshots taken of the webinars list,
  dashboard, a campaign Overview tab, Integrations (all 7 cards), and
  Agent run — all rendering correctly with no visual regressions

## Setup tab: fetch Zoom event details directly — 2026-09-05

Requested after the verification pass above: the wizard's "browse your Zoom
account and pick a meeting" capability only existed at campaign-creation
time. A campaign created by pasting a link by hand, or one that needs to be
re-pointed at a different Zoom meeting later, had no way back to that
picker — Setup only ever offered a plain paste field.

### What changed
- **`lib/actions/zoom.ts`** (new) — `listZoomMeetingsAction`,
  `linkZoomMeetingAction`, `createZoomMeetingAction`, and a new
  `unlinkZoomMeetingAction`, extracted from `lib/actions/wizard.ts` (which
  had near-identical, wizard-named versions) so both the wizard and Setup
  call the same code. `createZoomMeetingAction` now reads the campaign's
  *current* title/date/description from the DB instead of requiring a full
  `WizardDetails` object — by the time either caller reaches it, that data
  is already saved, so this is a behavior-preserving simplification, not
  just a move.
- **`lib/actions/wizard.ts`, `app/campaigns/new/WizardClient.tsx`** — updated
  to import the relocated actions; wizard behavior unchanged (reverified
  live: browse → pick → "Pulled from Zoom" confirmation → Continue → real
  campaign created with `zoomMeetingId` set, exactly as before).
- **`app/campaigns/[id]/setup/CampaignDetailsForm.tsx`** — added "Fetch from
  Zoom" (browse upcoming meetings, pick one) and "Create Zoom meeting"
  (create one from the webinar's current title/date/description) next to
  the existing manual paste field. Picking or creating a meeting updates
  name, date/time, and the join link in the form immediately — not just in
  the DB — since the component already owns that local state. A linked
  campaign shows a "Linked to Zoom" / "Created on Zoom" badge instead of the
  generic "Zoom link recognised" one, plus "Fetch a different event" and
  "Unlink" (detaches Zoom's own tracking while keeping the join link itself
  as a plain value — for un-linking before deleting that Zoom meeting
  without breaking links already sent).

### Design
**No extra gating on when this can be used.** Linking a new Zoom meeting on
a campaign whose cadence has already launched updates name/date exactly
like every other Setup field already does (`updateCampaignSchedule` has
never special-cased a live campaign either) — consistent with this app's
existing convention that Setup edits are never blocked, and the operator
uses the Cadence planner's per-step "Edit timing" afterward if a date
change needs to ripple into already-queued sends.

**Unlink keeps the join link, only drops the tracking.** Detaching
`zoomMeetingId`/`zoomMode` without touching `zoomLink` means contacts who
already received that link keep a working one; only the "this campaign is
tracking a specific Zoom meeting" relationship goes away.

### Verification
- `GATE PASS` — `next typegen`, 181 tests, `tsc` exit 0, `eslint` clean
- `VISUAL VERIFIED`, 0 console errors: browsed sandbox-fixture meetings on
  an unlinked campaign, picked one — name/date/link updated in the form and
  confirmed in the DB (`zoomMeetingId`, `zoomMode: 'existing'`); unlinked —
  confirmed cleared in DB, join link retained; created a new meeting on a
  different unlinked campaign — confirmed in DB (`zoomMode: 'new'`); wizard's
  own existing-meeting flow re-tested end to end (browse → pick → Continue
  → real campaign created with the link applied) to confirm the shared-code
  move didn't change its behavior
- All test campaigns/state reverted — full `Campaign`/`Contact` table diff
  against a pre-test backup confirmed exact match afterward

## Setup: read-only overview + gated edit, once there's real audience data — 2026-09-05

Requested behavior change: once a campaign has real work behind it, Setup's
always-editable form was too easy to change by accident, with no signal that
the topic/date/Zoom event feed scoring, personalized copy and cadence
timing. Confirmed scope with the user before touching anything, since
"resets everything" could have meant deleting contacts outright — it
doesn't.

### What changed
- **`lib/actions/setup.ts`** — added `getSetupEditImpactAction` (counts
  scored/approved contacts, personalized drafts, and cadence sends) and
  `resetCampaignForEditAction`, which clears `Contact.score`/`explanation`/
  `approved`/`approvedManually`, deletes all `PersonalizedMessage` and
  `CadenceSend` rows, and resets `Campaign.cadenceStatus` to `not_started`
  (`simulatedNow` cleared too) — **the imported contact list itself
  (name/email/company/title/enrichment/...) is never touched.**
- **`CampaignDetailsOverview.tsx`** (new) — read-only summary of topic, Zoom
  event, date, description and registration link, with an "Edit details"
  button.
- **`WebinarDetailsCard.tsx`** (new) — the actual gate: renders the overview
  by default once the campaign has any imported contacts, or the existing
  editable form directly if it doesn't (an empty draft has nothing that
  could go stale, so it stays frictionless). "Edit details" opens a
  confirmation dialog naming the *real* counts about to be cleared — or, if
  nothing has been scored/personalized/sent yet, says plainly that there's
  nothing to lose. Confirming runs the reset and switches to the form.
- **`CampaignDetailsForm.tsx`** — added an optional `onDone` prop; when
  present (i.e. reachable from the overview), a "Done editing" button
  returns to the read-only view without a page reload. A campaign with no
  contacts still gets the form with no `onDone` at all, since there's no
  overview to return to.

### Design
**No confirmation theater when there's nothing at stake.** The dialog reads
real counts, not a boilerplate warning — a campaign that's been imported but
never scored gets "nothing to lose," not a scary generic message, so the
warning stays trustworthy on the times it does list real consequences.

**"Overview" is the resting state, not sticky state.** Which view opens is
decided fresh on every page load (`hasAudience` from the current contact
count) rather than persisted anywhere — after a reset-and-edit-and-done
cycle, reloading the tab shows the overview again, exactly like "once setup
is done, it shows an overview" implies. There's deliberately no separate
"is this campaign locked" flag to keep in sync.

### Verification
- `GATE PASS` — `next typegen`, 181 tests, `tsc` exit 0, `eslint` clean
- `VISUAL VERIFIED`, 0 console errors, on a real campaign with 24 scored
  contacts (7 approved) and 30 cadence sends:
  - overview renders correctly; clicking Edit shows the dialog with the
    exact real counts ("24 scored contacts (7 approved), 30 queued or sent
    cadence steps")
  - Cancel: DB unchanged (re-verified by direct query)
  - Confirm: DB verified directly — scores/approvals cleared on all 24
    contacts, all 30 `CadenceSend` rows deleted, `cadenceStatus` back to
    `not_started` — while contact identity fields (name, email, account,
    `enrichedAt`) were untouched; form appeared with "Done editing"; clicking
    it returned to the overview in the same session
  - a contact-less campaign (`c3`) confirmed to show the plain editable form
    directly, no gate
  - test campaign's scores/approvals/cadence sends restored from a pre-test
    backup afterward, verified identical via direct diff; also found and
    removed 3 leftover test-artifact `ActivityLogEntry` rows from an earlier
    verification pass that had gone unnoticed until they showed up in this
    campaign's real activity log on screen

## Zoom connection gate, and simplifying the Cadence planner — 2026-09-05

Two requested changes, both scoped precisely before touching code.

### Zoom fetch now refuses outright unless really connected
`listUpcomingMeetings()`/`createMeeting()` previously fell back to fixture
data whenever Zoom wasn't configured *or* was in sandbox mode — reasonable
for the wizard's original design ("exercisable without credentials"), but
wrong for a feature whose whole point is pulling a *real* event's details:
picking "Weekly product demo" from a fake list and having it silently link
to a fake meeting is worse than an error.

- **`lib/zoom/client.ts`** — added `zoomConnectionError()`: `null` when
  genuinely connected (real credentials saved *and* `ZOOM_MODE=live`),
  otherwise a specific message naming exactly what's missing.
- **`lib/actions/zoom.ts`** — `listZoomMeetingsAction`, `linkZoomMeetingAction`
  and `createZoomMeetingAction` all check this first and refuse before doing
  anything, rather than falling through to a fixture or a generic failure.
  `listZoomMeetingsAction`'s return type changed from a bare array to
  `{ok, meetings} | {ok: false, error}` so "not connected" and "connected,
  zero upcoming meetings" are distinguishable messages, not the same empty
  list. `unlinkZoomMeetingAction` is untouched — it never calls Zoom.
- **`CampaignDetailsForm.tsx`, `WizardClient.tsx`** — updated to the new
  return shape; both surfaces (Setup and the creation wizard) now show the
  same specific error.

### Cadence planner: removed Channel mix, Scheduling configuration, Bot-led sign-up
All three were genuinely redundant or purely informational, confirmed
before removing anything:
- **Channel mix** bulk-toggled a whole channel's steps at once, but
  `CadenceGroups.tsx` already has a per-step enable checkbox using the same
  `toggleCadenceStepAction` — removing the bulk card loses no capability,
  only the "toggle all of a channel in one click" shortcut. Deleted
  `ChannelMixCard.tsx` and `lib/actions/channels.ts` (only used by that card).
- **Bot-led sign-up** was a static, non-interactive info block (no toggle,
  no server action, no schema field of its own) — just explanatory text and
  an example link. Deleted the block from `page.tsx` with zero functional
  change; one-click registration itself is unaffected (its real toggle,
  `Campaign.oneClickSignup`, lives in the wizard, untouched).
- **Scheduling configuration** (send window, cadence preset, daily send
  limit) — asked the user directly before touching this one, since "Daily
  send limit" was on the original must-keep list from earlier in this
  project. Confirmed: remove all of it. Deleted `ScheduleConfig.tsx` and
  `updateScheduleConfigAction` (the one export in `lib/actions/schedule.ts`
  used only by that card — every other export there is used by
  `CadenceGroups`/`LaunchCadenceCard` and was left alone). All three
  settings freeze at each campaign's existing stored value; the backend
  enforcement (`isWithinSendWindow`, the daily-limit check in
  `processDueSends`, nudge/final-call offsets) is untouched and keeps
  running exactly as before — there's just no UI left to change any of them
  per campaign.

### Verification
- `GATE PASS` — `next typegen`, 181 tests, `tsc` exit 0, `eslint` clean
- `VISUAL VERIFIED`, 0 console errors: cadence planner confirmed to open
  directly on the step schedule with no Channel mix / Scheduling
  configuration / Bot-led sign-up sections, `CadenceGroups`/`LinkedInPanel`/
  `LaunchCadenceCard` all rendering and unaffected
- Zoom gate tested live in both Setup (`c3`, unconnected) and the creation
  wizard's "Use existing event"/"Create new event" — both correctly show
  "Zoom isn't connected — add your Server-to-Server OAuth credentials on
  Integrations → Zoom." and neither writes anything to the DB (confirmed by
  direct query) when blocked

## Zoom: real Marketplace OAuth, two-way background sync, automatic attendance — 2026-09-05

The user asked for Zoom to connect "the way the LeadSquared listing on the
Zoom Marketplace does," for connection two-way sync (app → Zoom on create,
Zoom → app on fetch) to run automatically once connected, for attendance
import to be fully automatic with **no manual UI at all**, and for the
connection itself to live on the Integrations page. Researched Zoom's real
OAuth docs (`developers.zoom.us`) rather than guessing: confirmed a
"User-managed OAuth app" — the actual app type behind real published
Marketplace integrations — is a standard three-legged OAuth 2.0 flow, not
the account-level Server-to-Server credentials this project had built
earlier. Rebuilt Zoom's connection on that basis, mirroring this codebase's
own already-working LinkedIn OAuth implementation exactly rather than
inventing a new pattern.

### Connection: Server-to-Server OAuth → three-legged Marketplace OAuth
- **`lib/zoom/auth.ts`** (new) — `buildAuthorizationUrl`, `exchangeCodeForToken`,
  `refreshAccessToken`, `fetchConnectedUser`. Real endpoints
  (`zoom.us/oauth/authorize`, `zoom.us/oauth/token`), real scopes
  (`meeting:read`, `meeting:write`, `report:read`, `user:read`).
- **`app/api/auth/zoom/connect/route.ts`**, **`.../callback/route.ts`** (new)
  — same shape as the existing LinkedIn connect/callback routes: HttpOnly
  CSRF-state cookie, Basic-auth token exchange, connected account's email
  fetched and stored for display.
- **`lib/zoom/client.ts`** — rewritten. Removed `ZoomCredentials`,
  `credentials()`, `fetchZoomToken()` (the old S2S plumbing) entirely.
  Added `storedAccessToken()`/`storedRefreshCredentials()`,
  `tryRefreshAccessToken()` (rotates the refresh token on save, same as
  LinkedIn), and `zoomRequest()` (retry-once-on-401 wrapper). `zoomIsConfigured()`
  now means "an access token is on file," not "an account ID is on file."
  `zoomConnectionError()` keeps its role from the previous checkpoint but
  its unconnected message now points at the new flow: `Zoom isn't
  connected — click "Connect with Zoom" on Integrations → Zoom.`
- **`lib/integrationFields.ts`** — Zoom's field list swapped: dropped
  `accountId`; added `accessToken`, `refreshToken`, `connectedEmail`,
  `tokenExpiresAt` (all optional, auto-filled by the connect flow, not
  hand-typed). `clientId`/`clientSecret` remain — those two are the
  Marketplace *app's* credentials (created once in the Zoom Marketplace
  developer console), not a per-connection secret.
- **`lib/integrationConfig.ts`** — removed Zoom's 3 lines from
  `envFallback()`, matching LinkedIn's existing pattern: OAuth tokens are
  DB-only state from a live handshake, never something to source from an
  env var.
- **`lib/actions/integrations.ts`** — Zoom's `testIntegrationAction` branch
  now calls the real `GET /v2/users/me` with the stored access token
  (mirroring LinkedIn's test branch) instead of exercising the old
  S2S token endpoint.
- **`app/integrations/IntegrationPanel.tsx`** — the manual credential-entry
  explainer replaced with a single "Connect with Zoom" button
  (`/api/auth/zoom/connect`), matching LinkedIn's card.
- **`.env.example`** — `ZOOM_ACCOUNT_ID` removed, `ZOOM_REDIRECT_URI` added,
  plus a commented-out `ZOOM_AUTOSYNC`/`ZOOM_AUTOSYNC_SECONDS` block (see
  below), styled the same as the existing `CADENCE_AUTOTICK` block.

### Two-way sync, fully automatic, off by default
**`lib/zoomAutosync.ts`** (new) — a background loop with the same shape as
the existing `lib/cadenceAutotick.ts`, wired into `instrumentation.ts` behind
its own env var (`ZOOM_AUTOSYNC`), so a fresh clone never starts making real
Zoom API calls on its own. Three independent jobs per tick, each guarded so
one failing doesn't block the others, and the whole tick is a no-op unless
Zoom is both connected and `ZOOM_MODE=live`:
1. **App → Zoom**: any non-archived campaign with a future date and no
   linked meeting gets one created via `createMeeting()`.
2. **Zoom → App**: any meeting on the connected account with no matching
   campaign (deduped by `zoomMeetingId`) becomes a new draft campaign,
   provisioned the same way the wizard provisions one, with an
   `ActivityLogEntry` noting where it came from.
3. **Attendance**: any campaign linked to a meeting, not yet imported, whose
   webinar started 2+ hours ago (reusing the existing "Attendee/No-show
   follow-up" post-webinar buffer convention) gets `importAttendanceFromZoom()`
   called on it automatically.

### Post-event: attendance import removed from the UI entirely
Per explicit instruction ("i don't want that in the ui"), not just hidden
behind a flag:
- Deleted **`app/campaigns/[id]/agent/ZoomPanel.tsx`** (the "Pull attendance
  from Zoom" / "Upload attendance report (.csv)" buttons) and, from
  **`lib/attendance.ts`**, `importAttendanceCsv()` — the CSV path is gone,
  not just unreached; Zoom's reporting API is the only source of attendance
  now. Removed `importAttendanceAction`/`importAttendanceFromZoomAction`
  from **`lib/actions/attendance.ts`**, leaving only `pushAccountsForSdrAction`
  (still a real manual action, unrelated to attendance import).
- **`app/campaigns/[id]/post-event/page.tsx`** — replaced the panel with a
  read-only 3-state status card: imported (with timestamp), linked-but-
  pending, or not-linked — so the operator can see what's happening without
  a button to press.

### Verification
- `GATE PASS` — `next typegen`, `tsc --noEmit`, 181 tests, `eslint`, all clean
- Live-triggered `/api/auth/zoom/connect` with syntactically-valid test
  credentials (written directly to `AppSetting` via SQL, not through the UI)
  and confirmed Zoom's own server accepted the redirect: real sign-in page,
  correctly encoded `client_id`, `redirect_uri`, `response_type=code`,
  `state=<uuid>`, `scope=meeting:read%20meeting:write%20report:read%20user:read`
- `VISUAL VERIFIED` via direct page fetch, all three Post-event status-card
  branches, against real data: `c1` (`attendanceImportedAt` set) → "Imported
  automatically ... — attendee and no-show follow-ups were queued";
  `cmtaiw5yk0000y9ufpx40rrad` (`zoomMeetingId` set, no import yet) → "Not
  imported yet — this campaign is linked to a Zoom meeting..."; `c2` (no
  Zoom meeting) → "No Zoom meeting linked to this campaign..."
- Grepped the whole tree (including `scripts/`) for every removed symbol —
  `ZOOM_ACCOUNT_ID`, `fetchZoomToken`, `ZoomCredentials`, `ChannelMixCard`,
  `ScheduleConfig`, `ZoomPanel`, `importAttendanceCsv`,
  `importAttendanceAction`/`importAttendanceFromZoomAction` — zero remaining
  references
- `dev.db` diffed byte-for-byte (`sqlite3 .dump`) against the pre-session
  backup: identical. No stray `AppSetting` rows, no test campaigns created
  by `zoomAutosync` logic (never triggered live — `ZOOM_AUTOSYNC` was never
  set during testing)
