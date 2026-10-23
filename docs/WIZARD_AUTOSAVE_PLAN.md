# Webinar creation: autosave and resume — plan

Status: implemented (all four phases, with the five recommended decisions applied). Section 16 records what shipped and where it differs from this plan.

## 1. Goal and non-goals

**Goal.** Someone creating a webinar never loses work and never has to remember where they were. They can go Back, refresh, close the tab, open Integrations to connect a service, or come back tomorrow, and the wizard reopens on the right step with every value filled in.

**Non-goals.** No offline editing. No multi-user live collaboration. Autosave never launches, sends, syncs to a CRM, creates a Zoom meeting or calls the AI. Those stay explicit actions.

## 2. What happens today (the gaps)

| Area | Today | Gap |
|---|---|---|
| Draft creation | Only on Continue at step 0 (`createCampaignFromWizardAction`) | Typing before the first Continue is lost |
| Step 0 details | Held in React state, saved on Continue (`updateWizardDetailsAction`) | Back, refresh or navigation loses edits |
| Scoring settings, messaging settings | Saved on Continue (`updateScoringConfigAction`, `saveWizardMessagingAction`) | Same |
| Landing page / funnel mode, field mappings | Saved on their own button (`updateWizardFunnelModeAction`, `saveWizardFieldMappingsAction`) | Easy to leave unsaved |
| Contacts, enrichment, approvals, cadence step toggles | Saved immediately | Already fine |
| Current step | Only in the address bar (`?id=&step=`) | Nothing on the server, so "resume" has no answer |
| Resume | A draft card opens the webinar Overview, not the wizard | The wizard is hard to re-enter |
| Integrations round-trip | OAuth callbacks always redirect to `/integrations` | No way back to the step |
| Duplicate editors | Overview has an Edit Setup dialog for drafts as well as the wizard | Two ways to change the same data |

## 3. Principles

1. **The server is the source of truth.** The browser is a cache; a draft opened anywhere shows the same state.
2. **Save early, validate late.** Drafts may be incomplete. Validation only decides whether Continue is enabled.
3. **Saving is pure.** A draft save writes our own database only. No external calls, ever.
4. **Visible and honest.** The person always sees Saving, Saved or Failed, and a failure is never silent.
5. **One editor.** The wizard edits a draft. Once launched, the setup is locked (existing rule).
6. **Never lose the newer edit.** Conflicts are detected and shown, not overwritten.

## 3b. Data model

Add to `Campaign` (one migration, all defaulted so existing rows stay valid):

| Field | Meaning |
|---|---|
| `wizardStep Int @default(0)` | The step the person was last on |
| `wizardFurthestStep Int @default(0)` | Highest step reached (drives the stepper and the "Step 3 of 6" label) |
| `draftRevision Int @default(0)` | Incremented on every draft save; used for conflict detection |
| `draftTouchedAt DateTime?` | Last wizard activity (separate from `updatedAt`, which other jobs also bump) |

No JSON blob of form state. Every field already has a real column (title, date, time, timezone, duration, speakers, Zoom link, registration mode and link, scoring prompt and threshold, messaging mode, tone, length, instructions, channels, per-step configs). Real columns keep reports, the launch gate and the rest of the app reading one source.

Fields without a column yet (check during Phase 1): the unsaved wizard-only choices `zoomChoice` (existing/paste/new) and the pasted Zoom text. These are cheap UI state; keep them in session storage, not the database.

## 4. Server design

### 4.1 One draft-save entry point
`saveWizardDraftAction(campaignId | null, step, patch, baseRevision)`:
- **Patch, not snapshot.** Only the fields that changed are sent, so two browser tabs editing different fields do not erase each other.
- **Allowed fields are an allowlist per step**, each with its own light sanitising (lengths, enum values, URL syntax). Nothing is rejected for being incomplete.
- **Locked guard:** reuses `assertSetupEditable`; a launched webinar returns `locked` and the client redirects to its workspace.
- **Revision check:** if `baseRevision` is older than the stored revision for any field in the patch that changed since, return `conflict` with the newer values; otherwise apply, bump `draftRevision`, set `draftTouchedAt`, return the new revision.
- **No side effects:** no Zoom, LeadSquared, AI, email or cadence calls. Enforced by a test that fails the draft action if any outbound module is imported or called.
- **Create-if-needed:** with `campaignId = null` it creates the draft (see 4.2) and returns the id.

The existing Continue actions stay and now do two things: persist the step exactly as before, then set `wizardStep` and `wizardFurthestStep`. Autosave and Continue write the same columns, so they cannot disagree.

