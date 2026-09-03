# Webinar Studio Revamp — Master Plan

**Status:** in progress · **Baseline commit:** `accb563` · **Started:** 2026-09-03

> **This document is the single source of truth for the revamp.**
> It exists so that work can be resumed after any interruption or context loss
> without re-deriving decisions or dropping features. Every companion decision
> is recorded here; every completed change is recorded in
> [`REVAMP-CHANGELOG.md`](./REVAMP-CHANGELOG.md).

---

## 0. How to resume work on this

If you are picking this up cold, do these four things in order:

1. Read §1 (mandate) and §2 (ground rules).
2. Read `REVAMP-CHANGELOG.md` bottom-to-top to see what is already done.
3. Find the first checkpoint in §7 whose box is unchecked — that is the next task.
4. Run the regression gate in §2.4 before writing any code, to confirm the tree is green.

**Never** mark a checkpoint done without: its acceptance criteria met, the
regression gate green, and a changelog entry written.

---

## 1. The mandate

Rebuild the app's UI and IA to match the attached standalone prototype
(`Webinar Campaign Prototype (standalone).html`), **while retaining every
existing capability.** The prototype is a visual and IA target, not a feature
scope. Anything the prototype omits that exists today is *relocated*, never
deleted.

Three governing facts established during analysis:

- **F1 — The prototype uses the app's existing design system.** 17/17 core
  colours are already in `styles/tokens/colors.css`; same Mulish, same card
  shadow, same radius family. Only 6 new colour values are needed. The visual
  work is layout and IA, not a re-theme.
- **F2 — The cadence engine blocks the prototype's headline feature.**
  `lib/cadence.ts:45` queues only steps in the hardcoded `AUTOMATED_STEP_KEYS`
  allowlist; `lib/cadence.ts:250` resolves copy by `campaignId_key`. User-added
  planner steps would render but never send. Must be fixed before planner UI.
- **F3 — Registration is not currently a first-class state.** It exists only
  for LinkedIn Lead Sync arrivals. The prototype's entire funnel vocabulary
  (registered / invited / attended / capacity) depends on making it one.

---

## 2. Ground rules

### 2.1 Next.js
This project's Next.js **diverges from model training data**. Per `AGENTS.md`,
read the relevant guide in `node_modules/next/dist/docs/` **before** writing or
changing any route, layout, page, server action or API handler. Do not assume
App Router conventions from memory.

### 2.2 Safety
- `SEND_MODE=sandbox` for the entire revamp. Flipping to live is a separate,
  deliberate decision made only after C13.
- Never weaken a send guard to make a UI flow work. If a guard blocks a new
  path, the new path is wrong.
- Every failure lands as a `CadenceSend.error` + `AttentionItem`, never a
  thrown 500. This is what makes the Agent run tab meaningful.

### 2.3 Styling
- Use existing tokens in `styles/tokens/`. Add new tokens rather than literals.
- Keep the inline-style + `lsq-*` utility-class pattern already in use.
  Do not introduce Tailwind, CSS modules or a component library.
- Pseudo-classes (`:hover`, `:focus-visible`, `:active`) must go in
  `globals.css` — inline styles cannot express them.

### 2.4 Regression gate
Run before marking any checkpoint complete:

```bash
npx next typegen && npm run test && npx tsc --noEmit && npm run lint
```

**`next typegen` is not optional.** This Next.js generates the global
`PageProps<'/route'>` / `LayoutProps<'/route'>` helpers and `next-env.d.ts`
from the `app/` directory tree. Adding, renaming or removing a route changes
those types, so `tsc --noEmit` run on a stale generation will either pass
wrongly or fail on routes that are in fact correct. `next dev` and `next build`
also regenerate, but `typegen` is the cheap way to do it in a check.

Plus, for checkpoints touching send/cadence/registration logic:

```bash
npx tsx scripts/e2e-journey.ts && npx tsx scripts/deep-audit-db.ts
```

**Baseline to beat:** 112 tests passing across 12 files, clean `tsc`, clean lint.

### 2.5 Routing conventions in this Next.js
Confirmed against `node_modules/next/dist/docs/` during C1:

- `params` and `searchParams` are **Promises** on both pages and layouts.
  Always `await` them. Synchronous access is deprecated.
- Type routes with the **global** helpers `PageProps<'/literal/[route]'>` and
  `LayoutProps<'/literal'>`. They are generated, not imported. Using a literal
  route string gives strict `params` keys and autocomplete; static routes
  resolve `params` to `{}`.
- Root layout is required and must render `html` and `body`.
- A `page` file is what makes a segment publicly accessible; it is always the
  leaf of its subtree, wrapped by `loading`, `error`, `template`, `layout`.
- `searchParams` is a request-time API and opts a page into dynamic rendering.
  It is a plain object, not `URLSearchParams`.
- Route handlers live in `route.ts` and are the right shape for `/r/[token]`.

---

## 3. Settled decisions

