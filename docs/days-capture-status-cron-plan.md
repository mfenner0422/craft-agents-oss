# Plan — Days, Capture, Status DnD/Keyboard, Cron Recovery

## Context

Four features for the `craft-agents-oss` fork at `/Users/mfenner/dev/craft-agents-oss` (branch `rocky`), built upstream-merge-clean so each can be PR'd back. Motivated by running this fork on Rocky II (Mac mini, headless, Telegram primary) and Rocky Pro (work Mac, interactive UI primary), and by the daily-practice doc at `/Users/mfenner/Desktop/days-feature.md`.

1. **Days** — daily-practice surface with auto-rolling daily folders, morning/evening rituals, system-prompt injection of today's three files, and a mini-calendar+list+Plan/Reflect UI.
2. **Capture Inbox** — global-hotkey native capture window writing one markdown file per item to `<vault>/inbox/`, with async URL metadata enrichment.
3. **Session status DnD + keyboard** — drag from middle list onto existing sidebar entries (`nav:state:<id>`, `nav:flagged`, `nav:archived`); number keys 1–9 set status by sidebar position.
4. **Cron recovery** — per-automation `recovery: 'critical' | 'soft' | 'none'`; missed cron firings re-fire on app start / wake.

Days morning/evening rituals depend on cron-recovery to survive a Mac being asleep at 8am, so **Feature 4 lands first**.

## Decisions (locked with user)

- Vault location: per-workspace config; default `{workspaceRoot}/vault/`. Override to absolute path.
- No new packages. Code lives at `packages/shared/src/{vault,days,capture}/` (matches existing `sessions/`, `sources/`, `automations/`) and UI at `packages/ui/src/components/{days,capture}/`.
- qmd: extend rocky qmd cycle to add `<vault>/daily/` and `<vault>/inbox/` collections.
- Days: top-level sidebar row. Plan/Reflect mode auto-by-time, manual override sticky for the day.
- Capture sidebar: top-level row "Capture" (avoid collision with the existing session-Inbox sidebar concept).
- Capture entry: Electron `globalShortcut` `Cmd+Opt+Space`. **App-global, single hotkey** stored in app-level preferences (not workspace config). Capture target workspace = focused or most-recently-focused Craft window's workspace, with per-capture override. No global hotkey on web.
- File scheme: `<vault>/inbox/YYYY-MM-DD-HHMMSS-<slug>.md` with frontmatter `id, captured_at, source, url?, title?, tags[]`. URL meta enriched async.
- Daily files: `<vault>/daily/YYYY-MM-DD/{tasks,scratch,journal}.md`. Templates at `packages/shared/src/days/templates/`; vault override at `<vault>/_templates/daily/<file>.md`.
- Carry-forward: per-task action banner. Tasks carry stable IDs (see "Task identity").
- Identity injection: every session, with **per-session pinning** + truncation (see "Prompt injection semantics").
- Slash commands: `/task /scratch /journal /today /capture` registered in slash-command-menu **and** an NL fallback skill `daily-practice` at `packages/shared/src/days/skills/daily-practice/`.
- Web parity: **deferred to v2.** v1 is Electron-only. Shared UI still lives under `packages/ui/` for future reuse.
- Status keys: numbers 1–9 map to sidebar position in `effectiveSessionStatuses`.
- Recovery semantics: `critical` always fires (including prompt actions, may spawn sessions on app start, accepted); `soft` (default) fires only within `recoveryGraceMinutes` (default 120); `none` skips and bumps last-fired.
- Rocky II: container always-on; in-app cron-recovery covers it. No host launchd needed.
- Default ritual times: 8am / 7pm local (vault-configurable).
- Journal sealing: never. Always editable.
- Meetings strip: deferred.

## Critical files (verified read)

| File | Lines | Role |
|---|---|---|
| `packages/shared/src/protocol/dto.ts` | 501 | `WorkspaceSettings` DTO — projection of `WorkspaceConfig` exposed via RPC. Settings UI binds against this. |
| `packages/server-core/src/handlers/rpc/settings.ts` | 96, 121 | `SETTINGS_GET` projection + `SETTINGS_UPDATE` `validKeys` switch. Hardcoded; needs extension. |
| `packages/shared/src/workspaces/storage.ts` | 99, 144 | `loadWorkspaceConfig`/`saveWorkspaceConfig` — JSON read/write of workspace `config.json`. |
| `packages/shared/src/workspaces/types.ts` | 33 | `WorkspaceConfig` shape. New `vault?`, `days?`, `capture?` fields go here. |
| `packages/shared/src/agent/core/prompt-builder.ts` | 66 | `buildContextParts()` runs **every user message** — daily context must be cached/pinned. |
| `packages/shared/src/automations/schemas.ts` | 131 | `AutomationMatcherSchema` — non-breaking optional adds. |
| `packages/shared/src/automations/automation-system.ts` | 79 | Constructor sequence: `loadConfig` → `createHandlers` → optional `startScheduler`. Recovery sweep slots before scheduler. |
| `packages/shared/src/automations/history-store.ts` | 57 | Mutex pattern to copy for `last-run-store.ts`. `appendAutomationHistoryEntry` is the single write path. |
| `packages/shared/src/automations/webhook-utils.ts` | 32, 62 | `createWebhookHistoryEntry` / `createPromptHistoryEntry` — must propagate `recoveredAt`. |
| `packages/server-core/src/sessions/SessionManager.ts` | 1339 | `onPromptsReady` callback writes prompt history entries — must accept and serialize `recoveredAt`. |
| `apps/electron/src/shared/route-parser.ts` | 38, 63 | `NavigatorType` + `COMPOUND_ROUTE_PREFIXES` — Days and Capture need new navigators. |
| `apps/electron/src/shared/routes.ts` | 92 | `view.*` route-builder helpers (one per navigator). Days and Capture need `view.days(dateISO?)` and `view.capture(itemId?)`. |
| `apps/electron/src/shared/types.ts` | 730 | `SessionsNavigationState` etc. — add `DaysNavigationState`, `CaptureNavigationState`, type guards `isDaysNavigation`/`isCaptureNavigation`. |
| `apps/electron/src/renderer/components/app-shell/MainContentPanel.tsx` | 233 | Switches on `is*Navigation(navState)` to render the right page. Needs render branches for Days and Capture so parsed routes actually render. |
| `apps/electron/src/renderer/components/app-shell/AppShell.tsx` | 2247 | Sidebar definition; new entries inserted here. |
| `packages/shared/src/config/watcher.ts` | 425, 488 | `ConfigWatcher` watches `automations.json`, `statuses/config.json`, `labels/config.json` — but **NOT workspace-root `config.json`**. Adding `vault`/`days`/`capture` settings means we must add a watch branch + `onWorkspaceConfigChange` callback. |
| `apps/electron/src/main/power-manager.ts` | 9 | Currently only `powerSaveBlocker`. No reference to `SessionManager` or `AutomationSystem`. Wake-recovery bridge needs explicit owner. |
| `apps/electron/src/main/index.ts` | 187 | Deep-link scheme is `craftagents://` (not `craft://`); overridable via `CRAFT_DEEPLINK_SCHEME` env. |
| `packages/shared/src/automations/handlers/prompt-handler.ts` | 113 | Fire-and-forget delivery via `onPromptsReady`. Last-run watermark must advance here (on dispatch), not on downstream success. |
| `apps/electron/src/renderer/components/app-shell/LeftSidebar.tsx` | 59 | `LinkItem` shape; `@dnd-kit/core` is the in-use lib. |
| `apps/electron/src/renderer/components/ui/slash-command-menu.tsx` | 13, 551 | `SlashCommandId` is `PermissionMode \| 'compact'` (closed union). Hardcoded — needs extension to support arg-bearing commands. |
| `apps/electron/src/renderer/components/app-shell/input/FreeFormInput.tsx` | 914 | `handleSlashCommand` is the real wiring site, not the menu component. |
| `packages/rocky/src/qmd/lifecycle.ts` | — | Extension point for daily/ + inbox/ qmd collections. Stays Rocky-specific. |

