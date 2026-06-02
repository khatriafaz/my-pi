# my-pi

Opinionated pi setup for Afaz.

This repository contains Afaz's personal [`pi`](https://github.com/khatriafaz/my-pi) extension setup.

## What's included

- **`update_plan` tool** — a Codex-style planning/checklist tool for agents, with one active `in_progress` step at a time.
- **`/plan` command** — shows the current task plan in the TUI or prints it in non-UI mode.
- **Conversation resources** — a session-scoped resource tracker for important links, PRs, docs, notes, and references.
- **`/resources` command** — list, add, edit, remove, or clear saved conversation resources.
- **Automatic URL saving** — URLs mentioned by the user are auto-saved as conversation resources.
- **Resource sidebar widget** — saved resources are displayed in the pi UI when available.
- **`/exit` command** — cleanly exits pi.

## Files

- `index.ts` is intentionally minimal and only wires feature modules into pi.
- `update-plan.ts` registers the `update_plan` tool, `/plan` command, and plan status UI.
- `exit-command.ts` registers the `/exit` command.
- `conversation-resources.ts` registers the `conversation_resources` tool, `/resources` command, URL auto-save behavior, and resource UI widgets.

## Purpose

This setup makes pi feel more like Afaz's preferred agent workflow: persistent task planning, visible working context, quick resource management, and a clean exit command.