| # | Decision | Resolution | Consequence |
|---|---|---|---|
| D1 | WhatsApp / SMS delivery path | **Keep LeadSquared.** Surface compliance metadata only. | No BSP integration. `lib/channelDelivery.ts` untouched. Meta status / DLT ID / sender ID become template fields. |
| D2 | Control Center | **Fold into Agent run tab.** | Nothing in `lib/actions/control.ts` discarded. |
| D3 | User profile chip | **Dropped.** | No `User` model, no auth, no sessions, no ownership checks. |
| D4 | Feature scope | **Keep everything.** All 18 originally-cut features retained and given a home in the new UI. | Register in §5 is exhaustive and binding. |
| D5 | Chat widget | **Keep.** | Floating, does not collide with the new shell. Per-campaign history already persisted. |

---

## 4. Prototype visual specification

Extracted from the prototype so it survives loss of the source file.

### 4.1 New tokens required
| Token | Value | Use |
|---|---|---|
| `--brand-linkedin` | `#0A66C2` | LinkedIn channel icon, assisted badges |
| `--brand-linkedin-wash` | `#e8f0fe` | LinkedIn icon tile background |
| `--chart-1` | `#0040DF` | First chart series |
| `--chart-2` | `#411EED` | Second chart series |
| `--chart-3` | `#5F3FFF` | Third chart series |
| `--warning-wash` | `#fff7db` | Softer warning tint (badges, running state) |

### 4.2 Layout
- Sidebar: `216px` fixed, `#fff`, `border-right: 1px solid #eff2f5`, `padding: 22px 14px`, sticky full height.
- Main: `max-width: 1080px`, centred, `padding: 32px`. Wizard uses `760px`.
- Page title: `22px / 800 / -0.01em`; subtitle `13px` `--n60`, `margin-top: 3px`.

### 4.3 Components
| Element | Spec |
|---|---|
| Card | `#fff`, radius `12px`, `box-shadow: 0 1px 2px rgba(24,24,24,.04)`, padding `20px` (panels `18px 20px`, stat tiles `16px 18px`) |
| Stat tile | label `11px/700` `--n50` uppercase `ls .04em`; value `24px/800` `mt 8px` `ls -.02em` |
| Stat grid | `repeat(auto-fit, minmax(150px, 1fr))`, gap `14px` |
| Card grid | `repeat(auto-fill, minmax(320px, 1fr))`, gap `16px` |
| Status badge | inline-flex, `h22`, `padding 0 10px`, radius `999px`, `11px/700`, leading `6px` dot |
| Filter pill | `padding 7px 14px`, radius `8px`, `13px/600`; active `--accent-50` / `--accent-700` |
| Nav item | `padding 9px 12px`, radius `8px`, `13px/600`; active `--accent-50` / `--accent-700` |
| Button primary | `h40`, `padding 0 16px`, `--accent-500`, `#fff`, radius `8px`, `14px/700` (sm: `h36`/`h34`/`h30`) |
| Button secondary | `#fff` + `inset 0 0 0 1px --n30`, colour `--n60` |
| Input | no border, radius `6px`, `inset 0 0 0 1px --n30`, `padding 9px 12px`, `13px` |
| Select | `h36`, radius `6px`, `inset 1px --n30`, `padding 0 12px` |
| Field label | `11px/700` `--n60`, `margin-bottom 6px` |
| Tab | `padding 10px 14px`, `13px/700`; active `--accent-500` + `2px` bottom border; inactive `--n50` |
| Toggle | `34×20`, radius `999px`, dot `14px`; on `--accent-500` dot `left 17px`; off `--n40` dot `left 3px` |
| Table header | `10–11px/700` `--n50` uppercase `ls .03em`, `padding 10px 20px`, `--n10` ground |
| Table row | `padding 12px 20px`, `border-bottom 1px --n20`, `13px` |
| Progress bar | `h8`, `--n20` ground, radius `999px`, coloured inner fill |
| Toast | fixed `bottom 22px`, centred, `--n90` ground, `#fff`, `padding 10px 18px`, radius `6px`, `13px/600`, `toastIn 180ms cubic-bezier(.2,0,.2,1)` |
| Info callout | `--accent-50` ground, radius `8px`, `padding 10–12px`, `✦`/`✓` glyph + `11–12px` `--accent-700` text |
| Channel icon tile | `34×34`, radius `8px` — Email `--accent-50`/`--accent-700` `@` · LinkedIn `#e8f0fe`/`#0A66C2` `in` · WhatsApp `--success-100`/`--success-700` `W` · SMS `--warning-100`/`--warning-700` `#` |
| Avatar | `28–30px` circle, `--accent-50`/`--accent-700`, `11px/800` initials |
| Variable chip | `11px` mono, `--n10` ground, radius `6px`, `padding 4px 9px` |
| Wizard progress | flex, gap `6px`, `h4`, radius `999px`; done `--accent-500`, pending `--n20` |

### 4.4 Information architecture
```
/                       Webinars list      (KPIs · filters · cards)
/dashboard              Cross-campaign     (ranges · KPIs · trend · persona · learnings)
/templates              Global library     (channel tabs · list · editor)
/integrations           7 integration cards
/campaigns/new          4-step wizard
/campaigns/[id]/overview     tab 1
/campaigns/[id]/audience     tab 2
/campaigns/[id]/messaging    tab 3
/campaigns/[id]/cadence      tab 4
/campaigns/[id]/agent        tab 5   ← Control Center folds in here
/campaigns/[id]/post-event   tab 6
/r/[token]                   one-click sign-up (public)
```

---

## 5. Feature register — exhaustive and binding