### 4.2 When the draft is created
On the first meaningful input: the title reaches 3 characters, or any other field is changed to a non-empty value. A stray click on New Webinar creates nothing. The address bar is updated with `router.replace` (not push) so Back does not walk through the creation.

### 4.3 Unload-safe saving
Server actions are cancelled when a page unloads. Add `POST /api/wizard/draft` (same patch contract, same-site only, `keepalive` fetch or `sendBeacon`) used only from `pagehide` / `visibilitychange`. It shares the implementation with the action.

## 5. Client design

### 5.1 `useDraftAutosave` hook
- Holds a per-step "dirty fields" set and the last known revision.
- **When it saves:** 800 ms after the last change (debounced), on blur of a field, before a step change, on `visibilitychange: hidden`, and on `pagehide`.
- **Queue:** one in-flight request at a time; changes made meanwhile are merged into the next patch. Retries with backoff (1 s, 3 s, 10 s), then stops and shows Failed with a Retry button.
- **Status:** a small `aria-live="polite"` label in the wizard header: `Saving…`, `Saved 2 min ago`, `Couldn't save · Retry`, `Updated in another tab · Reload`.
- **Navigation guard:** extend the existing `lib/unsavedChangesGuard`: while anything is unsaved, leaving shows a confirm (Save and leave / Leave / Stay); in practice the flush on blur and navigation means it is rarely needed.
- **Local safety net:** the dirty patch is mirrored to `localStorage` under `wizard-draft:<id>` (never secrets or tokens; only wizard fields). On load, if the stored patch is newer than the server revision, offer "Restore unsaved changes". Cleared on a confirmed save.

### 5.2 Step by step

| Step | Autosaved fields | Notes |
|---|---|---|
| 0 Details | title, date, time, timezone, duration, capacity, description, speakers, registration option and landing URL, Zoom link / meeting id, channels | Zoom pick/create/link are explicit buttons and keep their own actions; only the chosen link text and id are drafted |
| 1 Audience | n/a (import is already immediate) | Show import job progress and survive reload by reading the job from the server |
| 2 Scoring | scoring prompt, criteria, threshold | Approvals and enrichment already immediate |
| 3 Cadence | already immediate per toggle/edit | Add the same status label for consistency |
| 4 Messaging | mode, tone, length, instructions, brief, personalization fields, per-step config, channels | AI drafting remains explicit |
| 5 Review | registration mode / landing link, field mappings | Replaces the separate "Save" buttons with autosave; launch stays explicit |

### 5.3 Stepper
Clicking any earlier step, or a later step up to `wizardFurthestStep`, navigates freely (after a flush). Steps beyond the furthest are disabled with a short reason. Reopening a draft lands on `wizardStep`.

## 6. Resume entry points

1. **Webinars list.** A draft card's primary button becomes `Continue Setup · Step 3 of 6`, linking to `/campaigns/new?id=<id>&step=<wizardStep>`; the card shows a thin progress bar and "Edited 2 hours ago".
2. **Sidebar shortcut.** If any draft was touched in the last 14 days, a compact `Draft in progress: <name> · Step 3` item sits under Webinars (most recent one; "and N more" opens the Draft filter).
3. **Draft Overview.** A draft webinar's Overview shows a banner with the same Continue button; the Edit Setup dialog is removed for drafts so there is only one editor.
4. **Direct URL.** `/campaigns/new?id=` with no `step` opens `wizardStep`, not step 0. A launched webinar redirects to its workspace (existing).
5. **Header shortcut.** `New Webinar` with an existing recent draft asks "Continue <name> or start a new one?" instead of silently creating another.

## 7. Integrations round-trip

Problem: connecting Zoom, LinkedIn or the CRM mid-wizard sends the person to `/integrations` and the OAuth callbacks always end there.

Design:
- Wizard links to Integrations with `?returnTo=<encoded same-site path>` (`/campaigns/new?id=…&step=…`).
- `returnTo` is validated as a relative path starting with `/campaigns/new` or `/campaigns/<id>/` (no scheme, no `//`, no backslash) before any use; otherwise ignored.
- OAuth connect routes store `returnTo` next to the CSRF state they already persist (`*.oauth_state.<state>` record, 10-minute expiry), so it travels server-side and cannot be altered by the redirect. The callback reads it after validating the state and redirects there with `?connected=zoom` (or `error`), falling back to `/integrations` as today.
- Integrations shows a slim "Back to <webinar name>, step 1" bar whenever `returnTo` is present, including for non-OAuth saves (API keys), so the person is never stranded.
- Back in the wizard, a one-time toast reports the result; for Zoom the existing "pick a meeting" panel opens already loaded.