## Existing utilities to reuse

- `gray-matter` (already a dep) — frontmatter for daily/capture files.
- `generateShortId` in `packages/shared/src/automations/resolve-config-path.ts` — capture item IDs, task IDs, matcher IDs.
- `SortableList` + `@dnd-kit/core` (`apps/electron/src/renderer/components/ui/sortable-list.tsx`).
- `SchedulerService` — already emits `SchedulerTick`; recovery synthesizes the same payload type.
- `appendAutomationHistoryEntry` / `createPromptHistoryEntry` — single write path; extend in place.
- `croner` (already in `cron-matcher.ts`) — `Cron.previousRun()` for missed-firing math; minute-walk fallback if API differs.
- `powerMonitor` from Electron — not yet wired (`apps/electron/src/main/power-manager.ts` only does `powerSaveBlocker`); add `'resume'` + `'unlock-screen'` listeners.
- `atomicWriteFileSync` (used by `saveWorkspaceConfig`) — for `last-run-store.ts` writes.
- `ConfigWatcher` invocation in `SessionManager.ts:1333` — re-uses on config.json change; same pipeline must propagate new vault/days/capture fields without restart.

## Sequencing across features

1. **Feature 4 (cron recovery)** — pure backend, smallest surface, unblocks Days rituals.
2. **Vault helpers + workspace config additions** (DTO + storage + RPC + settings UI + watcher) — unblocks Days and Capture both.
3. **Feature 3a — keyboard 1–9 only** — independent, low-risk; ships alongside.
4. **Feature 2 (Capture)** — exercises vault helpers and the new top-level navigator pattern at smaller scope than Days.
5. **Feature 1 (Days)** — biggest piece; depends on 2 and 4.
6. **Feature 3b — sidebar DnD** — after Days lands, when nested-DndContext can be tested against real session traffic.
7. **v2: Web parity** — `apps/webui` adapter + `/api/vault/*` routes for Days and Capture.

---

## Feature 4: Cron recovery

### Files to add
- `packages/shared/src/automations/last-run-store.ts` — `readLastRun(workspaceRootPath) → Record<matcherId, ISO>`, `writeLastRun(...)`. Mutex pattern from `history-store.ts`. Atomic writes via `atomicWriteFileSync`.
- `packages/shared/src/automations/recovery.ts` — pure `computeMissedFirings(matcher, lastRunISO, now) → MissedFiring[]` using `croner.previousRun()` (or minute-walk capped at 7 days).
- `packages/shared/src/automations/__tests__/recovery.test.ts` — fixed-clock tests including DST and persisted-future edge cases.

### Files to modify
- `packages/shared/src/automations/schemas.ts` — extend `AutomationMatcherSchema`:
  ```ts
  recovery: z.enum(['critical', 'soft', 'none']).optional(),
  recoveryGraceMinutes: z.number().int().positive().optional(),
  ```
