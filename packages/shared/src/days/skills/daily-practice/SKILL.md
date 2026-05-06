---
name: daily-practice
description: Use when the user asks to plan today, reflect on today, add tasks, add scratch notes, journal, review today, or manage daily practice notes.
---

# Daily Practice

Use the workspace daily files as the source of truth:

- Tasks live in `<vault>/daily/YYYY-MM-DD/tasks.md`.
- Scratch notes live in `<vault>/daily/YYYY-MM-DD/scratch.md`.
- Journal notes live in `<vault>/daily/YYYY-MM-DD/journal.md`.

When the user asks to plan the day, review today's tasks and scratch first, then propose a concise plan. When the user asks to reflect, summarize what changed, what remains open, and what should carry forward.

If the user writes in Dutch, respond in Dutch. If the user asks informally for "vandaag", "dagplanning", "reflectie", or "taken", treat that as a daily-practice request.
