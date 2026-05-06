# PR Review — Days, Capture, Status, Cron Recovery

**Scope:** review of six branches (`codex/pr1-cron-recovery` … `codex/pr6-sidebar-dnd`) against the agreed implementation plan at `~/.claude/plans/users-mfenner-desktop-days-feature-md-i-joyful-brook.md`.

**Verdict:** PR1, PR2, PR3 are mostly on-plan with discrete defects. PR4 ships ~half the capture flow (no capture window or workspace targeting). **PR5 is materially under-scoped** — most of the Days value (identity injection, carry-forward, slash commands, Plan/Reflect modes, in-process rollover, daily-practice skill, mini calendar) is missing. PR6 ignores the plan's `@dnd-kit` directive and ships HTML5 drag-and-drop with no drop-zone affordance, no validation, and no tests.

The current state will run, but it doesn't yet deliver the Days/Capture experience the plan describes. Land PR1–3 with the discrete fixes below, treat PR4 as foundation only and add the missing layers, redo most of PR5, and rebuild PR6 on `@dnd-kit`.

---

## PR1 — Cron Recovery

**On-plan:**
- `recovery.ts` `computeMissedFirings` correctly uses `croner.previousRun`/`nextRun` walk with a 7-day cap; tests cover DST, weekday cron, persisted-future watermark, and the cap.
- `last-run-store.ts` exists and uses `atomicWriteFileSync`.
- `AutomationSystem.runRecoverySweep` runs at boot and on `notifyResume`.
- `SchedulerTickPayload` carries `scheduledAt` in both `scheduler-service.ts` and `event-bus.ts`.
- `recoveredMatcherId` filter in `matcherMatches` correctly narrows recovered firings to a single matcher — handlers no longer double-fire on synthesized payloads.
- `createPromptHistoryEntry` / `createWebhookHistoryEntry` accept `recoveredAt`; `SessionManager.onPromptsReady` threads it through.
- `power-manager.ts` listens to `resume` + `unlock-screen`; `SessionManager.notifyAutomationResume` fans out.

