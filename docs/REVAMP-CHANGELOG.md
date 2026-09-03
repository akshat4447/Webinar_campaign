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
