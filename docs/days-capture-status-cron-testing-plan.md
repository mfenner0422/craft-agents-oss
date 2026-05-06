# Days, Capture, Status, Cron Recovery Testing Plan

This plan validates the stacked PR set for cron recovery, vault/workspace config, status shortcuts, capture, Days, and sidebar session drag/drop. Run it against the top branch of each stack when reviewing independently, and against the latest integrated branch for full end-to-end validation.

## Test Result Legend

- Pass: behavior matches expected result.
- Fail: behavior does not match expected result; record branch, exact step, logs, and screenshots if UI-related.
- Blocked: cannot run because setup, branch stack, credentials, OS permission, or app startup is not ready.
- Risk accepted: behavior is known incomplete and explicitly deferred.

## Phase 0: Environment and Branch Setup

Goal: confirm the repo, dependencies, branches, and Electron runtime are in a known state.

1. Check current repo state.
   - Command: `git status --short --branch`
   - Expected: current branch is the branch under test; only known untracked plan/review docs appear.

2. Install dependencies.
   - Command: `bun install`
   - Expected: install completes without package changes unless intentionally updating the lockfile.

3. Confirm branch stack exists.
   - Command: `git branch --list 'codex/pr*'`
   - Expected: PR branches 1 through 6 plus fix-up branches 1.5, 2.5, 3.5, 4.5, 5a-d, 6 redo, and 6b exist locally or can be fetched.

4. Start the app for manual tests.
   - Command: `bun run dev:electron`
   - Expected: Electron launches and can select/open a workspace.

## Phase 1: Automated Regression Suite

Goal: catch compile, routing, i18n, and shared logic regressions before manual testing.

1. Cron recovery tests.
   - Command: `bun test packages/shared/src/automations/__tests__/recovery.test.ts packages/shared/src/automations/event-bus.test.ts packages/shared/src/automations/handlers/prompt-handler.test.ts packages/shared/src/automations/handlers/webhook-handler.test.ts`
   - Expected: all tests pass.

2. Vault tests.
   - Command: `bun test packages/shared/src/vault/__tests__/path.test.ts`
   - Expected: all tests pass.

3. Capture and Days tests.
   - Command: `bun test packages/shared/src/capture/__tests__/store.test.ts packages/shared/src/days/__tests__/store.test.ts apps/electron/src/transport/__tests__/channel-map-parity.test.ts`
   - Expected: all tests pass.

4. Shared typecheck.
   - Command: `bun run typecheck:shared`
   - Expected: no TypeScript errors.

5. Electron typecheck.
   - Command: `bun run typecheck:electron`
   - Expected: no TypeScript errors.

6. Shared UI typecheck.
   - Command: `cd packages/ui && bun run tsc --noEmit && cd ../..`
   - Expected: no TypeScript errors.

7. i18n parity.
   - Command: `bun run lint:i18n:parity`
   - Expected: parity check passes.

8. Whitespace check.
   - Command: `git diff --check`
   - Expected: no whitespace errors.

## Phase 2: Cron Recovery Manual Tests

Goal: verify boot and wake recovery semantics, watermarks, skipped history, and race hardening.

Use a disposable workspace and a test `automations.json` with minute-level cron matchers:

```json
{
  "automations": {
    "SchedulerTick": [
      {
        "id": "test-critical",
        "cron": "* * * * *",
        "recovery": "critical",
        "actions": [{ "type": "webhook", "url": "https://example.com/test-critical" }]
      },
      {
        "id": "test-soft",
        "cron": "* * * * *",
        "recovery": "soft",
        "recoveryGraceMinutes": 2,
        "actions": [{ "type": "webhook", "url": "https://example.com/test-soft" }]
      },
      {
        "id": "test-none",
        "cron": "* * * * *",
        "recovery": "none",
        "actions": [{ "type": "webhook", "url": "https://example.com/test-none" }]
      }
    ]
  }
}
```

1. Start app and wait for a scheduled minute.
   - Expected: `automations-last-run.json` appears with matcher IDs and scheduled timestamps.

2. Quit before the next scheduled minute; restart within two minutes.
   - Expected: critical and soft recovered firings dispatch; none is skipped and watermark advances.

3. Quit before a scheduled minute; restart after more than two minutes.
   - Expected: critical dispatches; soft and none are skipped and logged.

4. Inspect `automations-history.jsonl`.
   - Expected: recovered entries include `recovered: true` and `recoveredAt`; skipped entries include `skipped: true`, `recovered: false`, `scheduledAt`, and `reason`.

5. Trigger close wake events.
   - Method: sleep/wake the Mac or use a short manual lock/unlock cycle.
   - Expected: no duplicate recovered firings from overlapping resume/unlock sweeps.

6. Inspect `automations-last-run.json`.
   - Expected: values are scheduled firing times, not wake time or completion time.

## Phase 3: Vault and Workspace Settings

Goal: verify vault resolution, workspace config live reload, prompt-builder refresh, and app-level capture hotkey persistence.

1. Enable Days and Capture in Workspace Settings.
   - Expected: settings save and persist across Settings reopen.

2. Set vault path to a temporary folder.
   - Expected: folder is created; Days and Capture write under that vault.

3. Edit workspace `config.json` externally with valid Days values.
   - Expected: app reloads config without switching workspaces; settings page updates.

4. Edit workspace `config.json` externally with one invalid value and one valid value.
   - Example invalid: `"morningTime": "99:99"`
   - Expected: invalid setting is rejected/warned; valid setting still applies.

5. Change capture hotkey to an obviously invalid accelerator.
   - Expected: UI reports failure and persisted preference remains unchanged.