**Defects:**
1. **No mutex on `last-run-store`.** Boot recovery sweep is `void runRecoverySweep('boot')` followed immediately by `startScheduler()`. The first regular tick can race with sweep writes; concurrent updates can lose entries (read-modify-write is non-atomic). Plan explicitly called out copying `history-store.ts`'s mutex pattern; not done. **Fix:** add the same per-workspace `mutexes: Map<string, Promise<void>>` pattern; make `writeLastRun` async and serialize through it.
2. **Skipped firings are silent.** When `recovery === 'none'` or `soft` past grace, `runRecoverySweep` writes the watermark and `continue`s with no `appendAutomationHistoryEntry` and no `eventLogHandler` entry. Plan: "All scheduled events log to log.md whether they fired or skipped." **Fix:** emit a `recovered: false, skipped: true` history entry (extend `createPromptHistoryEntry`/`createWebhookHistoryEntry` or add a `createSkippedRecoveryEntry`).
3. **Recovery sweeps can overlap on wake.** `notifyResume` is fire-and-forget. Two close `'resume'` + `'unlock-screen'` events spawn two sweeps that race on the watermark and can re-emit firings. **Fix:** guard with `if (this.recoveringSweepInProgress) return; this.recoveringSweepInProgress = true; try {...} finally {...}`.
4. **Boot sweep may exceed `SCHEDULER_RATE_LIMIT`.** The test only verifies 65 emissions; the new ceiling is `7 * 24 * 60 = 10080`. A worst-case sweep emits exactly that many `SchedulerTick`s synchronously through the bus, hitting the per-minute rate window. Acceptable with the limit, but the test should assert the cap (a 10081th drop is silent corruption).
5. **`emitSchedulerTick` writes the watermark BEFORE `eventBus.emit`.** That's "on dispatch," matches the plan, but worth a code comment so it isn't "fixed" later.
6. **Watermark `last[matcherId]` is read once at the start of `runRecoverySweep`.** If `runRecoverySweep` runs again concurrently (see #3), both see the same starting watermark and re-emit. Mutex + in-progress guard together close this.
7. **Type cast clutter in handlers**: `payload as unknown as Record<string, unknown>` to read `recoveredAt`. The bus type already has `recoveredAt?: string`; just narrow on `payload.recoveredAt`. Cleanup, not a bug.

---

## PR2 — Vault + Workspace Config

**On-plan:**
- `vault/{path,markdown,template}.ts` exist; `resolveVaultRoot` defaults to `<workspaceRoot>/vault/`, supports relative + absolute overrides, lazily creates the dir.
- `WorkspaceConfig` extended with `vault`, `days`, `capture`; types exported from `workspaces/index.ts`.
- `WorkspaceSettings` DTO extended with flat projections; `SETTINGS_GET` projects them; `SETTINGS_UPDATE` validates and routes via the existing top-level branch pattern.
- `ConfigWatcher` gains a `config.json` branch + `onWorkspaceConfigChange` callback with `WorkspaceConfigValidationIssue[]`.
- `SessionManager` exposes `setOnWorkspaceConfigChange(cb)` hook for Electron main; emits `workspace.SETTINGS_CHANGED` and `workspace.SETTINGS_INVALID` pushes.
- `formatPreferencesForPrompt` filters `UI_ONLY_PREFERENCE_KEYS` (currently `{captureHotkey}`).
- `AgentBackend.refreshWorkspaceConfig` added in `backend/types.ts`, `base-agent.ts`, `claude-agent.ts`, `pi-agent.ts`.
- App-level hotkey channels `app.GET/SET_CAPTURE_HOTKEY`, `CAPTURE_HOTKEY_CHANGED`, `CAPTURE_HOTKEY_CONFLICT` registered.

**Defects:**
1. **`refreshWorkspaceConfig` doesn't propagate to the prompt-builder.** All three implementations are just `this.config.workspace = workspace`. The prompt-builder still holds the old `config.workspace`. Live-reload won't actually surface vault/days config changes inside the system prompt for active sessions. The plan explicitly required: `this.promptBuilder.setWorkspace(workspace)` in both `setWorkspace` and `refreshWorkspaceConfig`. **Fix:** add the prompt-builder call in `base-agent.ts` `refreshWorkspaceConfig`; remove the redundant overrides in `claude-agent.ts`/`pi-agent.ts` (they shadow the base method without adding behavior).
2. **`base-agent.setWorkspace` not updated either.** Same prompt-builder sync gap that the plan called out for `setWorkspace`. **Fix:** add `this.promptBuilder.setWorkspace(workspace)` in base `setWorkspace`. Update claude-agent's override to call `super.setWorkspace(workspace)` (currently shadows; doesn't call super).
3. **`SET_CAPTURE_HOTKEY` persists before binding.** PR2's settings handler validates with a too-permissive regex `/^[A-Za-z0-9+ -]+$/` (accepts `+++`, `aaa`, plain spaces) and writes to preferences immediately. PR4 retrofits a `captureHotkeyBinder` callback, but PR2 standalone leaves the prefs file in an unbindable state if the user happens to land on PR2 only. **Fix:** make PR2's handler call back to a registered binder (default no-op) and refuse persistence on bind failure. PR4 then registers the real binder.
4. **WorkspaceSettingsPage doesn't subscribe to push events.** The push channels exist (`workspace.SETTINGS_CHANGED`, `workspace.SETTINGS_INVALID`) and the `electronAPI.onWorkspaceSettingsChanged` / `onWorkspaceSettingsInvalid` listeners are wired in `channel-map.ts`, but no renderer subscribes. External `config.json` edits will reload server-side but the open Settings page won't repaint, and invalid edits never toast. **Fix:** subscribe in `WorkspaceSettingsPage` (and probably also in `AppShell`/`NavigationContext` so the sidebar reacts to `daysEnabled`/`captureEnabled` toggles).
5. **Default hotkey accelerator is duplicated.** `'CommandOrControl+Alt+Space'` lives in `apps/electron/src/main/handlers/settings.ts`, in `apps/electron/src/main/index.ts` (PR4), and as the prompt-side `UI_ONLY_PREFERENCE_KEYS` reference. **Fix:** export a single constant from `packages/shared/src/config/preferences.ts` (e.g. `DEFAULT_CAPTURE_HOTKEY`).
6. **`SETTINGS_INVALID` doesn't fire on UI-driven invalid input.** It only fires from the watcher path (external file edits). UI errors come through the Promise rejection. Either acceptable (one path per source) or we should also push from the RPC handler for consistency. Document the decision in the plan.
7. **`vault.path` validation is shallow.** The `mkdirSync(resolvedVaultPath, {recursive: true})` happens both in `SETTINGS_UPDATE` and in `resolveVaultRoot` lazy-creation. No protection against (a) absolute paths into system dirs, (b) parent traversal that escapes the workspace, (c) symlink cycles. Plan didn't specify, but worth at least rejecting paths outside `$HOME` or with `..` segments.
8. **Test coverage thin.** Only `vault/__tests__/path.test.ts`. Missing tests for `markdown.ts` (atomic write, frontmatter round-trip), `template.ts` (override resolution + var interpolation + missing template), the watcher's new `config.json` branch + `validateWorkspaceRuntimeConfig`, and the agent refresh path.
9. **i18n added in 7 locales** (de, en, es, hu, ja, pl, zh-Hans). The `packages/shared/CLAUDE.md` only requires en/es/zh-Hans, but the repo evidently maintains more — fine. All keys present in all seven, alphabetized — good.
10. **`AppSettingsPage`'s `setCaptureHotkey` flow is awkward**: it persists on blur, then on failure refetches the saved value and overwrites. There's a brief window where the local input shows the user's bad value mid-save. Minor.