Action codes: **KEEP** = survives, restyle only · **MOVE** = same capability,
new home · **NEW** = build from scratch · **RESTORE** = exists, prototype omits
it, must be reinstated.

### 5.1 Shell & navigation
| ID | Feature | Target home | Action | CP | Done |
|---|---|---|---|---|---|
| NAV-1 | Sidebar, 216px, 3 nav items | `components/Sidebar.tsx` | MOVE | C2 | [x] |
| NAV-2 | "AGENT ONLINE" live block + campaign counts | sidebar, below nav | RESTORE | C2 | [x] |
| NAV-3 | "Built on LeadSquared" logo lockup | sidebar footer | RESTORE | C2 | [x] |
| NAV-4 | Integrations nav pinned to bottom | sidebar | MOVE | C2 | [x] |
| NAV-5 | Global chat widget + per-campaign history | floating, all routes | KEEP | C2 | [x] |
| NAV-6 | 6-tab campaign workspace | `campaigns/[id]/layout.tsx` | MOVE | C2B | [x] |
| NAV-7 | Toast notification system | new shared component | NEW | C2 | [x] |
| NAV-8 | User profile chip | — | **DROPPED (D3)** | — | n/a |

### 5.2 Webinars list
| ID | Feature | Target home | Action | CP | Done |
|---|---|---|---|---|---|
| LST-1 | Campaign cards, 3 stats, 2 CTAs | `app/page.tsx` | MOVE | C2 | [x] |
| LST-2 | 4-KPI summary row | `app/page.tsx` | NEW | C2 | [x] |
| LST-3 | All / Upcoming / Completed / Drafts filters | `app/page.tsx` | MOVE | C2 | [x] |
| LST-4 | Archived view | filter option | KEEP | C2 | [x] |
| LST-5 | Archive · Unarchive · Delete kebab menu | card corner | RESTORE | C2 | [x] |
| LST-6 | Cadence deep-link CTA | card | NEW | C2 | [x] |
| LST-7 | Approval-rate-by-persona panel | → `/dashboard` | MOVE | C11 | [ ] |

### 5.3 Creation wizard
| ID | Feature | Target home | Action | CP | Done |
|---|---|---|---|---|---|
| WIZ-1 | 4-step flow + per-step validation | `app/campaigns/new/` | NEW | C6 | [ ] |
| WIZ-2 | Zoom: link existing vs create new | step 0 | NEW | C8 | [ ] |
| WIZ-3 | Auto-fill title/date/time from Zoom event | step 0 | NEW | C8 | [ ] |
| WIZ-4 | Name, description, date/time picker | step 0 | KEEP | C6 | [ ] |
| WIZ-5 | AI "improve description" | step 0, inline button | RESTORE | C6 | [ ] |
| WIZ-6 | Speaker + speaker title | step 0 | NEW | C6 | [ ] |
| WIZ-7 | Capacity | step 0 | NEW | C6 | [ ] |
| WIZ-8 | Zoom link + registration link fields | step 0 (advanced) | KEEP | C6 | [ ] |
| WIZ-9 | CSV upload vs LSQ list import | step 1 | KEEP | C6 | [ ] |
| WIZ-10 | AI CSV column → LSQ field mapping | step 1, after upload | RESTORE | C6 | [ ] |
| WIZ-11 | CSV preflight → validation gap panel | step 1 | MOVE | C6 | [ ] |
| WIZ-12 | `extraFieldsJson` — retain all operator columns | step 1, silent | RESTORE | C6 | [ ] |
| WIZ-13 | Apollo enrichment toggle | step 2 | MOVE | C6 | [ ] |
| WIZ-14 | Editable scoring prompt / criteria / threshold | step 2, collapsible | RESTORE | C6 | [ ] |
| WIZ-15 | Score preview table (top 6) | step 2 | NEW | C6 | [ ] |
| WIZ-16 | Templatized vs AI-personalized mode | step 3 | NEW | C6 | [ ] |
| WIZ-17 | Tone / length / AI instructions | step 3 | MOVE | C6 | [ ] |
| WIZ-18 | Message brief textarea | step 3 | NEW | C6 | [ ] |
| WIZ-19 | One-click sign-up toggle | step 3 | NEW | C6 | [ ] |
| WIZ-20 | Channel toggles + cadence descriptions | step 3 | MOVE | C6 | [ ] |

### 5.4 Audience
| ID | Feature | Target home | Action | CP | Done |
|---|---|---|---|---|---|
| AUD-1 | 4 summary stat cards | Audience tab | MOVE | C7 | [ ] |
| AUD-2 | Score distribution stacked bar + legend | Audience tab | NEW | C7 | [ ] |
| AUD-3 | Server-side search | Audience tab | NEW | C7 | [ ] |
| AUD-4 | Score-band filters | Audience tab | NEW | C7 | [ ] |
| AUD-5 | Pagination | Audience tab | NEW | C7 | [ ] |
| AUD-6 | Approve checkboxes, per contact | table row | RESTORE | C7 | [ ] |
| AUD-7 | Bulk approve / unapprove | table toolbar | RESTORE | C7 | [ ] |
| AUD-8 | "Approve all ≥ threshold" | table toolbar | NEW | C7 | [ ] |
| AUD-9 | `approvedManually` protection on re-score | logic | RESTORE | C7 | [ ] |
| AUD-10 | Re-run scoring | Audience tab header | RESTORE | C7 | [ ] |
| AUD-11 | Editable scoring config (post-creation) | Audience tab header | RESTORE | C7 | [ ] |
| AUD-12 | Inline phone edit | table row | RESTORE | C7 | [ ] |
| AUD-13 | Verify inferred emails action | Audience tab | RESTORE | C7 | [ ] |
| AUD-14 | Inferred-email quarantine indicator | table row badge | RESTORE | C7 | [ ] |

