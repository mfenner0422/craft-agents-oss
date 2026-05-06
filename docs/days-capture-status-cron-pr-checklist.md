# Implementation Checklist — Days, Capture, Status DnD/Keyboard, Cron Recovery

This checklist is grouped into merge-clean PRs for a cloud agent. Each PR should stay narrowly scoped, pass its own tests, and avoid reaching ahead into later UI or feature work unless explicitly listed as shared groundwork.

## PR 1 — Cron Recovery

**Goal**
- Land the backend-only cron recovery foundation that unblocks Days rituals.

**Scope**
- Add recovery schema/types.
- Add persistent last-run store.
- Add missed-firing computation.
- Thread `scheduledAt` and `recoveredAt` through scheduler/event payloads and history.
- Run recovery on boot and wake.
- Centralize last-run watermark writes in `AutomationSystem`.

**Primary files**
- `packages/shared/src/automations/last-run-store.ts`
- `packages/shared/src/automations/recovery.ts`
- `packages/shared/src/automations/__tests__/recovery.test.ts`
- `packages/shared/src/automations/schemas.ts`
- `packages/shared/src/automations/types.ts`
- `packages/shared/src/automations/automation-system.ts`
- `packages/shared/src/automations/handlers/prompt-handler.ts`
- `packages/shared/src/scheduler/scheduler-service.ts`
- `packages/shared/src/automations/event-bus.ts`
- `packages/shared/src/automations/webhook-utils.ts`
- `packages/shared/src/automations/constants.ts`
- `packages/server-core/src/sessions/SessionManager.ts`
- `apps/electron/src/main/power-manager.ts`
- `apps/electron/src/main/index.ts`

**Checklist**
- Add `recovery` and `recoveryGraceMinutes` to matcher schema and runtime types.
- Add `scheduledAt` to scheduler tick payloads in both scheduler-service and event-bus.
- Add `recoveredAt` to pending prompt/history plumbing.
- Implement `automations-last-run.json` storage with atomic writes.
- Implement missed-firing computation with `croner.previousRun()` plus bounded fallback if needed.
- Run recovery before scheduler startup.
- Expose `notifyResume()` on `AutomationSystem`.
- Expose `notifyAutomationResume()` on `SessionManager`.
- Wire Electron wake events to `SessionManager.notifyAutomationResume()`.
- Ensure last-run writes happen exactly once per matcher firing in `AutomationSystem`, not in handlers.
- Ensure last-run timestamp is the scheduled cron time, not wake time or handler completion time.

**Verification**
- Run recovery unit tests, including DST and persisted-future cases.
- Manually verify boot recovery for `critical`, `soft`, and `none`.
- Manually verify wake recovery after sleep.
- Confirm recovered history entries show `recovered: true`.

**Stop conditions**
- No Days, vault, Capture, or UI work in this PR.
- No changes to slash commands or navigation.

## PR 2 — Vault + Workspace Config Infrastructure

**Goal**
- Add shared vault helpers and live workspace config plumbing used by both Days and Capture.

**Scope**
- Vault path/markdown/template helpers.
- Workspace config shape expansion.
- Workspace settings DTO/RPC updates.
- Workspace-root `config.json` watcher.
- Live settings push events.
- App-level capture hotkey RPCs and preferences plumbing.
- Non-destructive active-session workspace-config hot reload path.

**Primary files**
- `packages/shared/src/vault/path.ts`
- `packages/shared/src/vault/markdown.ts`
- `packages/shared/src/vault/template.ts`
- `packages/shared/src/vault/index.ts`
- `packages/shared/src/workspaces/types.ts`
- `packages/shared/src/protocol/dto.ts`
- `packages/server-core/src/handlers/rpc/settings.ts`
- `apps/electron/src/main/handlers/settings.ts`
- `packages/shared/src/config/preferences.ts`
- `packages/shared/src/config/watcher.ts`
- `packages/server-core/src/sessions/SessionManager.ts`
- `packages/shared/src/protocol/channels.ts`
- `packages/shared/src/protocol/routing.ts`
- `apps/electron/src/transport/channel-map.ts`
- `apps/electron/src/shared/types.ts`
- `apps/electron/src/renderer/pages/settings/WorkspaceSettingsPage.tsx`
- `apps/electron/src/renderer/pages/settings/AppSettingsPage.tsx`
- `apps/electron/src/renderer/contexts/NavigationContext.tsx`
- `packages/shared/src/agent/backend/types.ts`
- `packages/shared/src/agent/base-agent.ts`
- `packages/shared/src/agent/claude-agent.ts`
- `packages/shared/src/agent/pi-agent.ts`