---

## PR3 — Status Number Keys

**On-plan:**
- 1–9 keys in `SessionList.handleKeyDown` map to `effectiveSessionStatuses[i-1]?.id`.
- `shortcuts.setStatusByPosition` i18n key added in all locales.

**Defects:**
1. **No modifier check.** `if (/^[1-9]$/.test(e.key))` fires regardless of `metaKey`/`ctrlKey`/`altKey`/`shiftKey`. Holds for plain `1`, `Shift+1` (which is `!` on US layout but `e.key === '1'` for some IME setups), and `Cmd+1`. Latter is a real conflict — Cmd+1/2/3 are commonly used for tab/zone navigation. **Fix:** `if (!e.metaKey && !e.ctrlKey && !e.altKey && /^[1-9]$/.test(e.key))`.
2. **No `e.repeat` guard.** Holding `1` fires the IPC every keyrepeat. Wasteful but not incorrect (status set to same id is idempotent).
3. **Multi-select isn't honored.** Pressing `1` while multiple sessions are selected only changes the focused row's status, ignoring the selection. Existing keyboard ops (Delete, Archive shortcut) operate on selection. **Fix:** if `selectedIds.size > 1`, iterate; else single.
4. **`shortcuts.setStatusByPosition` i18n key is unused** by code. Either wire it into a shortcuts help/registry or drop the key.
5. **No test.** Add a test that synthesizes a keydown on a row and verifies `onSessionStatusChange` fires with the right id at the right index, including out-of-range no-op.

---

## PR4 — Capture Inbox

**On-plan:**
- `packages/shared/src/capture/{store,index}.ts` with `captureItem`, `listInboxItems`, `enrichUrl` and a unit test.
- `CaptureManager` in main owns `globalShortcut` register/unregister with bind-before-commit (`setHotkey` re-binds, reverts on failure).
- PR2's settings handler now consults `captureHotkeyBinder` before persisting — fixes the gap noted in PR2 #3.
- `RPC_CHANNELS.capture.{SAVE,LIST,ENRICH_URL}` and Electron channel-map entries registered.
- Capture sidebar entry added in AppShell; `CaptureItemView` wired in `MainContentPanel`; routes parser/builder/state-key/deep-link prefix updated.
- New `nav:capture` filter type and `isCaptureNavigation` guard added.