### 5.5 Templates (global library)
| ID | Feature | Target home | Action | CP | Done |
|---|---|---|---|---|---|
| TPL-1 | Global library, channel-tabbed | `/templates` | NEW | C4 | [x] |
| TPL-2 | Per-channel explainer callout | `/templates` | NEW | C4 | [x] |
| TPL-3 | Email: subject + body + vars | editor | KEEP | C4 | [x] |
| TPL-4 | WhatsApp: category, language, footer, buttons, numbered vars | editor | NEW | C4 | [x] |
| TPL-5 | Meta approval lifecycle (Draft→Pending→Approved) | editor + list badge | NEW | C4 | [x] |
| TPL-6 | SMS: DLT template ID, sender ID | editor | NEW | C4 | [x] |
| TPL-7 | SMS segment count + GSM-7 detection | editor, live | RESTORE | C4 | [x] |
| TPL-8 | LinkedIn: assisted-only, no approval | editor | NEW | C4 | [x] |
| TPL-9 | New template | list header | KEEP | C4 | [x] |
| TPL-10 | Save template | editor footer | KEEP | C4 | [x] |
| TPL-11 | Delete template | editor footer | RESTORE | C4 | [x] |
| TPL-12 | Duplicate template | editor footer | RESTORE | C4 | [x] |
| TPL-13 | Revert to saved (`savedSubject`/`savedBody`) | editor footer | RESTORE | C4 | [x] |
| TPL-14 | Hide / unhide (stops sends, keeps copy) | editor footer | RESTORE | C4 | [x] |
| TPL-15 | AI rewrite template | editor footer | RESTORE | C4 | [x] |
| TPL-16 | Merge-field preview w/ sample contact | editor | RESTORE | C4 | [x] |
| TPL-17 | Readiness badge + problem list | list header | RESTORE | C4 | [x] |
| TPL-18 | Per-campaign override via duplicate-into-campaign | editor | NEW | C4 | [x] |

### 5.6 Messaging / personalization
| ID | Feature | Target home | Action | CP | Done |
|---|---|---|---|---|---|
| MSG-1 | Personalization run card + progress | Messaging tab | NEW | C9 | [ ] |
| MSG-2 | Source-field chips | Messaging tab | NEW | C9 | [ ] |
| MSG-3 | Per-contact preview tabs | Messaging tab | NEW | C9 | [ ] |
| MSG-4 | Step picker w/ coverage counts | Messaging tab | MOVE | C9 | [ ] |
| MSG-5 | Generate all for a step | Messaging tab | KEEP | C9 | [ ] |
| MSG-6 | Regenerate one contact | preview panel | RESTORE | C9 | [ ] |
| MSG-7 | Edit + save a draft | preview panel | RESTORE | C9 | [ ] |
| MSG-8 | Mark reviewed / mark all reviewed | preview panel | RESTORE | C9 | [ ] |
| MSG-9 | Discard one / discard all | Messaging tab | RESTORE | C9 | [ ] |
| MSG-10 | Stale-link detection + repair | Messaging tab | RESTORE | C9 | [ ] |
| MSG-11 | Per-contact rationale line | preview panel | RESTORE | C9 | [ ] |
| MSG-12 | `status` draft→edited→reviewed | logic + badge | RESTORE | C9 | [ ] |
| MSG-13 | Editable personalization prompt | Messaging tab modal | RESTORE | C9 | [ ] |
| MSG-14 | Readiness badge | Messaging tab | RESTORE | C9 | [ ] |
| MSG-15 | Message validation (tokens, link, length) | logic + UI warning | RESTORE | C9 | [ ] |

### 5.7 Cadence planner
| ID | Feature | Target home | Action | CP | Done |
|---|---|---|---|---|---|
| CAD-1 | Channel-derived automation (engine fix F2) | `lib/cadence.ts` | NEW | C3 | [x] |
| CAD-2 | `templateId` resolution (engine fix F2) | `lib/cadence.ts` | NEW | C4A | [x] |
| CAD-3 | 3 groups, grouped step list | Cadence tab | MOVE | C5 | [x] |
| CAD-4 | Toggle step on/off | step row | KEEP | C5 | [x] |
| CAD-5 | **Add step** (any channel, any group) | group footer | NEW | C5 | [x] |
| CAD-6 | **Remove step** | step row | NEW | C5 | [x] |
| CAD-7 | Per-step template dropdown + Edit link | step row | NEW | C5 | [x] |
| CAD-8 | Timing editor (offset + unit + anchor) | step row | MOVE | C5 | [x] |
| CAD-9 | Reset schedule to defaults | tab header | RESTORE | C5 | [x] |
| CAD-10 | Send window (quiet hours) | tab header | RESTORE | C5 | [x] |
| CAD-11 | Frequency preset | tab header | RESTORE | C5 | [x] |
| CAD-12 | **Daily send limit** | tab header | RESTORE | C5 | [x] |
| CAD-13 | Channel mix card + reachability counts | tab header | RESTORE | C5 | [x] |
| CAD-14 | Per-step sent/queued/failed counts | step row | RESTORE | C5 | [x] |
| CAD-15 | Launch / restart cadence | tab header | MOVE | C5 | [x] |
| CAD-16 | LinkedIn assisted queue + Apollo verify + mark sent/skipped | Cadence tab panel | KEEP | C5 | [x] |

