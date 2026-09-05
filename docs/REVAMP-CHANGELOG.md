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
