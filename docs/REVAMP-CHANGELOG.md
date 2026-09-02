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