### 5.8 Agent run (incl. Control Center — D2)
| ID | Feature | Target home | Action | CP | Done |
|---|---|---|---|---|---|
| AGT-1 | Numbered activity log w/ status badges | Agent run tab | NEW | C10 | [ ] |
| AGT-2 | 4 run stat cards | Agent run tab | NEW | C10 | [ ] |
| AGT-3 | Pause / resume / stop cadence | Agent run tab | RESTORE | C10 | [ ] |
| AGT-4 | Retry failed sends | Agent run tab | RESTORE | C10 | [ ] |
| AGT-5 | Run due sends now | Agent run tab | RESTORE | C10 | [ ] |
| AGT-6 | Needs-attention cards + AI diagnose + resolve | Agent run tab | RESTORE | C10 | [ ] |
| AGT-7 | Next-send-due indicator | Agent run tab | RESTORE | C10 | [ ] |
| AGT-8 | Simulated clock | Agent run tab, dev flag | RESTORE | C10 | [ ] |

### 5.9 Post-event
| ID | Feature | Target home | Action | CP | Done |
|---|---|---|---|---|---|
| PST-1 | 4 post-event stat cards | Post-event tab | NEW | C10 | [ ] |
| PST-2 | Attendee follow-up card + metrics | Post-event tab | NEW | C10 | [ ] |
| PST-3 | No-show follow-up card + metrics | Post-event tab | NEW | C10 | [ ] |
| PST-4 | Account engagement summary table | Post-event tab | KEEP | C10 | [ ] |
| PST-5 | "Push to LSQ for SDR" | Post-event tab | NEW | C10 | [ ] |
| PST-6 | Zoom attendance CSV import | Post-event tab | KEEP | C8 | [ ] |
| PST-7 | Zoom participants API import | Post-event tab | NEW | C8 | [ ] |

### 5.10 Overview & Dashboard
| ID | Feature | Target home | Action | CP | Done |
|---|---|---|---|---|---|
| OVR-1 | 4 stat cards | Overview tab | MOVE | C11 | [ ] |
| OVR-2 | 6-tile clickable campaign pipeline | Overview tab | NEW | C11 | [ ] |
| OVR-3 | Registration funnel | Overview tab | MOVE | C11 | [ ] |
| OVR-4 | Step-to-step conversion % w/ >100% guard | Overview tab | RESTORE | C11 | [ ] |
| OVR-5 | Score-band predictiveness table | Overview tab | RESTORE | C11 | [ ] |
| OVR-6 | **Step + channel delivery breakdown** | Overview tab | RESTORE | C11 | [ ] |
| OVR-7 | Breakdowns: persona / score band / source / vertical | Overview tab | RESTORE | C11 | [ ] |
| OVR-8 | Account table | Overview tab | KEEP | C11 | [ ] |
| OVR-9 | Drill-down drawers (records behind a stage) | Overview tab | RESTORE | C11 | [ ] |
| OVR-10 | About / description panel | Overview tab | NEW | C11 | [ ] |
| OVR-11 | Per-campaign "what the agent learned" | Overview tab | NEW | C11 | [ ] |
| OVR-12 | Historical summary for empty campaigns | Overview tab | RESTORE | C11 | [ ] |
| DSH-1 | Cross-campaign dashboard | `/dashboard` | NEW | C11 | [ ] |
| DSH-2 | 30d / 90d / 6m / all range selector | `/dashboard` | NEW | C11 | [ ] |
| DSH-3 | 5 KPIs with deltas | `/dashboard` | NEW | C11 | [ ] |
| DSH-4 | Registrations-over-time trend chart | `/dashboard` | NEW | C11 | [ ] |
| DSH-5 | Registrations by channel | `/dashboard` | NEW | C11 | [ ] |
| DSH-6 | Webinars-in-range table | `/dashboard` | NEW | C11 | [ ] |
| DSH-7 | Persona conversion table | `/dashboard` | MOVE | C11 | [ ] |
| DSH-8 | Campaign-over-campaign learnings | `/dashboard` | NEW | C11 | [ ] |

### 5.11 Registration & Zoom
| ID | Feature | Target home | Action | CP | Done |
|---|---|---|---|---|---|
| REG-1 | `Contact.registeredAt` + `registrationSource` | schema | NEW | C8 | [ ] |
| REG-2 | Signed one-click sign-up route `/r/[token]` | `app/r/[token]/route.ts` | NEW | C8 | [ ] |
| REG-3 | Idempotent under replay | logic | NEW | C8 | [ ] |
| REG-4 | Confirmation step fires on registration | logic | NEW | C8 | [ ] |
| REG-5 | LinkedIn Lead Sync registration ingestion | existing | KEEP | C8 | [ ] |
| ZOM-1 | Zoom Server-to-Server OAuth | `lib/zoom/` | NEW | C8 | [ ] |
| ZOM-2 | List / link / create event | `lib/zoom/` | NEW | C8 | [ ] |
| ZOM-3 | Participants report fetch | `lib/zoom/` | NEW | C8 | [ ] |
| ZOM-4 | CSV fallback retained | Post-event tab | KEEP | C8 | [ ] |