**Defects:**
1. **No capture window exists.** `onCapture` does `BrowserWindow.getFocusedWindow()?.webContents.send('capture:open')` and nothing receives that event. Pressing the hotkey from inside Craft Agents triggers a no-op IPC; pressing it from outside the app does literally nothing (focused window is null). **Fix:** add `apps/electron/src/main/capture-window.ts` (frameless `BrowserWindow` ~480×320) and a renderer entry under `apps/electron/src/renderer/capture/CaptureWindow.tsx`. Plan called for both.
2. **`refreshTargetWorkspaces()` is a stub.** No MRU window stack, no per-workspace `capture.enabled` filtering, no fall-through, no "no enabled workspace → unregister hotkey" rule. **Fix:** implement per the plan: track focus changes via `BrowserWindow.on('focus')`, resolve target on hotkey fire, fall through MRU to enabled workspaces, unregister hotkey when none enabled.
3. **`SessionManager.setOnWorkspaceConfigChange` hook is unused.** PR2 added the hook for exactly this — PR4 needs to wire `setOnWorkspaceConfigChange((wsId) => captureManager.refreshTargetWorkspaces())` after CaptureManager construction in `main/index.ts`.
4. **URL enrichment is decoupled from save.** Plan: "URL meta auto-fetched async... fire-and-forget; updates frontmatter on completion." Current `enrichUrl` is a separate RPC the renderer would have to call after save and re-save with title/description. The store doesn't update the file. **Fix:** in `captureItem`, when `input.url` is set, kick off `enrichUrl(url)` in the background and `writeMarkdown` again with the enriched frontmatter.
5. **`enrichUrl` has no safety rails.** No URL-scheme validation (allows `file://`, `localhost`, `data:`), no body size cap (plan called for 256 KB), no `Accept: text/html` header, no content-type check on response. **Fix:** restrict to http/https, cap at 256 KB, set headers, gate by content-type.
6. **Capture sidebar count is unbounded.** `captureItems.length` grows forever and never decreases (no archival). Either show "today" or "unread" instead, or truncate at 99+.
7. **Capture sidebar entry position drifts from the plan.** Plan said "between `nav:allSessions` and the separator." PR4 places it after `nav:sources` in the link order and renders it under the Sources/Skills group. Move it up.
8. **Two duplicate fetches.** Both `AppShell` and `MainContentPanel` independently `electronAPI.listCaptureInbox(...)`. After saving, neither refreshes; the user must re-mount. **Fix:** lift the list to a Jotai atom (`captureItemsAtom`) with an invalidate trigger; subscribe to a `capture:saved` push to refresh.
9. **No save → list invalidation push.** When `RPC_CHANNELS.capture.SAVE` succeeds, no push notifies open clients to refresh. New captures from the global hotkey will not appear in another window's sidebar until reload.
10. **No `/capture` slash command.** Plan called for it; missing.
11. **Hardcoded UI strings.** `"No captures yet"`, `"Select a capture"`, `"Untitled capture"` not i18n'd.
12. **`saveCapture` doesn't return enrichment status.** Renderer can't tell whether the title will backfill, so no spinner / pending state UX.
13. **`enrichUrl` swallows errors.** If `fetch` throws (network/timeout), the function throws — but no place catches it for the auto-enrichment path. With auto-enrichment in #4, errors must be logged but not propagated.
14. **`generateShortId` reuse from `automations/resolve-config-path.ts` is fine** but the import path is awkward. Worth promoting `generateShortId` to `packages/shared/src/utils/`.

---

## PR5 — Days  *(materially under-scoped)*

**Shipped:**
- `packages/shared/src/days/{paths,store,index}.ts` with `ensureDay` (idempotent), `listDays`.
- 3 bundled templates (single-line content).
- 1 test file with 2 assertions.
- `DaysListColumn` (a `<button>` per date string).
- `DaysMainPane` (raw markdown rendered as `<pre>`).
- 2 RPC handlers (`days.ENSURE`, `days.LIST`).
- Sidebar entry; new `nav:days` route; `DaysNavigationState` (flat `dateISO?` shape — inconsistent with sibling navigators).