**Checklist**
- Add `vault`, `days`, and `capture` to `WorkspaceConfig`.
- Add flat `WorkspaceSettings` projections for vault/days/capture enablement.
- Add vault settings controls to Workspace Settings.
- Add capture hotkey controls to App Settings only.
- Add `captureHotkey` to preferences types.
- Exclude UI-only preference keys from prompt formatting.
- Add typed app-level hotkey RPCs in Electron-only handlers.
- Implement bind-before-commit hotkey update flow.
- Add `workspace.SETTINGS_CHANGED`, `workspace.SETTINGS_INVALID`, `app.CAPTURE_HOTKEY_CHANGED`, and `app.CAPTURE_HOTKEY_CONFLICT`.
- Register new channels in routing, preload/Electron API, and channel map.
- Add workspace-root `config.json` watch path.
- Implement per-field tolerance for invalid external config edits.
- Log invalid external edits and emit `workspace.SETTINGS_INVALID`.
- Add `refreshWorkspaceConfig(workspace)` to agent backend types.
- Implement non-destructive workspace-config hot reload in active agents.
- Keep `setWorkspace(workspace)` as destructive real workspace switch path.
- Expose `SessionManager.setOnWorkspaceConfigChange(cb)` for Electron-only reactions.

**Verification**
- Unit-test vault-path resolution and relative vs absolute handling.
- Verify workspace setting updates apply without restart.
- Verify invalid external `config.json` edits partially apply and emit UI warning.
- Verify capture hotkey only persists on successful rebind.

**Stop conditions**
- No Capture window or inbox UI yet.
- No Days storage or prompt injection yet.

## PR 3 — Status Keys 1–9

**Goal**
- Ship the low-risk keyboard shortcut for session status changes.

**Scope**
- Keyboard mapping only.
- Matching i18n strings.

**Primary files**
- `apps/electron/src/renderer/components/app-shell/SessionList.tsx`
- `packages/shared/src/i18n/locales/en.json`
- `packages/shared/src/i18n/locales/es.json`
- `packages/shared/src/i18n/locales/zh-Hans.json`

**Checklist**
- Map keys `1`–`9` to `effectiveSessionStatuses[i - 1]`.
- No-op when nothing is selected or the index is out of range.
- Ensure shortcut only applies when focus is in the list.
- Add shortcut description strings to all required locales.

**Verification**
- Manual key testing in the session list.

**Stop conditions**
- No drag-and-drop in this PR.

## PR 4 — Capture Inbox

**Goal**
- Ship Capture as the first vault-backed UI feature and prove the app-global hotkey model.

**Scope**
- Capture store and tests.
- Capture manager and hotkey wiring.
- Capture window.
- Capture navigator, routes, middle/right panes, and slash command.

**Primary files**
- `packages/shared/src/capture/store.ts`
- `packages/shared/src/capture/__tests__/store.test.ts`
- `apps/electron/src/main/capture-manager.ts`
- `apps/electron/src/main/handlers/capture.ts`
- `apps/electron/src/renderer/capture/CaptureWindow.tsx`
- `packages/ui/src/components/capture/CaptureInboxList.tsx`
- `packages/ui/src/components/capture/CaptureItemView.tsx`
- `apps/electron/src/main/index.ts`
- `apps/electron/src/shared/route-prefixes.ts` or equivalent shared route-prefix location
- `apps/electron/src/shared/types.ts`
- `apps/electron/src/shared/route-parser.ts`
- `apps/electron/src/shared/routes.ts`
- `apps/electron/src/renderer/components/app-shell/MainContentPanel.tsx`
- `apps/electron/src/renderer/components/app-shell/AppShell.tsx`
- `apps/electron/src/renderer/components/ui/slash-command-menu.tsx`
- `apps/electron/src/renderer/components/app-shell/input/FreeFormInput.tsx`
- `packages/shared/src/i18n/locales/en.json`
- `packages/shared/src/i18n/locales/es.json`
- `packages/shared/src/i18n/locales/zh-Hans.json`

**Checklist**
- Implement inbox file writes and listing.
- Implement URL enrichment with bounded fetch/read behavior.
- Add hotkey registration and MRU workspace targeting.
- Respect `capture.enabled` and skip hotkey registration if no workspace allows capture.
- Implement per-capture workspace override in the capture window.
- Add shared Days/Capture route-prefix constant and use it in both parser and deep-link code.
- Add `capture` navigation state and route builders.
- Add Capture sidebar entry, middle-column list, and right-pane detail view.
- Add `/capture` slash command behavior.
- Add capture i18n strings in all locales.

**Verification**
- Unit-test store behavior and URL enrichment edge cases.
- Manual hotkey launch and file creation.
- Manual deep-link verification for capture routes.
- Manual multi-window ownership verification.

**Stop conditions**
- No Days UI or Days prompt injection in this PR.

## PR 5 — Days

**Goal**
- Ship the daily-practice experience on top of vault helpers and cron recovery.

**Scope**
- Daily file paths/store/templates.
- Carry-forward.
- Daily context formatting and prompt pinning.
- Non-automation day rollover.
- Days UI, routes, sidebar entry, and slash commands.
- Rocky qmd collection extension.