### 5.12 Integrations
| ID | Feature | Target home | Action | CP | Done |
|---|---|---|---|---|---|
| INT-1 | 7 integration cards | `/integrations` | MOVE | C12 | [ ] |
| INT-2 | Per-integration "how it works" explainer | card | NEW | C12 | [ ] |
| INT-3 | Per-field credential entry (DB wins over env) | card panel | RESTORE | C12 | [ ] |
| INT-4 | Live connection test + stored result | card panel | RESTORE | C12 | [ ] |
| INT-5 | Delivery-settings summary | page header | RESTORE | C12 | [ ] |
| INT-6 | **LSQ activity-type mapping card** | `/integrations` | RESTORE | C12 | [ ] |
| INT-7 | **LSQ sender auto-discovery + probe** | LSQ card panel | RESTORE | C12 | [ ] |
| INT-8 | **Apify (enrichment)** | `/integrations` card | RESTORE | C12 | [ ] |
| INT-9 | WhatsApp Business card (WABA metadata) | `/integrations` | NEW | C12 | [ ] |
| INT-10 | SMS DLT card (entity ID, sender IDs, route) | `/integrations` | NEW | C12 | [ ] |
| INT-11 | LinkedIn card + connect flow | `/integrations` | KEEP | C12 | [ ] |

### 5.13 Safety rails — must all survive
| ID | Feature | Action | CP | Done |
|---|---|---|---|---|
| SAF-1 | `SEND_MODE=sandbox` redirect to allowlisted lead | RESTORE (surface in UI) | C12 | [ ] |
| SAF-2 | Inferred-email quarantine blocks send until verified | KEEP | C7 | [ ] |
| SAF-3 | Send window enforcement | KEEP | C5 | [x] |
| SAF-4 | Daily limit enforcement | KEEP | C5 | [x] |
| SAF-5 | `whatsappOptIn` gate | KEEP | C5 | [x] |
| SAF-6 | `smsOptOut` gate | KEEP | C5 | [x] |
| SAF-7 | Apollo pre-flight before LinkedIn touch | KEEP | C5 | [x] |
| SAF-8 | Send dedupe `@@unique([campaignId, contactId, stepKey])` | KEEP | C3 | [x] |
| SAF-9 | `responseUrn` webhook idempotency | KEEP | C8 | [ ] |
| SAF-10 | `claimedAt` concurrent-runner claim stamp | KEEP | C8 | [ ] |
| SAF-11 | HMAC webhook verification, fails closed | KEEP | C8 | [ ] |
| SAF-12 | Message validation before send | KEEP | C9 | [ ] |

---

## 6. Schema deltas

```prisma
// NEW — global template library, channel-shaped
model MessageTemplate {
  id                String   @id @default(cuid())
  campaignId        String?          // null = global library row
  channel           String           // email | whatsapp | sms | linkedin
  key               String?          // legacy cadence key, for migration mapping
  name              String
  label             String?
  // email
  subject           String?
  hasSubject        Boolean  @default(true)
  body              String
  // whatsapp
  category          String?          // Marketing | Utility
  language          String?
  footer            String?
  buttons           String?
  // sms
  dltTemplateId     String?
  senderId          String?
  // lifecycle
  status            String   @default("draft") // draft|pending|approved|assisted|ready
  // retained from Template
  savedSubject      String?
  savedBody         String?
  savedAt           DateTime?
  hidden            Boolean  @default(false)
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  @@index([channel, status])
  @@index([campaignId])
}

// CadenceStep additions
  templateId     String?    // FK → MessageTemplate
  createdByUser  Boolean @default(false)
  removedAt      DateTime?

// Campaign additions
  msgMode         String   @default("ai")   // ai | templatized
  tone            String?
  msgLength       String?
  aiInstructions  String?
  brief           String?
  oneClickSignup  Boolean  @default(true)
  speakerName     String?
  speakerTitle    String?
  capacity        Int?
  zoomMode        String?   // existing | new
  zoomEventId     String?
  zoomJoinUrl     String?

// Contact additions
  registeredAt        DateTime?
  registrationSource  String?   // one_click | linkedin | manual | import

// ActivityLogEntry additions
  ordinal  Int?
  status   String?   // done | running | failed
  detail   String?

// NEW — persisted import validation report
model ImportReport {
  id           String   @id @default(cuid())
  campaignId   String
  totalRows    Int
  withEmail    Int
  withLinkedin Int
  missingTitle Int
  duplicates   Int
  suppressed   Int
  gapsJson     String
  createdAt    DateTime @default(now())
  @@index([campaignId])
}
```

**Migration risk:** the `MessageTemplate` migration must preserve edited
templates and `savedBody` revert history from existing campaigns. Test against
a **copy of the real `dev.db`**, not a fresh `demo:reset`.

---

## 7. Checkpoints

