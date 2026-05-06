# Codex Cloud Agent Prompt — Implement Days, Capture, Status DnD/Keyboard, Cron Recovery

You are implementing a multi-PR feature set in the repository at `/Users/mfenner/dev/craft-agents-oss` on branch `rocky`.

Read these two files first and treat them as the source of truth:

- `/Users/mfenner/dev/craft-agents-oss/docs/days-capture-status-cron-plan.md`
- `/Users/mfenner/dev/craft-agents-oss/docs/days-capture-status-cron-pr-checklist.md`

## Objective

Implement the full plan described in those docs, using the PR breakdown from the checklist. The implementation must stay upstream-merge-clean so each PR can be proposed independently.

## Required execution model

Work **PR by PR**, in this exact order:

1. PR 1 — Cron Recovery
2. PR 2 — Vault + Workspace Config Infrastructure
3. PR 3 — Status Keys 1–9
4. PR 4 — Capture Inbox
5. PR 5 — Days
6. PR 6 — Sidebar DnD
7. PR 7 — Web Parity is deferred; do not implement unless explicitly requested later

Do **not** batch multiple PR scopes together unless a shared prerequisite is explicitly listed in the checklist.

## Hard constraints

- Do not add new packages.
- Keep code locations aligned with the plan:
  - shared logic in `packages/shared/src/{vault,days,capture}/`
  - shared UI in `packages/ui/src/components/{days,capture}/`
  - Electron-specific code in `apps/electron/src/...`
- Preserve Electron-only scope for v1 where the plan says web parity is deferred.
- Treat the plan’s locked decisions as final.
- Do not silently change file formats, storage locations, routing shapes, or ownership boundaries from the plan.

## Architectural rules you must preserve

- `CaptureManager` owns app-global hotkey binding, MRU window tracking, and target-workspace selection.
- App-level capture hotkey lives in preferences, not workspace config.
- `SessionManager` owns server-side fan-out and same-workspace config reload handling.
- Same-workspace config reload must use the **non-destructive** `refreshWorkspaceConfig(workspace)` path, not destructive `setWorkspace(workspace)`.
- `setWorkspace(workspace)` remains the destructive path for actual workspace switches.
- `AutomationSystem` is the single last-run watermark write site.
- Cron recovery stores the **scheduled firing time**, not wake time or completion time.
- `power-manager` only owns OS power events and calls `sessionManager.notifyAutomationResume()`.

## Quality bar

For each PR:

- Implement only the checklist scope for that PR.
- Add or update tests where the plan calls for them.
- Run the relevant test suites and targeted verification for the touched area.
- Update i18n in `en.json`, `es.json`, and `zh-Hans.json` whenever adding user-facing text.
- Verify no obvious TypeScript, lint, or build regressions in touched packages.

## Delivery format

For each PR, provide:

1. A concise summary of what was implemented.
2. The key files changed.
3. Tests run and their results.
4. Any deviations from the plan, with justification.
5. Any blockers or unresolved risks.

## Implementation notes

- Start by implementing **PR 1 only**.
- After finishing PR 1, summarize completion against the checklist before moving to PR 2.
- Continue sequentially unless blocked.
- If you discover that the plan conflicts with the codebase in a material way, stop and report the exact conflict with file references and a proposed resolution.
- Do not rewrite the plan docs unless a factual correction is required.

## Definition of done

The task is complete when PRs 1 through 6 are implemented in sequence, with tests and verification matching the plan and checklist, and with no unapproved scope drift.