## 8. Concurrency and failure handling

| Situation | Behaviour |
|---|---|
| Same draft open in two tabs | Each save carries `baseRevision`. Non-overlapping fields merge. Overlapping fields on a stale revision return `conflict`; the tab shows "Updated in another tab · Reload" and keeps the local patch until the person chooses |
| Save fails (network, 500) | Retry with backoff, then Failed + Retry; local mirror keeps the edit; Continue stays usable but warns if the last save failed |
| Draft launched or completed meanwhile | Save returns `locked`; client shows "This webinar has launched" and links to its workspace |
| Draft deleted or archived meanwhile | Save returns `gone`; offer to recreate from the local mirror |
| Very long text / bad URL | Sanitised on the server; the field shows the corrected value after the save |
| Browser crash mid-edit | At most the last debounce window (under a second) is lost; the local mirror usually has it |
| Two rapid typing bursts | Merged into one patch; only one request in flight |

## 9. Abandoned drafts

- A draft with only default values and no activity for 7 days is archived automatically; archived drafts stay restorable from the Archived filter.
- A touched draft is never auto-deleted.
- A small cleanup job (reuses the existing cron/worker lease pattern) runs daily; it logs what it archived.

## 10. Security and safety rules

- Draft saves are same-site: the beacon route checks `Origin`/`Sec-Fetch-Site`, applies a per-IP/per-draft rate limit, and caps body size.
- Allowlisted fields only; no ability to set status, cadence state, Zoom ids from the server's own sync, or lock fields.
- `returnTo` is validated as in section 7. Local mirror excludes credentials and tokens.
- Autosave must be provably side-effect free: a test imports the draft module and asserts no call to Zoom, LeadSquared, Netcore, Apollo or the AI client.

## 11. Copy and accessibility

- Status label text only, `aria-live="polite"`, no toast spam; timestamps use the app's date format.
- Buttons: `Continue Setup`, `Restore Unsaved Changes`, `Reload`, `Retry`. Sentence-case messages without blame ("We couldn't save. Your changes are kept on this device.").
- Keyboard: the stepper is a list of buttons; focus returns to the changed field after a conflict resolution.

## 12. Testing plan

**Unit**
- Patch merge, allowlist and sanitising per step; revision and conflict rules.
- `returnTo` validator: accepts the two allowed shapes; rejects absolute URLs, `//host`, `javascript:`, backslashes, encoded tricks.
- Draft-creation threshold (3 characters, any non-empty field).
- Debounce/queue behaviour (merging, one in flight, retry backoff).

**Integration (real database, no external services)**
- Create on first input; revision increments; locked and gone responses.
- Two writers editing different fields both survive; same field conflicts.
- Draft save makes zero outbound calls (fake Zoom/LeadSquared record no traffic).
- OAuth state carries and restores `returnTo`; a tampered value is ignored.
- Cleanup job archives only untouched, expired drafts.

**Browser journeys (Playwright)**
1. Type title and date, navigate to Integrations by the sidebar, come back via the Draft shortcut: values and step are intact.
2. Refresh in the middle of step 4: values intact.
3. Kill the network on step 2, edit, restore: Failed then Saved; no loss.
4. Two tabs: edit different fields (merge), then the same field (conflict banner).
5. Connect flow with `returnTo` (against the fake provider) returns to the step.
6. Launched webinar's wizard URL redirects; autosave to it is refused.
7. Keyboard-only pass and an axe scan of the status label and stepper.

## 13. Rollout

| Phase | Scope | Done when |
|---|---|---|
| 1. Foundation | Migration; `saveWizardDraftAction` + beacon route; early draft creation; autosave and status label on step 0; `wizardStep` set on Continue; draft card "Continue Setup"; sidebar shortcut; Overview banner | Typing a title then leaving and returning reproduces step 0 and resumes the right step from the list |
| 2. Whole wizard | Autosave for steps 2, 4, 5; remove separate Save buttons; stepper navigation by furthest step; conflict handling; "Continue or start new" prompt | Every wizard field survives navigation and refresh; two-tab conflicts handled |
| 3. Integrations | `returnTo` on connect links and OAuth state; return bar on Integrations; result toast | Connect Zoom/LinkedIn mid-wizard returns to the same step with values filled |
| 4. Hardening | Local mirror and restore; unload beacon; abandoned-draft job; full test suite and Playwright journeys; remove the Edit Setup dialog for drafts | All tests green; journeys pass at desktop and phone widths |

Estimated size: Phase 1 is the smallest useful release; Phases 2 and 3 are each about the same again; Phase 4 is mostly tests and the cleanup job.