Each checkpoint ends with: acceptance criteria met, regression gate green,
changelog entry written. Do not run two checkpoints in one pass.

### [x] C1 — Foundations
**Scope:** read Next docs; add the 6 new tokens; verify baseline.
**Files:** `styles/tokens/colors.css`, `docs/REVAMP-MASTER-PLAN.md`
**Acceptance:** new tokens resolve; zero visual change; 112 tests pass;
routing conventions confirmed against the bundled docs and recorded in §2.5.

### [x] C2 — Shell, navigation, list page
**Scope:** NAV-1..5, NAV-7, LST-1..6.
**Files:** `components/Sidebar.tsx`, `components/ui/{Toast,PageHeader,Placeholder}.tsx` (new), `components/ui/Icon.tsx`, `app/layout.tsx`, `app/page.tsx`, `app/CampaignCardMenu.tsx`, `app/{dashboard,templates}/page.tsx` (new), `lib/campaignCardStats.ts`, `lib/campaignRoutes.ts` (new), `app/globals.css`.
**Acceptance:** sidebar matches the prototype but retains AGENT ONLINE, the LeadSquared lockup and the chat widget; 4-KPI row and 5 filter pills compute from real data; cards carry three stats, two CTAs and a working kebab menu; `/dashboard` and `/templates` reachable.

### [x] C2B — Campaign workspace tab restructure
**Scope:** NAV-6. Split out of C2 to keep that checkpoint verifiable on its own.
**Files:** route folder renames under `app/campaigns/[id]/`, `WorkspaceTabs.tsx`, `app/campaigns/[id]/layout.tsx`, `lib/campaignRoutes.ts`, `lib/demo-data.ts` (`workspaceTabs`).
**Renames:** `dashboard`→`overview`, `scoring`→`audience`, `personalize`→`messaging`, `schedule`→`cadence`, `control`→`agent`; add `post-event`.
**Transitional:** `setup` stays a tab until C6 moves campaign-detail editing into Overview; per-campaign `templates` stays until C4.
**Acceptance:** all six prototype tabs present and every existing screen still reachable; `campaignRoutes.ts` is the only place tab hrefs are written; `next typegen` clean.

### [x] C3 — Cadence engine unblock (CAD-1)
**Scope:** CAD-1, SAF-8. CAD-2 (template resolution) deferred to C4, where
`MessageTemplate` and `CadenceStep.templateId` are introduced — resolving via a
column that does not exist yet was not possible.
**Files:** `prisma/schema.prisma` + migration `20260903033247_cadence_step_trigger`, `lib/cadence.ts`, `lib/channels.ts`, `lib/stepTrigger.ts` (new), `lib/stepTrigger.test.ts` (new), `lib/campaignDefaults.ts`, `app/campaigns/[id]/cadence/{page,CadenceGroups}.tsx`, `scripts/diag-cadence-trigger.ts` (new)
**Acceptance:** met. Automation derived from a per-step `trigger` column plus
channel, not a key allowlist; equivalence with the legacy allowlist pinned by
test; a user-added step provably queues (`scripts/diag-cadence-trigger.ts`).

### [x] C4A — MessageTemplate schema, migration, resolution
**Scope:** CAD-2 + the data model behind TPL-1..18.
**Files:** `prisma/schema.prisma` + migration `20260903034057_message_template_library`, `lib/messageTemplates.ts` (new), `lib/cadence.ts`, `scripts/diag-template-resolution.ts` (new)
**Acceptance:** met. 240 per-campaign template rows collapse to 14 library rows
+ 2 genuine overrides; every one of 224 cadence steps resolves; `Template` left
intact so the migration is reversible.

### [x] C4B — Global Templates page
**Scope:** TPL-1..18 (UI).
**Files:** `prisma/schema.prisma`, migration, `lib/messageTemplates.ts` (new), `app/templates/`, `lib/actions/templates.ts`
**Acceptance:** library renders 4 channel tabs; all 18 TPL features work; migration preserves existing edited templates verified against a `dev.db` copy.

### [x] C5 — Cadence planner
**Scope:** CAD-3..16, SAF-3..7.
**Files:** `app/campaigns/[id]/cadence/`, `lib/actions/schedule.ts`
**Acceptance:** add and remove steps; assign templates; edit timing; send window, frequency, daily limit and channel-mix all present and enforced; launch works.

### [ ] C6 — Creation wizard
**Scope:** WIZ-1, 4..21 (excluding Zoom items).
**Files:** `app/campaigns/new/`, `lib/actions/campaigns.ts`, `lib/actions/setup.ts`, `lib/actions/scoring.ts`
**Acceptance:** full 4-step creation with validation; AI description, AI CSV mapping, `extraFieldsJson`, editable scoring config all present; 5,000-row CSV completes.

### [ ] C7 — Audience tab
**Scope:** AUD-1..14, SAF-2.
**Files:** `app/campaigns/[id]/audience/`, `lib/actions/scoring.ts`
**Acceptance:** search, band filter and pagination server-side; approve checkboxes + bulk + approve-all-≥-threshold; re-run scoring and editable config; phone edit; quarantine badge visible.