**Primary files**
- `packages/shared/src/days/paths.ts`
- `packages/shared/src/days/store.ts`
- `packages/shared/src/days/carry-forward.ts`
- `packages/shared/src/days/identity.ts`
- `packages/shared/src/days/types.ts`
- `packages/shared/src/days/templates/tasks.md`
- `packages/shared/src/days/templates/scratch.md`
- `packages/shared/src/days/templates/journal.md`
- `packages/shared/src/days/skills/daily-practice/SKILL.md`
- `packages/shared/src/days/skills/daily-practice/index.ts`
- `packages/shared/src/days/__tests__/store.test.ts`
- `packages/shared/src/days/__tests__/carry-forward.test.ts`
- `packages/shared/src/days/__tests__/identity.test.ts`
- `packages/shared/src/agent/core/prompt-builder.ts`
- `packages/shared/src/agent/claude-agent.ts`
- `packages/shared/src/automations/automation-system.ts`
- `packages/ui/src/components/days/DaysListColumn.tsx`
- `packages/ui/src/components/days/DaysMainPane.tsx`
- `packages/ui/src/components/days/MiniCalendar.tsx`
- `packages/ui/src/components/days/RecentDaysList.tsx`
- `packages/ui/src/components/days/PlanPane.tsx`
- `packages/ui/src/components/days/ReflectPane.tsx`
- `packages/ui/src/components/days/CarryForwardBanner.tsx`
- `packages/ui/src/components/days/TasksSubpanel.tsx`
- `packages/ui/src/components/days/ScratchSubpanel.tsx`
- `packages/ui/src/components/days/JournalSubpanel.tsx`
- `apps/electron/src/main/handlers/days.ts`
- `apps/electron/src/shared/types.ts`
- `apps/electron/src/shared/route-parser.ts`
- `apps/electron/src/shared/routes.ts`
- `apps/electron/src/renderer/components/app-shell/MainContentPanel.tsx`
- `apps/electron/src/renderer/components/app-shell/AppShell.tsx`
- `apps/electron/src/renderer/contexts/NavigationContext.tsx`
- `apps/electron/src/renderer/components/ui/slash-command-menu.tsx`
- `apps/electron/src/renderer/components/app-shell/input/FreeFormInput.tsx`
- `packages/rocky/src/qmd/lifecycle.ts`
- `packages/shared/src/i18n/locales/en.json`
- `packages/shared/src/i18n/locales/es.json`
- `packages/shared/src/i18n/locales/zh-Hans.json`

**Checklist**
- Implement deterministic `ensureDay()` and file creation.
- Support vault template override and bundled fallback.
- Add stable task IDs and sidecar rolls metadata.
- Implement carry-forward by task ID, not text.
- Add `<daily_context>` generation with truncation and per-session pinning.
- Refresh pinned daily context on date change and config change.
- Add built-in day rollover call path on day boundary and boot/wake.
- Add Days navigation type, routes, sidebar entry, middle column, and right pane.
- Extend slash commands for `/task`, `/scratch`, `/journal`, `/today`, `/capture`.
- Add qmd collection registration for daily and inbox vault folders.
- Add all new Days i18n keys in all required locales.

**Verification**
- Run Days unit tests.
- Manual first-open file creation.
- Manual prompt injection test across multiple turns.
- Manual morning recovery after boot.
- Manual slash command append flow.

**Stop conditions**
- No sidebar DnD yet.

## PR 6 — Sidebar DnD

**Goal**
- Add drag-and-drop from the session list onto sidebar status/flag/archive targets.

**Scope**
- Outer DnD context.
- Draggable session rows.
- Droppable sidebar targets.
- Tests for dispatch behavior.

**Primary files**
- `apps/electron/src/renderer/components/app-shell/SessionDnDContext.tsx`
- `apps/electron/src/__tests__/session-dnd.test.tsx`
- `apps/electron/src/renderer/components/app-shell/AppShell.tsx`
- `apps/electron/src/renderer/components/app-shell/SessionList.tsx` or actual session-row component
- `apps/electron/src/renderer/components/app-shell/LeftSidebar.tsx`

**Checklist**
- Add shell-level DnD context and sensors.
- Mark session rows as draggable.
- Mark sidebar rows as droppable where applicable.
- Route drops to status/flag/archive handlers.
- Preserve inner sortable status reorder behavior.

**Verification**
- Unit-test DnD dispatch table.
- Manual drag onto status, Flagged, Archived, and invalid targets.

## PR 7 — Web Parity (Deferred v2)

**Goal**
- Adapt Days and Capture to WebUI after Electron v1 ships.

**Scope**
- WebUI adapters.
- API routes for vault-backed reads/writes.
- No global hotkey.

**Checklist**
- Add `/api/vault/*` routes or equivalent server endpoints.
- Add WebUI Days and Capture adapters using shared UI components.
- Decide how to represent Capture without OS-global shortcut.

**Verification**
- Out of scope for current delivery.

## Global Review Checklist

- Every PR must stay merge-clean and avoid speculative reach into later PRs.
- Every PR that adds user-facing strings must update `en.json`, `es.json`, and `zh-Hans.json`.
- Every PR that changes route parsing should verify deep-link handling.
- Every PR that changes settings or config should verify no-restart behavior where promised.
- Every PR that affects prompt injection should check token bloat and stale-context behavior.