## 14. Decisions to confirm

1. **Draft trigger:** 3-character title or any field (recommended) vs. only on first Continue.
2. **One editor:** retire Edit Setup for drafts in favour of the wizard (recommended).
3. **Auto-archive window:** 7 days for untouched drafts.
4. **Sidebar shortcut window:** drafts touched in the last 14 days.
5. **Local mirror:** include it (recommended) or rely on the server only.

## 15. Risks

- **Large `WizardClient`** (about 1,100 lines of local state): wrap changes in the hook and per-step field maps rather than rewriting the component.
- **Concurrent writers** other than the wizard (cron, Zoom sync) touch the same row; the revision applies only to wizard-owned fields, so those jobs are unaffected.
- **Chatty saves:** debouncing plus patch-only payloads keep requests small; add a per-draft rate limit.
- **Stale local mirror** restoring over newer server data: only offered when its base revision matches the server's, otherwise shown as a diff to choose from.

## 16. What shipped

All four phases are in, with the recommended answers to the five decisions: draft after a three-character title, the wizard as the only editor for a draft, untouched drafts archived after seven days, a fourteen-day sidebar shortcut window, and a device-only backup.

**Where the code differs from the plan above**

- **Serialising saves.** Every save to one draft runs in a transaction holding a Postgres advisory lock on the draft id (`lib/wizardDraftServer.ts`), and writes the draft's side tables (speakers, per-step message copy) inside it. That is what makes the revision check and the write one step. A creation is serialised on its client token, so a retried or raced creation returns the same draft.
- **Conflict groups.** A patch is checked per group, not per field: date, time and zone are one group, the landing page link and the one-click switch are one, the two Zoom fields are one, and each per-step message config is its own. A client sends a whole group whenever any member changes. Re-sending a value the draft already holds is not a conflict, which covers an unload post that lands after the in-flight save.
- **Behind, not just conflicting.** A save that succeeds while another tab changed other fields returns those group names; the client keeps its old base revision, so a later save of those fields is a conflict instead of a silent overwrite.
- **Channels are not autosaved, and Continue no longer sends them.** The Messaging step held a copy of which channels were on that was read when the wizard opened. Sending it back at Continue could switch channels Step 3 had turned on or off. Step 3 owns that switch; the Messaging save leaves it alone.
- **Scoring prompt and criteria.** These were edited in the card but never reported to the wizard, so Continue wrote back the original values unless scoring was run. They are now autosaved.
- **Saved message copy is shown on reopen.** The Messaging card started every step from the defaults even when copy had been saved. It now starts from the webinar's own saved copy, so a resumed draft shows (and Continue keeps) what was typed.
- **Zoom meeting id on reopen.** The page never passed the saved Zoom meeting id to the wizard; it does now, so a resumed draft reopens on the right Zoom option.
- **Registration mode.** Continue on step 1 now sets the registration mode the way autosave and the Review step do (a landing page link means the external page).
- **Field mappings** have no editor in the wizard today, so there was nothing to autosave there.
- **Dead code removed.** The Edit Setup dialog (`EditSetupModal`), its form (`CampaignDetailsForm`) and `lib/setupEditImpact.ts` had no remaining entry point once drafts reopen in the wizard. `/campaigns/<id>/overview?edit=1` (and `/setup`) now redirect a draft to the wizard.
- **Return path and OAuth.** The destination is stored with the OAuth state (`lib/oauthReturn.ts`), validated when stored and again when used. A successful connection returns to the wizard; a failed one stays on Integrations with the way back kept. When a return path is present the connect link runs in the same tab.
- **Housekeeping** (`lib/draftCleanup.ts`) runs inside the existing worker tick: expired creation tokens and return paths are purged every tick, and the archive of abandoned drafts runs once a day.

**How it is tested**

- Unit: patch rules and the return-path validator (`lib/wizardDraft.test.ts`), the client queue (`lib/draftSaveQueue.test.ts`), the on-device backup, and an import-graph guard that fails if the save path ever imports a provider, sender, enrichment or AI module (`lib/wizardDraftServer.test.ts`; checked by deliberately adding such an import).
- Integration, real database: `test-support/integration/wizardDraft.integration.test.ts` (creation threshold and idempotency, columns written, timezone handling, conflicts, concurrency, locked and gone drafts, allowlist, zero outbound requests, archive rules, resume query, return-path storage).
- Browser: `npm run test:wizard` (`scripts/test-wizard-journeys.ts`) runs 23 checks against a production build, a disposable database and the fake Zoom server, including a full OAuth redirect round trip.