### [ ] C8 — Registration + Zoom
**Scope:** REG-1..5, ZOM-1..4, PST-6, PST-7, SAF-9..11.
**Files:** `app/r/[token]/route.ts` (new), `lib/registration.ts` (new), `lib/zoom/` (new), `prisma/schema.prisma`
**Acceptance:** click a real one-click link → registered → redirected to join URL; double-click creates nothing extra; Zoom link/create works; CSV fallback still works.

### [ ] C9 — Messaging tab
**Scope:** MSG-1..15, SAF-12.
**Files:** `app/campaigns/[id]/messaging/`, `lib/actions/personalize.ts`
**Acceptance:** prototype previews **plus** the complete edit path — regenerate, edit, review, discard one/all, repair links, rationale, prompt modal, validation warnings.

### [ ] C10 — Agent run + Post-event
**Scope:** AGT-1..8, PST-1..5.
**Files:** `app/campaigns/[id]/agent/`, `app/campaigns/[id]/post-event/`, `lib/actions/control.ts`, `lib/actions/attendance.ts`
**Acceptance:** numbered log renders; every Control Center action available and working; post-event follow-up cards + account rollup + push-to-LSQ.

### [ ] C11 — Overview + Dashboard
**Scope:** OVR-1..12, DSH-1..8, LST-7.
**Files:** `app/campaigns/[id]/overview/`, `app/dashboard/`, `lib/analytics.ts` (new)
**Acceptance:** all prototype panels plus restored step/channel breakdown, score-band predictiveness, 4 breakdown dimensions and drill-down drawers; dashboard ranges aggregate correctly.

### [ ] C12 — Integrations
**Scope:** INT-1..11, SAF-1.
**Files:** `app/integrations/`, `lib/integrationFields.ts`, `lib/integrationConfig.ts`
**Acceptance:** 7 cards; per-field credentials + live test; LSQ activity mapping; sender discovery + probe; Apify card; delivery-mode summary showing sandbox state.

### [ ] C13 — Hardening
**Scope:** full audit against §5; a11y; motion; docs.
**Acceptance:** every row in §5 checked; full regression green; `docs/REVAMP-CHANGELOG.md` complete.

---

## 8. Testing strategy

### 8.1 Unit (vitest) — target ~175 total, from 112
New suites required:
- `lib/registration.test.ts` — token mint/verify, tamper, expiry, replay idempotency
- `lib/cadence.test.ts` — channel-derived automation, template resolution order, user-added steps
- `lib/messageTemplates.test.ts` — WhatsApp numbered-var rule, SMS DLT presence, segment count, LinkedIn assisted-only, status transitions
- `lib/analytics.test.ts` — dashboard range bucketing, delta computation, >100% conversion guard
- `lib/wizard.test.ts` — per-step validation rules
- Extend `lib/csvPreflight.test.ts` for `extraFieldsJson` retention

### 8.2 Integration
Extend `scripts/e2e-journey.ts` to walk: wizard → launch → one-click register →
tick → attendance → post-event → LSQ push. Sandbox-aware; it is the regression gate.

### 8.3 Browser
Per-screen verification of render, console cleanliness and both themes after
each UI checkpoint.

### 8.4 Migration
`MessageTemplate` migration tested against a copy of the real `dev.db`.
Verify: edited subject/body preserved, `savedBody` history preserved, `hidden`
preserved, every `CadenceStep` resolves to a template.

---

## 9. Debug playbook

### "Nothing sent" triage ladder
Walk in order — each rung is a real early-return in `processDueSends`:
1. `campaign.cadenceStatus === 'running'`?
2. Inside `scheduleWindow`?
3. `dailyLimit` budget remaining?
4. Step `enabled` and not `removedAt`?
5. Template resolved (`templateId` → campaign override → key)?
6. Template not `hidden`?
7. Recipient passes `sendGuard` (email present, not unverified-simulated)?
8. Channel gate (`whatsappOptIn` / `smsOptOut` / phone present)?
9. Channel strategy configured (`trigger` / `direct`)?
10. LeadSquared API response — check `CadenceSend.error`.

### Diagnostics
- `scripts/diag-sender.ts` — LSQ sender identity
- `scripts/deep-audit-db.ts` — per-campaign completeness (extend for new models)
- `scripts/diag-zoom.ts` — **to build in C8**
- `scripts/diag-registration.ts` — **to build in C8**, mint + replay a token

### Bug protocol
Every bug found during a checkpoint is logged in `REVAMP-CHANGELOG.md` under
that checkpoint with: symptom, root cause, fix, and the test added to prevent
regression. A bug without a test is not closed.

---

## 10. Anti-hallucination checklist

Before declaring the revamp complete, verify each of these by inspection:

- [ ] Every row in §5 has `Done` checked, or an explicit note saying why not
- [ ] No feature in the original app is unreachable from the new UI
- [ ] `grep -rn "AUTOMATED_STEP_KEYS"` returns only historical comments
- [ ] Every `CadenceStep` in `dev.db` resolves to a `MessageTemplate`
- [ ] `SEND_MODE` is still `sandbox` and visible in the UI
- [ ] Test count ≥ 175 and all pass
- [ ] `npx next typegen && npx tsc --noEmit` clean, `npm run lint` clean
- [ ] `scripts/e2e-journey.ts` passes end-to-end
- [ ] The 6 new tokens are used, and no new raw hex literals were introduced
- [ ] `docs/REVAMP-CHANGELOG.md` has an entry per checkpoint