**Missing vs. plan (significant):**
1. **Identity injection in `PromptBuilder`.** Not even started. The biggest plan deliverable — agent system prompt knowing today's tasks/scratch/journal — is absent.
2. **Carry-forward.** No `getIncompleteTasks`, no `pullForward`, no `dismissForwarding`, no banner. Yesterday's incomplete tasks invisible to the user.
3. **Stable task IDs.** Templates are unstructured; no HTML-comment ID format; no auto-assignment on read. Carry-forward will be impossible without this when it lands.
4. **Slash commands.** `/task /scratch /journal /today` — none.
5. **`daily-practice` skill.** Plan called for `packages/shared/src/days/skills/daily-practice/` (NL fallback). Missing entirely.
6. **In-process daily folder rollover.** Plan: "AutomationSystem (or SchedulerService) gains a built-in tick listener that calls `ensureDay(today)` directly when the day changes." Not present. Folder only exists if the user clicks the Days sidebar item.
7. **Plan/Reflect mode toggle, time-of-day default, manual-override-sticky-for-the-day.** Not implemented; `DaysMainPane` dumps all three files together.
8. **Mini calendar.** Plan called for a month-view with content dots; PR5 ships a flat date list.
9. **Sub-panels.** No `TasksSubpanel`, `ScratchSubpanel`, `JournalSubpanel`, `CarryForwardBanner`. The pane is read-only and unstructured.
10. **Editing.** No way to edit a task or scratch entry from the UI. User must edit `.md` on disk.
11. **Default automation entries** for morning/evening rituals — none.
12. **Rocky qmd cycle extension** to register `<vault>/daily/` and `<vault>/inbox/` collections — none.
13. **`days.*` i18n keys** — only `sidebar.days` present.

**Defects in what shipped:**
1. **`DaysMainPane` renders raw markdown as `<pre>`.** Headings show as literal `# Tasks`. Use the existing markdown renderer (`packages/ui` ships one).
2. **`DaysNavigationState` shape inconsistency.** Uses flat `dateISO?: string`, while `Capture`/`Sources`/`Automations` use nested `details`. Plan asked for `details: { type: 'date'; id: string } | null`. Pick one model and apply uniformly.
3. **`ensureDay` returns full file content for all three files** — fine for one day, but `MainContentPanel` re-runs ensureDay on every navState change. Acceptable now; will become wasteful when files grow.
4. **No `dateISO` validation** in route-parser or handler. A malformed value through `craftagents://days/foo` would create `daily/foo/` directories. **Fix:** regex-check `^\d{4}-\d{2}-\d{2}$` in both the parser and the handler.
5. **`loadTemplate` resolves bundled templates via `new URL('./templates/...', import.meta.url)`.** Works under Vite/Bun ESM but is bundle-config-fragile. Add a build-time smoke test that the templates are emitted to dist.
6. **Days sidebar count `days.length`** — semantically weak (total ever), not a useful badge. Drop, or replace with `1` if today exists else nothing.
7. **`handleDaysClick` only navigates inside `.then`.** If `ensureDay` rejects, no navigation happens. **Fix:** navigate first, then await ensureDay; show a loading state.
8. **No tests** beyond the two basic-creation assertions. Need tests for (a) idempotency on re-call, (b) override resolution, (c) listDays sort + limit, (d) `dateISO` regex rejection.

PR5 is the highest-risk PR. It needs the broadest follow-up — effectively a PR5b or split into PRs (5a: store + identity injection + rollover; 5b: UI; 5c: slash + skill).

---

## PR6 — Sidebar DnD

**Shipped:**
- `SessionItem` rows are HTML5 `draggable: true`; serialize sessionId to `application/x-craft-session-id` + `text/plain`.
- `LeftSidebar.LinkItem` gains `onSessionDrop`.
- AppShell wires `onSessionDrop` for `nav:state:<id>`, `nav:flagged`, `nav:archived` to existing handlers (`onSessionStatusChange`, `onFlagSession`, `onArchiveSession`).
- `SidebarButton` adds `onDragOver` (preventDefault to allow drop) and `onDrop` (extracts session id, calls handler).