6. Change capture hotkey to a valid accelerator.
   - Expected: hotkey rebinds before preference persistence; app restart uses the new value.

7. Prompt-builder refresh check.
   - Start an active chat, change Days/vault settings, then send another message.
   - Expected: daily context refreshes without destructive session/workspace reset.

## Phase 4: Capture Inbox

Goal: verify global capture window, workspace targeting, file creation, enrichment safety, and capture list visibility.

1. Enable Capture in exactly one workspace.
   - Expected: global capture hotkey is registered.

2. Press capture hotkey while Craft Agents is focused.
   - Expected: frameless capture window opens targeting the focused workspace.

3. Save a note-only capture.
   - Expected: one markdown file appears in `<vault>/inbox/`.

4. Save a URL capture.
   - Expected: markdown file includes `url` in frontmatter; title/description backfill if enrichment succeeds.

5. Press capture hotkey while another app is focused.
   - Expected: capture window targets the most recently focused enabled workspace.

6. Disable Capture for all workspaces.
   - Expected: hotkey no longer opens the capture window.

7. Re-enable Capture in a different workspace.
   - Expected: hotkey opens capture for the enabled workspace.

8. Try unsafe enrichment inputs.
   - Inputs: `file:///etc/passwd`, `data:text/html,test`, `ftp://example.com`
   - Expected: enrichment rejects or no-ops safely; capture flow does not crash.

9. Verify capture sidebar entry position and count.
   - Expected: Capture appears in the sessions group and count updates after refresh/reopen.

## Phase 5: Days

Goal: verify day creation, markdown rendering, editing, daily context, slash commands, mini calendar, Plan/Reflect toggle, and carry-forward.

1. Enable Days and open the Days sidebar item.
   - Expected: today is created under `<vault>/daily/YYYY-MM-DD/`.

2. Verify files.
   - Expected: `tasks.md`, `scratch.md`, and `journal.md` exist.

3. Verify markdown rendering.
   - Put headings, checkboxes, and links in a daily file.
   - Expected: Days pane renders markdown, not raw `#` headings in `<pre>`.

4. Edit each daily file from the UI.
   - Files: tasks, scratch, journal.
   - Expected: Save persists to disk and survives reopening Days.

5. Toggle Plan/Reflect.
   - Expected: selected mode changes visually and stays until pane remount.

6. Mini calendar.
   - Create multiple dated folders.
   - Expected: calendar shows dots for days with content and selecting a day loads it.

7. Carry-forward banner.
   - Create yesterday’s `tasks.md` with `- [ ] Follow up <!-- task:test123 -->`.
   - Open today.
   - Expected: banner appears listing unfinished task.

8. Pull forward.
   - Expected: today’s `tasks.md` gets the unfinished task with the same ID.

9. Pull forward again.
   - Expected: no duplicate `task:test123`.

10. Slash commands.
   - Test `/task`, `/scratch`, `/journal`, `/today`, `/capture`.
   - Expected: slash token is removed and mapped command submits through chat.

11. Daily prompt injection.
   - Ask an agent what is in today’s daily context.
   - Expected: response can reference current tasks/scratch/journal.

## Phase 6: Status Keyboard

Goal: verify number-key status changes and modifier safety.

1. Focus a session row and press `1`.
   - Expected: session status changes to first sidebar status.

2. Press `2` through `9`.
   - Expected: each maps to status by sidebar order; out-of-range positions no-op.

3. Press modified shortcuts.
   - Inputs: `Cmd+1`, `Ctrl+1`, `Alt+1`.
   - Expected: no status change.

4. Hold `1`.
   - Expected: no repeated status-update storm.

5. Multi-select sessions and press `1`.
   - Expected: all selected sessions update.

## Phase 7: Sidebar Session Drag and Drop

Goal: verify `@dnd-kit/core` session dragging, drop-zone feedback, status target behavior, and preservation of status reorder.

1. Drag a session row to a status row.
   - Expected: status target highlights; session status changes.

2. Drag a session row to Flagged.
   - Expected: target highlights; session becomes flagged.

3. Drag a session row to Archived.
   - Expected: target highlights; session archives.

4. Reorder status rows when not dragging a session.
   - Expected: status reorder still works.

5. Drag random text from another app over the sidebar.
   - Expected: no status/flag/archive operation occurs.

6. Keyboard sensor smoke.
   - Use keyboard drag activation if supported by browser focus.
   - Expected: no crash; if keyboard DnD is not discoverable, record as UX follow-up.

## Phase 8: Integrated End-to-End Smoke

Goal: validate the whole feature set in one real workflow.

1. Create or select a disposable workspace.
2. Configure a vault path.
3. Enable Days and Capture.
4. Open Days and edit today’s tasks/scratch/journal.
5. Capture a URL with the global hotkey.
6. Use `/today` in chat.
7. Change a session status with number keys.
8. Drag a session to another status.
9. Add an automation with cron recovery, quit, and restart after a missed tick.
10. Restart the app.

Expected: Days files persist, Capture inbox persists, daily context remains accurate, status changes persist, DnD still works, and cron recovery watermarks/history are correct.

## Exit Criteria

The feature set is ready for deeper review when:

- All automated checks pass.
- Cron recovery manual tests pass for `critical`, `soft`, and `none`.
- Capture works both app-focused and app-unfocused.
- Days supports creation, edit, carry-forward, slash commands, and prompt injection.
- Status number keys and sidebar DnD work without breaking status reorder.
- Any remaining gaps are documented as explicit follow-ups rather than hidden regressions.