- `packages/shared/src/automations/types.ts` — mirror fields on `AutomationMatcher`. Add optional `recoveredAt?: string` to `SchedulerTickPayload` and `PendingPrompt`.
- `packages/shared/src/automations/automation-system.ts`:
  - Between `loadConfig()` and `startScheduler()`, call new `runRecoverySweep('boot')`.
  - Add public `notifyResume()` that calls `runRecoverySweep('wake')`.
  - `runRecoverySweep(reason)`: walks every matcher with a `cron`, computes missed firings, emits synthesized `SchedulerTick` events with `recoveredAt`, updates last-run store, logs.
  - **Watermark advances on dispatch, not on success, and is keyed per-matcher per-firing** (not per-action, not per-handler). When a scheduled matcher fires (whether via real `SchedulerTick` or recovery sweep), the watermark for that matcher gets exactly one update equal to the **scheduled firing timestamp** (the cron's intended fire time, not `Date.now()`). This survives DST and long sleeps because missed-firing math compares scheduled-now vs scheduled-last-fired in cron's frame of reference. Downstream failures land in `automations-history.jsonl` (`ok: false`) and are NOT retried by cron-recovery.
  - **Centralized write site**: `AutomationSystem` performs the `lastRunStore.write(matcherId, scheduledAt)` exactly once per matched scheduled-tick dispatch — at the moment it routes the tick to its handlers (whether prompt, webhook, or both). Handlers (`PromptHandler`, `WebhookHandler`) do **not** write the watermark themselves — this avoids double-writes when a matcher has both prompt and webhook actions, and prevents drift if one handler is added/changed without updating the other.
- `packages/shared/src/automations/handlers/prompt-handler.ts:113` — no watermark write here. Handler stays focused on dispatching prompts; the `AutomationSystem` writes the watermark once before fan-out.
- `packages/shared/src/scheduler/scheduler-service.ts` — extend `SchedulerTickPayload` with `scheduledAt: string` (ISO of the cron-aligned minute the matcher was meant to fire). Real ticks set it to the current cron-aligned minute; recovery sweep sets it to the *missed* scheduled minute, not the wake-time minute. Existing `localTime`/`utcTime` are derived from `scheduledAt`.
- `packages/shared/src/automations/event-bus.ts` — `EventPayloadMap`'s `SchedulerTick` shape mirrors `scheduler-service.ts`. Add the same `scheduledAt: string` field here so consumers (`PromptHandler`, `WebhookHandler`, `EventLogHandler`) read the scheduled time from a stable, typed property regardless of which scheduler emitted the tick.
- `packages/shared/src/automations/webhook-utils.ts` — extend `createPromptHistoryEntry` and `createWebhookHistoryEntry` to accept `recoveredAt?: string` and serialize top-level `recovered: true, recoveredAt: ...`.
- `packages/server-core/src/sessions/SessionManager.ts:1339` — `onPromptsReady` threads `pending.recoveredAt` into `createPromptHistoryEntry({...})` so recovered runs are visible in `automations-history.jsonl`.
  - Also add public method `notifyAutomationResume()` that iterates `this.automationSystems` and calls `notifyResume()` on each. **This is the wake-recovery bridge owner** — power-manager must not reach into AutomationSystem directly.
- `packages/shared/src/automations/constants.ts` — `AUTOMATIONS_LAST_RUN_FILE = 'automations-last-run.json'`.
- `apps/electron/src/main/power-manager.ts` — add `powerMonitor.on('resume', …)` and `'unlock-screen'` listeners that call into a SessionManager reference (passed at startup) via `sessionManager.notifyAutomationResume()`. Power-manager keeps its single concern — owning OS power events — and SessionManager owns the fan-out.
- `apps/electron/src/main/index.ts` — wire the SessionManager reference into power-manager at app startup (where SessionManager is already constructed).

### Verification
- Unit: missed-firings calculator across DST, weekday cron, persisted-future last-fired, 7-day cap.
- Manual: minute-cron matcher, kill app at fire minute, restart 30s later — `critical` fires, `soft` fires within grace, `none` skips. `automations-history.jsonl` carries `recovered: true, recoveredAt: ...`.
- Manual: sleep Mac for 5 hours, wake — recovery sweep fires for any missed criticals; soft entries past grace are logged-and-skipped.

---

## Workspace config + settings (cross-cutting; lands second)

### Files to add
- `packages/shared/src/vault/path.ts` — `resolveVaultRoot(workspaceRootPath, config) → absolutePath`. Default `<workspaceRoot>/vault/`; override via `config.vault?.path` (absolute or workspace-relative). Creates dir on first read if missing.
- `packages/shared/src/vault/markdown.ts` — `readMarkdown(absPath) → {data, content}`, `writeMarkdown(absPath, data, content)`. Wraps `gray-matter`.
- `packages/shared/src/vault/template.ts` — `renderTemplate(slug, vars) → string`; resolves `<vault>/_templates/<slug>` first, then bundled `packages/shared/src/days/templates/<slug>` or `capture/`.
- `packages/shared/src/vault/index.ts` — exports.

### Files to modify
- `packages/shared/src/workspaces/types.ts` — `WorkspaceConfig` adds:
  ```ts
  vault?: { path?: string }
  days?: { enabled: boolean; morningTime?: string; eveningTime?: string; carryForwardMaxRolls?: number }
  capture?: { enabled: boolean }   // hotkey is app-global, not per-workspace
  ```
  Capture **hotkey** is an **app-level setting**, not workspace-scoped. Stored in app preferences (the file behind `getPreferencesPath()`). Surfaced in app-level settings UI (the `app` settings subpage at `apps/electron/src/renderer/pages/settings/`), NOT in `WorkspaceSettingsPage`. Single update path via the typed RPCs below — UI never touches raw `preferences.write` for the hotkey.

  Typed RPCs:
  - `RPC_CHANNELS.app.GET_CAPTURE_HOTKEY` → `string` (default `'CommandOrControl+Alt+Space'`)
  - `RPC_CHANNELS.app.SET_CAPTURE_HOTKEY` → `(accelerator: string) => {ok, error?}`. **Bind-before-commit**: validates the accelerator, calls `captureManager.setHotkey(...)` first; only on successful rebind persists to preferences and emits `RPC_CHANNELS.app.CAPTURE_HOTKEY_CHANGED`. On conflict, preferences stay untouched and `RPC_CHANNELS.app.CAPTURE_HOTKEY_CONFLICT` is emitted. Full sequence detailed under "App-level hotkey RPCs" below.
  - **Filter from prompt context**: `formatPreferencesForPrompt()` in `packages/shared/src/config/preferences.ts` must skip UI-only accelerator keys (`captureHotkey` and any future hotkey fields). Add an explicit `UI_ONLY_PREFERENCE_KEYS` set or a `_uiOnly: true` marker, and exclude those from the `<user_preferences>` block. Without this, the accelerator string would silently leak into every system prompt.
- `packages/shared/src/protocol/dto.ts:501` — extend `WorkspaceSettings` with flat projections: `vaultPath?`, `daysEnabled?`, `daysMorningTime?`, `daysEveningTime?`, `captureEnabled?`. (No `captureHotkey` here — it's an app-level preference, not workspace-scoped.)
- `packages/server-core/src/handlers/rpc/settings.ts:96` — `SETTINGS_GET` projects new fields out of `config.vault`, `config.days`, `config.capture`.
- `packages/server-core/src/handlers/rpc/settings.ts:121` — `SETTINGS_UPDATE`:
  - extend `validKeys` array with the new **workspace-scoped** keys only (`vaultPath`, `daysEnabled`, `daysMorningTime`, `daysEveningTime`, `captureEnabled`). **Do NOT add `captureHotkey`** — it's app-level, handled by separate RPCs (see below).
  - new branches that write to `config.vault.path`, `config.days[*]`, `config.capture.enabled` (these are top-level objects, not in `defaults` — separate branches like the existing `localMcpEnabled` branch)
  - validate `vaultPath` (path is absolute or relative, exists or can be created), `morningTime`/`eveningTime` (HH:MM regex)
- **App-level hotkey RPCs** (`app.GET_CAPTURE_HOTKEY` / `app.SET_CAPTURE_HOTKEY`) live in `apps/electron/src/main/handlers/settings.ts` (Electron-only), **not** in `packages/server-core/src/handlers/rpc/settings.ts`. server-core stays Electron-agnostic — it must not import `CaptureManager` or any Electron module.

  **Bind-before-commit ordering for `SET_CAPTURE_HOTKEY`** (key correction): never persist a broken accelerator.
  1. Validate the accelerator string syntax (Zod). On invalid → return `{ok: false, error}`, do not touch preferences.
  2. Call `captureManager.setHotkey(newAccelerator)` first. CaptureManager unregisters the old binding, attempts `globalShortcut.register(newAccelerator)`. If `register` returns false (OS conflict) → CaptureManager re-registers the previous accelerator and returns failure.
  3. Only on `setHotkey` success → persist the new value to preferences and emit `app.CAPTURE_HOTKEY_CHANGED` push.
  4. On `setHotkey` failure → preferences stay untouched (still holds the previous working value), emit `app.CAPTURE_HOTKEY_CONFLICT` push, return `{ok: false, error: 'conflict'}` to the caller. App restart will pick up the still-valid old value.
- `apps/electron/src/shared/types.ts` — extend `WorkspaceSettings` shadow type with the new keys.
- `apps/electron/src/renderer/pages/settings/WorkspaceSettingsPage.tsx` — controls for vault path (folder picker, reuse `RPC_CHANNELS.dialog.OPEN_FOLDER`), Days enabled + times, Capture **enabled** (no hotkey UI here).
- `apps/electron/src/renderer/pages/settings/AppSettingsPage.tsx` (or wherever app-level prefs live; check the existing settings registry) — control for **capture hotkey accelerator** using `RPC_CHANNELS.app.GET_CAPTURE_HOTKEY` / `SET_CAPTURE_HOTKEY`.
- `packages/shared/src/config/preferences.ts` — extend `UserPreferences` with `captureHotkey?: string`. Add `UI_ONLY_PREFERENCE_KEYS = new Set(['captureHotkey'])` and make `formatPreferencesForPrompt()` skip those keys so UI-only accelerators never enter `<user_preferences>`.
- `packages/shared/src/config/watcher.ts` — extend the mirrored `UserPreferences` type with `captureHotkey?: string` so app-preferences reads/writes and any future preference-file watch path stay type-consistent.
- **`packages/shared/src/config/watcher.ts:425`** — add a `config.json` (workspace-root) branch and a new `onWorkspaceConfigChange?: (workspaceId: string) => void` callback in `ConfigWatcherCallbacks`. Currently the watcher routes branches for `automations.json`, `permissions.json`, `statuses/`, `labels/`, `sources/`, `skills/`, `sessions/` — but workspace-root `config.json` is unwatched. Without this, vault/days/capture changes won't apply live.

  **Validation-failure policy for external edits**: when the watcher fires for `config.json`, run the new fields through Zod (`vault.path`, `days.morningTime`/`eveningTime` HH:MM, `days.carryForwardMaxRolls`, `capture.enabled`). If validation fails:
  - **Per-field tolerance, not full rollback.** Keep the previous value for any field whose new value is invalid; apply the rest. This avoids a single bad time string blocking a vault path change in the same edit.
  - Emit a `workspace.SETTINGS_INVALID` push (new channel) carrying `{workspaceId, issues: ValidationIssue[]}`. Settings UI surfaces a toast or inline indicator so the user knows their edit didn't fully take.
  - Do **not** rewrite `config.json` from main — the file is the user's source of truth. We just don't apply invalid fields in-memory.
  - Log issues via `deps.platform.logger.warn` for headless visibility (Rocky II).
- `packages/server-core/src/sessions/SessionManager.ts:1333` — pass `onWorkspaceConfigChange` to `ConfigWatcher`. On fire:
  - reload `WorkspaceConfig`
  - rebuild the in-memory `Workspace` object for that workspace
  - update all active agents in that workspace via `agent.refreshWorkspaceConfig(updatedWorkspace)` (the non-destructive same-workspace hot reload — does NOT clear session state, kill subprocesses, or invalidate `sessionId`/`piSessionId`) so existing sessions pick up live vault/days/capture changes on the next turn without restart
  - if vault root or any `days.*` field changed, clear pinned daily context on those agents (`clearPinnedDailyContext()`) so stale `<daily_context>` is not reused after a settings change
  - re-resolve vault root in server-side helpers
  - emit push event `RPC_CHANNELS.workspace.SETTINGS_CHANGED` carrying `{workspaceId, settings: WorkspaceSettings}`
  - if validation found issues, also emit `RPC_CHANNELS.workspace.SETTINGS_INVALID` carrying `{workspaceId, issues}`
  - expose a generic `setOnWorkspaceConfigChange(cb)` hook so Electron main can subscribe for GUI-only reactions such as `CaptureManager.refreshTargetWorkspaces()`, without server-core importing Electron modules
- `packages/shared/src/protocol/channels.ts` — add:
  - `workspace.SETTINGS_CHANGED: 'workspaceSettings:changed'` (push)
  - `app.GET_CAPTURE_HOTKEY: 'app:captureHotkey:get'` (request/response)
  - `app.SET_CAPTURE_HOTKEY: 'app:captureHotkey:set'` (request/response)
  - `app.CAPTURE_HOTKEY_CHANGED: 'app:captureHotkey:changed'` (push)
  - `app.CAPTURE_HOTKEY_CONFLICT: 'app:captureHotkey:conflict'` (push)
  - `workspace.SETTINGS_INVALID: 'workspaceSettings:invalid'` (push)
- `packages/shared/src/protocol/routing.ts` — register the new channels in the routing table.
- `apps/electron/src/transport/channel-map.ts` — register all new channels for the renderer subscription/invocation surface.
- `apps/electron/src/shared/types.ts` — extend `ElectronAPI` with typed methods: `getCaptureHotkey(): Promise<string>`, `setCaptureHotkey(accelerator: string): Promise<{ok: boolean; error?: string}>`, plus subscription methods for the two pushes.
- `apps/electron/src/renderer/contexts/NavigationContext.tsx` (or wherever workspace settings are loaded — `App.tsx:531`, `AppShell.tsx:850`) — subscribe to `workspace.SETTINGS_CHANGED` and update local state. Subscribe to `workspace.SETTINGS_INVALID` here too: surface a workspace-scoped toast listing the failed fields (the same toast component already used for sources/skills load errors). The renderer state simply doesn't update for those fields — the in-memory value stays at the last valid value.
- `apps/electron/src/renderer/pages/settings/AppSettingsPage.tsx` (or equivalent) — subscribe to `app.CAPTURE_HOTKEY_CHANGED` (sync the input value) and `app.CAPTURE_HOTKEY_CONFLICT` (show "accelerator already in use, reverted to previous").


### Verification
- Unit: `resolveVaultRoot` defaulting and override resolution; relative-vs-absolute handling.
- Manual: settings page round-trip — change vault path → folder created → daily files land in the new path. Change ritual times → next-tick fires at the new time without restart (ConfigWatcher).

---

## Feature 3a: Number-key status (low-risk; lands alongside)

### Files to modify
- `apps/electron/src/renderer/components/app-shell/SessionList.tsx` — when focus is in the list and a session is selected, keys `'1'`–`'9'` map to `effectiveSessionStatuses[i-1]?.id` and call existing `handleSessionStatusChange`. No-op when out of range.
- `packages/shared/src/i18n/locales/{en,es,zh-Hans}.json` — `shortcuts.setStatusByPosition` description.

### Verification
- Manual: focus the list, select a session, press `1`–`'9'` → status changes per sidebar position. Verify out-of-range keys no-op.

---

## Feature 2: Capture Inbox

### Files to add
- `packages/shared/src/capture/store.ts` — `captureItem({source, url?, title?, body, tags?}) → filePath` writes `<vault>/inbox/YYYY-MM-DD-HHMMSS-<slug>.md`. Slug derived from title or URL hostname (stable). `listInboxItems(limit)`. `enrichUrl(url): Promise<{title, description}>` fire-and-forget update of frontmatter via `gray-matter`. ID via `generateShortId`.
- `packages/shared/src/capture/__tests__/store.test.ts`.
- `apps/electron/src/main/capture-manager.ts` — **single owner** of:
  1. The OS-global `globalShortcut.register(...)` binding using the app-level `captureHotkey` preference (default `CommandOrControl+Alt+Space`).
  2. An MRU-focus stack of Craft windows, populated via `BrowserWindow.on('focus', …)`.
  3. Resolving the **target workspace** when the hotkey fires:
     - if a Craft window is focused → that window's workspace
     - else → top of MRU stack
     - else (no Craft window ever focused this session) → the workspace resolved at app startup (same default selection logic SessionManager already uses)
  4. **Disabled-workspace fallthrough**: if the resolved target's `workspaceConfig.capture?.enabled` is false, fall through MRU to the next workspace where it's enabled. If no loaded workspace has it enabled, do not register the hotkey at all (no surprise no-op presses).
  5. Opening the frameless capture `BrowserWindow` (~480×320) and passing the resolved `targetWorkspaceId` to its renderer.
  6. Receiving **direct main-process callbacks** when the hotkey or any workspace's `capture.enabled` flag changes:
     - `app.SET_CAPTURE_HOTKEY` in main calls `captureManager.setHotkey(accelerator)` using the bind-before-commit flow above.
     - `SessionManager.setOnWorkspaceConfigChange(cb)` is wired from Electron main at startup. That callback invokes `captureManager.refreshTargetWorkspaces()` when workspace config changes affect capture availability. Server-core remains Electron-agnostic.
     - Clearing pinned daily context for active sessions is handled inside `SessionManager` during workspace-config reload, not by `CaptureManager` and not by Electron main.
     - On accelerator conflict, `CaptureManager` re-registers the previous accelerator and reports failure; the caller emits `app.CAPTURE_HOTKEY_CONFLICT` for the settings UI.

- `apps/electron/src/main/handlers/capture.ts` — `ipcMain.handle('capture:save'|'capture:list'|'capture:enrichUrl', …)` delegating to `@craft-agent/shared/capture`.
- `apps/electron/src/renderer/capture/CaptureWindow.tsx` — capture-window renderer. Input + tag chip + submit, plus a header showing the target workspace name with a dropdown to override per-capture. Used only by the standalone capture window.
- `packages/ui/src/components/capture/CaptureInboxList.tsx` — middle-column list (mounted directly by `AppShell`'s middle-column switch).
- `packages/ui/src/components/capture/CaptureItemView.tsx` — right-pane detail view (mounted directly by `MainContentPanel`'s render branch).

### Files to modify
- `apps/electron/src/main/index.ts` — instantiate `CaptureManager` on `app.whenReady()`, dispose on quit. Power-manager and capture-manager both live in `apps/electron/src/main/`; SessionManager has no Electron globalShortcut concerns.
- **Shared route-prefix constant**: `route-parser.ts:63` and `deep-link.ts:117` currently each have their own copy of `COMPOUND_ROUTE_PREFIXES`. Promote to a single export (e.g. `apps/electron/src/shared/route-prefixes.ts` or extend `apps/electron/src/shared/routes.ts`) and import from both files so adding `'days'`/`'capture'` happens once. **Deep-link shape is `craftagents://capture` and `craftagents://days/2026-05-05`** — no `view/` segment. Same for workspace-targeted form `craftagents://workspace/<id>/days`.
- `apps/electron/src/shared/types.ts:730` — add `CaptureNavigationState { navigator: 'capture'; details: { type: 'item'; id: string } | null }` + `isCaptureNavigation` type guard.
- `apps/electron/src/shared/route-parser.ts:38, 63` — extend `NavigatorType` with `'capture'`; add `'capture'` to `COMPOUND_ROUTE_PREFIXES`; parse `capture` and `capture/item/<id>` routes.
- `apps/electron/src/shared/routes.ts:92` — add `view.capture(itemId?)` route-builder helper.
- `apps/electron/src/renderer/components/app-shell/MainContentPanel.tsx:233` — add render branch `if (isCaptureNavigation(navState)) { return <CaptureItemView ... /> }` for the right pane (selected item detail or empty state).
- `apps/electron/src/renderer/components/app-shell/AppShell.tsx:2247` — top-level "Capture" sidebar entry (between `nav:allSessions` and the separator) gated by `workspaceConfig.capture?.enabled`. Routes to capture view.
- `apps/electron/src/renderer/components/app-shell/AppShell.tsx:3123` — **middle-column render switch**: alongside the existing `isSourcesNavigation`/`isSkillsNavigation`/`isAutomationsNavigation`/`isSettingsNavigation`/`isSessionsNavigation` branches, add `{isCaptureNavigation(navState) && <CaptureInboxList … />}`. Without this branch, the middle column remains empty when navigating to Capture.
- `apps/electron/src/renderer/components/ui/slash-command-menu.tsx:13` — extend `SlashCommandId` with `'capture'` etc. (see Feature 1 for the broader slash extension; capture is one of the new commands).
- `apps/electron/src/renderer/components/app-shell/input/FreeFormInput.tsx:914` — add `'capture'` branch in `handleSlashCommand` that opens an inline single-line capture or saves the trailing arg text directly.
- `packages/shared/src/i18n/locales/{en,es,zh-Hans}.json` — `sidebar.capture`, `capture.*` keys per `packages/shared/CLAUDE.md` rules.

### Verification
- Unit: capture writes file with stable id; list returns sorted by `captured_at` desc; URL enricher handles 404 / non-HTML / 256KB-capped body.
- Manual: press `Cmd+Opt+Space` from outside the app → capture window appears, type, submit → file at `<vault>/inbox/`. Paste a URL → title/description backfill within ~5s.
- Manual: deep links `craftagents://capture` and `craftagents://capture/item/<id>` open the panel (scheme is `craftagents://`, overridable via `CRAFT_DEEPLINK_SCHEME`; no `view/` segment in the URL).

---

## Feature 1: Days

### Task identity (key correction)
Tasks in `tasks.md` need stable IDs so `pullForward`/`dismissForwarding` survive edits. Format:
```markdown
## Today
- [ ] 1:1 with Jane <!--id:t_2k9bzx7-->
- [x] Memo to COO <!--id:t_2k9byc1-->
```
- New tasks added via `/task` get an auto-generated id (`generateShortId`).
- Tasks added by hand without ids get an id auto-assigned on next `readDay`/`writeDay` round-trip.
- Carry-forward operates on ids, not text.
- `tasks.meta.json` (sidecar, optional) stores rolls-count per id for the `carryForwardMaxRolls` cap; absent file = 0 rolls.

### Prompt injection semantics (key correction)
`PromptBuilder.buildContextParts()` runs every user message. Daily context must:
- **Pin per session**, like `pinnedPreferencesPrompt` already does (`prompt-builder.ts:47, 186`). First call computes `<daily_context>`, caches it on the builder; subsequent calls reuse. Cleared by `clearPinnedPreferences()` equivalent on session clear.
- **Truncate** each of tasks/scratch/journal to 4KB (~1k tokens each, ~3k total), with a `[truncated, NN bytes omitted]` marker. Avoids silently bloating every turn.
- **Refresh on date change** within a session: if `dateISO` (cached at pin time) ≠ today, re-pin. Lets a long-running session pick up tomorrow's files at midnight without ending the session.

### Deterministic daily-folder rollover (key correction)
Don't use a prompt automation for `ensureDay`. Instead:
- `AutomationSystem` (or `SchedulerService`) gains a built-in tick listener that calls `ensureDay(today)` directly when the day changes (`previousTick.dateISO !== now.dateISO`). Idempotent.
- On boot/wake, `runRecoverySweep` also calls `ensureDay(today)` directly before running prompt-action recoveries. Folder existence is never blocked on a model call.
- Morning/evening rituals stay as `prompt` actions in `automations.json` — those benefit from the agent voice.

### Files to add
- `packages/shared/src/days/paths.ts` — `getDailyDir(vaultRoot, dateISO)`, `getDayFiles(vaultRoot, dateISO) → {tasks, scratch, journal}`.
- `packages/shared/src/days/store.ts` — `ensureDay(dateISO)` (idempotent; renders templates for missing files), `readDay(dateISO)`, `appendTask(dateISO, section, line)`, `appendScratch`, `appendJournal`, `listRecentDays(n)`, `dayStatus(dateISO) → {hasTasks, completed, total, hasJournal}`. Auto-assigns task ids on read.
- `packages/shared/src/days/carry-forward.ts` — `getIncompleteTasks(yesterdayISO)`, `pullForward(taskId, target)`, `dismissForwarding(taskId)`. Operates on stable ids.
- `packages/shared/src/days/identity.ts` — `formatTodayContext(vaultRoot, dateISO) → {block: string, dateISO: string}` returning truncated `<daily_context>`.
- `packages/shared/src/days/types.ts` — `DayFiles`, `DayStatus`, `IncompleteTask` (with `id`, `text`, `section`, `rolls`).
- `packages/shared/src/days/templates/{tasks,scratch,journal}.md` — bundled defaults.
- `packages/shared/src/days/skills/daily-practice/SKILL.md` + `index.ts` — generic, idempotent NL fallback.
- `packages/shared/src/days/__tests__/store.test.ts`, `carry-forward.test.ts`, `identity.test.ts`.
- `packages/ui/src/components/days/DaysListColumn.tsx` — middle-column UI: mini calendar + recent days list. Mounted directly by `AppShell`'s middle-column switch.
- `packages/ui/src/components/days/DaysMainPane.tsx` — right-pane UI: picks Plan/Reflect by hour-of-day with sticky manual override; renders TasksSubpanel/ScratchSubpanel/JournalSubpanel + CarryForwardBanner. Mounted directly by `MainContentPanel`.
- `packages/ui/src/components/days/{MiniCalendar,RecentDaysList,PlanPane,ReflectPane,CarryForwardBanner,TasksSubpanel,ScratchSubpanel,JournalSubpanel}.tsx` — leaves used by the two parents above.
- `apps/electron/src/main/handlers/days.ts` — `ipcMain.handle('days:read'|'days:write'|'days:list'|'days:appendTask'|'days:carryForward'|'days:dayStatuses', …)`.

### Files to modify
- `packages/shared/src/agent/core/prompt-builder.ts:66` — direct import `import { formatTodayContext } from '../../days/identity.ts'`. Add `pinnedDailyContext: { block: string; dateISO: string } | null = null` field. In `buildContextParts()`, when `this.config.workspace?.config?.days?.enabled`, push the pinned-or-fresh block. Add `clearPinnedDailyContext()` mirroring `clearPinnedPreferences()`. Refresh when `dateISO` no longer matches today.
- **Workspace hot-reload (separate from workspace switch).** `setWorkspace()` on `claude-agent.ts:2452` and `pi-agent.ts:2115` is **destructive** — Claude clears the session ID; Pi clears the session and kills the subprocess. Those overrides are correct for an actual workspace switch but would break active sessions on a same-workspace config edit. Introduce a non-destructive method:
  - `packages/shared/src/agent/backend/types.ts` — add `refreshWorkspaceConfig(workspace: Workspace): void` for same-workspace config hot reload. Keep `setWorkspace(workspace)` for actual workspace switches only.
  - `packages/shared/src/agent/base-agent.ts` — implement `refreshWorkspaceConfig(workspace)` to update `this.config.workspace` and call `this.promptBuilder.setWorkspace(workspace)` without clearing session state. Also update `setWorkspace(workspace)` to call `this.promptBuilder.setWorkspace(workspace)` so the prompt-builder sync is consistent across both paths.
  - `packages/shared/src/agent/claude-agent.ts` — leave `setWorkspace()` as the destructive workspace-switch path; inherit `refreshWorkspaceConfig()` from base, or override only if Claude-specific caches need light refresh without clearing `sessionId`. Also call `clearPinnedDailyContext()` wherever `clearPinnedPreferences()` is called.
  - `packages/shared/src/agent/pi-agent.ts` — same rule: `setWorkspace()` remains destructive for real workspace switches; `refreshWorkspaceConfig()` must not clear `piSessionId` or kill the subprocess.
- `packages/shared/src/automations/automation-system.ts` — daily-rollover tick handler (described above).
- `apps/electron/src/shared/types.ts:730` — add `DaysNavigationState { navigator: 'days'; details: { type: 'date'; id: string /* YYYY-MM-DD */ } | null }` + `isDaysNavigation` type guard.
- `apps/electron/src/shared/route-parser.ts:38, 63` — extend `NavigatorType` with `'days'`; add `'days'` to `COMPOUND_ROUTE_PREFIXES`; parse `days` and `days/<dateISO>` routes.
- `apps/electron/src/shared/routes.ts:92` — add `view.days(dateISO?)` route-builder helper.
- `apps/electron/src/renderer/components/app-shell/MainContentPanel.tsx:233` — add right-pane render branch `if (isDaysNavigation(navState)) { return <DaysMainPane selectedDate={navState.details?.id} /> }` (Plan/Reflect content). Direct mount; no intermediate `DaysPanel` wrapper.
- `apps/electron/src/renderer/components/app-shell/AppShell.tsx:2247` — top-level "Days" sidebar entry (above Capture) when `workspaceConfig.days?.enabled`. Routes to Days view.
- `apps/electron/src/renderer/components/app-shell/AppShell.tsx:3123` — **middle-column render switch**: add `{isDaysNavigation(navState) && <DaysListColumn … />}` rendering the mini calendar + recent days list.
- `apps/electron/src/renderer/contexts/NavigationContext.tsx` — handlers for nav-to-days/capture.
- `apps/electron/src/renderer/components/ui/slash-command-menu.tsx:13` — broaden `SlashCommandId`. Existing union `PermissionMode | 'compact'` is closed and arg-less; the new `task|scratch|journal|today|capture` commands accept trailing arg text. Two practical paths:
  - **(a)** Extend `SlashCommandId` to `... | 'task' | 'scratch' | 'journal' | 'today' | 'capture'` and make `useInlineSlashCommand` capture trailing text after the command id, passing it as a second arg to `onSelectCommand`. Default commands list grows; `defaultCommands` array adds entries.
  - **(b)** Keep `SlashCommandId` for mode-only and add a parallel "vault command" mechanism in `useInlineSlashCommand`. More invasive but cleaner separation.
  - Plan goes with (a) for v1 (less code; matches existing structure).
- `apps/electron/src/renderer/components/app-shell/input/FreeFormInput.tsx:914` — extend `handleSlashCommand` with branches for the new ids; uses `window.electronAPI.days.appendTask(...)` / etc. Keeps execution local (no model round-trip).
- `packages/rocky/src/qmd/lifecycle.ts` — extend with `qmdAddVaultCollections(vaultRoot)` registering `<vault>/daily/` and `<vault>/inbox/`.
- `packages/shared/src/i18n/locales/{en,es,zh-Hans}.json` — `sidebar.days`, `days.*` keys.

### Default `automations.json` rituals (per-vault, not bundled)
```json
{
  "automations": {
    "SchedulerTick": [
      { "id": "days-morning-ritual", "cron": "0 8 * * *", "recovery": "critical", "recoveryGraceMinutes": 240,
        "actions": [{ "type": "prompt", "prompt": "Run skill daily-practice with action=morning" }] },
      { "id": "days-evening-ritual", "cron": "0 19 * * *", "recovery": "soft", "recoveryGraceMinutes": 120,
        "actions": [{ "type": "prompt", "prompt": "Run skill daily-practice with action=evening" }] }
    ]
  }
}
```
(Folder rollover is now in-process, not an automation entry.)

### Verification
- Unit: `ensureDay` idempotent; carry-forward parses Today/Next/Someday sections + ids; status counts; identity context truncation + pinning + date-change refresh.
- Manual: open app, switch to Days; three files created on first visit. Chat in any session, ask "what's on today?" — `<daily_context>` shows up; verify it's the same content across multiple turns (pinning) until midnight.
- Manual: kill app at 7:55am, boot at 8:30am — folder exists immediately (in-process rollover), morning ritual fires (critical recovery).
- Manual: slash `/task buy milk` → appended to today's `Today` section in `tasks.md` with auto-id, no model round-trip.
- Manual: edit `tasks.md` directly to mark a task complete; carry-forward banner reflects on next-day open.

---

## Feature 3b: Sidebar DnD (lands after Days)

### Files to add
- `apps/electron/src/renderer/components/app-shell/SessionDnDContext.tsx` — owns shell-level `<DndContext>`, sensors (PointerSensor 5px activation + KeyboardSensor), drop dispatch table. Listens for `data.type === 'session'` only; coexists with inner `SortableList` DndContext used for status reorder.
- `apps/electron/src/__tests__/session-dnd.test.tsx` — synthetic `DragEndEvent` dispatch tests.

### Files to modify
- `apps/electron/src/renderer/components/app-shell/AppShell.tsx` — wrap shell in `<SessionDnDContext>`. On drop:
  - target `nav:state:<id>` → `handleSessionStatusChange(sessionId, statusId)`
  - target `nav:flagged` → existing flag handler
  - target `nav:archived` → existing archive handler
- Locate session row component (likely under `SessionList.tsx`) — wrap with `useDraggable({id: session.id, data: {type: 'session', sessionId}})`.
- `apps/electron/src/renderer/components/app-shell/LeftSidebar.tsx` — wrap each rendered nav row in `useDroppable({id: link.id, data: {type: 'sidebar-target', linkId: link.id}})` with active-state class. Only `nav:state:*`, `nav:flagged`, `nav:archived` accept `session` drops; others no-op.

### Verification
- Unit: dispatch table tested with synthetic `DragEndEvent` per target type.
- Manual: drag a session onto each status / Flagged / Archived → state changes. Drag onto Sources/separator → no-op. Existing sortable status reorder still works (outer DndContext doesn't eat inner drag events).

---

## Cross-cutting infrastructure (added once, used by all features)

- `WorkspaceConfig` extended with `vault?`, `days?`, `capture?`. `WorkspaceSettings` DTO + `SETTINGS_GET`/`UPDATE` RPC handlers updated. ConfigWatcher propagates changes without app restart.
- `packages/shared/src/vault/` — generic helpers consumed by Days and Capture.
- `last-run-store.ts` — used by recovery; reusable for future "last-X-at" timestamps.
- `webhook-utils.ts` history factories accept `recoveredAt` so `automations-history.jsonl` reflects recovered firings.
- `apps/electron/src/main/power-manager.ts` — gains `powerMonitor` listeners that call `sessionManager.notifyAutomationResume()`. SessionManager owns fan-out to loaded workspaces' AutomationSystems; power-manager only owns OS power events.
- qmd cycle extension stays in `packages/rocky/src/qmd/lifecycle.ts` — upstream Days/Capture code is qmd-agnostic.

## Risks

1. **`croner.previousRun()`** — verify in pinned version. Fallback: minute-walk back from `now`, capped at 7 days.
2. **Slash command extension shape** — `SlashCommandId` is a closed union. Path (a) above grows it; need to pass trailing arg text through `onSelectCommand`. Verify `useInlineSlashCommand` callback signature can carry it without breaking existing callers.
3. **Nested DndContexts** (Feature 3b) — outer shell context vs inner sortable status reorder. De-risked by deferring to after Days lands; can prototype with a flag.
4. **Recovery prompt actions on app start** — `critical` may spawn 1+ agent sessions if Mac was off all night. Accepted by user.
5. **i18n key explosion** — new keys must land in `en.json`, `es.json`, `zh-Hans.json` per `packages/shared/CLAUDE.md`. Reviewer should grep all three.
6. **`Cmd+Opt+Space` collision** — some users rebind Spotlight to this. Hotkey is **app-level** configurable in App Settings; if `globalShortcut.register` returns false (already taken by another app), CaptureManager toasts and reverts.
7. **Pinned daily context staleness** — pinning means edits to today's files mid-session won't show until next session or date rollover. Acceptable (matches preferences pattern); can add a `clearPinnedDailyContext()` slash command if it bites.

## End-to-end verification (after all features)

1. **Days reliability**: power down at 7:55am, power on at 8:45am — `daily/<today>/` exists immediately (in-process rollover), morning ritual fires (critical recovery), `automations-history.jsonl` shows `recovered: true`.
2. **Identity injection**: open new chat, ask "what's on today?" — agent answers from `<daily_context>`; same answer across multiple turns (pinning); next session reflects file edits.
3. **Capture roundtrip**: press `Cmd+Opt+Space` from outside the app, paste a URL, submit — file lands at `<vault>/inbox/<timestamp>-<slug>.md`, frontmatter backfills with title within ~5s, item appears in Capture sidebar list.
4. **Status keys**: select a session, press `1`–`5` → status cycles through configured statuses by sidebar position.
5. **Status DnD** (after 3b): drag a session onto each existing status row, Flagged, Archived → all set correctly.
6. **qmd index**: after a rocky cycle, query qmd for a phrase from a daily/journal entry and a capture entry — both return.
7. **Settings round-trip**: change vault path / ritual times / `capture.enabled` in Workspace Settings → persists to `config.json` → `onWorkspaceConfigChange` fires in server-core → server reloads config, updates active agents' workspace objects, clears pinned daily context if needed, re-resolves vault root, and emits `workspace.SETTINGS_CHANGED` → renderer refreshes sidebar/state without restart. Separately, change capture hotkey in App Settings → `app.SET_CAPTURE_HOTKEY` attempts rebind first, persists only on success, then emits `app.CAPTURE_HOTKEY_CHANGED`.
8. **Invalid external edit**: hand-edit `config.json` to put `daysMorningTime: "99:99"` while leaving `vaultPath` valid. Watcher fires, vault path applies, morning time keeps old value, `workspace.SETTINGS_INVALID` push reaches the UI, toast appears with the issue. Headless: warning shows in the log.
9. **Multi-window capture ownership**: open two workspaces in two windows. Focus window A, press `Cmd+Opt+Space` → capture lands in workspace A's `<vault>/inbox/`. Lose focus, press hotkey → capture lands in most-recently-focused workspace's vault.
10. **Recovery watermark**: induce a downstream prompt failure (e.g., LLM auth error) for a `critical` cron — verify history shows `ok: false`, last-run advanced, cron-recovery does NOT retry on next boot.