**Defects:**
1. **HTML5 drag-and-drop, not `@dnd-kit/core`.** Plan explicitly said: "Reuse `@dnd-kit/core`, not `@dnd-kit/dom`. The existing `SortableList` is on `@dnd-kit/core`; ... Stay on `core` for consistency with the production sortable." PR6 introduces a second DnD system. **Fix:** rebuild on `@dnd-kit/core` (`useDraggable` on session rows, `useDroppable` on sidebar entries, single `<DndContext>` at shell level with `data.type === 'session'` filter so it coexists with the existing inner `SortableList`).
2. **No drop-zone visual feedback.** `onDragOver` `preventDefault`s but doesn't add a hover/active class. User has no indication that a row will accept the drop.
3. **No drag overlay.** Native HTML5 ghosts the row; `@dnd-kit` would have given a clean DragOverlay. UX feels janky.
4. **`text/plain` fallback is unsafe.** `e.dataTransfer.getData('application/x-craft-session-id') || e.dataTransfer.getData('text/plain')` accepts arbitrary text dropped from any app as a session id. **Fix:** drop the fallback; require the custom MIME. Validate the id against `sessionMetaMap` before invoking the handler.
5. **`dropEffect = 'move'` set unconditionally.** Even when the drag isn't a session — dragging text from another app over the sidebar shows a "move" cursor on every status row. **Fix:** check `event.dataTransfer.types.includes('application/x-craft-session-id')` first.
6. **No keyboard accessibility.** HTML5 drag-and-drop has no keyboard story. `@dnd-kit` ships a KeyboardSensor that would solve this. PR3's number keys partly cover the feature, but DnD-only operations (Flag, Archive) have no keyboard equivalent.
7. **Multi-select drag not supported.** A user with three sessions selected can only drag one. Bulk operations are otherwise supported via the right-click menu.
8. **No tests.** Plan called for `apps/electron/src/__tests__/session-dnd.test.tsx` with synthetic `DragEndEvent` dispatches.
9. **`draggable: true` always.** No activation distance (5 px); accidental drags during quick clicks. `@dnd-kit`'s PointerSensor with `activationConstraint: {distance: 5}` is the plan's spec.

---

## Cross-cutting issues

1. **Default capture hotkey duplicated** in three files. Promote to a shared constant.
2. **i18n key explosion** without a registry. The hint string `shortcuts.setStatusByPosition` is added but unused; capture/days panes have hardcoded English strings. Audit before merge.
3. **No release-note doc** for the new automations.json keys (`recovery`, `recoveryGraceMinutes`), workspace config keys (`vault`, `days`, `capture`), or the new RPC channels. Either inline in the existing `packages/shared/CLAUDE.md` or a new `docs/automation-recovery.md`.
4. **No upstream PR strategy doc.** The plan called for these to be merge-clean for upstream `craft-agents-oss`. Some Rocky-specific bits in PR5 (qmd cycle, when added) belong in `packages/rocky` not `packages/shared` — keep separate before posting upstream.
5. **No verification README** describing the manual sleep/wake test for cron recovery. Add one to `docs/`.

---

## Recommended sequencing for fix-up PRs

1. **PR1.5 — cron recovery hardening**: mutex on `last-run-store`, in-progress guard for sweeps, skipped-firing history entries, type-cast cleanup.
2. **PR2.5 — hotkey + agent refresh fixes**: prompt-builder propagation in `setWorkspace` + `refreshWorkspaceConfig` (drop redundant overrides), bind-before-commit binder hook in PR2's settings handler with PR4 wiring left in place, renderer subscription to `SETTINGS_CHANGED`/`SETTINGS_INVALID`, single `DEFAULT_CAPTURE_HOTKEY` constant.
3. **PR3.5 — modifier guard + multi-select**: tighten the keyboard handler; add a test.
4. **PR4.5 — capture window + workspace targeting**: ship `CaptureWindow.tsx` + `capture-window.ts`; implement `refreshTargetWorkspaces`; auto-enrichment in `captureItem`; URL safety; sidebar entry positioning fix; `capture:saved` push for live updates; slash `/capture`.
5. **PR5a — Days backend**: identity injection in `PromptBuilder`; carry-forward; stable task IDs; in-process daily-rollover tick listener; `daily-practice` skill; default automations entries (template); date validation.
6. **PR5b — Days UI**: real markdown rendering; Plan/Reflect toggle; sub-panels; CarryForwardBanner; mini calendar; editing.
7. **PR5c — Days slash commands** + Rocky qmd extension (Rocky-only branch).
8. **PR6 redo — DnD on `@dnd-kit/core`**: shell-level DndContext, useDraggable session rows, useDroppable nav targets with active-state class, DragOverlay, MIME-only validation, KeyboardSensor.

Each fix-up PR is small enough to land independently. The plan's quality bar — Plan/Reflect by time, identity injection, carry-forward — depends almost entirely on PR5a landing. Consider that the next priority after PR1.5/PR2.5.
